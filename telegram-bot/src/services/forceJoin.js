// PATH: telegram-bot/src/services/forceJoin.js
const { api } = require('./telegram');
const forceJoinRepo = require('../db/forceJoin');
const joinRequestsRepo = require('../db/joinRequests');
const logger = require('../utils/logger');

const isInside = (m) =>
  !!m && (
    m.status === 'member' ||
    m.status === 'administrator' ||
    m.status === 'creator' ||
    (m.status === 'restricted' && m.is_member === true)
  );

// Check if a user is a member of a single channel
async function checkMembership(userId, channel) {
  // A recorded join request is the verification signal for request-based
  // channels. Avoid an extra Telegram API round-trip in this common path.
  if (channel.requires_approval) {
    const pending = await joinRequestsRepo.hasPendingRequest(userId, channel.id);
    if (pending) return true;
  }

  const chatId = getVerificationChatId(channel);
  if (!chatId) {
    logger.warn(`Force-join: cannot verify channel "${channel.button_name}" — no channel_id, no username, and link is private. Set the numeric Channel ID in admin panel.`);
    return false;
  }

  try {
    const member = await api.getChatMember(chatId, userId);
    if (isInside(member)) return true;
    logger.info(`Force-join: user=${userId} channel="${channel.button_name}" status=${member.status} → not joined${channel.requires_approval ? ' (no join request on record)' : ''}`);
    return false;
  } catch (err) {
    logger.error(`Force-join check failed: user=${userId} channel="${channel.button_name}" chatId=${chatId} error=${err.message}`);
    return false;
  }
}

// Keep the request record in sync when Telegram reports an approval or leave.
// A spurious "left → left" event must NOT wipe a pending request, so we only
// change the status when the user really entered, was banned, or really left.
async function recordChatMemberUpdate(chatId, member, oldMember) {
  if (!member?.user?.id) return false;
  let status = null;
  if (isInside(member)) status = 'approved';
  else if (member.status === 'kicked') status = 'declined';
  else if (isInside(oldMember)) status = 'left';
  if (!status) return false;

  await joinRequestsRepo.updateRequestStatus(member.user.id, chatId, status);
  logger.info(`Join request status updated: user=${member.user.id} chat=${chatId} status=${status}`);
  return true;
}

// Positive results are cached for a short time so "Back" / "See Videos" taps
// don't hit Supabase + Telegram every single time. Negative results are never
// cached, so "Check Join" always re-checks right after the user joins.
const VERIFIED_TTL_MS = 60 * 1000;
const verifiedCache = new Map(); // userId -> { sig, until }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of verifiedCache) if (v.until <= now) verifiedCache.delete(k);
}, 5 * 60 * 1000).unref();

// Check all enabled channels. Returns { allJoined, missing }
async function checkAllChannels(userId, { fresh = false } = {}) {
  const channels = await forceJoinRepo.listEnabledChannels();
  if (channels.length === 0) return { allJoined: true, missing: [], channels: [] };

  const sig = channels.map((c) => `${c.id}:${c.requires_approval ? 1 : 0}`).join(',');
  if (!fresh) {
    const hit = verifiedCache.get(userId);
    if (hit && hit.sig === sig && hit.until > Date.now()) {
      return { allJoined: true, missing: [], channels };
    }
  }

  const results = await Promise.all(
    channels.map(async (channel) => ({
      channel,
      ok: await checkMembership(userId, channel),
    })),
  );
  const missing = results.filter((result) => !result.ok).map((result) => result.channel);
  const allJoined = missing.length === 0;

  if (allJoined) verifiedCache.set(userId, { sig, until: Date.now() + VERIFIED_TTL_MS });
  else verifiedCache.delete(userId);

  return { allJoined, missing, channels };
}

// Build the join URL for a channel — link takes priority, then username, then ID
function getChannelUrl(channel) {
  if (channel.channel_link) return channel.channel_link;
  if (channel.channel_username) return `https://t.me/${channel.channel_username}`;
  if (channel.channel_id) {
    return `https://t.me/c/${String(channel.channel_id).replace('-100', '')}`;
  }
  return null;
}

// Resolve a channel to a chat ID or @username that getChatMember can verify.
// Priority: numeric channel_id → @username → extract username from public link.
// Private invite links (t.me/+... or t.me/joinchat/...) cannot be verified
// without a numeric channel ID.
function getVerificationChatId(channel) {
  if (channel.channel_id) return channel.channel_id;
  if (channel.channel_username) return '@' + channel.channel_username;
  const match = String(channel.channel_link || '').match(/^https?:\/\/t\.me\/([A-Za-z0-9_]{4,})\/?$/);
  return match ? '@' + match[1] : null;
}

// Resolve a channel record to its numeric chat id (cached for @usernames).
const usernameIdCache = new Map();
async function resolveNumericChatId(channel) {
  const target = getVerificationChatId(channel);
  if (target === null || target === undefined) return null;
  if (typeof target === 'number' || /^-?\d+$/.test(String(target))) return Number(target);
  const key = String(target).toLowerCase();
  if (usernameIdCache.has(key)) return usernameIdCache.get(key);
  try {
    const chat = await api.getChat(target);
    usernameIdCache.set(key, chat.id);
    return chat.id;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AUTO request links
// For "Request" channels the bot creates the invite link itself (with
// creates_join_request: true) instead of relying on a hand-made link that can
// hit its limit / expire. One shared link is handed out and rotated
// automatically (after N uses or M hours); the link from two rotations ago is
// revoked so links never pile up. Falls back to the manually saved link if the
// bot cannot create one (e.g. no channel ID, or bot lacks "Invite Users" right).
// ---------------------------------------------------------------------------
const AUTO_LINK_MAX_USES = 300;                 // rotate after this many hand-outs
const AUTO_LINK_MAX_AGE_MS = 6 * 60 * 60 * 1000; // ...or after 6 hours
const autoLinks = new Map(); // channel record id -> { url, chatId, createdAt, handed, prevUrl, creating }
const autoLinkWarned = new Set();

async function createAutoLink(channel, state) {
  const chatId = await resolveNumericChatId(channel);
  if (chatId === null) return null;
  const invite = await api.createChatInviteLink(chatId, {
    name: `auto ${new Date().toISOString().slice(5, 16).replace('T', ' ')}`.slice(0, 32),
    creates_join_request: true, // NOTE: Telegram does not allow member_limit together with this
  });
  // Revoke the link from two rotations ago (best effort); keep the previous one
  // alive so users who already opened the join page can still use it.
  if (state?.prevUrl) {
    api.revokeChatInviteLink(chatId, state.prevUrl).catch(() => {});
  }
  return {
    url: invite.invite_link,
    chatId,
    createdAt: Date.now(),
    handed: 0,
    prevUrl: state?.url || null,
  };
}

async function getAutoRequestLink(channel) {
  let state = autoLinks.get(channel.id);
  const stale =
    !state ||
    state.handed >= AUTO_LINK_MAX_USES ||
    Date.now() - state.createdAt > AUTO_LINK_MAX_AGE_MS;

  if (stale) {
    // Share one in-flight creation between concurrent users
    if (!state?.creating) {
      const creating = createAutoLink(channel, state)
        .then((fresh) => {
          if (fresh) {
            autoLinks.set(channel.id, fresh);
            logger.info(`Auto request link created for channel "${channel.button_name}"`);
          }
          return fresh;
        })
        .finally(() => {
          const cur = autoLinks.get(channel.id);
          if (cur) delete cur.creating;
        });
      if (state) state.creating = creating;
      else autoLinks.set(channel.id, { creating, handed: 0, createdAt: 0 });
      state = autoLinks.get(channel.id);
    }
    const fresh = await state.creating;
    if (!fresh) return null;
    state = autoLinks.get(channel.id);
  }

  state.handed++;
  return state.url;
}

// URL the user should tap. Request channels get an auto-generated link.
async function getJoinUrl(channel) {
  if (channel.requires_approval) {
    try {
      const url = await getAutoRequestLink(channel);
      if (url) return url;
    } catch (err) {
      if (!autoLinkWarned.has(channel.id)) {
        autoLinkWarned.add(channel.id);
        logger.warn(`Auto link failed for "${channel.button_name}": ${err.message} — using saved link. Make sure the bot is admin with "Invite Users" permission and the channel ID is set.`);
      }
    }
  }
  return getChannelUrl(channel);
}

// Record a join request from the chat_join_request update
async function recordJoinRequest(chatId, userId, chatTitle) {
  try {
    const channels = await forceJoinRepo.listEnabledChannels();

    for (const ch of channels) {
      const targetId = await resolveNumericChatId(ch);
      if (targetId !== null && String(targetId) === String(chatId)) {
        await joinRequestsRepo.recordRequest(userId, chatId, ch.id);
        logger.info(`Join request recorded: user=${userId} chat=${chatId} channel="${ch.button_name}"`);
        if (!ch.requires_approval) {
          logger.warn(`Channel "${ch.button_name}" is receiving join requests but "Request Channel" is OFF in the admin panel. Turn it ON so requests unlock the bot.`);
        }
        return true;
      }
    }

    // Private invite links do not reveal a chat ID. If there is exactly one
    // request channel without a resolvable target, bind the ID from the
    // verified Telegram update so future checks use getChatMember correctly.
    const unbound = channels.filter((ch) => ch.requires_approval && !ch.channel_id && !ch.channel_username);
    if (unbound.length === 1) {
      const ch = unbound[0];
      await forceJoinRepo.updateChannel(ch.id, { channel_id: chatId });
      await joinRequestsRepo.recordRequest(userId, chatId, ch.id);
      logger.info(`Join request recorded and channel ID learned: user=${userId} chat=${chatId} channel="${ch.button_name}"`);
      return true;
    }

    logger.warn(`Join request NOT matched: user=${userId} chat=${chatId} title="${chatTitle || ''}" — put this chat ID in the channel's "Edit Channel ID" in the admin panel.`);
    return false;
  } catch (err) {
    logger.error('Join request recording error:', err.message);
    return false;
  }
}

module.exports = {
  checkMembership,
  checkAllChannels,
  getChannelUrl,
  getJoinUrl,
  recordJoinRequest,
  recordChatMemberUpdate,
};
