const { stmts } = require("../database/db");

/**
 * میدلور بررسی عضویت در کانال‌های اسپانسر
 * @param {import('grammy').Api} api - آبجکت API ربات
 * @param {number} userId - آیدی کاربر
 * @returns {Promise<{isMember: boolean, notJoined: Array}>}
 */
async function checkMembership(api, userId) {
  const sponsors = stmts.getActiveSponsors.all();

  if (sponsors.length === 0) {
    return { isMember: true, notJoined: [] };
  }

  const notJoined = [];

  for (const sponsor of sponsors) {
    try {
      const member = await api.getChatMember(sponsor.channel_id, userId);

      // Allowed statuses: member, administrator, creator
      const allowedStatuses = ["member", "administrator", "creator"];
      if (!allowedStatuses.includes(member.status)) {
        notJoined.push(sponsor);
      }
    } catch (error) {
      // If the bot does not have access or an error occurs, skip or treat as not joined
      console.error(
        `Error checking membership for channel ${sponsor.channel_name}:`,
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
