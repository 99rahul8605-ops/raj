// PATH: telegram-bot/src/services/telegram.js
const { Bot } = require('grammy');
const env = require('../config/env');
const logger = require('../utils/logger');

const bot = new Bot(env.botToken);

// Harmless Telegram errors should never spam the logs or abort a handler:
//  - answerCallbackQuery: "query is too old" / "query ID is invalid" (button tap expired)
//  - editMessageText: "message is not modified" (same text tapped twice)
bot.api.config.use(async (prev, method, payload, signal) => {
  const t0 = Date.now();
  const res = await prev(method, payload, signal);
  const ms = Date.now() - t0;
  if (ms > 1500 && method !== 'getUpdates') logger.warn(`SLOW Telegram API ${method}: ${ms}ms`);
  if (!res.ok) {
    const desc = res.description || '';
    if (method === 'answerCallbackQuery' && /query is too old|query ID is invalid/i.test(desc)) {
      return { ok: true, result: true };
    }
    if (
      (method === 'editMessageText' || method === 'editMessageReplyMarkup') &&
      /message is not modified/i.test(desc)
    ) {
      return { ok: true, result: true };
    }
  }
  return res;
});

// Expose raw API for cases where we need it outside of middleware context
const api = bot.api;

module.exports = { bot, api };
