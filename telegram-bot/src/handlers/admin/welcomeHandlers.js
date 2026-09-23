const { InlineKeyboard } = require('grammy');
const settingsRepo = require('../../db/settings');
const logsRepo = require('../../db/logs');
const session = require('../../utils/session');

const EDITABLE = [
  { key: 'welcome_text', label: '👋 Welcome Text', multiline: true },
  { key: 'demo_image', label: '🖼️ Demo Image (file_id or URL)', multiline: false },
  { key: 'instructions_text', label: '📝 Instructions Text', multiline: true },
  { key: 'join_button_text', label: '📢 Join Button Text', multiline: false },
  { key: 'check_button_text', label: '✅ Check Join Button Text', multiline: false },
  { key: 'videos_button_text', label: '📚 See Videos Button Text', multiline: false },
  { key: 'back_button_text', label: '⬅️ Back Button Text', multiline: false },
  { key: 'panel_button_text', label: '⚙️ Admin Panel Button Text', multiline: false },
];

async function showWelcomeMenu(ctx) {
  const settings = await settingsRepo.getAllSettings();
  const kb = new InlineKeyboard();
  for (const e of EDITABLE) {
    kb.text(e.label, `awelcome:${e.key}`).row();
  }
  kb.text('👁️ Preview Welcome', 'awelcome:preview').row();
  kb.text('⬅️ Back', 'admin:panel').row();

  let text = '📝 Welcome Page Management\n\nCurrent values:\n';
  text += `\n• Welcome Text: ${truncate(settings.welcome_text, 60)}`;
  text += `\n• Demo Image: ${settings.demo_image ? '✅ Set' : '❌ None'}`;
  text += `\n• Instructions: ${truncate(settings.instructions_text, 60)}`;
  text += `\n• Join Button: ${settings.join_button_text}`;
  text += `\n• Check Button: ${settings.check_button_text}`;
  text += `\n• Videos Button: ${settings.videos_button_text}`;

  await ctx.editMessageText(text, { reply_markup: kb });
}

async function startEdit(ctx, key) {
  const entry = EDITABLE.find((e) => e.key === key);
  if (!entry) return;
  session.set(ctx.from.id, { flow: 'welcome_edit', key });
  const current = await settingsRepo.getSetting(key);
  await ctx.reply(
    `📝 Edit: ${entry.label}\n\nCurrent value:\n${current || '(empty)'}\n\nSend the new value${entry.multiline ? ' (multi-line supported)' : ''}:`
  );
  await ctx.answerCallbackQuery();
}

async function handleTextInput(ctx) {
  const s = session.get(ctx.from.id);
  if (!s || s.flow !== 'welcome_edit') return false;

  const text = ctx.message.text;
  await settingsRepo.setSetting(s.key, text, ctx.from.id);
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'edit_welcome',
    target: s.key,
    details: { value: truncate(text, 200) },
  });
  session.clear(ctx.from.id);
  await ctx.reply('✅ Welcome page setting updated.');
  return true;
}

async function preview(ctx) {
  const settings = await settingsRepo.getAllSettings();
  let text = settings.welcome_text || '👋 Welcome!';
  if (settings.instructions_text) text += `\n\n${settings.instructions_text}`;

  const { welcomeKeyboard } = require('../../keyboards/keyboards');
  const kb = await welcomeKeyboard();

  if (settings.demo_image && settings.demo_image.trim()) {
    try {
      await ctx.replyWithPhoto(settings.demo_image, { caption: text, parse_mode: 'HTML', reply_markup: kb });
    } catch (err) {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    }
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
  await ctx.answerCallbackQuery();
}

function truncate(s, n) {
  if (!s) return '(empty)';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = { showWelcomeMenu, startEdit, handleTextInput, preview };
