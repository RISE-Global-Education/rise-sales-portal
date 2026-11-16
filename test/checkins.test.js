// Daily Checkin: Arth and Guillermo add / edit / delete; everyone else reads. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const mem = {};
require.cache[path.join(__dirname, '../lib/store.js')] = { id: 'store', loaded: true, exports: { get: async (k) => (mem[k] ? JSON.parse(mem[k]) : null), put: async (k, v) => { mem[k] = JSON.stringify(v); } } };
const checkins = require('../lib/checkins');
const { checkinAccess } = require('../lib/config');

const ARTH = { name: 'Arth Agarwal', checkin: 'edit' };
const GUILLERMO = { name: 'Guillermo Chavarria', checkin: 'edit' };
const PAULA = { name: 'Paula Jimenez', checkin: 'view' };
const LINK = 'https://notes.granola.ai/d/59e9bd76-1426-454a-88cb-74abc6fc1614';

test('Arth and Guillermo edit; everyone else views', () => {
  assert.equal(checkinAccess('arth@riseresearch.com'), 'edit');
  assert.equal(checkinAccess('guillermo@riseresearch.com'), 'edit');
  for (const e of ['yash@riseresearch.com', 'paula@riseresearch.com']) assert.equal(checkinAccess(e), 'view');
});

test('add, list by date, edit and delete a check-in', async () => {
  const a = await checkins.save(ARTH, { date: '2026-11-16', people: ['Paula Jimenez', 'Diego Alvarez', 'Paula Jimenez'], link: LINK, summary: '  Pipeline review  ' });
  assert.deepEqual(a.people, ['Diego Alvarez', 'Paula Jimenez']); // roster order, no duplicates
  assert.equal(a.summary, 'Pipeline review');
  assert.equal(a.by, 'Arth Agarwal');
  await checkins.save(GUILLERMO, { date: '2026-11-15', people: ['Lucas Moreno'], link: LINK, summary: 'Second day' });
  assert.deepEqual((await checkins.list('2026-11-16', '2026-11-16')).entries.map((e) => e.id), [a.id]);
  assert.deepEqual((await checkins.list()).entries.map((e) => e.date), ['2026-11-16', '2026-11-15']); // newest day first

  const e = await checkins.save(GUILLERMO, { id: a.id, date: '2026-11-16', people: ['Reem AbouElenain'], link: LINK, summary: 'Edited' });
  assert.deepEqual([e.id, e.people, e.summary, e.by, e.editedBy], [a.id, ['Reem AbouElenain'], 'Edited', 'Arth Agarwal', 'Guillermo Chavarria']);
  assert.equal((await checkins.list()).entries.length, 2);

  await checkins.remove(ARTH, a.id);
  assert.deepEqual((await checkins.list()).entries.map((x) => x.date), ['2026-11-15']);
  await assert.rejects(checkins.remove(ARTH, a.id), { status: 404 });
});

test('viewers cannot change check-ins; bad input is refused', async () => {
  const ok = { date: '2026-11-16', people: ['Paula Jimenez'], link: LINK, summary: 'x' };
  await assert.rejects(checkins.save(PAULA, ok), { status: 403 });
  await assert.rejects(checkins.remove(PAULA, 'any'), { status: 403 });
  await assert.rejects(checkins.save(ARTH, { ...ok, people: [] }), { status: 400 });
  await assert.rejects(checkins.save(ARTH, { ...ok, people: ['Someone Else'] }), { status: 400 });
  await assert.rejects(checkins.save(ARTH, { ...ok, link: 'not a link' }), { status: 400 });
  await assert.rejects(checkins.save(ARTH, { ...ok, link: '' }), { status: 400 }); // the Granola link is required
  await assert.rejects(checkins.save(ARTH, { ...ok, link: 'https://docs.google.com/d/59e9bd76-1426-454a-88cb-74abc6fc1614' }), { status: 400 });
  await assert.rejects(checkins.save(ARTH, { ...ok, summary: '   ' }), { status: 400 });
  await assert.rejects(checkins.save(ARTH, { ...ok, date: 'today' }), { status: 400 });
  await assert.rejects(checkins.save(ARTH, { ...ok, id: 'missing' }), { status: 404 });
});

test('a Granola link fills in that note’s full summary', async () => {
  process.env.GRANOLA_API_KEY = 'test';
  const NEW = 'https://notes.granola.ai/d/4a1da9c8-fa2c-4a5d-a150-ca8469ff4e6f';
  const notes = {
    not_cached: { id: 'not_cached', web_url: LINK, title: 'Daily checkin', summary_text: 'Full summary of the cached note' },
    not_new: { id: 'not_new', web_url: NEW, title: 'Monday checkin', summary_text: 'Brand new note' },
  };
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(url);
    const u = new URL(url), id = u.pathname.split('/notes/')[1];
    const body = id ? notes[decodeURIComponent(id)] : { notes: [{ id: 'not_new' }, { id: 'not_cached' }], hasMore: false };
    return { ok: !!body, status: body ? 200 : 404, json: async () => body, text: async () => '' };
  };
  try {
    mem['granola-cache'] = JSON.stringify({ not_cached: { id: 'not_cached', link: LINK, summary: 'Full summ' } });
    // cached: matched by link, then the full note is fetched (the cache keeps only 300 characters)
    assert.deepEqual(await checkins.fromGranola(ARTH, LINK + '?source=share'), { link: LINK, title: 'Daily checkin', summary: 'Full summary of the cached note' });
    assert.deepEqual(calls.map((c) => new URL(c).pathname), ['/v1/notes/not_cached']);
    // newer than the last refresh: found among the notes the cache has not seen
    assert.equal((await checkins.fromGranola(GUILLERMO, NEW)).summary, 'Brand new note');
    await assert.rejects(checkins.fromGranola(ARTH, 'https://notes.granola.ai/d/00000000-0000-0000-0000-000000000000'), { status: 404 });
    await assert.rejects(checkins.fromGranola(ARTH, 'https://example.com'), { status: 400 });
    await assert.rejects(checkins.fromGranola(PAULA, LINK), { status: 403 });
  } finally { global.fetch = realFetch; delete process.env.GRANOLA_API_KEY; }
});
