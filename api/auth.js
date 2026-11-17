const auth = require('../lib/auth');
const { json, body } = require('../lib/http');

// GET -> the signed-in user (401 if none).   POST { action: 'login', email, password } | { action: 'logout' }
module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const u = await auth.sessionUser(req);
      return u ? json(res, 200, { user: u, sso: auth.sso.publicInfo() }) : auth.unauthorized(req, res);
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
    const b = await body(req);
    if (b.action === 'login') return json(res, 200, { user: await auth.login(req, res, b) });
    // With SSO the page then goes to the portal's logout, which signs out of every RISE tool.
    if (b.action === 'logout') { auth.clear(res); return json(res, 200, { ok: true, redirect: auth.sso.enabled ? auth.sso.publicInfo().logoutUrl : null }); }
    json(res, 400, { error: 'unknown action' });
  } catch (e) { json(res, e.status || 500, { error: e.message }); }
};
