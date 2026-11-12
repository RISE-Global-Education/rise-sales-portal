// Discrepancy rules. Raising happens on the portal; accept / reject happens ONLY in Airtable (Status field). Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.DISPUTES_STORE = 'local'; // the first tests use the in-memory store below, never Airtable
const mem = {};
require.cache[path.join(__dirname, '../lib/store.js')] = { id: 'store', loaded: true, exports: { get: async (k) => (mem[k] ? JSON.parse(mem[k]) : null), put: async (k, v) => { mem[k] = JSON.stringify(v); } } };
const disputes = require('../lib/disputes');
const api = require('../api/disputes');

test('raise validates and blocks a second open discrepancy for the same deal', async () => {
  await assert.rejects(disputes.raise({ dealId: 'D1', details: 'x' }), /who is raising/);
  await assert.rejects(disputes.raise({ raisedBy: 'Arth', details: 'x' }), /deal or client/);
  await assert.rejects(disputes.raise({ raisedBy: 'Arth', dealId: 'D1' }), /explanation/);
  await assert.rejects(disputes.raise({ raisedBy: 'Arth', dealId: 'D1', details: 'x', link: 'javascript:alert(1)' }), /http/);
  const d = await disputes.raise({ raisedBy: 'Arth', dealId: 'D1', rep: 'Arth Agarwal', details: 'Zoom call', reason: 'nonsense' });
  assert.equal(d.status, 'open');
  assert.equal(d.reason, 'Other'); // unknown reasons are normalised
  await assert.rejects(disputes.raise({ raisedBy: 'Arth', dealId: 'D1', details: 'again' }), /already an open/);
});

test('the portal cannot accept or reject: there is no resolve function, and the API ignores a resolve request', async () => {
  assert.equal(disputes.resolve, undefined);
  const before = await disputes.list();
  // a hand-made "resolve" POST is treated as a normal raise, which fails validation and changes nothing
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
  await api({ method: 'POST', headers: {}, body: { action: 'resolve', id: before[0].id, decision: 'accepted' } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(await disputes.list(), before);
  assert.equal((await disputes.list())[0].status, 'open');
});

test('Airtable backend: raise writes an Open record; a Status set in Airtable is read back by the portal', async () => {
  const calls = [];
  const rec = { id: 'recABC', createdTime: '2026-11-12T00:00:00.000Z', fields: {} };
  const realFetch = global.fetch;
  global.fetch = async (url, o) => {
    calls.push({ url, method: o.method, body: o.body && JSON.parse(o.body) });
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (o.method === 'GET') return ok({ records: rec.fields.Client ? [rec, { id: 'recBLANK', createdTime: rec.createdTime, fields: {} }] : [] }); // + a blank Airtable row
    if (o.method === 'POST') { Object.assign(rec.fields, calls.at(-1).body.records[0].fields); return ok({ records: [rec] }); }
    throw new Error('unexpected ' + o.method);
  };
  process.env.DISPUTES_STORE = ''; process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = 'tok';
  try {
    const d = await disputes.raise({ raisedBy: 'Arth', dealId: 'D9', client: 'Client D9', rep: 'Arth Agarwal', details: 'Zoom', dealLink: 'https://app.hubspot.com/x' });
    assert.equal(d.id, 'recABC'); assert.equal(d.status, 'open'); assert.equal(d.dealId, 'D9');
    const post = calls.find((c) => c.method === 'POST');
    assert.equal(post.body.typecast, true);
    assert.equal(post.body.records[0].fields.Status, 'Open');
    assert.equal(post.body.records[0].fields['HubSpot Deal'], 'https://app.hubspot.com/x');
    await assert.rejects(disputes.raise({ raisedBy: 'Arth', dealId: 'D9', details: 'again' }), /already an open/);
    // a manager accepts it in Airtable (Status + note); the portal reads it back once the short cache is cleared
    Object.assign(rec.fields, { Status: 'Accepted', 'Resolved By': 'Puneet', 'Resolution Note': 'recording found' });
    const all = await disputes.list(true); // skip the ~20s cache
    assert.equal(all.length, 1, 'blank Airtable rows are ignored');
    const [x] = all;
    assert.equal(x.status, 'accepted'); assert.equal(x.resolvedBy, 'Puneet'); assert.equal(x.note, 'recording found');
    assert.ok(!calls.some((c) => c.method === 'PATCH'), 'the portal never edits a discrepancy');
  } finally { global.fetch = realFetch; process.env.DISPUTES_STORE = 'local'; delete process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN; }
});

test('refresh builds the snapshot from the data it just loaded, not a stale stored copy', async () => {
  // a store that keeps returning the OLD version after an overwrite (like Blob right after a put)
  const stale = { 'granola-cache': { old: { id: 'old', rep: 'X', date: '2026-01-01' } } };
  const saved = {};
  require.cache[path.join(__dirname, '../lib/store.js')].exports = { get: async (k) => (k in stale ? stale[k] : saved[k] ?? null), put: async (k, v) => { saved[k] = v; } };
  for (const k of ['base', 'deals', 'leads', 'tasks', 'meetings', 'emails', 'airtable']) saved['hs-' + k] = {};
  const g = require('../lib/granola'), b = require('../lib/build');
  const realLoad = g.load, realBuild = b.build;
  let rowsSeen;
  g.load = async () => ({ cache: { fresh: { id: 'fresh', rep: 'Y', date: '2026-11-12' } }, complete: true });
  b.build = (hs, rows) => { rowsSeen = rows.map((r) => r.id); return {}; }; // service.js takes build when it loads, so patch first
  delete require.cache[path.join(__dirname, '../lib/service.js')];
  const service = require('../lib/service');
  const now = Date.now();
  saved.state = { parts: { base: now, deals: now, leads: now, tasks: now, meetings: now, emails: now, airtable: now } }; // only granola is due
  try {
    const r = await service.refresh({ staleMs: 3600e3 });
    assert.deepEqual(r.ran, ['granola']);
    assert.deepEqual(rowsSeen, ['fresh']); // not the stale 'old' copy
  } finally { g.load = realLoad; b.build = realBuild; }
});
