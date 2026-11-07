// Core operations shared by the Vercel functions (api/*) and the local server (server.js).
const store = require('./store');
const hubspot = require('./hubspot');
const granola = require('./granola');
const { build } = require('./build');
const { compute } = require('./views');
const report = require('./report');
const mailer = require('./mailer');
const { today } = require('./tz');

const num = (v, d) => (v ? Number(v) : d);

// Refresh in small time-boxed steps. Each HubSpot part (and the Granola cache) is saved as soon as it finishes,
// so if the time budget runs out the next call carries on where this one stopped. When every part is present
// the merged snapshot is rebuilt.
async function refresh({ budgetMs = num(process.env.REFRESH_BUDGET_MS, 240000), staleMs = num(process.env.REFRESH_STALE_MS, 2 * 3600e3), force = false } = {}) {
  const deadline = Date.now() + budgetMs;
  const state = (await store.get('state')) || { parts: {} };
  const fresh = (k) => !force && state.parts[k] && Date.now() - state.parts[k] < staleMs;
  const ran = [], skipped = [];
  let timedOut = false;
  let base = await store.get('hs-base');

  for (const k of hubspot.ORDER) {
    if (fresh(k) && (k !== 'base' || base)) { skipped.push(k); continue; }
    if (Date.now() > deadline - 20000) { timedOut = true; break; } // not enough time left for another part
    const data = await hubspot.PARTS[k](base);
    await store.put('hs-' + k, data);
    if (k === 'base') base = data;
    state.parts[k] = Date.now();
    await store.put('state', state);
    ran.push(k);
  }

  if (!timedOut) {
    if (fresh('granola')) skipped.push('granola');
    else {
      const r = await granola.load((await store.get('granola-cache')) || {}, deadline);
      await store.put('granola-cache', r.cache);
      if (r.complete) { state.parts.granola = Date.now(); ran.push('granola'); } else { timedOut = true; ran.push('granola (partial)'); }
      await store.put('state', state);
    }
  }

  const assembled = ran.length ? await assemble() : false;
  return { complete: !timedOut, ran, skipped, assembled };
}

// Merge the stored parts + Granola cache into one snapshot (what the portal and emails read).
async function assemble() {
  const hs = {};
  for (const k of hubspot.ORDER) {
    const d = await store.get('hs-' + k);
    if (!d) return false;
    Object.assign(hs, d);
  }
  const cache = await store.get('granola-cache');
  if (!cache) return false;
  const rows = Object.values(cache).filter((r) => r.rep && r.date);
  await store.put('snapshot', { updatedAt: new Date().toISOString(), data: build(hs, rows) });
  memo = null;
  return true;
}

let memo = null; // warm-function cache so repeat requests don't re-download the snapshot
async function snapshot(fresh = false) {
  if (!fresh && memo && Date.now() - memo.at < 60000) return memo.snap;
  const snap = await store.get('snapshot');
  memo = snap ? { at: Date.now(), snap } : null;
  return snap;
}

async function getData({ from, to, rep } = {}) {
  const snap = await snapshot();
  if (!snap) return { loading: true };
  const t = today();
  return { updatedAt: snap.updatedAt, ...compute(snap.data, from || t.slice(0, 8) + '01', to || t, t, rep || '') };
}

// ---- emails ----
async function ensureFresh(maxAgeMs) {
  const snap = await snapshot(true);
  if (snap && Date.now() - Date.parse(snap.updatedAt) < maxAgeMs) return true;
  const r = await refresh({ staleMs: maxAgeMs });
  return r.complete;
}

// kind: 'daily' | 'weekly'. Safe to call repeatedly: it sends at most once per day per kind.
async function sendReport(kind) {
  if (process.env.REPORTS_ENABLED !== 'true') return { sent: false, reason: 'REPORTS_ENABLED is not true' };
  if (!mailer.configured()) return { sent: false, reason: 'SMTP_USER / SMTP_PASS not set' };
  const to = kind === 'weekly' ? process.env.WEEKLY_TO || process.env.DAILY_TO : process.env.DAILY_TO;
  if (!to) return { sent: false, reason: 'no recipients configured' };
  const d = today();
  const log = (await store.get('sent')) || {};
  if (log[kind] === d) return { sent: false, reason: 'already sent today' };
  if (!(await ensureFresh(num(process.env.EMAIL_MAX_AGE_MS, 3 * 3600e3)))) return { sent: false, reason: 'data refresh incomplete, will retry' };
  const m = report[kind]((await snapshot(true)).data, d);
  await mailer.send(to, m.subject, m.html, m.text);
  log[kind] = d;
  await store.put('sent', log);
  return { sent: true, to };
}

// Local server only (Vercel uses cron): send at 10:00 daily and Sunday 09:00, local clock.
async function sendScheduled(now = new Date()) {
  const hhmm = now.getHours() * 60 + now.getMinutes();
  const out = [];
  if (hhmm >= 10 * 60) out.push(['daily', await sendReport('daily')]);
  if (now.getDay() === 0 && hhmm >= 9 * 60) out.push(['weekly', await sendReport('weekly')]);
  return out;
}

module.exports = { refresh, assemble, getData, snapshot, sendReport, sendScheduled };
