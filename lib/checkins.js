// Daily Checkin: any number of check-ins per day, each { id, date, people: [sales person names], link (Granola), summary }.
// Editors (CHECKIN_EDITORS: Arth, Guillermo) add, edit and delete; everyone else views.
// Stored in the portal store (Vercel Blob / ./data locally) under the key 'checkins' as one array.
const crypto = require('crypto');
const store = require('./store');
const { REPS } = require('./config');
const granola = require('./granola');

const KEY = 'checkins';
const SUMMARY_MAX = 20000; // Granola summaries of a long call can run past a few thousand characters
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const isDay = (d) => /^\d{4}-\d\d-\d\d$/.test(String(d || '')) && !isNaN(Date.parse(d + 'T00:00:00Z'));
const PEOPLE = () => REPS.map((r) => r.name);
const canEdit = (user) => { if (!user || user.checkin !== 'edit') throw fail(403, 'Only Arth and Guillermo can change check-ins.'); };

// -> { people, entries } for dates from..to (inclusive), newest day first, then in the order they were added
async function list(from, to) {
  const all = (await store.get(KEY)) || [];
  const entries = all.map((e, i) => [e, i]).filter(([e]) => (!from || e.date >= from) && (!to || e.date <= to))
    .sort(([a, i], [b, j]) => b.date.localeCompare(a.date) || a.at.localeCompare(b.at) || i - j).map(([e]) => e);
  return { people: PEOPLE(), entries };
}

function clean(b) {
  if (!isDay(b.date)) throw fail(400, 'Pick a valid day.');
  const roster = PEOPLE();
  const people = [...new Set(Array.isArray(b.people) ? b.people : [])];
  if (!people.length) throw fail(400, 'Pick at least one sales person.');
  const bad = people.find((p) => !roster.includes(p));
  if (bad) throw fail(400, `Unknown sales person: ${bad}`);
  const link = String(b.link || '').trim();
  if (!link) throw fail(400, 'Add the Granola link.');
  if (link.length > 500 || !granola.isGranolaLink(link)) throw fail(400, 'The Granola link must be a Granola note link (https://notes.granola.ai/d/…).');
  const summary = String(b.summary || '').trim();
  if (!summary) throw fail(400, 'Write a summary.');
  if (summary.length > SUMMARY_MAX) throw fail(400, `The summary is too long (${SUMMARY_MAX.toLocaleString('en-US')} characters at most).`);
  return { date: b.date, people: roster.filter((p) => people.includes(p)), link, summary };
}

// editors only. Body: { id?, date, people, link, summary }. With id: edits that check-in; without: adds a new one.
async function save(user, b) {
  canEdit(user);
  const fields = clean(b);
  const all = (await store.get(KEY)) || [];
  const now = new Date().toISOString();
  let entry;
  if (b.id) {
    entry = all.find((e) => e.id === b.id);
    if (!entry) throw fail(404, 'That check-in no longer exists.');
    Object.assign(entry, fields, { editedBy: user.name, editedAt: now });
  } else {
    entry = { id: crypto.randomUUID(), ...fields, by: user.name, at: now };
    all.push(entry);
  }
  await store.put(KEY, all);
  return entry;
}

async function remove(user, id) {
  canEdit(user);
  const all = (await store.get(KEY)) || [];
  const i = all.findIndex((e) => e.id === id);
  if (i < 0) throw fail(404, 'That check-in no longer exists.');
  all.splice(i, 1);
  await store.put(KEY, all);
}

// editors only: the summary of the Granola note at `link`, to prefill the form -> { link, title, summary }
async function fromGranola(user, link) {
  canEdit(user);
  return granola.noteByLink(String(link || '').trim(), (await store.get('granola-cache')) || {});
}

module.exports = { list, save, remove, fromGranola, KEY, SUMMARY_MAX };
