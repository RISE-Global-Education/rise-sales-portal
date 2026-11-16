const { authorize } = require('../lib/auth');
const { json, body, query } = require('../lib/http');
const spam = require('../lib/spam');

// Spam Check tab. Every signed-in user can read; only editors (SPAM_EDITORS, default Guillermo) can save.
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD -> { team, checks }
// POST { date, member, email, phone }  editors only -> { check }
module.exports = async (req, res) => {
  const user = await authorize(req, res);
  if (!user) return;
  try {
    if (req.method === 'GET') { const q = query(req); return json(res, 200, await spam.list(q.from, q.to)); }
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
    return json(res, 200, { check: await spam.set(user, await body(req)) });
  } catch (e) { json(res, e.status || 500, { error: e.message }); }
};
