// Spam Check: one record per day per team member. Each channel - e-mails, phone calls, texts - is either not checked yet
// (''), working ('works') or flagged as spam ('spam'), plus free-text notes explaining any findings.
// Stored in the portal store (Vercel Blob / ./data locally) under the key 'spam-checks':
//   { '2026-11-16': { 'Paula Jimenez': { emails: 'works', calls: 'spam', texts: '', notes: 'Calls show "Spam risk" on T-Mobile', by: 'Guillermo Chavarria', at: '…' } } }
// Older records ({ email, phone, spam, ok } ticks) are converted when read, so the history keeps working.
// Changes to a saved record keep an edit history on it (lib/history.js). The page saves while you type, so saves by the
// same person within EDIT_SESSION of their last save count as one edit (and the first such run just creates the record).
const store = require('./store');
const history = require('./history');
const { SPAM_TEAM } = require('./config');

const KEY = 'spam-checks';
const CHANNELS = ['emails', 'calls', 'texts'];
const RESULTS = ['', 'works', 'spam'];
const NOTES_MAX = 1000;
const EDIT_SESSION = 10 * 60 * 1000;
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const isDay = (d) => /^\d{4}-\d\d-\d\d$/.test(String(d || '')) && !isNaN(Date.parse(d + 'T00:00:00Z'));

// old shape: email / phone = "was checked", spam / ok = the result for that person on that day
function normalize(r) {
  if (!r || CHANNELS.some((c) => c in r)) return r;
  const result = r.spam ? 'spam' : r.ok ? 'works' : '';
  return { emails: r.email ? result : '', calls: r.phone ? result : '', texts: '', notes: r.notes || '', by: r.by, at: r.at };
}

// -> { team, checks: { date: { member: record } } } for dates from..to (inclusive)
async function list(from, to) {
  const all = (await store.get(KEY)) || {};
  const checks = {};
  for (const [d, v] of Object.entries(all)) {
    if ((from && d < from) || (to && d > to)) continue;
    checks[d] = Object.fromEntries(Object.entries(v).map(([m, r]) => [m, normalize(r)]));
  }
  return { team: SPAM_TEAM, checks };
}

// editors only. Body: { date, member, emails, calls, texts: '' | 'works' | 'spam', notes } -> the saved record
// (by / at = the last save; history = earlier values)
async function set(user, b) {
  if (!user || user.spam !== 'edit') throw fail(403, 'Only the spam checker can change spam checks.');
  if (!isDay(b.date)) throw fail(400, 'Pick a valid day.');
  if (!SPAM_TEAM.includes(b.member)) throw fail(400, 'Unknown team member.');
  const rec = {};
  for (const c of CHANNELS) {
    const v = String(b[c] ?? '');
    if (!RESULTS.includes(v)) throw fail(400, `${c}: pick Works, Spam or leave it unchecked.`);
    rec[c] = v;
  }
  rec.notes = String(b.notes ?? '').trim();
  if (rec.notes.length > NOTES_MAX) throw fail(400, `The notes are too long (${NOTES_MAX.toLocaleString('en')} characters at most).`);
  const all = (await store.get(KEY)) || {}, day = (all[b.date] = all[b.date] || {});
  const old = normalize(day[b.member]), at = new Date().toISOString();
  if (!old) { day[b.member] = { ...rec, by: user.name, at }; await store.put(KEY, all); return day[b.member]; }
  const saved = { ...old };
  if (!history.record(saved, rec, user, { at, last: { by: old.by, at: old.at }, mergeWithin: EDIT_SESSION })) return old;
  Object.assign(saved, { by: user.name, at });
  day[b.member] = saved;
  await store.put(KEY, all);
  return saved;
}

module.exports = { list, set, normalize, KEY, CHANNELS, NOTES_MAX };
