const { authorize } = require('../lib/auth');
const { json, body } = require('../lib/http');
const disputes = require('../lib/disputes');
const notify = require('../lib/notify');

// Signed-in users only.
// GET -> all discrepancies (with comments and attachments).
// POST { action: 'raise', ... }        any user          -> e-mails Yash (DISPUTE_NOTIFY_TO)
// POST { action: 'comment', id, message, files }  Yash / the deal's rep / the raiser -> e-mails the others
// POST { action: 'resolve', id, decision, note }   Yash only (RESOLVERS) -> e-mails the rep and the raiser
module.exports = async (req, res) => {
  const user = await authorize(req, res);
  if (!user) return;
  try {
    if (req.method === 'GET') return json(res, 200, { disputes: await disputes.list(), reasons: disputes.REASONS });
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
    const b = await body(req);
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const portal = process.env.PORTAL_URL || (host ? `${/^localhost|^127\./.test(host) ? 'http' : 'https'}://${host}/#disputes` : '');
    // e-mails are sent before replying: on Vercel the function may be frozen as soon as the response goes out
    if (b.action === 'comment') {
      const { dispute, comment } = await disputes.comment(user, b);
      return json(res, 200, { comment, notified: (await notify.send('comment', dispute, user, { comment }, portal)).sent });
    }
    if (b.action === 'resolve') {
      const dispute = await disputes.resolve(user, b);
      return json(res, 200, { dispute, notified: (await notify.send('resolved', dispute, user, {}, portal)).sent });
    }
    const dispute = await disputes.raise(user, b);
    return json(res, 200, { dispute, notified: (await notify.send('raised', dispute, user, {}, portal)).sent });
  } catch (e) { json(res, e.status || 500, { error: e.message }); }
};
