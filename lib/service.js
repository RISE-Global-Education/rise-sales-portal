// Core operations shared by the Vercel functions (api/*) and the local server (server.js).
const store = require('./store');
const hubspot = require('./hubspot');
const granola = require('./granola');
const { build } = require('./build');
const { compute } = require('./views');
const report = require('./report');
const mailer = require('./mailer');
const slack = require('./slack');
const { today, addDays, dayStartMs, dayEndMs } = require('./tz');
const { ROSTER } = require('./config');

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

// Overdue tasks as HubSpot sees them right now, keyed by rep name. Cached for 2 minutes; undefined if HubSpot can't be reached
// (the saved data is then used instead).
let liveMemo = null;
async function liveOverdue(data, fresh = false) {
  if (!fresh && liveMemo && Date.now() - liveMemo.at < 2 * 60 * 1000) return liveMemo.map;
  try {
    const byOwner = await hubspot.overdueNow();
    const nameOf = {};
    for (const t of data.tasks) if (t.owner && t.rep) nameOf[t.owner] = t.rep;
    const map = {};
    for (const [id, n] of Object.entries(byOwner)) if (nameOf[id]) map[nameOf[id]] = n;
    liveMemo = { at: Date.now(), map };
    return map;
  } catch (e) { console.error('live overdue failed:', e.message); return undefined; }
}

// unclaimed leads created on [from..to] (report-zone days), live from HubSpot; undefined if HubSpot can't be reached
async function liveUnclaimed(from, to) {
  try { return await hubspot.unclaimed(dayStartMs(from), dayEndMs(to)); }
  catch (e) { console.error('unclaimed leads failed:', e.message); return undefined; }
}

async function getData({ from, to, rep, country } = {}) {
  const snap = await snapshot();
  if (!snap) return { loading: true };
  const t = today();
  return { updatedAt: snap.updatedAt, ...compute(snap.data, from || t.slice(0, 8) + '01', to || t, t, rep || '', { country, overdue: await liveOverdue(snap.data) }) };
}

// ---- emails ----
async function ensureFresh(maxAgeMs) {
  const snap = await snapshot(true);
  if (snap && Date.now() - Date.parse(snap.updatedAt) < maxAgeMs) return true;
  const r = await refresh({ staleMs: maxAgeMs });
  return r.complete;
}

// who a report goes to: the configured list, plus every roster rep's HubSpot e-mail as hidden (Bcc) recipients
async function recipients(kind) {
  const to = kind === 'weekly' ? process.env.WEEKLY_TO || process.env.DAILY_TO : process.env.DAILY_TO;
  let bcc;
  if (to && process.env[kind === 'weekly' ? 'WEEKLY_TO_REPS' : 'DAILY_TO_REPS'] !== 'false') {
    const base = (await store.get('hs-base')) || { owners: {} };
    const have = new Set(to.split(',').map((x) => x.trim().toLowerCase()));
    bcc = [...new Set(Object.values(base.owners).filter((o) => ROSTER.has(o.name) && o.email).map((o) => o.email.toLowerCase()))].filter((e) => !have.has(e)).join(',') || undefined;
  }
  return { to, bcc };
}

// kind: 'daily' | 'weekly'. Safe to call repeatedly: it sends at most once per day per kind.
async function sendReport(kind) {
  if (process.env.REPORTS_ENABLED !== 'true') return { sent: false, reason: 'REPORTS_ENABLED is not true' };
  if (!mailer.configured()) return { sent: false, reason: 'SMTP_USER / SMTP_PASS not set' };
  const to = kind === 'weekly' ? process.env.WEEKLY_TO || process.env.DAILY_TO : process.env.DAILY_TO;
  if (!to) return { sent: false, reason: 'no recipients configured' };
  const d = today();
  const log = (await store.get('sent')) || {};
  const wantSlack = slack.configured() && (kind === 'daily' || process.env.SLACK_WEEKLY !== 'false') && log[kind + 'Slack'] !== d;
  const wantMail = log[kind] !== d;
  if (!wantMail && !wantSlack) return { sent: false, reason: 'already sent today' };
  if (!(await ensureFresh(num(process.env.EMAIL_MAX_AGE_MS, 3 * 3600e3)))) return { sent: false, reason: 'data refresh incomplete, will retry' };
  const data = (await snapshot(true)).data;
  const [uFrom, uTo] = kind === 'weekly' ? [addDays(d, -7), addDays(d, -1)] : [addDays(d, -1), addDays(d, -1)];
  const m = report[kind](data, d, { overdue: await liveOverdue(data, true), unclaimed: await liveUnclaimed(uFrom, uTo) }); // overdue + unclaimed = right now, straight from HubSpot
  // the daily and weekly reports also go to every sales rep on the roster (their HubSpot e-mail), as hidden recipients
  let bcc;
  if (process.env[kind === 'weekly' ? 'WEEKLY_TO_REPS' : 'DAILY_TO_REPS'] !== 'false') {
    const base = (await store.get('hs-base')) || { owners: {} };
    const have = new Set(to.split(',').map((x) => x.trim().toLowerCase()));
    bcc = [...new Set(Object.values(base.owners).filter((o) => ROSTER.has(o.name) && o.email).map((o) => o.email.toLowerCase()))].filter((e) => !have.has(e)).join(',') || undefined;
  }
  const out = { sent: false };
  if (wantMail) {
    // a mail failure must not stop the Slack post; the next 15-minute run retries the mail
    try {
      await mailer.send(to, m.subject, m.html, m.text, bcc);
      log[kind] = d; await store.put('sent', log);
      Object.assign(out, { sent: true, to, reps: bcc ? bcc.split(',').length : 0 });
    } catch (e) { out.mailError = e.message.split('\n')[0]; console.error('report e-mail failed:', e.message); }
  }
  // Slack has its own once-a-day record, so a Slack hiccup never blocks or repeats the e-mail (and is retried by the next run)
  if (wantSlack) {
    try { await slack.post(m.subject, m.text); log[kind + 'Slack'] = d; await store.put('sent', log); out.slack = true; }
    catch (e) { out.slack = false; out.slackError = e.message; }
  }
  return out;
}

// Local server only (Vercel uses cron): send at 10:00 daily and Sunday 09:00, local clock.
async function sendScheduled(now = new Date()) {
  const hhmm = now.getHours() * 60 + now.getMinutes();
  const out = [];
  if (hhmm >= 10 * 60) out.push(['daily', await sendReport('daily')]);
  if (now.getDay() === 0 && hhmm >= 9 * 60) out.push(['weekly', await sendReport('weekly')]);
  return out;
}

module.exports = { liveUnclaimed, recipients, refresh, assemble, getData, snapshot, sendReport, sendScheduled, liveOverdue };
