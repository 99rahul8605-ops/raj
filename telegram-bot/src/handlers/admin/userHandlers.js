const { InlineKeyboard } = require('grammy');
const usersRepo = require('../../db/users');
const logsRepo = require('../../db/logs');
const session = require('../../utils/session');

async function showUsersMenu(ctx) {
  const total = await usersRepo.countUsers();
  const active = await usersRepo.countActiveSince(7);
  const newUsers = await usersRepo.countNewSince(7);

  const kb = new InlineKeyboard();
  kb.text('🔍 Search by ID', 'auser:search').row();
  kb.text('🔍 Search by Username', 'auser:search_user').row();
  kb.text('⬅️ Back', 'admin:panel').row();

  await ctx.editMessageText(
    `👥 Users\n\n` +
    `📊 Total users: ${total}\n` +
    `🟢 Active (7d): ${active}\n` +
    `🆕 New (7d): ${newUsers}`,
    { reply_markup: kb }
  );
}

async function startSearch(ctx, byUsername) {
  session.set(ctx.from.id, { flow: 'user_search', byUsername: !!byUsername });
  await ctx.reply(byUsername ? '🔍 Send the username to search:' : '🔍 Send the Telegram ID to search:');
  await ctx.answerCallbackQuery();
}

async function handleTextInput(ctx) {
  const s = session.get(ctx.from.id);
  if (!s || s.flow !== 'user_search') return false;

  const query = ctx.message.text.trim();
  session.clear(ctx.from.id);

  let result;
  if (s.byUsername) {
    result = await usersRepo.searchUser(query);
  } else {
    result = await usersRepo.searchUser(query);
  }

  const users = Array.isArray(result) ? result : [result];
  const found = users.filter(Boolean);

  if (found.length === 0) {
    await ctx.reply('❌ No users found.');
    return true;
  }

  for (const u of found.slice(0, 5)) {
    await showUserDetail(ctx, u);
  }
  return true;
}

async function showUserDetail(ctx, user) {
  const kb = new InlineKeyboard();
  kb.text(`${user.is_blocked ? '✅ Unblock' : '🚫 Block'}`, `auser:block:${user.telegram_id}`).row();
  kb.text('⬅️ Back', 'admin:users').row();

  let text = `👤 User Info\n\n`;
  text += `🆔 ID: ${user.telegram_id}\n`;
  text += `👤 Name: ${user.first_name || '—'}\n`;
  text += `📛 Username: ${user.username ? '@' + user.username : '—'}\n`;
  text += `📅 Joined: ${new Date(user.joined_at).toLocaleString()}\n`;
  text += `🕐 Last active: ${new Date(user.last_activity).toLocaleString()}\n`;
  text += `🚫 Blocked: ${user.is_blocked ? 'Yes' : 'No'}`;

  await ctx.reply(text, { reply_markup: kb });
}

async function toggleBlock(ctx, telegramId) {
  const user = await usersRepo.getUser(telegramId);
  const newBlocked = !user.is_blocked;
  await usersRepo.setBlocked(telegramId, newBlocked);
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: newBlocked ? 'block_user' : 'unblock_user',
    target: String(telegramId),
    details: { telegramId },
  });
  await ctx.answerCallbackQuery(newBlocked ? '🚫 User blocked.' : '✅ User unblocked.');
  const updated = await usersRepo.getUser(telegramId);
  await showUserDetail(ctx, updated);
}

module.exports = {
  showUsersMenu,
  startSearch,
  handleTextInput,
  showUserDetail,
  toggleBlock,
};
