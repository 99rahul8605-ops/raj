const { api } = require('./telegram');
const contentRepo = require('../db/content');
const settingsRepo = require('../db/settings');

async function getStorageChannelId() {
  const fromDb = await settingsRepo.getSetting('storage_channel_id');
  if (fromDb) return Number(fromDb);
  const { storageChannelId } = require('../config/env');
  return storageChannelId;
}

// Forward a message from the admin chat into the storage channel, return the
// stored message_id + file metadata. Forwarding avoids re-uploading large files.
async function storeMessage(fromChatId, messageId) {
  const storageChannelId = await getStorageChannelId();
  if (!storageChannelId) {
    throw new Error('Storage channel not configured. Set it in Admin Panel > Storage Settings.');
  }
  const forwarded = await api.forwardMessage(storageChannelId, fromChatId, messageId);
  return {
    storageChannelId,
    telegramMessageId: forwarded.message_id,
    fileType: detectFileType(forwarded),
    fileId: extractFileId(forwarded),
    fileUniqueId: extractFileUniqueId(forwarded),
    caption: forwarded.caption || null,
  };
}

// Store multiple messages in one session (admin uploads many videos)
async function storeMany(fromChatId, messageIds) {
  const results = [];
  for (const msgId of messageIds) {
    try {
      const stored = await storeMessage(fromChatId, msgId);
      results.push({ success: true, ...stored, originalMessageId: msgId });
    } catch (err) {
      results.push({ success: false, error: err.message, originalMessageId: msgId });
    }
  }
  return results;
}

async function createContentFromStored(folderId, stored, { title, description, accessMode, sortOrder }) {
  const content = await contentRepo.createContent({
    folder_id: folderId,
    title: title || 'Untitled',
    description,
    access_mode: accessMode,
    sort_order: sortOrder ?? 0,
  });
  await contentRepo.addContentItem(content.id, stored, 0);
  return contentRepo.getContent(content.id);
}

// Send a stored content item to a user by copying it from the storage channel.
// Uses copyMessage with protect_content to prevent forwarding/saving.
// If auto-delete timer is set, deletes the message after the configured minutes
// and shows a one-time info message about the timer.
async function sendStoredContent(chatId, contentItem) {
  const autoDeleteMinutes = Number(await settingsRepo.getSetting('content_auto_delete_minutes')) || 0;
  const items = Array.isArray(contentItem.items) ? contentItem.items : [contentItem];
  const sent = [];
  for (const item of items) {
    try {
      const copied = await api.copyMessage(chatId, item.storage_channel_id, item.telegram_message_id, {
        caption: item === items[0] ? buildContentCaption(contentItem) : item.caption || undefined,
        parse_mode: 'HTML',
        protect_content: true,
      });
      sent.push(copied.message_id);
      if (autoDeleteMinutes > 0) scheduleAutoDelete(chatId, copied.message_id, autoDeleteMinutes);
    } catch (err) {
      try {
        const forwarded = await api.forwardMessage(chatId, item.storage_channel_id, item.telegram_message_id, {
          protect_content: true,
        });
        sent.push(forwarded.message_id);
        if (autoDeleteMinutes > 0) scheduleAutoDelete(chatId, forwarded.message_id, autoDeleteMinutes);
      } catch (err2) {
        return { success: false, sent: sent.length, error: err2.message };
      }
    }
  }
  if (autoDeleteMinutes > 0) {
    await api.sendMessage(
      chatId,
      `This content will be automatically deleted in <b>${autoDeleteMinutes} minute(s)</b>. Forwarding and saving are disabled.`,
      { parse_mode: 'HTML' },
    );
  }
  return { success: true, sent: sent.length, message_ids: sent };
}

function scheduleAutoDelete(chatId, messageId, minutes) {
  const ms = minutes * 60 * 1000;
  setTimeout(async () => {
    try {
      await api.deleteMessage(chatId, messageId);
    } catch (err) {
      // message may already be deleted — ignore
    }
  }, ms);
}

function buildContentCaption(item) {
  let cap = `🎬 <b>${escapeHtml(item.title)}</b>`;
  if (item.description) cap += `\n\n${escapeHtml(item.description)}`;
  return cap;
}

function detectFileType(msg) {
  if (msg.video) return 'video';
  if (msg.photo) return 'photo';
  if (msg.document) return 'document';
  if (msg.audio) return 'audio';
  if (msg.animation) return 'animation';
  if (msg.voice) return 'voice';
  if (msg.video_note) return 'video_note';
  if (msg.media_group_id) return 'media';
  return 'unknown';
}

function extractFileId(msg) {
  if (msg.video) return msg.video.file_id;
  if (msg.photo) return msg.photo[msg.photo.length - 1].file_id;
  if (msg.document) return msg.document.file_id;
  if (msg.audio) return msg.audio.file_id;
  if (msg.animation) return msg.animation.file_id;
  if (msg.voice) return msg.voice.file_id;
  if (msg.video_note) return msg.video_note.file_id;
  return null;
}

function extractFileUniqueId(msg) {
  if (msg.video) return msg.video.file_unique_id;
  if (msg.photo) return msg.photo[msg.photo.length - 1].file_unique_id;
  if (msg.document) return msg.document.file_unique_id;
  if (msg.audio) return msg.audio.file_unique_id;
  if (msg.animation) return msg.animation.file_unique_id;
  if (msg.voice) return msg.voice.file_unique_id;
  if (msg.video_note) return msg.video_note.file_unique_id;
  return null;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  getStorageChannelId,
  storeMessage,
  storeMany,
  createContentFromStored,
  sendStoredContent,
};
