// Spam Check: only Guillermo saves; everyone else reads. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const mem = {};
require.cache[path.join(__dirname, '../lib/store.js')] = { id: 'store', loaded: true, exports: { get: async (k) => (mem[k] ? JSON.parse(mem[k]) : null), put: async (k, v) => { mem[k] = JSON.stringify(v); } } };
const spam = require('../lib/spam');
const { spamAccess } = require('../lib/config');

const GUILLERMO = { email: 'guillermo@riseresearch.com', name: 'Guillermo Chavarria', spam: 'edit' };
const YASH = { email: 'yash@riseresearch.com', name: 'Yash Mundada', spam: 'view' };

test('Guillermo edits; everyone else views', () => {
  assert.equal(spamAccess('guillermo@riseresearch.com'), 'edit');
  for (const e of ['yash@riseresearch.com', 'paula@riseresearch.com', 'arth@riseresearch.com']) assert.equal(spamAccess(e), 'view');
});

test('saving a check and reading it back by date range', async () => {
  const rec = await spam.set(GUILLERMO, { date: '2026-11-16', member: 'Paula Jimenez', email: true, phone: false });
  assert.deepEqual([rec.email, rec.phone, rec.by], [true, false, 'Guillermo Chavarria']);
  await spam.set(GUILLERMO, { date: '2026-11-15', member: 'Diego Alvarez', email: true, phone: true });
  const r = await spam.list('2026-11-16', '2026-11-16');
  assert.deepEqual(Object.keys(r.checks), ['2026-11-16']);
  assert.equal(r.checks['2026-11-16']['Paula Jimenez'].email, true);
  assert.ok(r.team.includes('Ramya Warrier') && r.team.includes('Arth Agarwal'));
  // a later save for the same person and day replaces it; other people are untouched
  await spam.set(GUILLERMO, { date: '2026-11-16', member: 'Paula Jimenez', email: true, phone: true });
  await spam.set(GUILLERMO, { date: '2026-11-16', member: 'Lucas Moreno', email: false, phone: true });
  const d = (await spam.list()).checks['2026-11-16'];
  assert.equal(d['Paula Jimenez'].phone, true);
  assert.equal(d['Lucas Moreno'].phone, true);
});

test('viewers cannot save; bad input is refused', async () => {
  await assert.rejects(spam.set(YASH, { date: '2026-11-16', member: 'Paula Jimenez', email: true }), { status: 403 });
  await assert.rejects(spam.set(GUILLERMO, { date: 'yesterday', member: 'Paula Jimenez' }), { status: 400 });
  await assert.rejects(spam.set(GUILLERMO, { date: '2026-11-16', member: 'Someone Else' }), { status: 400 });
});
