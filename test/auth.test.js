// Portal logins: password = own e-mail (Yash: YASH_PASSWORD), sessions, brute-force brake. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CRON_SECRET = 'cron-secret-for-tests';
process.env.YASH_PASSWORD = 'Yash-Env-Secret-1';
const authApi = require('../api/auth');
const { USERS } = require('../lib/config');

// tiny HTTP harness: keeps the session cookie between calls, like a browser
function client() {
  let cookie = '';
  const call = async (handler, method, body) => {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
    await handler({ method, headers: { cookie }, body }, res);
    const sc = res.headers['set-cookie'];
    if (sc) cookie = /Max-Age=0/.test(sc) ? '' : sc.split(';')[0];
    return res;
  };
  return { call, get cookie() { return cookie; }, set cookie(c) { cookie = c; } };
}
const login = (c, email, password) => c.call(authApi, 'POST', { action: 'login', email, password });

test('11 logins, Ramya included; only Yash has an environment password', () => {
  assert.equal(USERS.length, 11);
  assert.ok(USERS.some((u) => u.email === 'ramya@riseresearch.com' && u.name === 'Ramya Warrier'));
  assert.deepEqual(USERS.filter((u) => u.passwordEnv).map((u) => [u.email, u.passwordEnv]), [['yash@riseresearch.com', 'YASH_PASSWORD']]);
});

test('every rep signs in with their own e-mail as the password; nobody else can sign in', async () => {
  for (const u of USERS.filter((x) => !x.passwordEnv)) {
    const r = await login(client(), u.email, u.email);
    assert.equal(r.statusCode, 200, u.email);
    assert.deepEqual(r.body.user, { email: u.email, name: u.name, resolver: false });
  }
  assert.equal((await login(client(), ' ARTH@riseresearch.com ', 'Arth@RiseResearch.com')).statusCode, 200); // case / spaces do not matter
  assert.equal((await login(client(), 'arth@riseresearch.com', 'muskaan@riseresearch.com')).statusCode, 401); // someone else's e-mail
  assert.equal((await login(client(), 'someone@gmail.com', 'someone@gmail.com')).statusCode, 401); // not on the list
  assert.equal((await client().call(authApi, 'POST', { action: 'password', newPassword: 'x' })).statusCode, 400); // no password change
});

test('Yash: only YASH_PASSWORD works (not his e-mail); he is the resolver; changing the variable signs him out', async () => {
  assert.equal((await login(client(), 'yash@riseresearch.com', 'yash@riseresearch.com')).statusCode, 401);
  const y = client();
  const r = await login(y, 'yash@riseresearch.com', 'Yash-Env-Secret-1');
  assert.deepEqual(r.body.user, { email: 'yash@riseresearch.com', name: 'Yash Mundada', resolver: true });
  assert.equal((await y.call(authApi, 'GET')).body.user.resolver, true);
  process.env.YASH_PASSWORD = 'Yash-Env-Secret-2';
  assert.equal((await y.call(authApi, 'GET')).statusCode, 401);
  assert.equal((await login(client(), 'yash@riseresearch.com', 'Yash-Env-Secret-1')).statusCode, 401);
  assert.equal((await login(client(), 'yash@riseresearch.com', 'Yash-Env-Secret-2')).statusCode, 200);
  delete process.env.YASH_PASSWORD;
  assert.equal((await login(client(), 'yash@riseresearch.com', '')).statusCode, 503); // without the variable Yash cannot sign in
  process.env.YASH_PASSWORD = 'Yash-Env-Secret-1';
});

test('sessions: no cookie / forged cookie = 401; sign out works', async () => {
  assert.equal((await client().call(authApi, 'GET')).statusCode, 401);
  const forged = client(); forged.cookie = 'sp_session=' + Buffer.from(JSON.stringify({ e: 'yash@riseresearch.com', v: 0, exp: 9e9 })).toString('base64url') + '.fakesig';
  assert.equal((await forged.call(authApi, 'GET')).statusCode, 401);
  const a = client();
  await login(a, 'muskaan@riseresearch.com', 'muskaan@riseresearch.com');
  assert.equal((await a.call(authApi, 'GET')).body.user.name, 'Muskaan Mir');
  await a.call(authApi, 'POST', { action: 'logout' });
  assert.equal((await a.call(authApi, 'GET')).statusCode, 401);
});

test('8 wrong passwords lock that e-mail for 15 minutes', async () => {
  const c = client();
  for (let i = 0; i < 8; i++) assert.equal((await login(c, 'lucas@riseresearch.com', 'bad' + i)).statusCode, 401);
  assert.equal((await login(c, 'lucas@riseresearch.com', 'lucas@riseresearch.com')).statusCode, 429);
});

test('cron endpoints still use CRON_SECRET, not logins', async () => {
  const { authorizeCron } = require('../lib/auth');
  const res = { statusCode: 0, setHeader() {}, end() {} };
  assert.equal(authorizeCron({ headers: { authorization: 'Bearer cron-secret-for-tests' } }, res), true);
  assert.equal(authorizeCron({ headers: {} }, res), false);
});
