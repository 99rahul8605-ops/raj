// PATH: telegram-bot/src/db/forceJoin.js
const supabase = require('./supabase');
const logger = require('../utils/logger');

// TESTING OVERRIDE:
// Agar env variable FORCE_JOIN_CHANNELS_OVERRIDE set hai (JSON array),
// to ye bot Supabase table 'force_join_channels' ko bilkul touch nahi karega —
// sirf yahi hardcoded list use hoga. Isse purana bot (jo same Supabase table
// use kar raha hai) completely unaffected rehta hai.
//
// Render env variable example (ek hi line mein, valid JSON):
// FORCE_JOIN_CHANNELS_OVERRIDE=[{"id":1,"channel_id":"-1001234567890","channel_username":"mychannel","channel_link":"https://t.me/mychannel","button_name":"Join Channel","requires_approval":false,"is_enabled":true,"created_at":"2024-01-01T00:00:00Z"}]
let overrideChannels = null;
if (process.env.FORCE_JOIN_CHANNELS_OVERRIDE) {
  try {
    overrideChannels = JSON.parse(process.env.FORCE_JOIN_CHANNELS_OVERRIDE);
    logger.warn(`FORCE_JOIN_CHANNELS_OVERRIDE active — using ${overrideChannels.length} hardcoded channel(s), Supabase 'force_join_channels' table bypass ho raha hai.`);
  } catch (err) {
    logger.warn(`FORCE_JOIN_CHANNELS_OVERRIDE JSON parse fail hua, Supabase fallback ho raha hai: ${err.message}`);
    overrideChannels = null;
  }
}

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
  if (overrideChannels) return overrideChannels.slice();
  const { data, error } = await supabase
    .from('force_join_channels')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function loadEnabled() {
  if (overrideChannels) return overrideChannels.filter((c) => c.is_enabled);
  const { data, error } = await supabase
    .from('force_join_channels')
    .select('*')
    .eq('is_enabled', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function listEnabledChannels() {
  if (overrideChannels) return overrideChannels.filter((c) => c.is_enabled);
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
  if (overrideChannels) {
    throw new Error('FORCE_JOIN_CHANNELS_OVERRIDE active hai — add/update/delete disabled hai is test mode mein. Env variable JSON edit karke Render pe redeploy karo.');
  }
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
  if (overrideChannels) {
    throw new Error('FORCE_JOIN_CHANNELS_OVERRIDE active hai — add/update/delete disabled hai is test mode mein. Env variable JSON edit karke Render pe redeploy karo.');
  }
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
  if (overrideChannels) {
    throw new Error('FORCE_JOIN_CHANNELS_OVERRIDE active hai — add/update/delete disabled hai is test mode mein. Env variable JSON edit karke Render pe redeploy karo.');
  }
  const { error } = await supabase.from('force_join_channels').delete().eq('id', id);
  if (error) throw error;
  invalidate();
}

async function countChannels() {
  if (overrideChannels) return overrideChannels.length;
  const { count, error } = await supabase
    .from('force_join_channels')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count;
}

module.exports = { listChannels, listEnabledChannels, addChannel, updateChannel, deleteChannel, countChannels };
