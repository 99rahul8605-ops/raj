const { InlineKeyboard } = require('grammy');
const settingsRepo = require('../../db/settings');
const logsRepo = require('../../db/logs');
const session = require('../../utils/session');
const { api } = require('../../services/telegram');

async function showStorageMenu(ctx) {
  const currentId = await settingsRepo.getSetting('storage_channel_id');
  const envId = require('../../config/env').storageChannelId;
  const effective = currentId ? Number(currentId) : envId;

  const kb = new InlineKeyboard();
  kb.text('✏️ Set Storage Channel ID', 'astorage:set').row();
  if (effective) {
    kb.text('✅ Test Connection', 'astorage:test').row();
  }
  kb.text('⬅️ Back', 'admin:panel').row();

  let text = '💾 Storage Settings\n\n';
  text += `Current Storage Channel ID: ${effective || '❌ Not set'}\n\n`;
  text += 'The Storage Channel is a PRIVATE Telegram channel where content is stored.\n\n';
  text += 'Setup:\n';
  text += '1. Create a private channel\n';
  text += '2. Add the bot as admin with "Post Messages" permission\n';
  text += '3. Get the channel\'s numeric ID (starts with -100...)\n';
  text += '4. Set it here\n';

  await ctx.editMessageText(text, { reply_markup: kb });
}

async function startSet(ctx) {
  session.set(ctx.from.id, { flow: 'storage_set' });
  await ctx.reply('📝 Send the numeric Storage Channel ID (starts with -100...):');
  await ctx.answerCallbackQuery();
}

async function handleTextInput(ctx) {
  const s = session.get(ctx.from.id);
  if (!s || s.flow !== 'storage_set') return false;

  const text = ctx.message.text.trim();
  const channelId = Number(text);
  if (Number.isNaN(channelId)) {
    await ctx.reply('⚠️ Invalid ID. Must be numeric.');
    return true;
  }

  await settingsRepo.setSetting('storage_channel_id', channelId, ctx.from.id);
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'set_storage_channel',
    target: text,
    details: { channelId },
  });
  session.clear(ctx.from.id);
  await ctx.reply(`✅ Storage Channel ID set to ${channelId}.`);
  return true;
}

async function testConnection(ctx) {
  const channelId = await settingsRepo.getSetting('storage_channel_id');
  const effective = channelId ? Number(channelId) : require('../../config/env').storageChannelId;

  if (!effective) {
    await ctx.answerCallbackQuery({ text: 'No storage channel configured.', show_alert: true });
    return;
  }

  try {
    const chat = await api.getChat(effective);
    await ctx.answerCallbackQuery({
      text: `✅ Connected! Chat: ${chat.title || 'OK'}`,
      show_alert: true,
    });
  } catch (err) {
    await ctx.answerCallbackQuery({
      text: `❌ Failed: ${err.message}`,
      show_alert: true,
    });
  }
}

module.exports = { showStorageMenu, startSet, handleTextInput, testConnection };
