const supabase = require('./supabase');

async function createContent(row) {
  const { data, error } = await supabase
    .from('content')
    .insert({
      folder_id: row.folder_id,
      title: row.title,
      description: row.description || null,
      access_mode: row.access_mode || 'protected',
      sort_order: row.sort_order ?? 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function addContentItem(contentId, row, sortOrder) {
  const { data, error } = await supabase
    .from('content_items')
    .insert({
      content_id: contentId,
      storage_channel_id: row.storageChannelId ?? row.storage_channel_id,
      telegram_message_id: row.telegramMessageId ?? row.telegram_message_id,
      file_type: row.fileType ?? row.file_type ?? null,
      file_id: row.fileId ?? row.file_id ?? null,
      file_unique_id: row.fileUniqueId ?? row.file_unique_id ?? null,
      caption: row.caption || null,
      sort_order: sortOrder ?? row.sortOrder ?? row.sort_order ?? 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getContentItems(contentId) {
  const { data, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('content_id', contentId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getContentByFolder(folderId, { includeInactive = false } = {}) {
  let query = supabase.from('content').select('*').eq('folder_id', folderId);
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query.order('sort_order', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function getContent(id) {
  const { data, error } = await supabase
    .from('content')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, items: await getContentItems(id) };
}

async function updateContent(id, patch) {
  const { data, error } = await supabase
    .from('content')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteContent(id) {
  const { error } = await supabase.from('content').delete().eq('id', id);
  if (error) throw error;
}

async function deleteContentItem(id) {
  const { error } = await supabase.from('content_items').delete().eq('id', id);
  if (error) throw error;
}

async function markUnlocked(userId, contentId, accessDate) {
  const { error } = await supabase
    .from('unlocked_content')
    .upsert(
      { user_id: Number(userId), content_id: contentId, access_date: accessDate || null },
      { onConflict: 'user_id,content_id' },
    );
  if (error) throw error;
}

async function countContent() {
  const { count, error } = await supabase
    .from('content')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count;
}

module.exports = {
  createContent,
  getContentByFolder,
  getContent,
  updateContent,
  deleteContent,
  addContentItem,
  getContentItems,
  deleteContentItem,
  markUnlocked,
  countContent,
};
