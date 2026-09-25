const { InlineKeyboard } = require('grammy');
const settingsRepo = require('../db/settings');
const forceJoinRepo = require('../db/forceJoin');
const foldersRepo = require('../db/folders');
const contentRepo = require('../db/content');

// ---- User keyboards ----

async function welcomeKeyboard(settingsOverride = null, channelsOverride = null) {
  const enabled = channelsOverride || await forceJoinRepo.listEnabledChannels();
  const kb = new InlineKeyboard();

  if (enabled.length > 0) {
    kb.text('➡️ Next', 'join_channels');
  } else {
    const settings = settingsOverride || await settingsRepo.getAllSettings();
    kb.text(`📚 ${settings.videos_button_text}`, 'see_videos');
  }
  return kb;
}

async function joinKeyboard(settingsOverride = null, channelsOverride = null) {
  const settings = settingsOverride || await settingsRepo.getAllSettings();
  const channels = channelsOverride || await forceJoinRepo.listEnabledChannels();
  const { getJoinUrl } = require('../services/forceJoin');
  const kb = new InlineKeyboard();

  const active = channels.filter((ch) => ch.is_enabled);
  const urls = await Promise.all(active.map((ch) => getJoinUrl(ch)));

  active.forEach((ch, i) => {
    if (urls[i]) kb.url(`🔗 Join ${i + 1}`, urls[i]).row();
  });

  kb.text(`✅ ${settings.check_button_text}`, 'check_join');
  return kb;
}

async function folderKeyboard(parentId, breadcrumb) {
  const settings = await settingsRepo.getAllSettings();
  const children = await foldersRepo.getChildFolders(parentId);
  const contents = parentId ? await contentRepo.getContentByFolder(parentId) : [];

  const kb = new InlineKeyboard();
  for (const f of children) {
    if (!f.is_active) continue;
    kb.text(`📁 ${truncate(f.name, 40)}`, `open_folder:${f.id}`).row();
  }
  for (const c of contents) {
    if (!c.is_active) continue;
    kb.text(`🎬 ${truncate(c.title, 40)}`, `view_content:${c.id}`).row();
  }

  if (breadcrumb && breadcrumb.length > 1) {
    const parent = breadcrumb[breadcrumb.length - 2];
    kb.text(`⬅️ ${settings.back_button_text}`, `open_folder:${parent.id}`);
  } else if (breadcrumb && breadcrumb.length === 1 && !breadcrumb[0].parent_id) {
    kb.text(`⬅️ ${settings.back_button_text}`, 'see_videos');
  }

  return kb;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---- Admin keyboards ----

function adminPanelKeyboard(perms) {
  const kb = new InlineKeyboard();
  const has = (p) => perms.includes(p);

  if (has('view_stats')) kb.text('📊 Statistics', 'admin:stats').row();
  if (has('manage_folders')) kb.text('📁 Manage Folders', 'admin:folders').row();
  if (has('upload_content') || has('edit_content') || has('delete_content')) kb.text('🎬 Manage Content', 'admin:content').row();
  if (has('broadcast')) kb.text('📢 Broadcast', 'admin:broadcast').row();
  if (has('manage_force_join')) kb.text('📢 Force Join Channels', 'admin:forcejoin').row();
  if (has('edit_welcome')) kb.text('📝 Welcome Page', 'admin:welcome').row();
  if (has('manage_users')) kb.text('👥 Users', 'admin:users').row();
  if (has('manage_admins')) kb.text('👨‍💼 Admin Management', 'admin:admins').row();
  if (has('view_logs')) kb.text('📜 Activity Logs', 'admin:logs').row();
  if (has('manage_storage')) kb.text('💾 Storage Settings', 'admin:storage').row();
  if (has('manage_settings')) kb.text('🔗 Referral Program', 'admin:referrals').row();
  if (has('manage_settings')) kb.text('⚙️ Bot Settings', 'admin:settings').row();

  kb.row().text('🔄 Refresh', 'admin:panel');
  return kb;
}

function backToPanelKeyboard() {
  return new InlineKeyboard().text('⬅️ Back to Panel', 'admin:panel');
}

module.exports = {
  welcomeKeyboard,
  joinKeyboard,
  folderKeyboard,
  adminPanelKeyboard,
  backToPanelKeyboard,
};