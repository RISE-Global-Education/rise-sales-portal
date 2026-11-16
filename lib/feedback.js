// Feedback: Yash and Shreyans (FEEDBACK_GIVERS) write feedback to one sales person; that person and the givers can comment.
// Privacy: a sales person only ever receives the feedback written to them (filtered here, on the server).
// Stored in the portal store (Vercel Blob / ./data locally) under the key 'feedback' as one array:
//   { id, rep, text, by, at, comments: [{ id, by, text, at }] }
const crypto = require('crypto');
const store = require('./store');
const { REPS } = require('./config');

const KEY = 'feedback';
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const text = (v, max, what) => {
  const t = String(v || '').trim();
  if (!t) throw fail(400, `Write the ${what}.`);
  if (t.length > max) throw fail(400, `The ${what} is too long (${max.toLocaleString('en')} characters at most).`);
  return t;
};
const sees = (user, f) => user && (user.feedback === 'give' || (user.feedback === 'rep' && f.rep === user.name));

// -> { people, items } visible to this user, newest first
async function list(user) {
  const all = (await store.get(KEY)) || [];
  // newest first; the array is in the order they were written, so it settles ties within the same millisecond
  const items = all.map((f, i) => [f, i]).filter(([f]) => sees(user, f)).sort((a, b) => b[0].at.localeCompare(a[0].at) || b[1] - a[1]).map(([f]) => f);
  return { people: user && user.feedback === 'give' ? REPS.map((r) => r.name) : [], items };
}

async function give(user, b) {
  if (!user || user.feedback !== 'give') throw fail(403, 'Only Yash and Shreyans can give feedback.');
  if (!REPS.some((r) => r.name === b.rep)) throw fail(400, 'Pick the sales person this feedback is for.');
  const item = { id: crypto.randomUUID(), rep: b.rep, text: text(b.text, 5000, 'feedback'), by: user.name, at: new Date().toISOString(), comments: [] };
  const all = (await store.get(KEY)) || [];
  all.push(item);
  await store.put(KEY, all);
  return item;
}

// the sales person it is for, or a giver
async function comment(user, b) {
  const all = (await store.get(KEY)) || [];
  const item = all.find((f) => f.id === b.id);
  if (!item || !sees(user, item)) throw fail(404, 'That feedback no longer exists.');
  const c = { id: crypto.randomUUID(), by: user.name, text: text(b.text, 4000, 'comment'), at: new Date().toISOString() };
  item.comments.push(c);
  await store.put(KEY, all);
  return { item, comment: c };
}

// only the giver who wrote it
async function remove(user, id) {
  const all = (await store.get(KEY)) || [];
  const i = all.findIndex((f) => f.id === id);
  if (i < 0 || !sees(user, all[i])) throw fail(404, 'That feedback no longer exists.');
  if (user.feedback !== 'give' || all[i].by !== user.name) throw fail(403, 'Only the person who wrote this feedback can delete it.');
  all.splice(i, 1);
  await store.put(KEY, all);
}

module.exports = { list, give, comment, remove, KEY };
