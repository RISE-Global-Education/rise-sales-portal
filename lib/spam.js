// Spam Check: one record per day per team member. Each channel - e-mails, phone calls, texts - is either not checked yet
// (''), working ('works') or flagged as spam ('spam'), plus free-text notes explaining any findings.
// Stored in the portal store (Vercel Blob / ./data locally) under the key 'spam-checks':
//   { '2026-11-16': { 'Paula Jimenez': { emails: 'works', calls: 'spam', texts: '', notes: 'Calls show "Spam risk" on T-Mobile', by: 'Guillermo Chavarria', at: '…' } } }
// Older records ({ email, phone, spam, ok } ticks) are converted when read, so the history keeps working.
const store = require('./store');
const { SPAM_TEAM } = require('./config');

const KEY = 'spam-checks';
const CHANNELS = ['emails', 'calls', 'texts'];
const RESULTS = ['', 'works', 'spam'];
const NOTES_MAX = 1000;
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
  Object.assign(rec, { by: user.name, at: new Date().toISOString() });
  const all = (await store.get(KEY)) || {};
  (all[b.date] = all[b.date] || {})[b.member] = rec;
  await store.put(KEY, all);
  return rec;
}

module.exports = { list, set, normalize, KEY, CHANNELS, NOTES_MAX };
