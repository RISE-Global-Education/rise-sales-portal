// Spam Check: one record per day per team member - was their e-mail checked for spam, was their phone checked for spam.
// Stored in the portal store (Vercel Blob / ./data locally) under the key 'spam-checks':
//   { '2026-11-16': { 'Paula Jimenez': { email: true, phone: false, by: 'Guillermo Chavarria', at: '2026-11-16T15:04:05.000Z' } } }
const store = require('./store');
const { SPAM_TEAM } = require('./config');

const KEY = 'spam-checks';
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const isDay = (d) => /^\d{4}-\d\d-\d\d$/.test(String(d || '')) && !isNaN(Date.parse(d + 'T00:00:00Z'));

// -> { team, checks: { date: { member: record } } } for dates from..to (inclusive)
async function list(from, to) {
  const all = (await store.get(KEY)) || {};
  const checks = {};
  for (const [d, v] of Object.entries(all)) if ((!from || d >= from) && (!to || d <= to)) checks[d] = v;
  return { team: SPAM_TEAM, checks };
}

// editors only. Body: { date, member, email: bool, phone: bool } -> the saved record
async function set(user, b) {
  if (!user || user.spam !== 'edit') throw fail(403, 'Only the spam checker can change spam checks.');
  if (!isDay(b.date)) throw fail(400, 'Pick a valid day.');
  if (!SPAM_TEAM.includes(b.member)) throw fail(400, 'Unknown team member.');
  const all = (await store.get(KEY)) || {};
  const rec = { email: !!b.email, phone: !!b.phone, by: user.name, at: new Date().toISOString() };
  (all[b.date] = all[b.date] || {})[b.member] = rec;
  await store.put(KEY, all);
  return rec;
}

module.exports = { list, set, KEY };
