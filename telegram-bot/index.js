// PATH: telegram-bot/index.js
require('dotenv').config();

const { bot } = require('./src/services/telegram');
const { isSuperAdmin, isAdmin, adminOnly, hasPermission } = require('./src/services/permissions');
const { PERMISSIONS } = require('./src/config/constants');
const userHandlers = require('./src/handlers/user/userHandlers');
const adminRouter = require('./src/handlers/admin');
const folderHandlers = require('./src/handlers/admin/folderHandlers');
const contentHandlers = require('./src/handlers/admin/contentHandlers');
const forceJoinHandlers = require('./src/handlers/admin/forceJoinHandlers');
const welcomeHandlers = require('./src/handlers/admin/welcomeHandlers');
const broadcastHandlers = require('./src/handlers/admin/broadcastHandlers');
const userAdminHandlers = require('./src/handlers/admin/userHandlers');
const adminMgmtHandlers = require('./src/handlers/admin/adminHandlers');
const storageHandlers = require('./src/handlers/admin/storageHandlers');
const settingsHandlers = require('./src/handlers/admin/settingsHandlers');
const session = require('./src/utils/session');
const logger = require('./src/utils/logger');
const { ensureSuperAdmin } = require('./src/utils/bootstrap');
const { startHealthServer } = require('./src/services/health');

// ---- Middleware ----

// SPEED FIX: grammY long polling handles updates strictly one after another, so
// one slow update (content sending, broadcast, slow DB call) froze the bot for
// everybody. This runs different users in parallel, while keeping the updates
// of the SAME user in order (needed for the multi-step admin flows).
const userQueues = new Map();
bot.use((ctx, next) => {
  const key = ctx.from?.id ?? ctx.chat?.id ?? 'system';
  const arrived = Date.now();
  const previous = userQueues.get(key) || Promise.resolve();
  const run = previous.then(() => {
    const waited = Date.now() - arrived;
    return Promise.resolve(next()).finally(() => {
      const total = Date.now() - arrived;
      if (total > 1500) {
        const type = Object.keys(ctx.update).find((k) => k !== 'update_id');
        const what = ctx.callbackQuery?.data || ctx.message?.text?.slice(0, 20) || '';
        const lag = ctx.message?.date ? `, telegram delivery lag ${Math.round(Date.now() / 1000 - ctx.message.date)}s` : '';
        logger.warn(`SLOW update ${type} "${what}": waited ${waited}ms in queue + handled in ${total - waited}ms${lag}`);
      }
    });
  });
  const tail = run.catch(() => {});
  userQueues.set(key, tail);
  tail.then(() => {
    if (userQueues.get(key) === tail) userQueues.delete(key);
  });
  run.catch((err) => logger.error('Bot error:', err.message, err.stack));
  // Intentionally NOT returning the promise: polling continues immediately.
});

// Only respond in private chats (not groups) unless it's an admin command
bot.use(async (ctx, next) => {
  // Allow callback queries (they come from button taps in private chats)
  if (ctx.callbackQuery) return next();
  // Join requests and member updates originate from the channel and must reach the tracker.
  if (ctx.update?.chat_join_request || ctx.update?.chat_member || ctx.update?.my_chat_member) return next();
  if (ctx.chat?.type && ctx.chat.type !== 'private') {
    return; // silently ignore group messages
  }
  return next();
});

// Error wrapper
bot.catch((err) => {
  logger.error('Bot error:', err.message, err.stack);
});

// ---- Commands ----

bot.command('start', async (ctx) => {
  try {
    await userHandlers.handleStart(ctx);
  } catch (err) {
    logger.error('Start error:', err.message);
    await ctx.reply('⚠️ Something went wrong. Please try again.');
  }
});

bot.command('admin', async (ctx) => {
  const uid = ctx.from.id;
  if (!await isAdmin(uid)) {
    return ctx.reply('⛔️ You are not an admin.');
  }
    const perms = await (require('./src/services/permissions')).getEffectivePermissions(uid);
  const { adminPanelKeyboard } = require('./src/keyboards/keyboards');
  const kb = adminPanelKeyboard(perms);
  const role = isSuperAdmin(uid) ? '👑 Super Admin' : '👨‍💼 Sub-Admin';
  await ctx.reply(`⚙️ ADMIN PANEL\n\nRole: ${role}\n\nSelect an option:`, { reply_markup: kb });
});

bot.command('done', async (ctx) => {
  // Handled in admin text router for upload flow; if not in flow, ignore
  const s = session.get(ctx.from.id);
  if (s?.flow === 'content_upload' && (isSuperAdmin(ctx.from.id) || await hasPermission(ctx.from.id, PERMISSIONS.UPLOAD_CONTENT))) {
    return contentHandlers.finishUpload(ctx);
  }
});

bot.command('cancel', async (ctx) => {
  session.clear(ctx.from.id);
  await ctx.reply('✅ Operation cancelled.');
});

// ---- User callbacks ----

bot.callbackQuery('join_channels', async (ctx) => {
  await userHandlers.handleJoinChannels(ctx);
});

bot.callbackQuery('check_join', async (ctx) => {
  await userHandlers.handleCheckJoin(ctx);
});

bot.callbackQuery('see_videos', async (ctx) => {
  await userHandlers.handleSeeVideos(ctx);
});

// Folder navigation: open_folder:<id>
bot.callbackQuery(/^open_folder:(.*)$/, async (ctx) => {
  const folderId = ctx.match?.[1];
  if (folderId === 'null' || !folderId) {
    await userHandlers.showFolderView(ctx, null);
  } else {
    await userHandlers.handleOpenFolder(ctx, folderId);
  }
  await ctx.answerCallbackQuery();
});

// View content: view_content:<id>
bot.callbackQuery(/^view_content:(.*)$/, async (ctx) => {
  await userHandlers.handleViewContent(ctx, ctx.match[1]);
});

// ---- Admin callbacks ----

// Admin panel entry: admin:panel
bot.callbackQuery('admin:panel', async (ctx) => {
  const uid = ctx.from.id;
  if (!await isAdmin(uid)) {
    return ctx.answerCallbackQuery({ text: 'Not an admin.', show_alert: true });
  }
  await adminRouter.showPanel(ctx);
});

// All admin: callbacks
bot.callbackQuery(/^admin:(.+)$/, async (ctx) => {
  const uid = ctx.from.id;
  if (!await isAdmin(uid)) {
    return ctx.answerCallbackQuery({ text: 'Not an admin.', show_alert: true });
  }
  await adminRouter.routeAdminCallback(ctx);
});

// All other admin sub-callbacks (afolder:, acfolder:, etc.)
bot.callbackQuery(/^(afolder|acfolder|acitem|acupload|acedit_title|acedit_desc|actoggle|acdelete|acaccess|afj|afj_type|awelcome|abc|auser|aadmin|astorage|asettings):(.+)$/, async (ctx) => {
  const uid = ctx.from.id;
  if (!await isAdmin(uid)) {
    return ctx.answerCallbackQuery({ text: 'Not an admin.', show_alert: true });
  }
  await adminRouter.routeAdminSubCallback(ctx);
});

// ---- Text message handling (for multi-step flows) ----

bot.on('message:text', async (ctx, next) => {
  // Skip commands (handled above). Exception: /skip is used inside admin flows
  // (clear description/link/username, skip content name) so it must reach them.
  const isSkip = /^\/skip(@\w+)?$/i.test(ctx.message.text.trim());
  if (ctx.message.text.startsWith('/') && !isSkip) return next();

  // Try admin text flows first
  const handled = await adminRouter.routeAdminText(ctx);
  if (handled) return;

  return next();
});

// Media messages during upload flow
bot.on('message', async (ctx, next) => {
  const s = session.get(ctx.from.id);
  if (s?.flow === 'content_upload' && (isSuperAdmin(ctx.from.id) || await hasPermission(ctx.from.id, PERMISSIONS.UPLOAD_CONTENT))) {
    const handled = await contentHandlers.collectUploadMessage(ctx);
    if (handled) return;
  }
  return next();
});

// Track join requests for request-based channels (no auto-approval)
bot.on('chat_join_request', async (ctx) => {
  try {
    const { recordJoinRequest } = require('./src/services/forceJoin');
    // NOTE: the raw update is ctx.update.chat_join_request (ctx.chat_join_request does not exist)
    const req = ctx.update.chat_join_request;
    const chatId = req.chat.id;
    const userId = req.from.id;
    const title = req.chat.title;
    await recordJoinRequest(chatId, userId, title);
  } catch (err) {
    logger.error('Join request tracking error:', err.message);
  }
});

// Track approval/leave events for request-based force-join channels. A
// pending request alone never unlocks the bot; approval must arrive first.
bot.on('chat_member', async (ctx) => {
  try {
    const update = ctx.update.chat_member;
    const { recordChatMemberUpdate } = require('./src/services/forceJoin');
    await recordChatMemberUpdate(update.chat.id, update.new_chat_member, update.old_chat_member);
  } catch (err) {
    logger.error('Chat member status update error:', err.message);
  }
});

// ---- Startup ----

async function main() {
  const healthServer = startHealthServer();
  await ensureSuperAdmin();
  await bot.start({
    allowed_updates: [
      'message',
      'edited_message',
      'callback_query',
      'chat_join_request',
      'chat_member',
      'my_chat_member',
    ],
    onStart: (me) => {
      logger.info(`Bot started as @${me.username}`);
    },
  });
}

main().catch((err) => {
  logger.error('Fatal startup error:', err.message, err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason?.message || reason);
});

process.once('SIGTERM', () => {
  bot.stop();
  process.exit(0);
});
