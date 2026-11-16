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
const LINK = 'https://notes.granola.ai/d/abc123';

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
  await checkins.save(GUILLERMO, { date: '2026-11-15', people: ['Lucas Moreno'], summary: 'No link this time' });
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
  await assert.rejects(checkins.save(ARTH, { ...ok, summary: '   ' }), { status: 400 });
  await assert.rejects(checkins.save(ARTH, { ...ok, date: 'today' }), { status: 400 });
  await assert.rejects(checkins.save(ARTH, { ...ok, id: 'missing' }), { status: 404 });
});
