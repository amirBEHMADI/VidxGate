const { stmts } = require("../database/db");
const logger = require("../utils/logger");

/**
 * میدلور بررسی عضویت در کانال‌های اسپانسر
 * @param {import('grammy').Api} api - آبجکت API ربات
 * @param {number} userId - آیدی کاربر
 * @returns {Promise<{isMember: boolean, notJoined: Array}>}
 */
async function checkMembership(api, userId) {
  const sponsors = stmts.getActiveSponsors.all();

  if (sponsors.length === 0) {
    logger.info(`No active sponsor channels found. Membership check passed for user ${userId}.`);
    return { isMember: true, notJoined: [] };
  }

  const notJoined = [];

  for (const sponsor of sponsors) {
    try {
      const member = await api.getChatMember(sponsor.channel_id, userId);
      logger.info(
        `Checking sponsor ${sponsor.channel_name} (${sponsor.channel_id}) for user ${userId}: status = "${member.status}"`
      );

      // Allowed statuses: member, administrator, creator
      const allowedStatuses = ["member", "administrator", "creator"];
      if (!allowedStatuses.includes(member.status)) {
        notJoined.push(sponsor);
      }
    } catch (error) {
      logger.error(
        `Error checking membership for channel ${sponsor.channel_name} (${sponsor.channel_id}):`,
        error.message
      );
      // Assume user is not a member
      notJoined.push(sponsor);
    }
  }

  return {
    isMember: notJoined.length === 0,
    notJoined,
  };
}

module.exports = { checkMembership };

