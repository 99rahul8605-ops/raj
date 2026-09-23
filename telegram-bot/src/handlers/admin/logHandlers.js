const { InlineKeyboard } = require('grammy');
const logsRepo = require('../../db/logs');

async function showLogsMenu(ctx) {
  const logs = await logsRepo.listLogs(30);
  if (logs.length === 0) {
    const kb = new InlineKeyboard().text('⬅️ Back', 'admin:panel');
    await ctx.editMessageText('📜 Activity Logs\n\nNo activity logged yet.', { reply_markup: kb });
    return;
  }

  let text = '📜 Recent Admin Activity (last 30)\n\n';
  for (const log of logs) {
    const date = new Date(log.created_at).toLocaleString();
    let details = '';
    try {
      if (log.details) {
        const parsed = JSON.parse(log.details);
        details = Object.entries(parsed).map(([k, v]) => `${k}=${v}`).join(', ');
      }
    } catch (err) {
      details = log.details || '';
    }
    text += `[${date}] Admin ${log.admin_id}\n  ${log.action}${log.target ? ' → ' + truncate(log.target, 40) : ''}${details ? '\n  (' + truncate(details, 80) + ')' : ''}\n\n`;
  }

  const kb = new InlineKeyboard().text('⬅️ Back', 'admin:panel');
  await ctx.editMessageText(text, { reply_markup: kb });
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = { showLogsMenu };
