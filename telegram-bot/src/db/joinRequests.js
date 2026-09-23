const supabase = require('./supabase');

// Record that a user sent a join request to a chat
async function recordRequest(userId, chatId, channelRecordId) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('join_requests')
    .upsert(
      {
        user_id: userId,
        chat_id: chatId,
        channel_record_id: channelRecordId || null,
        status: 'pending',
        requested_at: now,
        updated_at: now,
      },
      { onConflict: 'user_id,chat_id' }
    );
  if (error) throw error;
}

// Check if a user has an unapproved join request for a specific channel record
async function hasPendingRequest(userId, channelRecordId) {
  const { data, error } = await supabase
    .from('join_requests')
    .select('id')
    .eq('user_id', userId)
    .eq('channel_record_id', channelRecordId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// Record that Telegram approved/removed the requested membership.
async function updateRequestStatus(userId, chatId, status) {
  const { error } = await supabase
    .from('join_requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('chat_id', chatId);
  if (error) throw error;
}

// Remove a join request record (e.g., after user is approved or leaves)
async function removeRequest(userId, chatId) {
  const { error } = await supabase
    .from('join_requests')
    .delete()
    .eq('user_id', userId)
    .eq('chat_id', chatId);
  if (error) throw error;
}

module.exports = {
  recordRequest,
  hasPendingRequest,
  updateRequestStatus,
  removeRequest,
};
