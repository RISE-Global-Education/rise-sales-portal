// Shared-password login for the portal + secret check for cron endpoints.
//  PORTAL_PASSWORD  - password for the portal (required on Vercel; unset = open, local dev only)
//  CRON_SECRET      - Vercel sends it automatically as "Authorization: Bearer <secret>" on cron calls
const crypto = require('crypto');
const { json } = require('./http');

const token = () => crypto.createHmac('sha256', process.env.PORTAL_PASSWORD || '').update('sales-portal-v1').digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookie = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));

function authorize(req, res) {
  if (!process.env.PORTAL_PASSWORD) {
    if (process.env.VERCEL) { json(res, 503, { error: 'Set PORTAL_PASSWORD in the Vercel project settings.' }); return false; }
    return true; // local dev
  }
  if (cookie(req).sp_auth && safeEq(cookie(req).sp_auth, token())) return true;
  json(res, 401, { error: 'login required' });
  return false;
}

function login(req, res, password) {
  if (!process.env.PORTAL_PASSWORD || !safeEq(crypto.createHash('sha256').update(String(password || '')).digest('hex'), crypto.createHash('sha256').update(process.env.PORTAL_PASSWORD).digest('hex'))) {
    return json(res, 401, { error: 'wrong password' });
  }
  res.setHeader('Set-Cookie', `sp_auth=${token()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.VERCEL ? '; Secure' : ''}`);
  json(res, 200, { ok: true });
}

function authorizeCron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.VERCEL) { json(res, 503, { error: 'Set CRON_SECRET in the Vercel project settings.' }); return false; }
    return true;
  }
  if ((req.headers.authorization || '') === `Bearer ${secret}`) return true;
  json(res, 401, { error: 'unauthorized' });
  return false;
}

module.exports = { authorize, login, authorizeCron };
