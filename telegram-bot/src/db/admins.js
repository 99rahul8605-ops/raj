const supabase = require('./supabase');
const { ALL_PERMISSIONS } = require('../config/constants');

async function getAdmin(telegramId) {
  const { data, error } = await supabase
    .from('admins')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getAdminWithPerms(telegramId) {
  const { data: admin, error } = await supabase
    .from('admins')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  if (!admin) return null;
  const { data: perms, error: perr } = await supabase
    .from('admin_permissions')
    .select('permission')
    .eq('admin_id', telegramId);
  if (perr) throw perr;
  return { ...admin, permissions: (perms || []).map((p) => p.permission) };
}

async function listAdmins() {
  const { data, error } = await supabase
    .from('admins')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function addAdmin(telegramId, username) {
  const { data, error } = await supabase
    .from('admins')
    .upsert({ telegram_id: telegramId, username }, { onConflict: 'telegram_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function removeAdmin(telegramId) {
  const { error } = await supabase
    .from('admins')
    .delete()
    .eq('telegram_id', telegramId)
    .eq('is_super', false);
  if (error) throw error;
}

async function getPermissions(telegramId) {
  const { data, error } = await supabase
    .from('admin_permissions')
    .select('permission')
    .eq('admin_id', telegramId);
  if (error) throw error;
  return (data || []).map((p) => p.permission);
}

async function grantPermission(telegramId, permission, grantedBy) {
  const { error } = await supabase
    .from('admin_permissions')
    .upsert(
      { admin_id: telegramId, permission, granted_by: grantedBy },
      { onConflict: 'admin_id,permission' }
    );
  if (error) throw error;
}

async function revokePermission(telegramId, permission) {
  const { error } = await supabase
    .from('admin_permissions')
    .delete()
    .eq('admin_id', telegramId)
    .eq('permission', permission);
  if (error) throw error;
}

async function revokeAll(telegramId) {
  const { error } = await supabase
    .from('admin_permissions')
    .delete()
    .eq('admin_id', telegramId);
  if (error) throw error;
}

module.exports = {
  getAdmin,
  getAdminWithPerms,
  listAdmins,
  addAdmin,
  removeAdmin,
  getPermissions,
  grantPermission,
  revokePermission,
  revokeAll,
  ALL_PERMISSIONS,
};
