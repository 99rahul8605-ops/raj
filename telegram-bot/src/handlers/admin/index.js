const { InlineKeyboard } = require('grammy');
const { adminPanelKeyboard, backToPanelKeyboard } = require('../../keyboards/keyboards');
const { getEffectivePermissions, isSuperAdmin, adminOnly, hasPermission } = require('../../services/permissions');
const { PERMISSIONS } = require('../../config/constants');
const folderHandlers = require('./folderHandlers');
const contentHandlers = require('./contentHandlers');
const forceJoinHandlers = require('./forceJoinHandlers');
const welcomeHandlers = require('./welcomeHandlers');
const broadcastHandlers = require('./broadcastHandlers');
const userHandlers = require('./userHandlers');
const adminMgmtHandlers = require('./adminHandlers');
const logHandlers = require('./logHandlers');
const statsHandlers = require('./statsHandlers');
const storageHandlers = require('./storageHandlers');
const settingsHandlers = require('./settingsHandlers');
const session = require('../../utils/session');
const logger = require('../../utils/logger');

async function showPanel(ctx) {
  const uid = ctx.from.id;
  const perms = await getEffectivePermissions(uid);
  const kb = adminPanelKeyboard(perms);
  const role = isSuperAdmin(uid) ? '👑 Super Admin' : '👨‍💼 Sub-Admin';
  await ctx.editMessageText(`⚙️ ADMIN PANEL\n\nRole: ${role}\n\nSelect an option:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
}

async function guard(ctx, permission) {
  if (isSuperAdmin(ctx.from.id) || (await hasPermission(ctx.from.id, permission))) return true;
  await ctx.answerCallbackQuery({ text: `Not permitted: ${permission}`, show_alert: true });
  return false;
}

async function guardAny(ctx, permissions) {
  for (const permission of permissions) {
    if (isSuperAdmin(ctx.from.id) || (await hasPermission(ctx.from.id, permission))) return true;
  }
  await ctx.answerCallbackQuery({
    text: 'You do not have permission for this action.',
    show_alert: true,
  });
  return false;
}

async function routeAdminCallback(ctx) {
  const data = ctx.callbackQuery.data;
  if (!data.startsWith('admin:')) return false;

  const action = data.slice(6);

  switch (action) {
    case 'panel':
      await showPanel(ctx);
      return true;
    case 'stats':
      if (!(await guard(ctx, PERMISSIONS.VIEW_STATS))) return true;
      await statsHandlers.showStats(ctx);
      return true;
    case 'folders':
      if (!(await guard(ctx, PERMISSIONS.MANAGE_FOLDERS))) return true;
      await folderHandlers.showFoldersMenu(ctx);
      return true;
    case 'content':
      if (!(await guardAny(ctx, [PERMISSIONS.UPLOAD_CONTENT, PERMISSIONS.EDIT_CONTENT, PERMISSIONS.DELETE_CONTENT]))) return true;
      await contentHandlers.showContentMenu(ctx);
      return true;
    case 'broadcast':
      if (!(await guard(ctx, PERMISSIONS.BROADCAST))) return true;
      await broadcastHandlers.showBroadcastMenu(ctx);
      return true;
    case 'forcejoin':
      if (!(await guard(ctx, PERMISSIONS.MANAGE_FORCE_JOIN))) return true;
      await forceJoinHandlers.showForceJoinMenu(ctx);
      return true;
    case 'welcome':
      if (!(await guard(ctx, PERMISSIONS.EDIT_WELCOME))) return true;
      await welcomeHandlers.showWelcomeMenu(ctx);
      return true;
    case 'users':
      if (!(await guard(ctx, PERMISSIONS.MANAGE_USERS))) return true;
      await userHandlers.showUsersMenu(ctx);
      return true;
    case 'admins':
      if (!(await guard(ctx, PERMISSIONS.MANAGE_ADMINS))) return true;
      await adminMgmtHandlers.showAdminsMenu(ctx);
      return true;
    case 'logs':
      if (!(await guard(ctx, PERMISSIONS.VIEW_LOGS))) return true;
      await logHandlers.showLogsMenu(ctx);
      return true;
    case 'storage':
      if (!(await guard(ctx, PERMISSIONS.MANAGE_STORAGE))) return true;
      await storageHandlers.showStorageMenu(ctx);
      return true;
    case 'settings':
      if (!(await guard(ctx, PERMISSIONS.MANAGE_SETTINGS))) return true;
      await settingsHandlers.showSettingsMenu(ctx);
      return true;
    case 'referrals':
      if (!(await guard(ctx, PERMISSIONS.MANAGE_SETTINGS))) return true;
      await settingsHandlers.showReferralMenu(ctx);
      return true;
    default:
      return false;
  }
}

async function routeAdminSubCallback(ctx) {
  const data = ctx.callbackQuery.data;
  const uid = ctx.from.id;

  if (data.startsWith('afolder:')) {
    if (!(await guard(ctx, PERMISSIONS.MANAGE_FOLDERS))) return true;
    const parts = data.slice(8).split(':');
    const sub = parts[0];
    if (sub === 'create') await folderHandlers.startCreate(ctx, parts[1] || null);
    else if (sub === 'rename') await folderHandlers.startRename(ctx, parts[1]);
    else if (sub === 'desc') await folderHandlers.startDesc(ctx, parts[1]);
    else if (sub === 'toggle') await folderHandlers.toggleActive(ctx, parts[1]);
    else if (sub === 'delete') await folderHandlers.deleteFolder(ctx, parts[1]);
    else await folderHandlers.showFolderDetail(ctx, parts[0]);
    return true;
  }

  if (data.startsWith('acfolder:')) {
    if (!(await guardAny(ctx, [PERMISSIONS.UPLOAD_CONTENT, PERMISSIONS.EDIT_CONTENT, PERMISSIONS.DELETE_CONTENT]))) return true;
    await contentHandlers.showFolderContent(ctx, data.slice(9));
    return true;
  }
  if (data.startsWith('acitem:')) {
    if (!(await guardAny(ctx, [PERMISSIONS.UPLOAD_CONTENT, PERMISSIONS.EDIT_CONTENT, PERMISSIONS.DELETE_CONTENT]))) return true;
    await contentHandlers.showContentDetail(ctx, data.slice(7));
    return true;
  }
  if (data.startsWith('acupload:')) {
    const parts = data.slice(9).split(':');
    if (parts[0] === 'done') {
      if (!(await guard(ctx, PERMISSIONS.UPLOAD_CONTENT))) return true;
      await contentHandlers.finishUpload(ctx);
    } else if (parts[0] === 'add') {
      if (!(await guard(ctx, PERMISSIONS.UPLOAD_CONTENT))) return true;
      const item = await require('../../db/content').getContent(parts[1]);
      if (!item) return true;
      await contentHandlers.startUpload(ctx, item.folder_id, item.id);
    } else {
      if (!(await guard(ctx, PERMISSIONS.UPLOAD_CONTENT))) return true;
      await contentHandlers.startUpload(ctx, parts[0]);
    }
    return true;
  }
  if (data.startsWith('acedit_')) {
    if (!(await guard(ctx, PERMISSIONS.EDIT_CONTENT))) return true;
    const parts = data.slice(7).split(':');
    if (parts[0] === 'title') await contentHandlers.startEditTitle(ctx, parts[1]);
    else if (parts[0] === 'desc') await contentHandlers.startEditDesc(ctx, parts[1]);
    return true;
  }
  if (data.startsWith('actoggle:')) {
    if (!(await guard(ctx, PERMISSIONS.EDIT_CONTENT))) return true;
    await contentHandlers.toggleContent(ctx, data.slice(9));
    return true;
  }
  if (data.startsWith('acdelete:')) {
    if (!(await guard(ctx, PERMISSIONS.DELETE_CONTENT))) return true;
    await contentHandlers.deleteContent(ctx, data.slice(9));
    return true;
  }
  if (data.startsWith('acaccess:')) {
    if (!(await guard(ctx, PERMISSIONS.EDIT_CONTENT))) return true;
    const contentId = data.slice(9);
    const contentRepo = require('../../db/content');
    const item = await contentRepo.getContent(contentId);
    if (!item) return true;
    await contentRepo.updateContent(contentId, {
      access_mode: item.access_mode === 'public' ? 'protected' : 'public',
    });
    await ctx.answerCallbackQuery('Access mode updated.');
    await contentHandlers.showContentDetail(ctx, contentId);
    return true;
  }

  if (data.startsWith('afj_type:')) {
    if (!(await guard(ctx, PERMISSIONS.MANAGE_FORCE_JOIN))) return true;
    await forceJoinHandlers.handleTypeSelection(ctx, data.slice(9));
    return true;
  }

  if (data.startsWith('afj:')) {
    if (!(await guard(ctx, PERMISSIONS.MANAGE_FORCE_JOIN))) return true;
    const parts = data.slice(4).split(':');
    const sub = parts[0];
    if (sub === 'add') await forceJoinHandlers.startAdd(ctx);
    else if (sub === 'edit_name') await forceJoinHandlers.startEditName(ctx, parts[1]);
    else if (sub === 'edit_link') await forceJoinHandlers.startEditLink(ctx, parts[1]);
    else if (sub === 'edit_user') await forceJoinHandlers.startEditUsername(ctx, parts[1]);
    else if (sub === 'edit_id') await forceJoinHandlers.startEditId(ctx, parts[1]);
    else if (sub === 'toggle') await forceJoinHandlers.toggleChannel(ctx, parts[1]);
    else if (sub === 'toggle_approval') await forceJoinHandlers.toggleApproval(ctx, parts[1]);
    else if (sub === 'delete') await forceJoinHandlers.deleteChannel(ctx, parts[1]);
    else await forceJoinHandlers.showChannelDetail(ctx, parts[0]);
    return true;
  }

  if (data.startsWith('awelcome:')) {
    if (!(await guard(ctx, PERMISSIONS.EDIT_WELCOME))) return true;
    const sub = data.slice(9);
    if (sub === 'preview') await welcomeHandlers.preview(ctx);
    else await welcomeHandlers.startEdit(ctx, sub);
    return true;
  }

  if (data.startsWith('abc:')) {
    if (!(await guard(ctx, PERMISSIONS.BROADCAST))) return true;
    const sub = data.slice(4);
    if (sub === 'text') await broadcastHandlers.startText(ctx);
    else if (sub === 'photo') await broadcastHandlers.startPhoto(ctx);
    else if (sub === 'video') await broadcastHandlers.startVideo(ctx);
    else if (sub === 'history') await broadcastHandlers.showHistory(ctx);
    return true;
  }

  if (data.startsWith('auser:')) {
    if (!(await guard(ctx, PERMISSIONS.MANAGE_USERS))) return true;
    const parts = data.slice(6).split(':');
    if (parts[0] === 'search') await userHandlers.startSearch(ctx, false);
    else if (parts[0] === 'search_user') await userHandlers.startSearch(ctx, true);
    else if (parts[0] === 'block') await userHandlers.toggleBlock(ctx, Number(parts[1]));
    return true;
  }

  if (data.startsWith('aadmin:')) {
    if (!(await guard(ctx, PERMISSIONS.MANAGE_ADMINS))) return true;
    const parts = data.slice(7).split(':');
    const sub = parts[0];
    if (sub === 'add') await adminMgmtHandlers.startAdd(ctx);
    else if (sub === 'remove') await adminMgmtHandlers.removeAdmin(ctx, Number(parts[1]));
    else if (sub === 'perms') await adminMgmtHandlers.showPermissionsMenu(ctx, Number(parts[1]));
    else if (sub === 'toggle_perm') await adminMgmtHandlers.togglePermission(ctx, Number(parts[1]), parts[2]);
    else await adminMgmtHandlers.showAdminDetail(ctx, Number(parts[0]));
    return true;
  }

  if (data.startsWith('astorage:')) {
    if (!(await guard(ctx, PERMISSIONS.MANAGE_STORAGE))) return true;
    const sub = data.slice(9);
    if (sub === 'set') await storageHandlers.startSet(ctx);
    else if (sub === 'test') await storageHandlers.testConnection(ctx);
    return true;
  }

  if (data.startsWith('asettings:')) {
    if (!(await guard(ctx, PERMISSIONS.MANAGE_SETTINGS))) return true;
    const sub = data.slice(10);
    if (sub === 'language') await settingsHandlers.startLanguage(ctx);
    else if (sub === 'autodelete') await settingsHandlers.startAutoDelete(ctx);
    else if (sub === 'referrals') await settingsHandlers.startReferrals(ctx);
    else if (sub === 'referrals_off') await settingsHandlers.disableReferrals(ctx);
    else if (sub === 'referral_timezone') await settingsHandlers.startReferralTimezone(ctx);
    else if (sub === 'view') await settingsHandlers.viewAll(ctx);
    else if (sub === 'hv') await settingsHandlers.showHumanVerifyMenu(ctx);
    else if (sub === 'hv_toggle') await settingsHandlers.toggleHumanVerify(ctx);
    else if (sub.startsWith('hv_edit:')) await settingsHandlers.startHumanVerifyEdit(ctx, sub.slice(8));
    return true;
  }

  return false;
}

async function routeAdminText(ctx) {
  const s = session.get(ctx.from.id);
  if (!s || !s.flow) return false;
  const permission = permissionForFlow(s.flow);
  if (permission && !isSuperAdmin(ctx.from.id) && !(await hasPermission(ctx.from.id, permission))) {
    session.clear(ctx.from.id);
    await ctx.reply('⛔️ Your permission for this operation is no longer active.');
    return true;
  }

  if (ctx.message.text === '/done' && s.flow === 'content_upload') {
    return contentHandlers.finishUpload(ctx);
  }

  const handlers = [
    folderHandlers.handleTextInput,
    contentHandlers.handleTextInput,
    forceJoinHandlers.handleTextInput,
    welcomeHandlers.handleTextInput,
    broadcastHandlers.handleInput,
    userHandlers.handleTextInput,
    adminMgmtHandlers.handleTextInput,
    storageHandlers.handleTextInput,
    settingsHandlers.handleTextInput,
  ];

  for (const h of handlers) {
    try {
      const handled = await h(ctx);
      if (handled) return true;
    } catch (err) {
      logger.error('Admin text handler error:', err.message);
    }
  }
  return false;
}

function permissionForFlow(flow) {
  if (flow.startsWith('folder_')) return PERMISSIONS.MANAGE_FOLDERS;
  if (flow.startsWith('content_upload')) return PERMISSIONS.UPLOAD_CONTENT;
  if (flow.startsWith('content_edit')) return PERMISSIONS.EDIT_CONTENT;
  if (flow.startsWith('forcejoin_')) return PERMISSIONS.MANAGE_FORCE_JOIN;
  if (flow.startsWith('welcome_')) return PERMISSIONS.EDIT_WELCOME;
  if (flow.startsWith('broadcast_')) return PERMISSIONS.BROADCAST;
  if (flow.startsWith('user_')) return PERMISSIONS.MANAGE_USERS;
  if (flow.startsWith('admin_')) return PERMISSIONS.MANAGE_ADMINS;
  if (flow.startsWith('storage_')) return PERMISSIONS.MANAGE_STORAGE;
  if (flow.startsWith('settings_')) return PERMISSIONS.MANAGE_SETTINGS;
  return null;
}

module.exports = {
  showPanel,
  routeAdminCallback,
  routeAdminSubCallback,
  routeAdminText,
  adminOnly,
};