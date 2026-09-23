const adminRepo = require('../db/admins');
const { superAdminId } = require('../config/env');
const { PERMISSIONS } = require('../config/constants');

// Is this user the Super Admin?
function isSuperAdmin(telegramId) {
  return Number(telegramId) === superAdminId;
}

// Does this admin have the given permission? Super Admin always has all.
async function hasPermission(telegramId, permission) {
  if (isSuperAdmin(telegramId)) return true;
  const perms = await adminRepo.getPermissions(telegramId);
  return perms.includes(permission);
}

// Returns the list of permissions this admin has (all for super)
async function getEffectivePermissions(telegramId) {
  if (isSuperAdmin(telegramId)) {
    return Object.values(PERMISSIONS);
  }
  return adminRepo.getPermissions(telegramId);
}

// Is this user an admin at all (super or sub)?
async function isAdmin(telegramId) {
  if (isSuperAdmin(telegramId)) return true;
  const admin = await adminRepo.getAdmin(telegramId);
  return !!admin;
}

// Middleware: only allow admins to proceed. Sets ctx.admin = admin record.
async function adminOnly(ctx, next) {
  const uid = ctx.from?.id;
  if (!uid) return;
  if (isSuperAdmin(uid)) {
    ctx.admin = { telegram_id: uid, is_super: true };
    return next();
  }
  const admin = await adminRepo.getAdmin(uid);
  if (!admin) {
    return ctx.reply('⛔️ You are not an admin.');
  }
  ctx.admin = admin;
  return next();
}

// Middleware factory: require a specific permission
function requirePermission(permission) {
  return async (ctx, next) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (isSuperAdmin(uid)) return next();
    const has = await hasPermission(uid, permission);
    if (!has) {
      return ctx.reply(`⛔️ You don't have permission: ${permission}`);
    }
    return next();
  };
}

module.exports = {
  isSuperAdmin,
  hasPermission,
  getEffectivePermissions,
  isAdmin,
  adminOnly,
  requirePermission,
};
