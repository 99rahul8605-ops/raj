const { InlineKeyboard } = require('grammy');
const forceJoinRepo = require('../../db/forceJoin');
const logsRepo = require('../../db/logs');
const session = require('../../utils/session');

async function showForceJoinMenu(ctx) {
  const channels = await forceJoinRepo.listChannels();
  const kb = new InlineKeyboard();
  for (const ch of channels) {
    const icon = ch.is_enabled ? '✅' : '❌';
    const type = ch.requires_approval ? 'Request' : 'Normal';
    const label = ch.channel_link ? `🔗 ${type}` : (ch.channel_username ? `@${ch.channel_username}` : `ID:${ch.channel_id}`);
    kb.text(`${icon} ${truncate(ch.button_name, 25)} (${truncate(label, 20)})`, `afj:${ch.id}`).row();
  }
  kb.text('➕ Add Channel', 'afj:add').row();
  kb.text('⬅️ Back', 'admin:panel').row();
  await ctx.editMessageText(
    '📢 Force Join Channels\n\nAdd channels users must join before accessing content.\n\n' +
    'Two types supported:\n' +
    '• Normal — users join directly via link or @username\n' +
    '• Request — users send a join request, bot checks if request was sent\n\n' +
    'The bot must be an admin in each channel.',
    { reply_markup: kb }
  );
}

async function showChannelDetail(ctx, channelId) {
  const ch = await forceJoinRepo.listChannels().then((all) => all.find((c) => c.id === channelId));
  if (!ch) {
    await ctx.answerCallbackQuery({ text: 'Channel not found.', show_alert: true });
    return;
  }
  const kb = new InlineKeyboard();
  kb.text('✏️ Edit Button Name', `afj:edit_name:${channelId}`).row();
  kb.text('🔗 Edit Link', `afj:edit_link:${channelId}`).row();
  kb.text('👤 Edit Username', `afj:edit_user:${channelId}`).row();
  kb.text('🆔 Edit Channel ID', `afj:edit_id:${channelId}`).row();
  kb.text(`${ch.requires_approval ? '✅' : '❌'} Request Channel (Join Request)`, `afj:toggle_approval:${channelId}`).row();
  kb.text(`${ch.is_enabled ? 'Disable' : 'Enable'}`, `afj:toggle:${channelId}`).row();
  kb.text('🗑️ Delete', `afj:delete:${channelId}`).row();
  kb.text('⬅️ Back', 'admin:forcejoin');

  let text = `📢 Channel: ${ch.button_name}\n`;
  text += `Link: ${ch.channel_link || '—'}\n`;
  text += `Username: ${ch.channel_username ? '@' + ch.channel_username : '—'}\n`;
  text += `Channel ID: ${ch.channel_id || '—'}\n`;
  text += `Request Channel: ${ch.requires_approval ? 'Yes' : 'No'}\n`;
  if (ch.requires_approval) {
    text += `Auto Link: ${ch.channel_id || ch.channel_username ? 'ON (bot creates the request link itself)' : 'OFF — set Channel ID to enable'}\n`;
  }
  text += `Status: ${ch.is_enabled ? 'Enabled' : 'Disabled'}`;

  await ctx.editMessageText(text, { reply_markup: kb });
  await ctx.answerCallbackQuery();
}

// Multi-step add flow:
// Step 1: send link or username
// Step 2: send channel ID (needed for verification)
// Step 3: choose Normal or Request type
async function startAdd(ctx) {
  session.set(ctx.from.id, { flow: 'fj_add', step: 1 });
  await ctx.reply(
    '📝 Add a Force Join Channel — Step 1/3\n\n' +
    'Send the channel invite link (e.g. https://t.me/+AbCdEf) or @username (without @).\n\n' +
    'For a Request channel you can send /skip — the bot will then create the request link AUTOMATICALLY (you only need the Channel ID in the next step).\n\n' +
    'The bot must be an admin in the channel (with the "Invite Users" permission for auto links).'
  );
  await ctx.answerCallbackQuery();
}

async function startEditName(ctx, channelId) {
  session.set(ctx.from.id, { flow: 'fj_edit_name', channelId });
  await ctx.reply('📝 Send the new button name:');
  await ctx.answerCallbackQuery();
}

async function startEditLink(ctx, channelId) {
  session.set(ctx.from.id, { flow: 'fj_edit_link', channelId });
  await ctx.reply('📝 Send the new invite link (e.g. https://t.me/+AbCdEf), or /skip to clear:');
  await ctx.answerCallbackQuery();
}

async function startEditUsername(ctx, channelId) {
  session.set(ctx.from.id, { flow: 'fj_edit_user', channelId });
  await ctx.reply('📝 Send the new @username (without @), or /skip to clear:');
  await ctx.answerCallbackQuery();
}

async function startEditId(ctx, channelId) {
  session.set(ctx.from.id, { flow: 'fj_edit_id', channelId });
  await ctx.reply('📝 Send the new numeric channel ID (starts with -100...), or /skip to clear:');
  await ctx.answerCallbackQuery();
}

async function toggleChannel(ctx, channelId) {
  const channels = await forceJoinRepo.listChannels();
  const ch = channels.find((c) => c.id === channelId);
  await forceJoinRepo.updateChannel(channelId, { is_enabled: !ch.is_enabled });
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'toggle_forcejoin',
    target: ch.button_name,
    details: { channelId, enabled: !ch.is_enabled },
  });
  await showChannelDetail(ctx, channelId);
}

async function toggleApproval(ctx, channelId) {
  const channels = await forceJoinRepo.listChannels();
  const ch = channels.find((c) => c.id === channelId);
  await forceJoinRepo.updateChannel(channelId, { requires_approval: !ch.requires_approval });
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'toggle_forcejoin_approval',
    target: ch.button_name,
    details: { channelId, requires_approval: !ch.requires_approval },
  });
  await showChannelDetail(ctx, channelId);
}

async function deleteChannel(ctx, channelId) {
  const channels = await forceJoinRepo.listChannels();
  const ch = channels.find((c) => c.id === channelId);
  await forceJoinRepo.deleteChannel(channelId);
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'delete_forcejoin',
    target: ch?.button_name,
    details: { channelId },
  });
  await ctx.answerCallbackQuery('🗑️ Channel removed.');
  await showForceJoinMenu(ctx);
}

async function handleTextInput(ctx) {
  const s = session.get(ctx.from.id);
  if (!s || !s.flow || !s.flow.startsWith('fj_')) return false;

  const text = ctx.message.text.trim();

  // Multi-step add flow
  if (s.flow === 'fj_add') {
    if (s.step === 1) {
      let link = null;
      let username = null;
      if (text === '/skip') {
        // no manual link: bot will auto-generate one (needs channel ID in step 2)
      } else if (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('t.me/')) {
        link = text;
      } else {
        username = text.replace(/^@/, '');
      }
      session.update(ctx.from.id, { step: 2, link, username });
      await ctx.reply(
        '📝 Step 2/3 — Channel ID\n\n' +
        'Send the numeric channel ID (starts with -100...).\n\n' +
        'How to find it: forward a message from the channel to @userinfobot, or check the channel link for private channels (t.me/c/123456 → the ID is -100123456).\n\n' +
        'The bot needs this ID to verify membership. Send /skip if you only have a public @username (the bot can verify via username instead).'
      );
      return true;
    }

    if (s.step === 2) {
      let channelId = null;
      if (text !== '/skip') {
        channelId = Number(text);
        if (Number.isNaN(channelId)) {
          await ctx.reply('⚠️ Invalid numeric ID. Please send a number (e.g. -100123456789), or /skip.');
          return true;
        }
      } else if (!s.link && !s.username) {
        await ctx.reply('⚠️ You skipped the link, so the Channel ID is required (e.g. -100123456789).');
        return true;
      }
      session.update(ctx.from.id, { step: 3, channelId });
      const kb = new InlineKeyboard();
      kb.text('Normal (Direct Join)', 'afj_type:normal').row();
      kb.text('Request (Join Request)', 'afj_type:request').row();
      kb.text('❌ Cancel', 'afj_type:cancel');
      await ctx.reply(
        '📝 Step 3/3 — Channel Type\n\n' +
        'Choose the channel type:\n\n' +
        '• Normal — users join directly via the link\n' +
        '• Request — users send a join request (channel has "Approve new members" enabled). The bot creates the request link automatically (when Channel ID is set) and checks if the request was sent.',
        { reply_markup: kb }
      );
      return true;
    }

    return true;
  }

  if (s.flow === 'fj_edit_name') {
    await forceJoinRepo.updateChannel(s.channelId, { button_name: text });
    await logsRepo.logAction({
      adminId: ctx.from.id,
      action: 'edit_forcejoin_name',
      target: text,
      details: { channelId: s.channelId },
    });
    session.clear(ctx.from.id);
    await ctx.reply('✅ Button name updated.');
    return true;
  }

  if (s.flow === 'fj_edit_link') {
    const link = text === '/skip' ? null : text;
    await forceJoinRepo.updateChannel(s.channelId, { channel_link: link });
    session.clear(ctx.from.id);
    await ctx.reply('✅ Link updated.');
    return true;
  }

  if (s.flow === 'fj_edit_user') {
    const username = text === '/skip' ? null : text.replace(/^@/, '');
    await forceJoinRepo.updateChannel(s.channelId, { channel_username: username });
    session.clear(ctx.from.id);
    await ctx.reply('✅ Username updated.');
    return true;
  }

  if (s.flow === 'fj_edit_id') {
    let channelId = null;
    if (text !== '/skip') {
      channelId = Number(text);
      if (Number.isNaN(channelId)) {
        await ctx.reply('⚠️ Invalid numeric ID. Please send a number.');
        return true;
      }
    }
    await forceJoinRepo.updateChannel(s.channelId, { channel_id: channelId });
    session.clear(ctx.from.id);
    await ctx.reply('✅ Channel ID updated.');
    return true;
  }

  return false;
}

// Handle the type selection callback from step 3 of add flow
async function handleTypeSelection(ctx, type) {
  const s = session.get(ctx.from.id);
  if (!s || s.flow !== 'fj_add' || s.step !== 3) {
    await ctx.answerCallbackQuery({ text: 'Session expired. Start again.', show_alert: true });
    return;
  }

  if (type === 'cancel') {
    session.clear(ctx.from.id);
    await ctx.editMessageText('❌ Channel add cancelled.');
    await ctx.answerCallbackQuery();
    return;
  }

  const requiresApproval = type === 'request';
  const { link, username, channelId } = s;

  await forceJoinRepo.addChannel({
    channelId,
    channelUsername: username,
    channelLink: link,
    buttonName: `Channel ${Date.now().toString().slice(-4)}`,
    requiresApproval,
  });
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'add_forcejoin',
    target: link || username || String(channelId),
    details: { channelId, username, link, requiresApproval },
  });
  session.clear(ctx.from.id);
  const autoNote = requiresApproval && !channelId && !username
    ? '\n\n⚠️ No Channel ID set — auto link is OFF, the saved link will be used. Add the Channel ID to enable auto links.'
    : (requiresApproval ? '\n\n🔗 Auto request link is ON.' : '');
  await ctx.editMessageText('✅ Channel added successfully! You can edit its name and settings from the channel detail page.' + autoNote);
  await ctx.answerCallbackQuery('✅ Added!');
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = {
  showForceJoinMenu,
  showChannelDetail,
  startAdd,
  startEditName,
  startEditLink,
  startEditUsername,
  startEditId,
  toggleChannel,
  toggleApproval,
  deleteChannel,
  handleTextInput,
  handleTypeSelection,
};
