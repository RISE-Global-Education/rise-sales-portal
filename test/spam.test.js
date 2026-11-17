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

test('saving a check (e-mails / calls / texts + notes) and reading it back by date range', async () => {
  const rec = await spam.set(GUILLERMO, { date: '2026-11-16', member: 'Paula Jimenez', emails: 'works', calls: 'spam', texts: '', notes: '  Calls show "Spam risk"  ' });
  assert.deepEqual([rec.emails, rec.calls, rec.texts, rec.notes, rec.by], ['works', 'spam', '', 'Calls show "Spam risk"', 'Guillermo Chavarria']);
  await spam.set(GUILLERMO, { date: '2026-11-15', member: 'Diego Alvarez', emails: 'spam', calls: 'works', texts: 'works' });
  const diego = (await spam.list('2026-11-15', '2026-11-15')).checks['2026-11-15']['Diego Alvarez'];
  assert.deepEqual([diego.emails, diego.calls, diego.texts, diego.notes], ['spam', 'works', 'works', '']);
  const r = await spam.list('2026-11-16', '2026-11-16');
  assert.deepEqual(Object.keys(r.checks), ['2026-11-16']);
  assert.ok(r.team.includes('Ramya Warrier') && r.team.includes('Arth Agarwal'));
  // a later save for the same person and day replaces it; other people are untouched
  await spam.set(GUILLERMO, { date: '2026-11-16', member: 'Paula Jimenez', emails: 'works', calls: 'works', texts: 'works' });
  await spam.set(GUILLERMO, { date: '2026-11-16', member: 'Lucas Moreno', texts: 'spam' });
  const d = (await spam.list()).checks['2026-11-16'];
  assert.deepEqual([d['Paula Jimenez'].calls, d['Paula Jimenez'].notes], ['works', '']);
  assert.deepEqual([d['Lucas Moreno'].emails, d['Lucas Moreno'].texts], ['', 'spam']);
});

test('old tick-box records are read in the new shape', async () => {
  mem['spam-checks'] = JSON.stringify({ '2026-10-01': {
    'Arth Agarwal': { email: true, phone: false, spam: true, ok: false, by: 'Guillermo Chavarria', at: 'x' },
    'Muskaan Mir': { email: true, phone: true, spam: false, ok: true, by: 'Guillermo Chavarria', at: 'x' },
    'Pavitra N': { email: false, phone: false, spam: false, ok: false, by: 'Guillermo Chavarria', at: 'x' },
  } });
  const c = (await spam.list('2026-10-01', '2026-10-01')).checks['2026-10-01'];
  assert.deepEqual([c['Arth Agarwal'].emails, c['Arth Agarwal'].calls, c['Arth Agarwal'].texts], ['spam', '', '']);
  assert.deepEqual([c['Muskaan Mir'].emails, c['Muskaan Mir'].calls], ['works', 'works']);
  assert.deepEqual([c['Pavitra N'].emails, c['Pavitra N'].calls, c['Pavitra N'].notes], ['', '', '']);
  delete mem['spam-checks'];
});

test('viewers cannot save; bad input is refused', async () => {
  await assert.rejects(spam.set(YASH, { date: '2026-11-16', member: 'Paula Jimenez', emails: 'works' }), { status: 403 });
  await assert.rejects(spam.set(GUILLERMO, { date: 'yesterday', member: 'Paula Jimenez' }), { status: 400 });
  await assert.rejects(spam.set(GUILLERMO, { date: '2026-11-16', member: 'Someone Else' }), { status: 400 });
  await assert.rejects(spam.set(GUILLERMO, { date: '2026-11-16', member: 'Paula Jimenez', calls: 'maybe' }), { status: 400 });
  await assert.rejects(spam.set(GUILLERMO, { date: '2026-11-16', member: 'Paula Jimenez', notes: 'x'.repeat(1001) }), { status: 400 });
});
