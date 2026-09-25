require('dotenv').config();

const required = ['BOT_TOKEN', 'SUPER_ADMIN_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}. See .env.example.`);
}
if (!Number.isSafeInteger(Number(process.env.SUPER_ADMIN_ID))) {
  throw new Error('SUPER_ADMIN_ID must be a numeric Telegram user ID.');
}

module.exports = {
  botToken: process.env.BOT_TOKEN,
  superAdminId: Number(process.env.SUPER_ADMIN_ID),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  storageChannelId: process.env.STORAGE_CHANNEL_ID ? Number(process.env.STORAGE_CHANNEL_ID) : null,
  botUsername: process.env.BOT_USERNAME?.replace(/^@/, '') || null,
  referralRequirementEnabled: process.env.REFERRAL_REQUIREMENT_ENABLED === 'true',
  referralDailyRequirement: Math.max(0, Number(process.env.REFERRAL_DAILY_REQUIREMENT) || 0),
  referralTimezone: process.env.REFERRAL_TIMEZONE || 'Asia/Calcutta',
  broadcastIntervalMs: Number(process.env.BROADCAST_INTERVAL_MS) || 35,
  port: Number(process.env.PORT) || 5000,
  apiId: process.env.API_ID ? Number(process.env.API_ID) : null,
  apiHash: process.env.API_HASH || null,
};