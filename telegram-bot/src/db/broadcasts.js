const supabase = require('./supabase');

async function createBroadcast({ adminId, messageType, content, total }) {
  const { data, error } = await supabase
    .from('broadcasts')
    .insert({
      admin_id: adminId,
      message_type: messageType,
      content,
      total,
      status: 'in_progress',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateBroadcast(id, patch) {
  const { data, error } = await supabase
    .from('broadcasts')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function listBroadcasts(limit = 20) {
  const { data, error } = await supabase
    .from('broadcasts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

async function getBroadcastStats() {
  const { data, error } = await supabase
    .from('broadcasts')
    .select('total, success, failed, status')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data;
}

module.exports = { createBroadcast, updateBroadcast, listBroadcasts, getBroadcastStats };
