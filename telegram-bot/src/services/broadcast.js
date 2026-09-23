const { api } = require('./telegram');
const usersRepo = require('../db/users');
const broadcastRepo = require('../db/broadcasts');
const { broadcastIntervalMs } = require('../config/env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Send a broadcast to all non-blocked users with rate limiting.
// messageType: 'text' | 'photo' | 'video'
// payload: { text } | { photo: file_id, caption } | { video: file_id, caption }
async function sendBroadcast(adminId, messageType, payload, onProgress) {
  const userIds = await usersRepo.getAllUserIds();
  const total = userIds.length;

  const broadcast = await broadcastRepo.createBroadcast({
    adminId,
    messageType,
    content: JSON.stringify(payload),
    total,
  });

  let success = 0;
  let failed = 0;

  for (let i = 0; i < userIds.length; i++) {
    const userId = userIds[i];
    try {
      await sendOne(userId, messageType, payload);
      success++;
    } catch (err) {
      failed++;
    }
    if (onProgress) onProgress({ sent: i + 1, total, success, failed });
    // Rate limit: ~28 msg/sec to stay under Telegram's 30/sec global limit
    if (i < userIds.length - 1) await sleep(broadcastIntervalMs);
  }

  await broadcastRepo.updateBroadcast(broadcast.id, {
    success,
    failed,
    status: 'completed',
  });

  return { total, success, failed, broadcastId: broadcast.id };
}

async function sendOne(userId, messageType, payload) {
  if (messageType === 'text') {
    return api.sendMessage(userId, payload.text, { parse_mode: 'HTML', disable_web_page_preview: true });
  }
  if (messageType === 'photo') {
    return api.sendPhoto(userId, payload.photo, {
      caption: payload.caption,
      parse_mode: 'HTML',
    });
  }
  if (messageType === 'video') {
    return api.sendVideo(userId, payload.video, {
      caption: payload.caption,
      parse_mode: 'HTML',
    });
  }
  throw new Error(`Unsupported message type: ${messageType}`);
}

module.exports = { sendBroadcast };
