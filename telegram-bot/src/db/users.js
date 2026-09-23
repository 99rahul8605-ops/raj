const supabase = require('./supabase');

async function upsertUser(telegramUser) {
  const row = {
    telegram_id: telegramUser.id,
    username: telegramUser.username || null,
    first_name: telegramUser.first_name || null,
  };
  const { data, error } = await supabase
    .from('users')
    .upsert(row, { onConflict: 'telegram_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function touchActivity(telegramId) {
  await supabase
    .from('users')
    .update({ last_activity: new Date().toISOString() })
    .eq('telegram_id', telegramId);
}

async function getUser(telegramId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function setBlocked(telegramId, blocked) {
  const { error } = await supabase
    .from('users')
    .update({ is_blocked: blocked })
    .eq('telegram_id', telegramId);
  if (error) throw error;
}

async function countUsers() {
  const { count, error } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count;
}

async function countActiveSince(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { count, error } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .gte('last_activity', since);
  if (error) throw error;
  return count;
}

async function countNewSince(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { count, error } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .gte('joined_at', since);
  if (error) throw error;
  return count;
}

async function getAllUserIds() {
  const { data, error } = await supabase
    .from('users')
    .select('telegram_id')
    .eq('is_blocked', false);
  if (error) throw error;
  return data.map((r) => r.telegram_id);
}

async function searchUser(query) {
  // query can be a telegram_id (numeric) or username
  const numeric = Number(query);
  if (!Number.isNaN(numeric) && String(numeric) === query.trim()) {
    return getUser(numeric);
  }
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .ilike('username', `%${query.replace('@', '')}%`)
    .limit(10);
  if (error) throw error;
  return data;
}

module.exports = {
  upsertUser,
  touchActivity,
  getUser,
  setBlocked,
  countUsers,
  countActiveSince,
  countNewSince,
  getAllUserIds,
  searchUser,
};
