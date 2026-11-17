// Edit history: check-ins, spam checks, feedback and discrepancies keep who changed what, from what, to what. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.DISPUTES_STORE = 'local';
const mem = {};
const fake = (file, exports) => { require.cache[path.join(__dirname, '../lib', file)] = { id: file, loaded: true, exports }; };
fake('store.js', { get: async (k) => (mem[k] ? JSON.parse(mem[k]) : null), put: async (k, v) => { mem[k] = JSON.stringify(v); } });
const history = require('../lib/history');
const checkins = require('../lib/checkins');
const spam = require('../lib/spam');
const feedback = require('../lib/feedback');
const disputes = require('../lib/disputes');

const A = { name: 'Arth Agarwal' }, G = { name: 'Guillermo Chavarria' };
const at = (min) => new Date(Date.UTC(2026, 10, 17, 10, min)).toISOString();

test('record: only changed fields, nothing when unchanged', () => {
  const o = { text: 'a', n: ['x'] };
  assert.equal(history.record(o, { text: 'a', n: ['x'] }, A), false);
  assert.equal(o.history, undefined);
  assert.equal(history.record(o, { text: 'b', n: ['x'] }, A, { at: at(0) }), true);
  assert.deepEqual(o.history, [{ by: 'Arth Agarwal', at: at(0), changes: { text: { from: 'a', to: 'b' } } }]);
  assert.equal(o.text, 'b');
});

test('record with mergeWithin: one entry per editing session; the first session creates, no entry', () => {
  const o = { notes: '', by: 'Arth Agarwal', at: at(0) };
  const save = (u, v, m) => { history.record(o, { notes: v }, u, { at: at(m), last: { by: o.by, at: o.at }, mergeWithin: 10 * 60000 }); Object.assign(o, { by: u.name, at: at(m) }); };
  save(A, 'Ca', 1); save(A, 'Calls spam', 2);
  assert.equal(o.history, undefined); // still the first save
  save(A, 'Calls spam risk', 30); save(A, 'Calls spam risk on TMO', 31);
  save(G, 'Fixed', 32);
  assert.deepEqual(history.entries(o).map((e) => [e.by, e.changes.notes.from, e.changes.notes.to]), [
    ['Arth Agarwal', 'Calls spam', 'Calls spam risk on TMO'], ['Guillermo Chavarria', 'Calls spam risk on TMO', 'Fixed']]);
  save(G, 'Calls spam risk on TMO', 33); // changed back within the session: the entry has nothing left and is not shown
  assert.equal(history.entries(o).length, 1);
});

test('check-in edits keep a history', async () => {
  const ARTH = { ...A, checkin: 'edit' }, GU = { ...G, checkin: 'edit' };
  const link = 'https://notes.granola.ai/d/59e9bd76-1426-454a-88cb-74abc6fc1614';
  const c = await checkins.save(ARTH, { date: '2026-11-16', people: ['Paula Jimenez'], link, summary: 'First' });
  assert.equal(c.history, undefined);
  await checkins.save(GU, { id: c.id, date: '2026-11-16', people: ['Paula Jimenez'], link, summary: 'First' }); // no change
  const e = await checkins.save(GU, { id: c.id, date: '2026-11-16', people: ['Paula Jimenez', 'Diego Alvarez'], link, summary: 'Second' });
  assert.equal(e.history.length, 1);
  assert.deepEqual(e.history[0].changes, { people: { from: ['Paula Jimenez'], to: ['Diego Alvarez', 'Paula Jimenez'] }, summary: { from: 'First', to: 'Second' } });
  assert.equal((await checkins.list()).entries[0].history[0].by, 'Guillermo Chavarria');
});

test('spam check: changing a saved check later is kept in its history', async () => {
  const GU = { ...G, spam: 'edit' }, day = '2026-11-16', who = 'Paula Jimenez';
  await spam.set(GU, { date: day, member: who, emails: 'works', calls: 'spam', texts: '', notes: 'n' });
  const r = await spam.set(GU, { date: day, member: who, emails: 'works', calls: 'works', texts: '', notes: 'n' });
  assert.equal(r.history, undefined); // same person, same sitting: still the first save
  // an hour later
  const all = JSON.parse(mem['spam-checks']); all[day][who].at = new Date(Date.now() - 3600000).toISOString(); mem['spam-checks'] = JSON.stringify(all);
  const r2 = await spam.set(GU, { date: day, member: who, emails: 'spam', calls: 'works', texts: '', notes: 'n' });
  assert.deepEqual(r2.history.map((e) => e.changes), [{ emails: { from: 'works', to: 'spam' } }]);
  assert.deepEqual((await spam.list(day, day)).checks[day][who].history, r2.history);
});

test('feedback and comments: only their writer edits; history kept', async () => {
  const YASH = { name: 'Yash Mundada', feedback: 'give' }, SHREYANS = { name: 'Shreyans Lodha', feedback: 'give' }, PAULA = { name: 'Paula Jimenez', feedback: 'rep' };
  const f = await feedback.give(YASH, { rep: 'Paula Jimenez', text: 'Good call' });
  const { comment } = await feedback.comment(PAULA, { id: f.id, text: 'Thx' });
  await assert.rejects(feedback.edit(SHREYANS, { id: f.id, text: 'x' }), { status: 403 });
  await assert.rejects(feedback.edit(PAULA, { id: f.id, text: 'x' }), { status: 403 });
  await assert.rejects(feedback.edit(YASH, { id: f.id, comment: comment.id, text: 'x' }), { status: 403 });
  await assert.rejects(feedback.edit(YASH, { id: f.id, text: '  ' }), { status: 400 });
  await assert.rejects(feedback.edit({ name: 'Diego Alvarez', feedback: 'rep' }, { id: f.id, comment: comment.id, text: 'x' }), { status: 404 }); // can't see it
  const { item } = await feedback.edit(YASH, { id: f.id, text: ' Great call ' });
  assert.equal(item.text, 'Great call');
  assert.deepEqual(item.history.map((e) => [e.by, e.changes.text]), [['Yash Mundada', { from: 'Good call', to: 'Great call' }]]);
  const { item: i2 } = await feedback.edit(PAULA, { id: f.id, comment: comment.id, text: 'Thanks!' });
  assert.deepEqual(i2.comments[0].history[0].changes.text, { from: 'Thx', to: 'Thanks!' });
  assert.equal((await feedback.list(PAULA)).items[0].comments[0].text, 'Thanks!');
});

test('discrepancy: the raiser edits it while open, a comment’s author edits theirs; history kept', async () => {
  const ARTH = { email: 'arth@riseresearch.com', name: 'Arth Agarwal' }, YASH = { email: 'yash@riseresearch.com', name: 'Yash Mundada' };
  const d = await disputes.raise(ARTH, { client: 'Client H', rep: 'Arth Agarwal', details: 'Zoom call' });
  const { comment } = await disputes.comment(YASH, { id: d.id, message: 'Proof?' });
  await assert.rejects(disputes.edit(YASH, { id: d.id, details: 'x' }), { status: 403 });
  await assert.rejects(disputes.edit(ARTH, { id: d.id, comment: comment.id, message: 'x' }), { status: 403 });
  await assert.rejects(disputes.edit(ARTH, { id: d.id, details: 'x', link: 'ftp://x' }), { status: 400 });
  const e = await disputes.edit(ARTH, { id: d.id, reason: 'Other', details: 'Zoom call with the father', link: 'https://zoom.us/rec/1' });
  assert.deepEqual(Object.keys(e.history[0].changes).sort(), ['details', 'link']);
  await disputes.edit(YASH, { id: d.id, comment: comment.id, message: 'Any proof?' });
  const listed = (await disputes.list()).find((x) => x.id === d.id);
  assert.deepEqual([listed.details, listed.comments[0].message, listed.comments[0].history[0].changes.message.from], ['Zoom call with the father', 'Any proof?', 'Proof?']);
  await disputes.resolve(YASH, { id: d.id, decision: 'rejected' });
  await assert.rejects(disputes.edit(ARTH, { id: d.id, details: 'y' }), { status: 409 });
});

test('discrepancy edits in Airtable: the field is patched, the history is kept in the portal store', async () => {
  const ARTH = { email: 'arth@riseresearch.com', name: 'Arth Agarwal' };
  const recs = { tbluL9dBxK46KAzz2: [], tblJQl6IrdAVZIol3: [] }, patches = [];
  const realFetch = global.fetch;
  global.fetch = async (url, o) => {
    const body = o.body && JSON.parse(o.body), ok = (j) => ({ ok: true, status: 200, json: async () => j });
    const t = Object.keys(recs).find((k) => url.includes(k));
    if (o.method === 'GET') return ok({ records: recs[t] });
    if (o.method === 'POST') { const r = { id: 'rec' + Math.random().toString(36).slice(2), createdTime: new Date().toISOString(), fields: body.records[0].fields }; recs[t].push(r); return ok({ records: [r] }); }
    if (o.method === 'PATCH') { patches.push(body.fields); const r = recs[t].find((x) => url.endsWith(x.id)); Object.assign(r.fields, body.fields); return ok(r); }
  };
  process.env.DISPUTES_STORE = ''; process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = 'tok';
  try {
    const d = await disputes.raise(ARTH, { client: 'Client AT', rep: 'Arth Agarwal', details: 'v1' });
    await disputes.edit(ARTH, { id: d.id, reason: d.reason, details: 'v2', link: '' });
    assert.equal(patches.at(-1).Details, 'v2');
    assert.deepEqual(JSON.parse(mem['dispute-history'])[d.id][0].changes, { details: { from: 'v1', to: 'v2' } });
    const listed = (await disputes.list(true)).find((x) => x.id === d.id);
    assert.deepEqual([listed.details, listed.history[0].by], ['v2', 'Arth Agarwal']);
  } finally { global.fetch = realFetch; process.env.DISPUTES_STORE = 'local'; delete process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN; }
});
