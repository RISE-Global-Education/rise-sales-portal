// Single sign-on through the RISE Internal Portal (SSO_PORTAL_URL + SSO_SECRET set). Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

const SECRET = 'x'.repeat(40);
process.env.CRON_SECRET = 'cron-secret-for-tests';
process.env.SSO_PORTAL_URL = 'https://portal.test/';
process.env.SSO_SECRET = SECRET;
const authApi = require('../api/auth');
const ssoApi = require('../api/sso');
const { signJwt } = require('../lib/sso-client');

const handoff = (email, aud = 'sales', exp = 60) => {
  const iat = Math.floor(Date.now() / 1000);
  return signJwt({ iss: 'rise-internal-portal', typ: 'sso', aud, sub: email, name: 'X', iat, exp: iat + exp }, SECRET);
};
const call = async (handler, { method = 'GET', url = '/', cookie = '', body } = {}) => {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.raw = b; try { this.body = JSON.parse(b); } catch { this.body = b; } } };
  await handler({ method, url, headers: { cookie }, body }, res);
  return res;
};
const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).find((c) => c.startsWith('rise_sso_sales=')).split(';')[0];

test('signed out: 401 points at the portal; password login is closed', async () => {
  const r = await call(authApi);
  assert.equal(r.statusCode, 401);
  assert.deepEqual(r.body.sso, { portalUrl: 'https://portal.test', appId: 'sales', logoutUrl: 'https://portal.test/sso/logout' });
  const l = await call(authApi, { method: 'POST', body: { action: 'login', email: 'arth@riseresearch.com', password: 'arth@riseresearch.com' } });
  assert.equal(l.statusCode, 410);
});

test('a portal hand-off signs a USERS member in with their normal profile', async () => {
  const r = await call(ssoApi, { url: `/sso/login?token=${handoff('arth@riseresearch.com')}&return=%2F%3Ftab%3Dx` });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, '/?tab=x');
  const me = await call(authApi, { cookie: cookieOf(r) });
  assert.equal(me.statusCode, 200);
  assert.equal(me.body.user.email, 'arth@riseresearch.com');
  assert.equal(me.body.user.checkin, 'edit');
});

test('someone with portal access but no Sales profile gets 403, not a redirect loop', async () => {
  const r = await call(ssoApi, { url: `/sso/login?token=${handoff('shubhvi@riseresearch.com')}` });
  const me = await call(authApi, { cookie: cookieOf(r) });
  assert.equal(me.statusCode, 403);
});

test('tokens for another portal, expired or forged tokens are refused; foreign return URLs are dropped', async () => {
  assert.equal((await call(ssoApi, { url: `/sso/login?token=${handoff('arth@riseresearch.com', 'chat')}` })).statusCode, 401);
  assert.equal((await call(ssoApi, { url: `/sso/login?token=${handoff('arth@riseresearch.com', 'sales', -5)}` })).statusCode, 401);
  const forged = signJwt({ iss: 'rise-internal-portal', typ: 'sso', aud: 'sales', sub: 'yash@riseresearch.com', exp: 9e9 }, 'y'.repeat(40));
  assert.equal((await call(ssoApi, { url: `/sso/login?token=${forged}` })).statusCode, 401);
  const evil = await call(ssoApi, { url: `/sso/login?token=${handoff('arth@riseresearch.com')}&return=https%3A%2F%2Fevil.com` });
  assert.equal(evil.headers.location, '/');
});

test('an old password-login cookie is not accepted in SSO mode', async () => {
  const me = await call(authApi, { cookie: 'sp_session=anything.sig' });
  assert.equal(me.statusCode, 401);
});

test('logout clears the cookie and continues the portal logout chain', async () => {
  const r = await call(ssoApi, { url: '/sso/logout?return=https%3A%2F%2Fportal.test%2Fsso%2Flogout%3Fi%3D2' });
  assert.equal(r.headers.location, 'https://portal.test/sso/logout?i=2');
  assert.match([].concat(r.headers['set-cookie']).join(), /rise_sso_sales=; .*Max-Age=0/);
  const api = await call(authApi, { method: 'POST', body: { action: 'logout' } });
  assert.equal(api.body.redirect, 'https://portal.test/sso/logout');
});
