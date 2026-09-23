const supabase = require('./supabase');
const settingsRepo = require('./settings');

function localDate(timeZone, date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
}

async function registerReferral(referrerId, referredId) {
  const referrer = Number(referrerId);
  const referred = Number(referredId);
  if (!Number.isSafeInteger(referrer) || !Number.isSafeInteger(referred) || referrer === referred) {
    return { created: false, reason: 'invalid' };
  }

  const { data: existing, error: lookupError } = await supabase
    .from('referrals')
    .select('id, status')
    .eq('referred_id', referred)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return { created: false, reason: 'already_registered', referral: existing };

  const { data, error } = await supabase
    .from('referrals')
    .insert({ referrer_id: referrer, referred_id: referred, status: 'pending' })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') return { created: false, reason: 'duplicate' };
    throw error;
  }
  return { created: true, referral: data };
}

async function markReferralValid(referredId) {
  const settings = await settingsRepo.getAllSettings();
  const today = localDate(settings.referral_timezone);
  const { data, error } = await supabase
    .from('referrals')
    .update({ status: 'valid', validated_at: new Date().toISOString(), validated_date: today })
    .eq('referred_id', Number(referredId))
    .eq('status', 'pending')
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getDailyProgress(userId) {
  const settings = await settingsRepo.getAllSettings();
  const date = localDate(settings.referral_timezone);
  const { count, error } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', Number(userId))
    .eq('status', 'valid')
    .eq('validated_date', date);
  if (error) throw error;

  const completed = count || 0;
  const { error: progressError } = await supabase.from('referral_daily_progress').upsert(
    { user_id: Number(userId), progress_date: date, completed_count: completed, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,progress_date' },
  );
  if (progressError) throw progressError;
  return {
    date,
    completed,
    required: Math.max(0, Number(settings.referral_daily_requirement) || 0),
    enabled: settings.referral_requirement_enabled === 'true',
    timezone: settings.referral_timezone,
  };
}

async function getProgressForUser(userId) {
  return getDailyProgress(userId);
}

async function canAccessContent(userId, content) {
  if (!content || content.access_mode === 'public') return { allowed: true };
  const progress = await getDailyProgress(userId);
  if (!progress.enabled || progress.required === 0 || progress.completed >= progress.required) {
    return { allowed: true, progress };
  }
  return { allowed: false, progress };
}

async function getStats() {
  const [{ count: total, error: totalError }, { count: valid, error: validError }] = await Promise.all([
    supabase.from('referrals').select('id', { count: 'exact', head: true }),
    supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('status', 'valid'),
  ]);
  if (totalError) throw totalError;
  if (validError) throw validError;
  return { total: total || 0, valid: valid || 0, pending: Math.max(0, (total || 0) - (valid || 0)) };
}

module.exports = { localDate, registerReferral, markReferralValid, getDailyProgress, getProgressForUser, canAccessContent, getStats };