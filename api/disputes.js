const { authorize } = require('../lib/auth');
const { json, body } = require('../lib/http');
const disputes = require('../lib/disputes');

// GET -> all discrepancies. POST -> raise one. (Accept / reject is done in Airtable only, by changing Status.)
module.exports = async (req, res) => {
  if (!authorize(req, res)) return;
  try {
    if (req.method === 'GET') return json(res, 200, { disputes: await disputes.list(), reasons: disputes.REASONS });
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
    const b = await body(req);
    return json(res, 200, { dispute: await disputes.raise(b) });
  } catch (e) { json(res, e.status || 500, { error: e.message }); }
};
