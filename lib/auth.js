// Portal logins + secret check for cron endpoints.
//  - Users: USERS in lib/config.js (e-mail = login ID). A user's password is their own e-mail address, except users with
//    `passwordEnv` (Yash: YASH_PASSWORD), who sign in only with the password in that environment variable.
//    There is no password change on the portal.
//  - Session: a signed, HttpOnly cookie (30 days). Changing YASH_PASSWORD in Vercel signs Yash's sessions out.
//    Signing key: SESSION_SECRET, or derived from CRON_SECRET when SESSION_SECRET is not set (changing it signs everyone out).
//  - CRON_SECRET: Vercel sends it as "Authorization: Bearer <secret>" on cron calls (unchanged).
const crypto = require('crypto');
const { json } = require('./http');
const { userByEmail, RESOLVERS } = require('./config');

const COOKIE = 'sp_session';
const MAX_AGE = 30 * 24 * 3600; // seconds
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const safeEq = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
const secret = () => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.CRON_SECRET) return crypto.createHmac('sha256', process.env.CRON_SECRET).update('sales-portal-session-v1').digest('hex');
  if (process.env.VERCEL) throw fail(503, 'Set SESSION_SECRET (or CRON_SECRET) in the Vercel project settings.');
  return 'local-dev-only';
};
const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));
// env-password users: sessions carry a fingerprint of that password, so changing it in Vercel signs them out
const envVersion = (u) => crypto.createHmac('sha256', secret()).update('envpw:' + (process.env[u.passwordEnv] || '')).digest('base64url').slice(0, 16);
const profile = (u) => ({ email: u.email, name: u.name, resolver: RESOLVERS().includes(u.email) });

function issue(res, u) {
  const payload = b64(JSON.stringify({ e: u.email, v: u.passwordEnv ? envVersion(u) : 0, exp: Math.floor(Date.now() / 1000) + MAX_AGE }));
  res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}${process.env.VERCEL ? '; Secure' : ''}`);
}
const clear = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.VERCEL ? '; Secure' : ''}`);

// -> { email, name, resolver } or null
async function sessionUser(req) {
  const raw = cookies(req)[COOKIE];
  if (!raw || !raw.includes('.')) return null;
  const [payload, sig] = raw.split('.');
  if (!safeEq(sig, sign(payload))) return null;
  let s; try { s = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  const u = userByEmail(s.e);
  if (!u || !s.exp || s.exp < Date.now() / 1000) return null;
  if (u.passwordEnv && (!process.env[u.passwordEnv] || s.v !== envVersion(u))) return null;
  return profile(u);
}

// Gate for the portal's API. Returns the user, or answers 401 and returns null.
async function authorize(req, res) {
  let u;
  try { u = await sessionUser(req); } catch (e) { json(res, e.status || 500, { error: e.message }); return null; }
  if (!u) { json(res, 401, { error: 'login required' }); return null; }
  return u;
}

// simple brute-force brake: 8 failed attempts per e-mail per 15 minutes (per server instance)
const fails = new Map();
const tooMany = (email) => { const f = fails.get(email); return f && f.n >= 8 && Date.now() - f.at < 15 * 60e3; };
const failed = (email) => { const f = fails.get(email); fails.set(email, f && Date.now() - f.at < 15 * 60e3 ? { n: f.n + 1, at: f.at } : { n: 1, at: Date.now() }); };

async function login(req, res, b) {
  const email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
  const u = userByEmail(email);
  if (tooMany(email)) throw fail(429, 'Too many attempts. Try again in 15 minutes.');
  let ok = false;
  if (u && u.passwordEnv) {
    if (!process.env[u.passwordEnv]) throw fail(503, `${u.passwordEnv} is not set yet.`);
    ok = safeEq(password, process.env[u.passwordEnv]);
  } else if (u) ok = safeEq(password.trim().toLowerCase(), u.email); // password = own e-mail
  if (!ok) { failed(email); await new Promise((r) => setTimeout(r, 400)); throw fail(401, 'Wrong e-mail or password.'); }
  fails.delete(email);
  issue(res, u);
  return profile(u);
}

function authorizeCron(req, res) {
  const s = process.env.CRON_SECRET;
  if (!s) {
    if (process.env.VERCEL) { json(res, 503, { error: 'Set CRON_SECRET in the Vercel project settings.' }); return false; }
    return true;
  }
  if ((req.headers.authorization || '') === `Bearer ${s}`) return true;
  json(res, 401, { error: 'unauthorized' });
  return false;
}

module.exports = { authorize, sessionUser, login, clear, authorizeCron };
