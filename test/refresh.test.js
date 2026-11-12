// The hourly refresh. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

test('refresh builds the snapshot from the data it just loaded, not a stale stored copy', async () => {
  // a store that keeps returning the OLD version after an overwrite (like Blob right after a put)
  const stale = { 'granola-cache': { old: { id: 'old', rep: 'X', date: '2026-01-01' } } };
  const saved = {};
  require.cache[path.join(__dirname, '../lib/store.js')] = { id: 'store', loaded: true, exports: { get: async (k) => (k in stale ? stale[k] : saved[k] ?? null), put: async (k, v) => { saved[k] = v; } } };
  for (const k of ['base', 'deals', 'leads', 'tasks', 'meetings', 'emails', 'airtable']) saved['hs-' + k] = {};
  const g = require('../lib/granola'), b = require('../lib/build');
  let rowsSeen;
  g.load = async () => ({ cache: { fresh: { id: 'fresh', rep: 'Y', date: '2026-11-12' } }, complete: true });
  b.build = (hs, rows) => { rowsSeen = rows.map((r) => r.id); return {}; }; // service.js takes build when it loads, so patch first
  const service = require('../lib/service');
  const now = Date.now();
  saved.state = { parts: { base: now, deals: now, leads: now, tasks: now, meetings: now, emails: now, airtable: now } }; // only granola is due
  const r = await service.refresh({ staleMs: 3600e3 });
  assert.deepEqual(r.ran, ['granola']);
  assert.deepEqual(rowsSeen, ['fresh']); // not the stale 'old' copy
});
