// Feedback: Yash and Shreyans (FEEDBACK_GIVERS) write feedback to one sales person; that person and the givers can comment.
// Privacy: a sales person only ever receives the feedback written to them (filtered here, on the server).
// Stored in the portal store (Vercel Blob / ./data locally) under the key 'feedback' as one array:
//   { id, rep, text, by, at, files: [file], comments: [{ id, by, text, at, files: [file] }] }
// The writer of a feedback / comment can edit its text; every edit is kept in its history (lib/history.js).
// Attachments (images and documents) are uploaded one by one first ('feedback-files/<id>', private, with the bytes),
// then referenced by id when the feedback / comment is sent. file = { id, name, type, size }.
// They are only ever served through download(), which checks the viewer can see the feedback they belong to.
const crypto = require('crypto');
const store = require('./store');
const history = require('./history');
const { REPS } = require('./config');

const KEY = 'feedback';
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const text = (v, max, what) => {
  const t = String(v || '').trim();
  if (!t) throw fail(400, `Write the ${what}.`);
  if (t.length > max) throw fail(400, `The ${what} is too long (${max.toLocaleString('en')} characters at most).`);
  return t;
};
const FILE_MAX = 3 * 1024 * 1024; // Vercel caps a request at 4.5 MB, and base64 adds a third
const FILES_PER_POST = 5;
const FILE_KEY = (id) => 'feedback-files/' + id;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// served inline (shown as pictures); everything else is sent as a download
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const EXT_OK = /\.(png|jpe?g|gif|webp|heic|pdf|docx?|xlsx?|pptx?|csv|txt|zip|mp4|mov|m4a|mp3)$/i;
const sees = (user, f) => user && (user.feedback === 'give' || (user.feedback === 'rep' && f.rep === user.name));

// editors of feedback / comments: one file -> { id, name, type, size }. Body: { name, type, data (base64) }
async function upload(user, b) {
  if (!user || !user.feedback) throw fail(403, 'You can’t add files to feedback.');
  const name = String(b.name || '').trim().replace(/[\\/\r\n"]/g, '_').slice(0, 150);
  if (!name) throw fail(400, 'The file needs a name.');
  if (!EXT_OK.test(name)) throw fail(400, `“${name}” can’t be attached. Use an image, PDF, Word, Excel, PowerPoint, CSV, text, ZIP, audio or video file.`);
  const data = Buffer.from(String(b.data || ''), 'base64');
  if (!data.length) throw fail(400, `“${name}” is empty.`);
  if (data.length > FILE_MAX) throw fail(400, `“${name}” is too big (3 MB at most).`);
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(b.type || '') ? b.type : 'application/octet-stream';
  const file = { id: crypto.randomUUID(), name, type, size: data.length };
  await store.put(FILE_KEY(file.id), { ...file, by: user.name, at: new Date().toISOString(), data: data.toString('base64') });
  return file;
}

// ids from upload() -> their { id, name, type, size }; only files this user uploaded
async function attach(user, ids) {
  ids = [...new Set(Array.isArray(ids) ? ids : [])];
  if (ids.length > FILES_PER_POST) throw fail(400, `Attach at most ${FILES_PER_POST} files at a time.`);
  return Promise.all(ids.map(async (id) => {
    const f = UUID.test(String(id)) && (await store.get(FILE_KEY(id)));
    if (!f || f.by !== user.name) throw fail(400, 'One of the attachments is missing. Remove it and attach it again.');
    return { id: f.id, name: f.name, type: f.type, size: f.size };
  }));
}
// text is optional when files are attached
const body = (b, files, max, what) => (files.length && !String(b.text || '').trim() ? '' : text(b.text, max, what));

// a file, only for someone who can see the feedback it is attached to -> { name, type, inline, data: Buffer }
async function download(user, id) {
  const all = (await store.get(KEY)) || [];
  const owner = UUID.test(String(id)) && all.find((f) => sees(user, f) && [f, ...f.comments].some((x) => (x.files || []).some((a) => a.id === id)));
  const f = owner && (await store.get(FILE_KEY(id)));
  if (!f) throw fail(404, 'That file no longer exists.');
  return { name: f.name, type: f.type, inline: IMAGE_TYPES.includes(f.type), data: Buffer.from(f.data, 'base64') };
}

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
  const files = await attach(user, b.files);
  const item = { id: crypto.randomUUID(), rep: b.rep, text: body(b, files, 5000, 'feedback'), by: user.name, at: new Date().toISOString(), files, comments: [] };
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
  const files = await attach(user, b.files);
  const c = { id: crypto.randomUUID(), by: user.name, text: body(b, files, 4000, 'comment'), at: new Date().toISOString(), files };
  item.comments.push(c);
  await store.put(KEY, all);
  return { item, comment: c };
}

// the person who wrote it: new text for a feedback (b.id) or one of its comments (b.id + b.comment) -> { item }
async function edit(user, b) {
  const all = (await store.get(KEY)) || [];
  const item = all.find((f) => f.id === b.id);
  if (!item || !sees(user, item)) throw fail(404, 'That feedback no longer exists.');
  const target = b.comment ? item.comments.find((c) => c.id === b.comment) : item;
  if (!target) throw fail(404, 'That comment no longer exists.');
  if (target.by !== user.name || (!b.comment && user.feedback !== 'give')) throw fail(403, `Only the person who wrote this ${b.comment ? 'comment' : 'feedback'} can edit it.`);
  const t = body(b, target.files || [], b.comment ? 4000 : 5000, b.comment ? 'comment' : 'feedback');
  if (history.record(target, { text: t }, user)) await store.put(KEY, all);
  return { item };
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

module.exports = { list, give, comment, edit, remove, upload, download, KEY, FILE_MAX };
