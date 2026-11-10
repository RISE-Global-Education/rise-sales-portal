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
    const m = report.daily(snap.data, undefined, { overdue: await service.liveOverdue(snap.data, true) });
    const out = { report: m.subject };
    if (only !== 'email') { if (slack.configured()) { try { await slack.post('[TEST] ' + m.subject, m.text); out.slack = 'posted'; } catch (e) { out.slack = 'failed: ' + e.message; } } else out.slack = 'not configured'; }
    if (only !== 'slack') { if (mailer.configured()) { try { const i = await mailer.send(process.env.SMTP_USER, '[TEST] ' + m.subject, m.html, m.text); out.email = 'accepted by ' + i.accepted.join(', '); } catch (e) { out.email = 'failed: ' + e.message; } } else out.email = 'not configured'; }
    json(res, 200, out);
  } catch (e) { json(res, 500, { error: e.message }); }
};
