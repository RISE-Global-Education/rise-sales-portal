const { authorize } = require('../lib/auth');
const { json, body } = require('../lib/http');
const feedback = require('../lib/feedback');

// Feedback tab. Givers (Yash, Shreyans) see everything; a sales person sees only the feedback written to them.
// GET                                   -> { people, items }
// POST { action: 'give', rep, text }    givers only                    -> { item }
// POST { action: 'comment', id, text }  the feedback's sales person / givers -> { item, comment }
// POST { action: 'delete', id }         the giver who wrote it          -> { ok: true }
module.exports = async (req, res) => {
  const user = await authorize(req, res);
  if (!user) return;
  try {
    if (req.method === 'GET') return json(res, 200, await feedback.list(user));
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
    const b = await body(req);
    if (b.action === 'give') return json(res, 200, { item: await feedback.give(user, b) });
    if (b.action === 'comment') return json(res, 200, await feedback.comment(user, b));
    if (b.action === 'delete') { await feedback.remove(user, b.id); return json(res, 200, { ok: true }); }
    return json(res, 400, { error: 'Unknown action.' });
  } catch (e) { json(res, e.status || 500, { error: e.message }); }
};
