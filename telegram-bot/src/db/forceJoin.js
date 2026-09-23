// PATH: telegram-bot/src/db/forceJoin.js
const supabase = require('./supabase');

// The enabled-channel list is needed on every /start, Check Join and See Videos
// tap. Keep it in memory for a short time; every write below clears the cache.
const CACHE_TTL_MS = 20 * 1000;
let cache = { at: 0, rows: null, loading: null };
let version = 0; // bumps on every write so an in-flight (stale) load can't refill the cache

function invalidate() {
  version++;
  cache = { at: 0, rows: null, loading: null };
}

async function listChannels() {
  const { data, error } = await supabase
    .from('force_join_channels')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function loadEnabled() {
  const { data, error } = await supabase
    .from('force_join_channels')
    .select('*')
    .eq('is_enabled', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function listEnabledChannels() {
  if (cache.rows && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows.slice();
  if (!cache.loading) {
    const v = version;
    const loading = loadEnabled()
      .then((rows) => {
        if (v === version) cache = { at: Date.now(), rows, loading: null };
        return rows;
      })
      .catch((err) => {
        if (v === version) cache.loading = null;
        throw err;
      });
    cache.loading = loading;
  }
  return (await cache.loading).slice();
}

async function addChannel({ channelId, channelUsername, channelLink, buttonName, requiresApproval }) {
  const { data, error } = await supabase
    .from('force_join_channels')
    .insert({
      channel_id: channelId || null,
      channel_username: channelUsername || null,
      channel_link: channelLink || null,
      button_name: buttonName || 'Join Channel',
      requires_approval: requiresApproval || false,
    })
    .select()
    .single();
  if (error) throw error;
  invalidate();
  return data;
}

async function updateChannel(id, patch) {
  const { data, error } = await supabase
    .from('force_join_channels')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  invalidate();
  return data;
}

async function deleteChannel(id) {
  const { error } = await supabase.from('force_join_channels').delete().eq('id', id);
  if (error) throw error;
  invalidate();
}

async function countChannels() {
  const { count, error } = await supabase
    .from('force_join_channels')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count;
}

module.exports = { listChannels, listEnabledChannels, addChannel, updateChannel, deleteChannel, countChannels };
