const { InlineKeyboard } = require('grammy');
const foldersRepo = require('../../db/folders');
const contentRepo = require('../../db/content');
const logsRepo = require('../../db/logs');
const storageService = require('../../services/storage');
const session = require('../../utils/session');
const logger = require('../../utils/logger');

// Edit the current menu message on a button tap, or send a fresh message when
// we are answering a typed message / command (editMessageText fails there).
async function render(ctx, text, kb) {
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb });
    await ctx.answerCallbackQuery();
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

// Show content management root — pick a folder
async function showContentMenu(ctx) {
  const folders = await foldersRepo.getChildFolders(null);
  const kb = new InlineKeyboard();
  for (const f of folders) {
    kb.text(`📁 ${truncate(f.name, 30)}`, `acfolder:${f.id}`).row();
  }
  kb.text('⬅️ Back', 'admin:panel').row();
  await ctx.editMessageText('🎬 Manage Content\n\nSelect a folder to manage its content:', { reply_markup: kb });
}

// Show content within a folder + subfolder navigation
async function showFolderContent(ctx, folderId) {
  const folder = await foldersRepo.getFolder(folderId);
  if (!folder) {
    await ctx.answerCallbackQuery({ text: 'Folder not found.', show_alert: true });
    return;
  }
  const children = await foldersRepo.getChildFolders(folderId);
  const items = await contentRepo.getContentByFolder(folderId, { includeInactive: true });

  const kb = new InlineKeyboard();
  // Subfolders
  for (const c of children) {
    kb.text(`📁 ${truncate(c.name, 30)}`, `acfolder:${c.id}`).row();
  }
  // Content items
  for (const item of items) {
    const icon = item.is_active ? '🎬' : '🚫';
    kb.text(`${icon} ${truncate(item.title, 30)}`, `acitem:${item.id}`).row();
  }
  kb.text('📤 Upload Here', `acupload:${folderId}`).row();
  kb.text('⬅️ Back', folder.parent_id ? `acfolder:${folder.parent_id}` : 'admin:content').row();

  let text = `🎬 ${folder.name}\n\nContent items: ${items.length}\nSubfolders: ${children.length}`;
  await render(ctx, text, kb);
}

// Show single content item detail
async function showContentDetail(ctx, contentId) {
  const item = await contentRepo.getContent(contentId);
  if (!item) {
    await ctx.answerCallbackQuery({ text: 'Content not found.', show_alert: true });
    return;
  }
  const folder = await foldersRepo.getFolder(item.folder_id);

  const kb = new InlineKeyboard();
  kb.text('✏️ Edit Title', `acedit_title:${contentId}`).row();
  kb.text('📝 Edit Description', `acedit_desc:${contentId}`).row();
  kb.text(`${item.is_active ? '👁️ Hide' : '👁️‍🗨️ Show'}`, `actoggle:${contentId}`).row();
  kb.text(`➕ Add Files (${item.items?.length || 0})`, `acupload:add:${contentId}`).row();
  kb.text(`🔐 Access: ${item.access_mode === 'public' ? 'Public' : 'Protected'}`, `acaccess:${contentId}`).row();
  kb.text('🗑️ Delete', `acdelete:${contentId}`).row();
  kb.text('⬅️ Back', `acfolder:${item.folder_id}`).row();

  let text = `🎬 Content: ${item.title}\n`;
  if (item.description) text += `\n${item.description}`;
  text += `\n\nFolder: ${folder?.name || 'Unknown'}`;
  text += `\nFiles: ${item.items?.length || 0}`;
  text += `\nAccess: ${item.access_mode === 'public' ? 'Public' : 'Protected'}`;
  text += `\nStatus: ${item.is_active ? 'Active' : 'Hidden'}`;

  await ctx.editMessageText(text, { reply_markup: kb });
  await ctx.answerCallbackQuery();
}

// Start upload flow — admin sends media messages
async function startUpload(ctx, folderId, contentId = null) {
  session.set(ctx.from.id, {
    flow: 'content_upload',
    folderId,
    contentId,
    messages: [], // collected message_ids
  });
  await ctx.reply(
    '📤 Upload Mode\n\nSend videos/photos/documents to this chat. ' +
    'Each message will be stored in the Storage Channel and added to this folder.\n\n' +
    'When done, click the button below or send /done.',
    { reply_markup: new InlineKeyboard().text('✅ Done', 'acupload:done') }
  );
  await ctx.answerCallbackQuery();
}

// Collect a media message during upload flow
async function collectUploadMessage(ctx) {
  const s = session.get(ctx.from.id);
  if (!s || s.flow !== 'content_upload') return false;

  const msg = ctx.message;
  // Check it has media
  const hasMedia = msg.video || msg.photo || msg.document || msg.audio || msg.animation || msg.voice || msg.video_note;
  if (!hasMedia) {
    await ctx.reply('⚠️ Please send a media file (video, photo, document, etc.).');
    return true; // handled, but not added
  }

  s.messages.push({
    message_id: msg.message_id,
    caption: msg.caption || null,
    chat_id: ctx.chat.id,
  });
  session.update(ctx.from.id, { messages: s.messages });

  await ctx.reply(`✅ Queued (${s.messages.length}). Send more or click Done.`);
  return true;
}

// Finish upload. For NEW content we first ask the admin for its name.
async function finishUpload(ctx) {
  const s = session.get(ctx.from.id);
  if (!s || s.flow !== 'content_upload') return false;

  if (s.messages.length === 0) {
    session.clear(ctx.from.id);
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    await ctx.reply('No messages collected. Upload cancelled.');
    return true;
  }

  // Adding files to an existing content keeps its current name.
  if (s.contentId) {
    return storeUpload(ctx, s.folderId, s.messages, s.contentId, null);
  }

  session.set(ctx.from.id, {
    flow: 'content_upload_name',
    folderId: s.folderId,
    messages: s.messages,
  });
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
  await ctx.reply(
    `📝 ${s.messages.length} file(s) ready.\n\nSend the NAME for this content (e.g. "Movie Name Part 1").\n\n` +
    'Send /skip to auto-name it from the first caption or today\'s date. You can rename it later with Edit Title.'
  );
  return true;
}

// Forward all collected messages to the storage channel and create/extend the content row
async function storeUpload(ctx, folderId, messages, contentId, title) {
  session.clear(ctx.from.id);

  await ctx.reply(`⏳ Storing ${messages.length} item(s) in the Storage Channel...`);

  let success = 0;
  let failed = 0;
  const autoTitle = messages[0].caption ? truncate(messages[0].caption, 200) : `Content ${new Date().toLocaleDateString()}`;
  const finalTitle = truncate((title || '').trim(), 200) || autoTitle;

  let content = contentId ? await contentRepo.getContent(contentId) : null;
  if (!content) {
    try {
      content = await contentRepo.createContent({
        folder_id: folderId,
        title: finalTitle,
        description: null,
        access_mode: 'protected',
      });
    } catch (err) {
      logger.error('Content creation failed:', err.message);
      await ctx.reply('⚠️ Could not create the content record. Nothing was uploaded.');
      return true;
    }
  }
  // Continue after the highest existing order (safe even if items were deleted earlier)
  const existing = content.items || [];
  const startingOrder = existing.length ? Math.max(...existing.map((i) => i.sort_order ?? 0)) + 1 : 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    try {
      const stored = await storageService.storeMessage(m.chat_id, m.message_id);
      await contentRepo.addContentItem(content.id, stored, startingOrder + i);
      success++;
    } catch (err) {
      logger.error('Upload item failed:', err.message);
      failed++;
    }
  }

  const folder = await foldersRepo.getFolder(folderId);
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'upload_content',
    target: folder?.name,
    details: { folderId, total: messages.length, success, failed },
  });

  if (failed === messages.length && !contentId) await contentRepo.deleteContent(content.id);
  await ctx.reply(`✅ Bulk upload complete: ${success} file(s) stored in "${content.title}", ${failed} failed.`);
  await showFolderContent(ctx, folderId);
  return true;
}

async function toggleContent(ctx, contentId) {
  const item = await contentRepo.getContent(contentId);
  await contentRepo.updateContent(contentId, { is_active: !item.is_active });
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'toggle_content',
    target: item.title,
    details: { contentId, active: !item.is_active },
  });
  await showContentDetail(ctx, contentId);
}

async function deleteContent(ctx, contentId) {
  const item = await contentRepo.getContent(contentId);
  const folderId = item.folder_id;
  await contentRepo.deleteContent(contentId);
  await logsRepo.logAction({
    adminId: ctx.from.id,
    action: 'delete_content',
    target: item.title,
    details: { contentId },
  });
  await ctx.answerCallbackQuery('🗑️ Content deleted.');
  await showFolderContent(ctx, folderId);
}

async function startEditTitle(ctx, contentId) {
  session.set(ctx.from.id, { flow: 'content_edit_title', contentId });
  await ctx.reply('📝 Send the new title:');
  await ctx.answerCallbackQuery();
}

async function startEditDesc(ctx, contentId) {
  session.set(ctx.from.id, { flow: 'content_edit_desc', contentId });
  await ctx.reply('📝 Send the new description (or /skip to clear):');
  await ctx.answerCallbackQuery();
}

// Handle text input during content flows
async function handleTextInput(ctx) {
  const s = session.get(ctx.from.id);
  if (!s || !s.flow || !(s.flow.startsWith('content_edit_') || s.flow === 'content_upload_name')) return false;

  const text = ctx.message.text.trim();

  if (s.flow === 'content_upload_name') {
    const title = text === '/skip' ? null : text;
    return storeUpload(ctx, s.folderId, s.messages || [], null, title);
  }

  if (s.flow === 'content_edit_title') {
    await contentRepo.updateContent(s.contentId, { title: text });
    const item = await contentRepo.getContent(s.contentId);
    await logsRepo.logAction({
      adminId: ctx.from.id,
      action: 'edit_content_title',
      target: text,
      details: { contentId: s.contentId },
    });
    session.clear(ctx.from.id);
    await ctx.reply(`✅ Title updated to "${text}".`);
    return true;
  }

  if (s.flow === 'content_edit_desc') {
    const desc = text === '/skip' ? null : text;
    await contentRepo.updateContent(s.contentId, { description: desc });
    await logsRepo.logAction({
      adminId: ctx.from.id,
      action: 'edit_content_desc',
      target: text,
      details: { contentId: s.contentId },
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
  showContentMenu,
  showFolderContent,
  showContentDetail,
  startUpload,
  collectUploadMessage,
  finishUpload,
  toggleContent,
  deleteContent,
  startEditTitle,
  startEditDesc,
  handleTextInput,
};
