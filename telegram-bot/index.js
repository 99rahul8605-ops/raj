// PATH: telegram-bot/index.js
require('dotenv').config();

const { bot } = require('./src/services/telegram');
const { isSuperAdmin, isAdmin, adminOnly, hasPermission } = require('./src/services/permissions');
const { PERMISSIONS } = require('./src/config/constants');
const userHandlers = require('./src/handlers/user/userHandlers');
const humanVerificationHandler = require('./src/handlers/user/humanVerification');
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
});

bot.use(async (ctx, next) => {
  if (ctx.callbackQuery) return next();
  if (ctx.update?.chat_join_request || ctx.update?.chat_member || ctx.update?.my_chat_member) return next();
  if (ctx.chat?.type && ctx.chat.type !== 'private') {
    return;
  }
  return next();
});

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
  const s = session.get(ctx.from.id);
  if (s?.flow === 'content_upload' && (isSuperAdmin(ctx.from.id) || await hasPermission(ctx.from.id, PERMISSIONS.UPLOAD_CONTENT))) {
    return contentHandlers.finishUpload(ctx);
  }
});

bot.command('cancel', async (ctx) => {
  session.clear(ctx.from.id);
  await ctx.reply('✅ Operation cancelled.');
});

bot.command('verify', async (ctx) => {
  await humanVerificationHandler.startHumanVerification(ctx);
});

bot.command('cancel_session', async (ctx) => {
  await humanVerificationHandler.cancel(ctx);
});

// ---- User callbacks ----

bot.callbackQuery('join_channels', async (ctx) => {
  await userHandlers.handleJoinChannels(ctx);
});

bot.callbackQuery('check_join', async (ctx) => {
  await userHandlers.handleCheckJoin(ctx);
});

bot.callbackQuery('verify_robot', async (ctx) => {
  await userHandlers.handleVerifyRobot(ctx);
});

bot.callbackQuery('see_videos', async (ctx) => {
  await userHandlers.handleSeeVideos(ctx);
});

bot.callbackQuery(/^open_folder:(.*)$/, async (ctx) => {
  const folderId = ctx.match?.[1];
  if (folderId === 'null' || !folderId) {
    await userHandlers.showFolderView(ctx, null);
  } else {
    await userHandlers.handleOpenFolder(ctx, folderId);
  }
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^view_content:(.*)$/, async (ctx) => {
  await userHandlers.handleViewContent(ctx, ctx.match[1]);
});

// Human verification OTP keypad
bot.callbackQuery(/^hv_otp\|/, async (ctx) => {
  await humanVerificationHandler.handleOtpCallback(ctx);
});

// ---- Admin callbacks ----

bot.callbackQuery('admin:panel', async (ctx) => {
  const uid = ctx.from.id;
  if (!await isAdmin(uid)) {
    return ctx.answerCallbackQuery({ text: 'Not an admin.', show_alert: true });
  }
  await adminRouter.showPanel(ctx);
});

bot.callbackQuery(/^admin:(.+)$/, async (ctx) => {
  const uid = ctx.from.id;
  if (!await isAdmin(uid)) {
    return ctx.answerCallbackQuery({ text: 'Not an admin.', show_alert: true });
  }
  await adminRouter.routeAdminCallback(ctx);
});

bot.callbackQuery(/^(afolder|acfolder|acitem|acupload|acedit_title|acedit_desc|actoggle|acdelete|acaccess|afj|afj_type|awelcome|abc|auser|aadmin|astorage|asettings):(.+)$/, async (ctx) => {
  const uid = ctx.from.id;
  if (!await isAdmin(uid)) {
    return ctx.answerCallbackQuery({ text: 'Not an admin.', show_alert: true });
  }
  await adminRouter.routeAdminSubCallback(ctx);
});

// ---- Text message handling ----

bot.on('message:text', async (ctx, next) => {
  // Human verification password / wrong-stage handling
  if (await humanVerificationHandler.tryHandlePassword(ctx)) return;
  if (await humanVerificationHandler.tryHandleWrongStageText(ctx)) return;

  const isSkip = /^\/skip(@\w+)?$/i.test(ctx.message.text.trim());
  if (ctx.message.text.startsWith('/') && !isSkip) return next();

  const handled = await adminRouter.routeAdminText(ctx);
  if (handled) return;

  return next();
});

// Contact handler for human verification
bot.on('message:contact', async (ctx) => {
  await humanVerificationHandler.handleContact(ctx);
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

// Join requests & member updates
bot.on('chat_join_request', async (ctx) => {
  try {
    const { recordJoinRequest } = require('./src/services/forceJoin');
    const req = ctx.update.chat_join_request;
    await recordJoinRequest(req.chat.id, req.from.id, req.chat.title);
  } catch (err) {
    logger.error('Join request tracking error:', err.message);
  }
});

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