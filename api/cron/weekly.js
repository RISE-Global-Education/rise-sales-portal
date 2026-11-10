const { authorizeCron } = require('../../lib/auth');
const { json } = require('../../lib/http');
const service = require('../../lib/service');

module.exports = async (req, res) => {
  if (!authorizeCron(req, res)) return;
  // Sundays: retries every 15 min from 05:00 UTC (10:30 IST) until it has been sent; later runs say "already sent today".
  const d = new Date(); if (d.getUTCHours() * 60 + d.getUTCMinutes() < 5 * 60) return json(res, 200, { sent: false, reason: 'too early (weekly report goes out from 10:30 IST)' });
  try { json(res, 200, await service.sendReport('weekly')); }
  catch (e) { json(res, 500, { error: e.message }); }
};
