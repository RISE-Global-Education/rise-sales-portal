const { authorize } = require('../lib/auth');
const { json, body } = require('../lib/http');
const disputes = require('../lib/disputes');
const notify = require('../lib/notify');

// GET -> all discrepancies. POST -> raise one, then e-mail DISPUTE_NOTIFY_TO (default yash@riseresearch.com).
// (Accept / reject is done in Airtable only, by changing Status.)
module.exports = async (req, res) => {
  if (!authorize(req, res)) return;
  try {
    if (req.method === 'GET') return json(res, 200, { disputes: await disputes.list(), reasons: disputes.REASONS });
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
    const b = await body(req);
    const dispute = await disputes.raise(b);
    // sent before replying: on Vercel the function may be frozen as soon as the response goes out
    const mail = await notify.disputeRaised(dispute, /^https:\/\/app\.hubspot\.com\//.test(b.dealLink || '') ? b.dealLink : '');
    return json(res, 200, { dispute, notified: mail.sent });
  } catch (e) { json(res, e.status || 500, { error: e.message }); }
};
