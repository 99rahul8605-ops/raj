const { InlineKeyboard } = require('grammy');
const adminRepo = require('../../db/admins');
const logsRepo = require('../../db/logs');
const session = require('../../utils/session');
const { PERMISSIONS, PERMISSION_LABELS, ALL_PERMISSIONS } = require('../../config/constants');
const { isSuperAdmin } = require('../../services/permissions');

async function showAdminsMenu(ctx) {
  const admins = await adminRepo.listAdmins();
  const kb = new InlineKeyboard();
  for (const a of admins) {
    const icon = a.is_super ? '👑' : '👨‍💼';
    const name = a.username ? '@' + a.username : String(a.telegram_id);
    kb.text(`${icon} ${truncate(name, 25)}`, `aadmin:${a.telegram_id}`).row();
  }
  kb.text('➕ Add Admin', 'aadmin:add').row();
  kb.text('⬅️ Back', 'admin:panel').row();
  await ctx.editMessageText(
    '👨‍💼 Admin Management\n\n👑 = Super Admin (full access)\n👨‍💼 = Sub-Admin (permission-based)',
    { reply_markup: kb }
  );
}

async function showAdminDetail(ctx, telegramId) {
  if (isSuperAdmin(telegramId)) {
    const kb = new InlineKeyboard().text('⬅️ Back', 'admin:admins');
    await ctx.editMessageText(
      `👑 Super Admin\n\nID: ${telegramId}\n\nThis account has full access and cannot be removed or restricted.`,
      { reply_markup: kb }
    );
    await ctx.answerCallbackQuery();
    return;
  }

  const admin = await adminRepo.getAdminWithPerms(telegramId);
  if (!admin) {
    await ctx.answerCallbackQuery({ text: 'Admin not found.', show_alert: true });
    return;
  }

  const kb = new InlineKeyboard();
  kb.text('🔑 Manage Permissions', `aadmin:perms:${telegramId}`).row();
  kb.text('🗑️ Remove Admin', `aadmin:remove:${telegramId}`).row();
  kb.text('⬅️ Back', 'admin:admins').row();

  let text = `👨‍💼 Sub-Admin\n\n`;
  text += `🆔 ID: ${admin.telegram_id}\n`;
  text += `📛 Username: ${admin.username ? '@' + admin.username : '—'}\n`;
  text += `📅 Added: ${new Date(admin.created_at).toLocaleString()}\n`;
  text += `\n🔑 Permissions (${admin.permissions.length}):`;
  for (const p of admin.permissions) {
    text += `\n  ✅ ${PERMISSION_LABELS[p] || p}`;
  }
  if (admin.permissions.length === 0) text += `\n  (none)`;

  await ctx.editMessageText(text, { reply_markup: kb });
  await ctx.answerCallbackQuery();
}

async function showPermissionsMenu(ctx, telegramId) {
  const current = await adminRepo.getPermissions(telegramId);
  const kb = new InlineKeyboard();
  for (const p of ALL_PERMISSIONS) {
    const has = current.includes(p);
    kb.text(`${has ? '✅' : '⬜'} ${PERMISSION_LABELS[p]}`, `aadmin:toggle_perm:${telegramId}:${p}`).row();
  }
  kb.text('⬅️ Back', `aadmin:${telegramId}`).row();
  await ctx.editMessageText(
    `🔑 Permissions for ${telegramId}\n\nTap to toggle each permission:`,
    { reply_markup: kb }
  );
  await ctx.answerCallbackQuery();
}

async function togglePermission(ctx, telegramId, permission) {
  if (isSuperAdmin(telegramId)) {
    return ctx.answerCallbackQuery({ text: 'Cannot modify Super Admin.', show_alert: true });
  }
  const current = await adminRepo.getPermissions(telegramId);
  if (current.includes(permission)) {
    await adminRepo.revokePermission(telegramId, permission);
    await logsRepo.logAction({
      adminId: ctx.from.id,
      action: 'revoke_permission',
      target: permission,
      details: { adminId: telegramId },
    });
  } else {
    await adminRepo.grantPermission(telegramId, permission, ctx.from.id);
    await logsRepo.logAction({
      adminId: ctx.from.id,
      action: 'grant_permission',
      target: permission,
      details: { adminId: telegramId },
    });
  }
  await showPermissionsMenu(ctx, telegramId);
}

async function startAdd(ctx) {
  session.set(ctx.from.id, { flow: 'admin_add' });
  await ctx.reply('📝 Send the Telegram user ID of the new admin:');
  await ctx.answerCallbackQuery();
}

async function removeAdmin(ctx, telegramId) {
  if (isSuperAdmin(telegramId)) {
    return ctx.answerCallbackQuery({ text: 'Cannot remove Super Admin.', show_alert: true });
  }
  await adminRepo.removeAdmin(telegramId);
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'remove_admin',
    target: String(telegramId),
    details: { adminId: telegramId },
  });
  await ctx.answerCallbackQuery('🗑️ Admin removed.');
  await showAdminsMenu(ctx);
}

async function handleTextInput(ctx) {
  const s = session.get(ctx.from.id);
  if (!s || s.flow !== 'admin_add') return false;

  const text = ctx.message.text.trim();
  const telegramId = Number(text);
  if (Number.isNaN(telegramId) || String(telegramId) !== text) {
    await ctx.reply('⚠️ Invalid ID. Please send a numeric Telegram user ID.');
    return true;
  }
  if (isSuperAdmin(telegramId)) {
    await ctx.reply('⚠️ This user is already the Super Admin.');
    session.clear(ctx.from.id);
    return true;
  }

  await adminRepo.addAdmin(telegramId, null);
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'add_admin',
    target: text,
    details: { adminId: telegramId },
  });
  session.clear(ctx.from.id);
  await ctx.reply(`✅ Admin added (ID: ${telegramId}). Now assign permissions from the admin detail page.`);
  return true;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = {
  showAdminsMenu,
  showAdminDetail,
  showPermissionsMenu,
  togglePermission,
  startAdd,
  removeAdmin,
  handleTextInput,
};
