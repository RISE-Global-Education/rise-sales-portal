// Tiny helpers shared by the Vercel functions and the local server.
const json = (res, status, obj) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
const query = (req) => Object.fromEntries(new URL(req.url, 'http://x').searchParams);
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let s = '';
  for await (const c of req) s += c;
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}
module.exports = { json, query, body };
