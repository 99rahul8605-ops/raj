const supabase = require('./supabase');

async function createFolder({ name, description, parentId, sortOrder }) {
  const { data, error } = await supabase
    .from('folders')
    .insert({
      name,
      description: description || null,
      parent_id: parentId || null,
      sort_order: sortOrder ?? 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getFolder(id) {
  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getChildFolders(parentId) {
  let query = supabase.from('folders').select('*');
  if (parentId) {
    query = query.eq('parent_id', parentId);
  } else {
    query = query.is('parent_id', null);
  }
  const { data, error } = await query.order('sort_order', { ascending: true }).order('name', { ascending: true });
  if (error) throw error;
  return data;
}

async function getAllFolders() {
  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data;
}

async function updateFolder(id, patch) {
  const { data, error } = await supabase
    .from('folders')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteFolder(id) {
  const { error } = await supabase.from('folders').delete().eq('id', id);
  if (error) throw error;
}

async function countFolders() {
  const { count, error } = await supabase
    .from('folders')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count;
}

// Get ancestor chain from root to this folder (for breadcrumb / back nav)
async function getFolderPath(id) {
  const path = [];
  let current = await getFolder(id);
  while (current) {
    path.unshift(current);
    if (!current.parent_id) break;
    const parent = await getFolder(current.parent_id);
    current = parent;
  }
  return path;
}

module.exports = {
  createFolder,
  getFolder,
  getChildFolders,
  getAllFolders,
  updateFolder,
  deleteFolder,
  countFolders,
  getFolderPath,
};
