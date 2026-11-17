// RISE Internal Portal - SSO client for the individual portals.  (canonical copy: internal-portal/sso-client/sso-client.cjs)
// Copy this file unchanged into a portal; it has no dependencies.
//
// The internal portal signs a 60-second token bound to one portal (aud = app id) and sends the browser to
//   <portal>/sso/login?token=..&return=..
// This module verifies it with the shared SSO_SECRET and sets the portal's own session cookie, so every
// later request is signed in without the internal portal. /sso/logout clears that cookie.
//
// Env: SSO_PORTAL_URL (the internal portal, no trailing slash), SSO_SECRET (shared), optional SSO_APP_ID,
//      SSO_SESSION_HOURS (default 8). SSO is on only when both SSO_PORTAL_URL and SSO_SECRET are set.
const crypto = require('crypto');

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const HEADER = b64({ alg: 'HS256', typ: 'JWT' });
const mac = (data, key) => crypto.createHmac('sha256', key).update(data).digest();

function signJwt(payload, key) {
  const body = `${HEADER}.${b64(payload)}`;
  return `${body}.${mac(body, key).toString('base64url')}`;
}

function verifyJwt(token, key, nowMs = Date.now()) {
  if (typeof token !== 'string' || !key) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    if (JSON.parse(Buffer.from(parts[0], 'base64url').toString()).alg !== 'HS256') return null;
  } catch {
    return null;
  }
  const expected = mac(`${parts[0]}.${parts[1]}`, key);
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let p;
  try {
    p = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return null;
  }
  return typeof p.exp === 'number' && p.exp * 1000 > nowMs ? p : null;
}

const cookiesOf = (req) => {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
};

function createSso({ appId, env = process.env, secure = Boolean(env.VERCEL) || env.NODE_ENV === 'production' } = {}) {
  const id = env.SSO_APP_ID || appId;
  const portalUrl = String(env.SSO_PORTAL_URL || '').trim().replace(/\/+$/, '');
  const secret = env.SSO_SECRET || '';
  const enabled = Boolean(portalUrl && secret.length >= 32);
  const hours = Number(env.SSO_SESSION_HOURS || 8);
  const cookie = `rise_sso_${id}`;
  // A separate key for this portal's session cookie: a hand-off token is never accepted as a session,
  // and one portal's cookie is useless on another.
  const sessionKey = secret && crypto.createHmac('sha256', secret).update(`app-session:${id}`).digest();
  const attrs = `HttpOnly; SameSite=Lax; Path=/${secure ? '; Secure' : ''}`;

  /** A hand-off token from the internal portal -> { email, name }, or null. */
  const verifyHandoff = (token, nowMs) => {
    const p = verifyJwt(token, secret, nowMs);
    if (!p || p.typ !== 'sso' || p.aud !== id || p.iss !== 'rise-internal-portal' || typeof p.sub !== 'string') return null;
    return { email: p.sub.toLowerCase(), name: p.name || '' };
  };

  const sessionCookie = ({ email, name }, nowMs = Date.now()) => {
    const iat = Math.floor(nowMs / 1000);
    const value = signJwt({ typ: 'app-session', aud: id, sub: email, name, iat, exp: iat + Math.round(hours * 3600) }, sessionKey);
    return `${cookie}=${value}; ${attrs}; Max-Age=${Math.round(hours * 3600)}`;
  };
  const clearCookie = () => `${cookie}=; ${attrs}; Max-Age=0`;

  /** The signed-in { email, name } from this portal's SSO cookie, or null. */
  const readSession = (req, nowMs) => {
    if (!enabled) return null;
    const p = verifyJwt(cookiesOf(req)[cookie], sessionKey, nowMs);
    return p && p.typ === 'app-session' && p.aud === id ? { email: p.sub, name: p.name || '' } : null;
  };

  /** Where to go after /sso/login or /sso/logout: a local path, or a page on the internal portal. Never elsewhere. */
  const safeReturn = (ret, fallback = '/') => {
    const s = String(ret || '');
    if (s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\')) return s;
    try {
      const u = new URL(s);
      if (portalUrl && u.origin === new URL(portalUrl).origin) return u.toString();
    } catch {
      /* fall through */
    }
    return fallback;
  };

  const redirect = (res, location, setCookie) => {
    res.statusCode = 302;
    if (setCookie) res.setHeader('Set-Cookie', setCookie);
    res.setHeader('Location', location);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.end();
  };

  /** GET /sso/login?token=..&return=..  Works with Express and plain Node responses. */
  const handleLogin = (req, res, query) => {
    if (!enabled) {
      res.statusCode = 404;
      return res.end('SSO is not enabled on this portal.');
    }
    const who = verifyHandoff(query.token);
    if (!who) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(`<p style="font-family:sans-serif">This sign-in link has expired. <a href="${portalUrl}/">Go back to the RISE portal</a> and open it again.</p>`);
    }
    redirect(res, safeReturn(query.return), sessionCookie(who));
  };

  /** GET /sso/logout?return=..  Clears the cookie and goes back to the internal portal's logout chain. */
  const handleLogout = (req, res, query) => redirect(res, safeReturn(query.return, enabled ? `${portalUrl}/sso/logout` : '/'), clearCookie());

  return {
    enabled,
    appId: id,
    portalUrl,
    verifyHandoff,
    readSession,
    sessionCookie,
    clearCookie,
    safeReturn,
    handleLogin,
    handleLogout,
    /** What a signed-out browser needs: send the user to `${portalUrl}/sso/authorize?app=..&return=<this page>`. */
    publicInfo: () => (enabled ? { portalUrl, appId: id, logoutUrl: `${portalUrl}/sso/logout` } : null),
  };
}

module.exports = { createSso, signJwt, verifyJwt };
