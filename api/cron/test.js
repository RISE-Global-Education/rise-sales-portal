// On demand (CRON_SECRET needed): sends ONE "[TEST]" copy of the daily report to the Slack channel and to the SMTP_USER mailbox only.
// Touches no recipient list and no once-a-day record, so the real reports are unaffected.
const { authorizeCron } = require('../../lib/auth');
const { json } = require('../../lib/http');
const service = require('../../lib/service');
const report = require('../../lib/report');
const mailer = require('../../lib/mailer');
const slack = require('../../lib/slack');

module.exports = async (req, res) => {
  if (!authorizeCron(req, res)) return;
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });
  const only = new URL(req.url, 'http://x').searchParams.get('only'); // 'slack' | 'email' | (both)
  try {
    const snap = await service.snapshot(true);
    const t = require('../../lib/tz').today(), y = require('../../lib/tz').addDays(t, -1);
    const m = report.daily(snap.data, undefined, { overdue: await service.liveOverdue(snap.data, true), unclaimed: await service.liveUnclaimed(y, y) });
    const out = { report: m.subject };
    if (only !== 'email') { if (slack.configured()) { try { await slack.post('[TEST] ' + m.subject, m.text, Object.values(require('../../lib/config').SLACK_IDS)); out.slack = 'posted'; } catch (e) { out.slack = 'failed: ' + e.message; } } else out.slack = 'not configured'; }
    if (only !== 'slack') { if (mailer.configured()) { try {
      // ?to=all -> the report's real recipient list; ?to=<address on that list> -> just that person; default = SMTP_USER only. Always marked [TEST], no once-a-day record.
      const q = new URL(req.url, 'http://x').searchParams.get('to');
      // only people already on the report (the visible list or a rep's hidden copy) can be addressed; comma-separate several
      const rec = await service.recipients('daily');
      const allowed = [...(rec.to || '').split(','), ...(rec.bcc || '').split(','), process.env.SMTP_USER || ''].map((x) => x.trim().toLowerCase()).filter(Boolean);
      const want = q && q !== 'all' ? q.split(',').map((x) => x.trim()).filter(Boolean) : null;
      if (want && want.some((a) => !allowed.includes(a.toLowerCase()))) throw new Error('an address is not on the report recipient list');
      const r = q === 'all' ? rec : { to: want ? want.join(',') : process.env.SMTP_USER };
      const i = await mailer.send(r.to, '[TEST] ' + m.subject, m.html, m.text, r.bcc); out.email = 'accepted by ' + i.accepted.length + ' recipients' + (r.bcc ? ' (' + r.to.split(',').length + ' visible + ' + r.bcc.split(',').length + ' hidden reps)' : ''); } catch (e) { out.email = 'failed: ' + e.message; } } else out.email = 'not configured'; }
    json(res, 200, out);
  } catch (e) { json(res, 500, { error: e.message }); }
};
