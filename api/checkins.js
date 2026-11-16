const { authorize } = require('../lib/auth');
const { json, body, query } = require('../lib/http');
const checkins = require('../lib/checkins');

// Daily Checkin tab. Every signed-in user can read; only editors (CHECKIN_EDITORS: Arth, Guillermo) can change.
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD           -> { people, entries }
// POST { action: 'save', id?, date, people, link, summary }  -> { entry }   (no id = new check-in)
// POST { action: 'delete', id }                             -> { ok: true }
module.exports = async (req, res) => {
  const user = await authorize(req, res);
  if (!user) return;
  try {
    if (req.method === 'GET') { const q = query(req); return json(res, 200, await checkins.list(q.from, q.to)); }
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
    const b = await body(req);
    if (b.action === 'delete') { await checkins.remove(user, b.id); return json(res, 200, { ok: true }); }
    return json(res, 200, { entry: await checkins.save(user, b) });
  } catch (e) { json(res, e.status || 500, { error: e.message }); }
};
