const { InlineKeyboard } = require('grammy');
const foldersRepo = require('../../db/folders');
const logsRepo = require('../../db/logs');
const session = require('../../utils/session');
const { backToPanelKeyboard } = require('../../keyboards/keyboards');
const logger = require('../../utils/logger');

// Show root folders list
async function showFoldersMenu(ctx) {
  const folders = await foldersRepo.getChildFolders(null);
  const kb = new InlineKeyboard();
  for (const f of folders) {
    kb.text(`${f.is_active ? '📁' : '🚫'} ${truncate(f.name, 30)}`, `afolder:${f.id}`).row();
  }
  kb.text('➕ Create Folder', 'afolder:create').row();
  kb.text('⬅️ Back', 'admin:panel').row();
  await ctx.editMessageText('📁 Manage Folders\n\nSelect a folder to manage, or create a new one:', { reply_markup: kb });
}

// Show a single folder's detail + its children
async function showFolderDetail(ctx, folderId) {
  const folder = await foldersRepo.getFolder(folderId);
  if (!folder) {
    await ctx.answerCallbackQuery({ text: 'Folder not found.', show_alert: true });
    return;
  }
  const children = await foldersRepo.getChildFolders(folderId);

  const kb = new InlineKeyboard();
  for (const c of children) {
    kb.text(`${c.is_active ? '📁' : '🚫'} ${truncate(c.name, 30)}`, `afolder:${c.id}`).row();
  }
  kb.text('➕ Create Subfolder', `afolder:create:${folderId}`).row();
  kb.text('✏️ Rename', `afolder:rename:${folderId}`).row();
  kb.text('📝 Set Description', `afolder:desc:${folderId}`).row();
  kb.text(`${folder.is_active ? '👁️ Hide' : '👁️‍🗨️ Show'}`, `afolder:toggle:${folderId}`).row();
  kb.text('🗑️ Delete', `afolder:delete:${folderId}`).row();
  kb.text('⬅️ Back to Folders', 'admin:folders').row();

  let text = `📁 ${folder.name}\n`;
  if (folder.description) text += `\n${folder.description}`;
  text += `\n\nStatus: ${folder.is_active ? 'Active' : 'Hidden'}`;
  text += `\nSubfolders: ${children.length}`;

  await ctx.editMessageText(text, { reply_markup: kb });
  await ctx.answerCallbackQuery();
}

// Start create flow
async function startCreate(ctx, parentId) {
  session.set(ctx.from.id, { flow: 'folder_create', parentId: parentId || null });
  await ctx.reply('📝 Send the name for the new folder:');
  await ctx.answerCallbackQuery();
}

// Start rename flow
async function startRename(ctx, folderId) {
  session.set(ctx.from.id, { flow: 'folder_rename', folderId });
  await ctx.reply('📝 Send the new name for this folder:');
  await ctx.answerCallbackQuery();
}

// Start description flow
async function startDesc(ctx, folderId) {
  session.set(ctx.from.id, { flow: 'folder_desc', folderId });
  await ctx.reply('📝 Send the new description (or send /skip to clear):');
  await ctx.answerCallbackQuery();
}

async function toggleActive(ctx, folderId) {
  const folder = await foldersRepo.getFolder(folderId);
  await foldersRepo.updateFolder(folderId, { is_active: !folder.is_active });
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'toggle_folder',
    target: folder.name,
    details: { folderId, active: !folder.is_active },
  });
  await showFolderDetail(ctx, folderId);
}

async function deleteFolder(ctx, folderId) {
  const folder = await foldersRepo.getFolder(folderId);
  await foldersRepo.deleteFolder(folderId);
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'delete_folder',
    target: folder.name,
    details: { folderId },
  });
  await ctx.answerCallbackQuery('🗑️ Folder deleted.');
  await showFoldersMenu(ctx);
}

// Handle text input during folder flows
async function handleTextInput(ctx) {
  const s = session.get(ctx.from.id);
  if (!s || !s.flow || !s.flow.startsWith('folder_')) return false;

  const text = ctx.message.text;

  if (s.flow === 'folder_create') {
    const folder = await foldersRepo.createFolder({ name: text, parentId: s.parentId });
    await logsRepo.logAction({
      adminId: ctx.from.id,
      action: 'create_folder',
      target: text,
      details: { folderId: folder.id, parentId: s.parentId },
    });
    session.clear(ctx.from.id);
    await ctx.reply(`✅ Folder "${text}" created.`);
    return true;
  }

  if (s.flow === 'folder_rename') {
    await foldersRepo.updateFolder(s.folderId, { name: text });
    const folder = await foldersRepo.getFolder(s.folderId);
    await logsRepo.logAction({
      adminId: ctx.from.id,
      action: 'rename_folder',
      target: folder.name,
      details: { folderId: s.folderId, newName: text },
    });
    session.clear(ctx.from.id);
    await ctx.reply(`✅ Folder renamed to "${text}".`);
    return true;
  }

  if (s.flow === 'folder_desc') {
    const desc = text === '/skip' ? null : text;
    await foldersRepo.updateFolder(s.folderId, { description: desc });
    await logsRepo.logAction({
      adminId: ctx.from.id,
      action: 'set_folder_desc',
      target: text,
      details: { folderId: s.folderId },
    });
    session.clear(ctx.from.id);
    await ctx.reply('✅ Description updated.');
    return true;
  }

  return false;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = {
  showFoldersMenu,
  showFolderDetail,
  startCreate,
  startRename,
  startDesc,
  toggleActive,
  deleteFolder,
  handleTextInput,
};
