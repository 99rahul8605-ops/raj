// Granular admin permission keys. The Super Admin implicitly has all of these.
const PERMISSIONS = {
  MANAGE_FOLDERS: 'manage_folders',
  UPLOAD_CONTENT: 'upload_content',
  EDIT_CONTENT: 'edit_content',
  DELETE_CONTENT: 'delete_content',
  MANAGE_FORCE_JOIN: 'manage_force_join',
  BROADCAST: 'broadcast',
  MANAGE_USERS: 'manage_users',
  EDIT_WELCOME: 'edit_welcome',
  VIEW_STATS: 'view_stats',
  MANAGE_ADMINS: 'manage_admins',
  VIEW_LOGS: 'view_logs',
  MANAGE_STORAGE: 'manage_storage',
  MANAGE_SETTINGS: 'manage_settings',
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

// Human-readable labels for the admin panel
const PERMISSION_LABELS = {
  [PERMISSIONS.MANAGE_FOLDERS]: '📁 Manage Folders',
  [PERMISSIONS.UPLOAD_CONTENT]: '📤 Upload Content',
  [PERMISSIONS.EDIT_CONTENT]: '✏️ Edit Content',
  [PERMISSIONS.DELETE_CONTENT]: '🗑️ Delete Content',
  [PERMISSIONS.MANAGE_FORCE_JOIN]: '📢 Force Join Channels',
  [PERMISSIONS.BROADCAST]: '📢 Broadcast',
  [PERMISSIONS.MANAGE_USERS]: '👥 Manage Users',
  [PERMISSIONS.EDIT_WELCOME]: '📝 Welcome Page',
  [PERMISSIONS.VIEW_STATS]: '📊 View Statistics',
  [PERMISSIONS.MANAGE_ADMINS]: '👨‍💼 Admin Management',
  [PERMISSIONS.VIEW_LOGS]: '📜 Activity Logs',
  [PERMISSIONS.MANAGE_STORAGE]: '💾 Storage Settings',
  [PERMISSIONS.MANAGE_SETTINGS]: '⚙️ Bot Settings',
};

module.exports = { PERMISSIONS, ALL_PERMISSIONS, PERMISSION_LABELS };
