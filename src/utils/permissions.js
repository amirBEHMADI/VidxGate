const config = require("../config");
const { stmts } = require("../database/db");

/**
 * بررسی دسترسی‌های یک کاربر
 * @param {number} userId
 * @returns {{
 *   isOwner: boolean,
 *   isAdmin: boolean,
 *   canManageVideos: boolean,
 *   canManageSponsors: boolean,
 *   canBroadcast: boolean,
 *   name: string
 * }}
 */
function getPermissions(userId) {
  const numericId = Number(userId);

  // Check if owner
  if (numericId === config.ADMIN_ID) {
    return {
      isOwner: true,
      isAdmin: true,
      canManageVideos: true,
      canManageSponsors: true,
      canBroadcast: true,
      name: "Owner",
    };
  }

  // Check admin from database
  const admin = stmts.getAdmin.get(numericId);
  if (admin) {
    return {
      isOwner: false,
      isAdmin: true,
      canManageVideos: Boolean(admin.can_manage_videos),
      canManageSponsors: Boolean(admin.can_manage_sponsors),
      canBroadcast: Boolean(admin.can_broadcast),
      name: admin.name || "Admin",
    };
  }

  return {
    isOwner: false,
    isAdmin: false,
    canManageVideos: false,
    canManageSponsors: false,
    canBroadcast: false,
    name: "",
  };
}

module.exports = { getPermissions };
