const supabase = require('./supabase');

async function logAction({ adminId, action, target, details }) {
  const { error } = await supabase.from('admin_activity_logs').insert({
    admin_id: adminId,
    action,
    target: target || null,
    details: details ? JSON.stringify(details) : null,
  });
  if (error) throw error;
}

async function listLogs(limit = 50, offset = 0) {
  const { data, error } = await supabase
    .from('admin_activity_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data;
}

async function listLogsByAdmin(adminId, limit = 50) {
  const { data, error } = await supabase
    .from('admin_activity_logs')
    .select('*')
    .eq('admin_id', adminId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

module.exports = { logAction, listLogs, listLogsByAdmin };
