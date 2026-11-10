const { authorizeCron } = require('../../lib/auth');
const { json } = require('../../lib/http');
const service = require('../../lib/service');

module.exports = async (req, res) => {
  if (!authorizeCron(req, res)) return;
  // The cron fires every 15 min from 09:30 IST; nothing goes out before 10:00 IST (04:30 UTC). Once today's report is sent, later runs just say "already sent today".
  const d = new Date(); if (d.getUTCHours() * 60 + d.getUTCMinutes() < 4 * 60 + 30) return json(res, 200, { sent: false, reason: 'too early (daily report goes out from 10:00 IST)' });
  try { json(res, 200, await service.sendReport('daily')); }
  catch (e) { json(res, 500, { error: e.message }); }
};
