// PATH: telegram-bot/src/db/supabase.js
const { createClient } = require('@supabase/supabase-js');
const { supabaseUrl, supabaseServiceKey } = require('../config/env');
const logger = require('../utils/logger');

// Logs any database call slower than 400ms so slow spots show up in the Render logs.
async function timedFetch(input, init) {
  const t0 = Date.now();
  try {
    return await fetch(input, init);
  } finally {
    const ms = Date.now() - t0;
    if (ms > 400) {
      let where = '';
      try {
        const u = new URL(typeof input === 'string' ? input : input.url);
        where = u.pathname.replace('/rest/v1/', '') + (init?.method ? ` ${init.method}` : '');
      } catch { /* ignore */ }
      logger.warn(`SLOW Supabase call: ${where} ${ms}ms`);
    }
  }
}

// Service-role client — bypasses RLS. The bot enforces authorization
// at the application layer (permission checks on every admin action).
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: timedFetch },
});

module.exports = supabase;
