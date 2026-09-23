const { InlineKeyboard } = require('grammy');
const broadcastService = require('../../services/broadcast');
const logsRepo = require('../../db/logs');
const session = require('../../utils/session');
const logger = require('../../utils/logger');

async function showBroadcastMenu(ctx) {
  const kb = new InlineKeyboard();
  kb.text('📝 Text Broadcast', 'abc:text').row();
  kb.text('🖼️ Photo + Caption', 'abc:photo').row();
  kb.text('🎬 Video + Caption', 'abc:video').row();
  kb.text('📜 Recent Broadcasts', 'abc:history').row();
  kb.text('⬅️ Back', 'admin:panel').row();
  await ctx.editMessageText(
    '📢 Broadcast\n\nSend a message to all users. Rate limiting is applied to respect Telegram limits.',
    { reply_markup: kb }
  );
}

async function startText(ctx) {
  session.set(ctx.from.id, { flow: 'bc_text' });
  await ctx.reply('📝 Send the text message to broadcast (HTML supported):');
  await ctx.answerCallbackQuery();
}

async function startPhoto(ctx) {
  session.set(ctx.from.id, { flow: 'bc_photo' });
  await ctx.reply('🖼️ Send the photo to broadcast (with optional caption):');
  await ctx.answerCallbackQuery();
}

async function startVideo(ctx) {
  session.set(ctx.from.id, { flow: 'bc_video' });
  await ctx.reply('🎬 Send the video to broadcast (with optional caption):');
  await ctx.answerCallbackQuery();
}

// Handle media/text input for broadcast flows
async function handleInput(ctx) {
  const s = session.get(ctx.from.id);
  if (!s || !s.flow || !s.flow.startsWith('bc_')) return false;

  const msg = ctx.message;

  if (s.flow === 'bc_text') {
    if (!msg.text) {
      await ctx.reply('⚠️ Please send a text message.');
      return true;
    }
    session.clear(ctx.from.id);
    await runBroadcast(ctx, 'text', { text: msg.text });
    return true;
  }

  if (s.flow === 'bc_photo') {
    if (!msg.photo) {
      await ctx.reply('⚠️ Please send a photo.');
      return true;
    }
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const caption = msg.caption || '';
    session.clear(ctx.from.id);
    await runBroadcast(ctx, 'photo', { photo: fileId, caption });
    return true;
  }

  if (s.flow === 'bc_video') {
    if (!msg.video) {
      await ctx.reply('⚠️ Please send a video.');
      return true;
    }
    const fileId = msg.video.file_id;
    const caption = msg.caption || '';
    session.clear(ctx.from.id);
    await runBroadcast(ctx, 'video', { video: fileId, caption });
    return true;
  }

  return false;
}

async function runBroadcast(ctx, messageType, payload) {
  await ctx.reply('⏳ Broadcast started...');

  let progressMsg = null;
  try {
    progressMsg = await ctx.reply('📊 Progress: 0% (0 sent)');
  } catch (err) {
    logger.warn('Could not send progress message:', err.message);
  }

  let lastUpdate = 0;
  const result = await broadcastService.sendBroadcast(ctx.from.id, messageType, payload, (p) => {
    const now = Date.now();
    // Throttle progress updates to every 2 seconds
    if (progressMsg && now - lastUpdate > 2000) {
      lastUpdate = now;
      const pct = Math.round((p.sent / p.total) * 100);
      api_editText(ctx, progressMsg.chat.id, progressMsg.message_id,
        `📊 Progress: ${pct}% (${p.sent}/${p.total} sent, ${p.success} ok, ${p.failed} failed)`)
        .catch(() => {});
    }
  });

  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'broadcast',
    target: messageType,
    details: { total: result.total, success: result.success, failed: result.failed },
  });

  await ctx.reply(
    `✅ Broadcast Complete\n\n` +
    `📊 Total users: ${result.total}\n` +
    `✅ Delivered: ${result.success}\n` +
    `❌ Failed: ${result.failed}`
  );
}

async function api_editText(ctx, chatId, messageId, text) {
  const { api } = require('../../services/telegram');
  await api.editMessageText(text, { chat_id: chatId, message_id: messageId });
}

async function showHistory(ctx) {
  const broadcastRepo = require('../../db/broadcasts');
  const broadcasts = await broadcastRepo.listBroadcasts(10);
  if (broadcasts.length === 0) {
    await ctx.answerCallbackQuery('No broadcasts yet.');
    return;
  }
  let text = '📜 Recent Broadcasts\n\n';
  for (const b of broadcasts) {
    const date = new Date(b.created_at).toLocaleString();
    text += `• ${date}\n  Type: ${b.message_type} | Total: ${b.total} | ✅ ${b.success} | ❌ ${b.failed} | ${b.status}\n\n`;
  }
  const kb = new InlineKeyboard().text('⬅️ Back', 'admin:broadcast');
  await ctx.editMessageText(text, { reply_markup: kb });
  await ctx.answerCallbackQuery();
}

module.exports = {
  showBroadcastMenu,
  startText,
  startPhoto,
  startVideo,
  handleInput,
  showHistory,
};
