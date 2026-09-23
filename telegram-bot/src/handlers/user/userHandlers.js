// PATH: telegram-bot/src/handlers/user/userHandlers.js
const { api } = require('../../services/telegram');
const settingsRepo = require('../../db/settings');
const forceJoinRepo = require('../../db/forceJoin');
const foldersRepo = require('../../db/folders');
const contentRepo = require('../../db/content');
const usersRepo = require('../../db/users');
const storageService = require('../../services/storage');
const forceJoinService = require('../../services/forceJoin');
const { welcomeKeyboard, joinKeyboard, folderKeyboard } = require('../../keyboards/keyboards');
const { isSuperAdmin, isAdmin } = require('../../services/permissions');
const logger = require('../../utils/logger');
const referralsRepo = require('../../db/referrals');
const { botUsername } = require('../../config/env');

async function handleStart(ctx) {
  const uid = ctx.from.id;
  const user = ctx.from;
  const startPayload = typeof ctx.match === 'string' ? ctx.match.trim() : '';

  const [existingUser, admin, settings, channels] = await Promise.all([
    usersRepo.getUser(uid),
    isAdmin(uid),
    settingsRepo.getAllSettings(),
    forceJoinRepo.listEnabledChannels(),
  ]);

  if (existingUser?.is_blocked) {
    return ctx.reply('⛔️ You have been blocked from using this bot.');
  }

  await usersRepo.upsertUser(user);

  let text = settings.welcome_text || '👋 Welcome!';
  if (settings.instructions_text) text += `\n\n${settings.instructions_text}`;

  const kb = await welcomeKeyboard(settings, channels);

  if (settings.demo_image && settings.demo_image.trim()) {
    try {
      await ctx.replyWithPhoto(settings.demo_image, { caption: text, parse_mode: 'HTML', reply_markup: kb });
    } catch (err) {
      logger.warn('Demo image failed, sending text:', err.message);
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    }
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }

  usersRepo.touchActivity(uid).catch((err) => logger.warn('touchActivity failed:', err.message));
  if (!existingUser && startPayload.startsWith('ref_')) {
    referralsRepo.registerReferral(startPayload.slice(4), uid)
      .catch((err) => logger.warn('registerReferral failed:', err.message));
  }

  if (admin) {
    const adminKb = new (require('grammy').InlineKeyboard)().text(settings.panel_button_text, 'admin:panel');
    await ctx.reply('👨‍💼 You have admin access.', { reply_markup: adminKb });
  }
}

async function handleJoinChannels(ctx) {
  const [channels, settings] = await Promise.all([
    forceJoinRepo.listEnabledChannels(),
    settingsRepo.getAllSettings(),
  ]);

  if (channels.length === 0) {
    return handleSeeVideos(ctx);
  }

  const kb = await joinKeyboard(settings, channels);

  const text = `📢 To access our content, please join all the channels below.\n\n` +
    `Click each Join button, then come back and tap "${settings.check_button_text}".`;

  try {
    await ctx.editMessageText(text, { reply_markup: kb });
  } catch (err) {
    await ctx.reply(text, { reply_markup: kb });
  }
  await ctx.answerCallbackQuery();
}

async function handleCheckJoin(ctx) {
  const uid = ctx.from.id;
  const { allJoined, missing, channels } = await forceJoinService.checkAllChannels(uid, { fresh: true });

  if (allJoined) {
    referralsRepo.markReferralValid(uid).catch((err) => logger.warn('markReferralValid failed:', err.message));
    const settings = await settingsRepo.getAllSettings();
    const { InlineKeyboard } = require('grammy');
    const kb = new InlineKeyboard().text(settings.videos_button_text, 'see_videos');
    const requestVerified = channels.some((channel) => channel.requires_approval);
    await ctx.answerCallbackQuery('✅ Verified!');
    await ctx.editMessageText(
      requestVerified
        ? '✅ Join request received and verified! You can now access our content library.'
        : '✅ Membership verified! You can now access our content library.',
      { reply_markup: kb }
    );
  } else {
    const { getChannelUrl } = require('../../services/forceJoin');
    const names = missing.map((ch) => {
      const name = ch.button_name || 'Channel';
      const url = getChannelUrl(ch);
      return url ? `${name} (${url})` : name;
    }).join('\n');
    await ctx.answerCallbackQuery({
      text: `❌ You haven't joined ${missing.length} channel(s) yet:\n\n${names}\n\nPlease join all channels and try again.`,
      show_alert: true,
    });
  }
}

async function handleSeeVideos(ctx) {
  const uid = ctx.from.id;
  const { allJoined, channels } = await forceJoinService.checkAllChannels(uid);

  if (channels.length > 0 && !allJoined) {
    return ctx.answerCallbackQuery({
      text: '❌ Please join all required channels first, then click Check Join.',
      show_alert: true,
    });
  }

  // ─── Human verification gate ───
  const settings = await settingsRepo.getAllSettings();
  if (settings.human_verify_enabled === 'true') {
    const user = await usersRepo.getUser(uid);
    if (!user?.human_verified) {
      await ctx.answerCallbackQuery();
      const humanVerify = require('./humanVerification');
      return humanVerify.startHumanVerification(ctx);
    }
  }

  referralsRepo.markReferralValid(uid).catch((err) => logger.warn('markReferralValid failed:', err.message));
  usersRepo.touchActivity(uid).catch(() => {});
  await showFolderView(ctx, null);
  await ctx.answerCallbackQuery();
}

async function showFolderView(ctx, parentId) {
  let breadcrumb = [];
  if (parentId) {
    breadcrumb = await foldersRepo.getFolderPath(parentId);
  }

  const kb = await folderKeyboard(parentId, breadcrumb);

  let title;
  if (breadcrumb.length === 0) {
    title = '📚 Content Library\n\nSelect a category:';
  } else {
    const names = breadcrumb.map((f) => f.name).join(' › ');
    title = `📁 ${names}\n\nSelect an option:`;
  }

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(title, { reply_markup: kb });
    } catch (err) {
      await ctx.reply(title, { reply_markup: kb });
    }
  } else {
    await ctx.reply(title, { reply_markup: kb });
  }
}

async function handleOpenFolder(ctx, folderId) {
  await showFolderView(ctx, folderId);
  await ctx.answerCallbackQuery();
}

async function handleViewContent(ctx, contentId) {
  const item = await contentRepo.getContent(contentId);
  if (!item || !item.is_active) {
    await ctx.answerCallbackQuery({ text: 'Content not available.', show_alert: true });
    return;
  }

  await usersRepo.touchActivity(ctx.from.id);
  const access = await referralsRepo.canAccessContent(ctx.from.id, item);
  if (!access.allowed) {
    const { completed, required } = access.progress;
    const link = botUsername ? `\n\nYour referral link:\nhttps://t.me/${botUsername}?start=ref_${ctx.from.id}` : '';
    await ctx.answerCallbackQuery({
      text: `Referral progress: ${completed}/${required}. Remaining: ${required - completed}.`,
      show_alert: true,
    });
    await ctx.reply(
      `Daily referral requirement: ${required}\nCompleted: ${completed}/${required}\nRemaining: ${required - completed}${link}`,
    );
    return;
  }
  await contentRepo.markUnlocked(ctx.from.id, contentId, access.progress?.date);
  await ctx.answerCallbackQuery('Loading content...');

  const result = await storageService.sendStoredContent(ctx.chat.id, item);
  if (!result.success) {
    await ctx.reply('⚠️ Could not retrieve this content. Please try again later.');
  }
}

module.exports = {
  handleStart,
  handleJoinChannels,
  handleCheckJoin,
  handleSeeVideos,
  handleOpenFolder,
  handleViewContent,
  showFolderView,
};