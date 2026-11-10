// Read-only: are the e-mail reports switched on, and when did each one last go out? (Sends nothing.)
const { authorizeCron } = require('../../lib/auth');
const { json } = require('../../lib/http');
const store = require('../../lib/store');
const mailer = require('../../lib/mailer');
const { today } = require('../../lib/tz');

module.exports = async (req, res) => {
  if (!authorizeCron(req, res)) return;
  try {
    const sent = (await store.get('sent')) || {};
    json(res, 200, {
      reportsEnabled: process.env.REPORTS_ENABLED === 'true',
      smtpConfigured: mailer.configured(),
      dailyRecipients: (process.env.DAILY_TO || '').split(',').filter(Boolean).length,
      weeklyRecipients: (process.env.WEEKLY_TO || process.env.DAILY_TO || '').split(',').filter(Boolean).length,
      today: today(), lastSent: sent,
    });
  } catch (e) { json(res, 500, { error: e.message }); }
};
