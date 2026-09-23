const { InlineKeyboard } = require('grammy');
const usersRepo = require('../../db/users');
const foldersRepo = require('../../db/folders');
const contentRepo = require('../../db/content');
const forceJoinRepo = require('../../db/forceJoin');
const broadcastRepo = require('../../db/broadcasts');
const referralsRepo = require('../../db/referrals');

async function showStats(ctx) {
  const [totalUsers, active7d, new7d, totalFolders, totalContent, totalChannels, broadcastStats, referralStats] = await Promise.all([
    usersRepo.countUsers(),
    usersRepo.countActiveSince(7),
    usersRepo.countNewSince(7),
    foldersRepo.countFolders(),
    contentRepo.countContent(),
    forceJoinRepo.countChannels(),
    broadcastRepo.getBroadcastStats(),
    referralsRepo.getStats(),
  ]);

  let totalBroadcasts = 0;
  let totalSent = 0;
  let totalDelivered = 0;
  let totalFailed = 0;
  for (const b of broadcastStats || []) {
    totalBroadcasts++;
    totalSent += b.total || 0;
    totalDelivered += b.success || 0;
    totalFailed += b.failed || 0;
  }

  const kb = new InlineKeyboard().text('🔄 Refresh', 'admin:stats').text('⬅️ Back', 'admin:panel');

  let text = '📊 Statistics Dashboard\n\n';
  text += '👥 Users\n';
  text += `  Total: ${totalUsers}\n`;
  text += `  Active (7d): ${active7d}\n`;
  text += `  New (7d): ${new7d}\n\n`;
  text += '📁 Content\n';
  text += `  Folders: ${totalFolders}\n`;
  text += `  Content items: ${totalContent}\n\n`;
  text += '📢 Force Join\n';
  text += `  Channels: ${totalChannels}\n\n`;
  text += '🔗 Referrals\n';
  text += `  Total: ${referralStats.total}\n`;
  text += `  Valid: ${referralStats.valid}\n`;
  text += `  Pending: ${referralStats.pending}\n\n`;
  text += '📣 Broadcasts\n';
  text += `  Campaigns: ${totalBroadcasts}\n`;
  text += `  Total sent: ${totalSent}\n`;
  text += `  Delivered: ${totalDelivered}\n`;
  text += `  Failed: ${totalFailed}`;

  await ctx.editMessageText(text, { reply_markup: kb });
  await ctx.answerCallbackQuery();
}

module.exports = { showStats };
