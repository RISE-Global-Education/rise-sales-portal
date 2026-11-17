// GET /sso/login?token=..&return=..  and  GET /sso/logout?return=..  (rewritten here by vercel.json)
// The hand-off from the RISE Internal Portal: see lib/sso-client.js.
const { sso } = require('../lib/auth');
const { query } = require('../lib/http');

module.exports = (req, res) => {
  const q = query(req);
  const action = q.action || new URL(req.url, 'http://x').pathname.split('/').pop();
  if (action === 'login') return sso.handleLogin(req, res, q);
  if (action === 'logout') return sso.handleLogout(req, res, q);
  res.statusCode = 404;
  res.end('Not found');
};
