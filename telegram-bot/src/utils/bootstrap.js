const adminRepo = require('../db/admins');
const { superAdminId } = require('../config/env');
const logger = require('./logger');

// Ensure the Super Admin record exists in the database on startup.
async function ensureSuperAdmin() {
  if (!superAdminId) {
    throw new Error('SUPER_ADMIN_ID is not set in environment.');
  }
  try {
    const existing = await adminRepo.getAdmin(superAdminId);
    if (!existing) {
      await adminRepo.addAdmin(superAdminId, null);
      // Mark as super
      const supabase = require('../db/supabase');
      await supabase
        .from('admins')
        .update({ is_super: true })
        .eq('telegram_id', superAdminId);
      logger.info(`Super Admin seeded: ${superAdminId}`);
    } else if (!existing.is_super) {
      const supabase = require('../db/supabase');
      await supabase
        .from('admins')
        .update({ is_super: true })
        .eq('telegram_id', superAdminId);
      logger.info(`Super Admin flag set for: ${superAdminId}`);
    }
  } catch (err) {
    logger.error('Failed to seed Super Admin:', err.message);
    throw err;
  }
}

module.exports = { ensureSuperAdmin };
