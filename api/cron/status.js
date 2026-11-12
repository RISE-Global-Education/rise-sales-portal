// Read-only: are the e-mail reports switched on, and when did each one last go out? (Sends nothing.)
const { authorizeCron } = require('../../lib/auth');
const { json } = require('../../lib/http');
const store = require('../../lib/store');
const mailer = require('../../lib/mailer');
const slack = require('../../lib/slack');
const { today } = require('../../lib/tz');

module.exports = async (req, res) => {
  if (!authorizeCron(req, res)) return;
  try {
    const sent = (await store.get('sent')) || {};
    // how old each stored data part is (minutes): every part should stay under ~1-2 hours with the hourly refresh
    const parts = ((await store.get('state')) || {}).parts || {};
    const dataAgeMin = Object.fromEntries(['base', 'deals', 'leads', 'tasks', 'meetings', 'emails', 'airtable', 'granola'].map((k) => [k, parts[k] ? Math.round((Date.now() - parts[k]) / 60000) : null]));
    json(res, 200, {
      build: 'commission',
      reportsEnabled: process.env.REPORTS_ENABLED === 'true',
      smtpConfigured: mailer.configured(),
      slackConfigured: slack.configured(), slackWeekly: process.env.SLACK_WEEKLY === 'true',
      dailyRecipients: (process.env.DAILY_TO || '').split(',').filter(Boolean).length,
      weeklyRecipients: (process.env.WEEKLY_TO || process.env.DAILY_TO || '').split(',').filter(Boolean).length,
      today: today(), lastSent: sent, dataAgeMin,
      airtableConfigured: !!(process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN || process.env.AIRTABLE_TOKEN),
      // saved Granola notes, and how many already carry attendee/invitee e-mails (needed for the commission call proof)
      granolaNotes: await store.get('granola-cache').then((c) => { const v = Object.values(c || {}); return { total: v.length, withEmails: v.filter((g) => Array.isArray(g.emails)).length, withClientEmail: v.filter((g) => (g.emails || []).some((e) => !/@riseresearch\.com$/i.test(e))).length }; }),
    });
  } catch (e) { json(res, 500, { error: e.message }); }
};
