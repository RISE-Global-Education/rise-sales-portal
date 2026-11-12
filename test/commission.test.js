// Commission proof + calculator tests (synthetic data, no network). Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../lib/build');
const { compute, tierPay } = require('../lib/views');
const { COMMISSION } = require('../lib/config');

const T = (s) => Date.parse(s);
const OWNERS = {
  1: { name: 'Lucas Moreno', email: 'lucas@riseresearch.com' },
  2: { name: 'Arth Agarwal', email: 'arth@riseresearch.com' },
  3: { name: 'Ramya Warrier', email: 'ramya@riseresearch.com' },
  4: { name: 'Paula Jimenez', email: 'paula@riseresearch.com' },
};
const note = (id, owner, email, startIso, extra = {}) => ({
  id, rep: OWNERS[owner].name, repEmail: OWNERS[owner].email, date: startIso.slice(0, 10), startMs: T(startIso), title: 'Discovery Call', attendees: '',
  emails: [OWNERS[owner].email, email], transcript: true, durationMin: 30, link: 'https://notes.granola.ai/' + id, portal: true, ...extra,
});
const deal = (id, owner, email, closedIso, contacts = []) => ({ id, name: 'Client ' + id, dealEmail: email, owner: String(owner), country: 'India', closedDate: closedIso.slice(0, 10), closedMs: T(closedIso), contacts });
const client = (id, studentEmail, parentEmail, clientDate, counselor = 'Direct') => ({ id, name: 'Student ' + id, studentEmail, parentEmail, clientDate, status: 'Completed', pkg: 'Premium', counselor, source: /^direct$/i.test(counselor) ? 'Direct' : 'Counsellor' });

function hs(over) {
  return {
    owners: OWNERS, postCallEmails: [], leads: [], meetings: [], meetingContacts: {}, deals: [], dealMoves: [], openDeals: [], tasks: [], stages: [],
    contactEmails: {}, clients: [], portalId: 99, ...over,
  };
}
const run = (h, notes, from, to, rep = '', disputes = []) => compute(build(h, notes), from, to, to, rep, { disputes, overdue: {} });

test('marginal US tiers', () => {
  const t = COMMISSION['Lucas Moreno'].tiers;
  assert.deepEqual([0, 30, 31, 45, 60, 61, 90, 91, 100].map((n) => tierPay(n, t)), [0, 0, 50, 750, 1500, 1575, 3750, 3850, 4750]);
});

test('verified needs the rep’s own Granola call with a transcript AND an Airtable client', () => {
  const h = hs({
    deals: [
      deal('A', 2, 'a@x.com', '2026-10-05T10:00:00Z'),            // both proofs -> Verified
      deal('B', 2, 'b@x.com', '2026-10-06T10:00:00Z'),            // no Granola note -> Missing call
      deal('C', 2, 'c@x.com', '2026-10-07T10:00:00Z'),            // call only under another rep -> Missing call (reported)
      deal('D', 2, 'd@x.com', '2026-10-08T10:00:00Z'),            // call without transcript
      deal('E', 2, 'e@x.com', '2026-10-09T10:00:00Z'),            // call, but not in Airtable -> Missing payment
    ],
    clients: [client('r1', 'a@x.com', '', '2026-10-05'), client('r2', '', 'b@x.com', '2026-10-06'), client('r3', 'c@x.com', '', '2026-10-07'), client('r4', 'd@x.com', '', '2026-10-08')],
  });
  const notes = [note('n1', 2, 'a@x.com', '2026-10-01T10:00:00Z'), note('n3', 1, 'c@x.com', '2026-10-01T10:00:00Z'), note('n4', 2, 'd@x.com', '2026-10-01T10:00:00Z', { transcript: false }), note('n5', 2, 'e@x.com', '2026-10-01T10:00:00Z')];
  const v = Object.fromEntries(run(h, notes, '2026-10-01', '2026-10-31').verify.map((r) => [r.Client, r]));
  assert.equal(v['Client A'].Status, 'Verified');
  assert.equal(v['Client A']['Granola Note'], 'https://notes.granola.ai/n1');
  assert.equal(v['Client B'].Status, 'Missing call');
  assert.equal(v['Client B']['Payment Proof'], 'Yes'); // matched on the parent e-mail
  assert.equal(v['Client C'].Status, 'Missing call');
  assert.match(v['Client C'].Details, /only under Lucas Moreno/);
  assert.equal(v['Client D'].Status, 'Missing transcript');
  assert.equal(v['Client E'].Status, 'Missing payment');
  assert.equal(v['Client A'].HubSpot, 'https://app.hubspot.com/contacts/99/record/0-3/A');
});

test('contact e-mails count, staff e-mails never do, and old cached notes are read from the attendee text', () => {
  const h = hs({
    deals: [deal('A', 2, '', '2026-10-05T10:00:00Z', ['c1']), deal('B', 2, 'arth@riseresearch.com', '2026-10-06T10:00:00Z')],
    contactEmails: { c1: ['parent@x.com', 'kid@x.com'] },
    clients: [client('r1', 'kid@x.com', 'parent@x.com', '2026-10-05'), client('r2', 'arth@riseresearch.com', '', '2026-10-06')],
  });
  const old = note('n1', 2, 'x', '2026-10-01T10:00:00Z', { emails: undefined, transcript: undefined, attendees: 'Arth Agarwal (arth@riseresearch.com), Mum (Parent@X.com)' });
  const v = Object.fromEntries(run(h, [old], '2026-10-01', '2026-10-31').verify.map((r) => [r.Client, r]));
  assert.equal(v['Client A'].Status, 'Verified');       // parent@x.com from the attendee text; kid@x.com proves payment
  assert.equal(v['Client B']['Call Proof'], 'No');      // the rep's own address is not proof of a client call
});

test('one Airtable payment proves only one deal (duplicate flagged)', () => {
  const h = hs({
    deals: [deal('A', 2, 'p@x.com', '2026-10-05T10:00:00Z'), deal('B', 2, 'p@x.com', '2026-10-06T10:00:00Z'), deal('C', 2, 's2@x.com', '2026-10-07T10:00:00Z', ['k'])],
    contactEmails: { k: ['p@x.com'] },
    clients: [client('r1', 's1@x.com', 'p@x.com', '2026-10-05'), client('r2', 's2@x.com', 'p@x.com', '2026-10-07')], // two children, one parent
  });
  const notes = ['p@x.com', 's2@x.com'].map((e, i) => note('n' + i, 2, e, '2026-10-01T10:00:00Z'));
  const v = Object.fromEntries(run(h, notes, '2026-10-01', '2026-10-31').verify.map((r) => [r.Client, r]));
  assert.equal(v['Client A'].Status, 'Verified');
  assert.equal(v['Client C'].Status, 'Verified');       // takes the second child's record (student e-mail match first)
  assert.equal(v['Client B'].Status, 'Missing payment (duplicate)');
  assert.match(v['Client B'].Details, /possible duplicate/);
});

test('HubSpot meeting matched to a Granola note is proof even when the client joined from another e-mail', () => {
  const h = hs({
    deals: [deal('A', 1, 'a@x.com', '2026-10-05T10:00:00Z', ['c1'])],
    meetings: [{ id: 'm1', owner: '1', startMs: T('2026-10-01T15:00:00Z'), outcome: 'COMPLETED', title: 'Discovery Call with A' }],
    meetingContacts: { m1: ['c1'] },
    clients: [client('r1', 'a@x.com', '', '2026-10-05')],
  });
  const g = note('n1', 1, 'other@y.com', '2026-10-01T15:05:00Z');
  const [row] = run(h, [g], '2026-10-01', '2026-10-31').verify;
  assert.equal(row.Status, 'Verified');
  assert.match(row.Details, /HubSpot meeting/);
});

test('commission: India counsellor/direct, US tiers, Ramya per client + per meeting, monthly reset, accepted discrepancy', () => {
  const deals = [], clients = [], notes = [];
  const add = (id, owner, day, counselor = 'Direct', withCall = true) => {
    const e = id + '@x.com';
    deals.push(deal(id, owner, e, day + 'T10:00:00Z'));
    clients.push(client('r' + id, e, '', day, counselor));
    if (withCall) notes.push(note('n' + id, owner, e, day + 'T08:00:00Z'));
  };
  // Arth, October: 2 counsellor + 1 direct = 2*2500 + 5000; one direct in November (resets)
  add('a1', 2, '2026-10-02', 'Oncourse Global'); add('a2', 2, '2026-10-03', 'Prep Zone'); add('a3', 2, '2026-10-04', 'Direct'); add('a4', 2, '2026-11-02', 'Direct');
  // Arth, October: one without a call (not paid until a manager accepts the discrepancy)
  add('a5', 2, '2026-10-05', 'Direct', false);
  // Paula, October: 45 verified students -> 15 * $50
  for (let i = 0; i < 45; i++) add('p' + i, 4, '2026-10-' + String(1 + (i % 28)).padStart(2, '0'));
  // Ramya, October: 3 won + 6 meetings taken -> 3*125 + 6*10 = 435 (the 3 winning calls are 3 of the 6 meetings)
  for (let i = 0; i < 3; i++) add('r' + i, 3, '2026-10-1' + i);
  for (let i = 0; i < 3; i++) notes.push(note('rm' + i, 3, 'lead' + i + '@x.com', '2026-10-2' + i + 'T08:00:00Z'));
  const h = hs({ deals, clients });
  const row = (c, rep, mo) => c.commission.find((x) => x['Team Member'] === rep && x.Month === mo);

  const oct = run(h, notes, '2026-10-01', '2026-10-31');
  assert.equal(row(oct, 'Arth Agarwal', '2026-10').Commission, 2 * 2500 + 5000);
  assert.equal(row(oct, 'Arth Agarwal', '2026-10').Counsellor, 2);
  assert.equal(row(oct, 'Arth Agarwal', '2026-10')['Unverified Wins'], 1);
  assert.equal(row(oct, 'Paula Jimenez', '2026-10').Commission, 750);
  assert.equal(row(oct, 'Ramya Warrier', '2026-10')['Meetings Taken'], 6);
  assert.equal(row(oct, 'Ramya Warrier', '2026-10').Commission, 435);
  assert.equal(oct.commission.find((x) => x['Team Member'] === 'Team (INR)').Commission, 10000);

  // November is computed on its own (reset)
  const both = run(h, notes, '2026-10-01', '2026-11-30');
  assert.equal(row(both, 'Arth Agarwal', '2026-11').Commission, 5000);
  assert.equal(row(both, 'Arth Agarwal', '2026-10').Commission, 10000);

  // a manager accepts the discrepancy for a5 -> it counts (direct)
  const acc = run(h, notes, '2026-10-01', '2026-10-31', '', [{ id: 'x', dealId: 'a5', rep: 'Arth Agarwal', status: 'accepted', at: '2026-10-06T00:00:00Z', reason: 'Other', details: 'zoom', raisedBy: 'Arth' }]);
  assert.equal(row(acc, 'Arth Agarwal', '2026-10').Commission, 15000);
  assert.equal(acc.verify.find((r) => r.Discrepancy === 'a5').Status, 'Accepted (discrepancy)');
  // rejected or open does not count
  const rej = run(h, notes, '2026-10-01', '2026-10-31', '', [{ id: 'x', dealId: 'a5', rep: 'Arth Agarwal', status: 'rejected', at: '2026-10-06T00:00:00Z', reason: 'Other', details: 'zoom', raisedBy: 'Arth' }]);
  assert.equal(row(rej, 'Arth Agarwal', '2026-10').Commission, 10000);
});

test('commission month follows the Airtable Client Date, not the HubSpot close date', () => {
  const h = hs({ deals: [deal('A', 2, 'a@x.com', '2026-10-31T10:00:00Z')], clients: [client('r1', 'a@x.com', '', '2026-11-02', 'Direct')] });
  const c = run(h, [note('n1', 2, 'a@x.com', '2026-10-20T10:00:00Z')], '2026-10-01', '2026-11-30');
  assert.equal(c.commission.find((x) => x['Team Member'] === 'Arth Agarwal' && x.Month === '2026-10')['Verified Wins'], 0);
  assert.equal(c.commission.find((x) => x['Team Member'] === 'Arth Agarwal' && x.Month === '2026-11').Commission, 5000);
});

test('no proof but the rep has a call titled with the client’s name: shown as a possible call, NOT counted', () => {
  const h = hs({ deals: [deal('A', 1, 'school@x.edu', '2026-10-15T10:00:00Z')], clients: [client('r1', 'school@x.edu', '', '2026-10-15')] });
  const d = h.deals[0]; d.name = 'Amanda Julia Galletly';
  const g = note('n1', 1, 'mandy@gmail.com', '2026-10-01T10:00:00Z', { title: 'Rise Research Discovery Call with Amanda Julia' });
  const other = note('n2', 4, 'amanda2@gmail.com', '2026-10-02T10:00:00Z', { title: 'Discovery Call with Amanda' }); // another rep's call: never a hint
  const [row] = run(h, [g, other], '2026-10-01', '2026-10-31').verify;
  assert.equal(row.Status, 'Missing call');
  assert.equal(row['Possible Call'], 'https://notes.granola.ai/n1');
  assert.match(row.Details, /Possible call .*mandy@gmail\.com/);
});

test('refresh order: oldest part first so a timed-out run resumes; base first when stale', () => {
  const { refreshOrder } = require('../lib/service');
  const now = 1e12, h = 3600e3;
  // nothing stored yet: every part, base first, in the normal order
  assert.deepEqual(refreshOrder({}, now, 600e3), ['base', 'deals', 'leads', 'tasks', 'meetings', 'emails', 'airtable', 'granola']);
  // last hour's run only reached base, deals, leads: the parts it never reached go next (base still first: it is stale)
  const parts = { base: now - h, deals: now - h, leads: now - h, tasks: now - 3 * h, meetings: now - 3 * h, emails: now - 3 * h, granola: now - 3 * h };
  assert.deepEqual(refreshOrder(parts, now, 600e3), ['base', 'airtable', 'tasks', 'meetings', 'emails', 'granola', 'deals', 'leads']);
  // fresh parts are skipped
  assert.deepEqual(refreshOrder({ ...parts, base: now - 60e3, tasks: now - 60e3 }, now, 600e3), ['airtable', 'meetings', 'emails', 'granola', 'deals', 'leads']);
});

test('verified-wins dialog lists each counted deal with what it pays, adding up to the row', () => {
  const deals = [], clients = [], notes = [];
  const add = (id, owner, day, counselor = 'Direct') => { const e = id + '@x.com'; deals.push(deal(id, owner, e, day + 'T10:00:00Z')); clients.push(client('r' + id, e, '', day, counselor)); notes.push(note('n' + id, owner, e, day + 'T08:00:00Z')); };
  add('a1', 2, '2026-10-02', 'Oncourse Global'); add('a2', 2, '2026-10-03', 'Direct');
  for (let i = 0; i < 32; i++) add('p' + i, 4, '2026-10-' + String(1 + (i % 28)).padStart(2, '0'));
  const c = run(hs({ deals, clients }), notes, '2026-10-01', '2026-10-31');
  const arth = c.verified['2026-10|Arth Agarwal'];
  assert.deepEqual(arth.map((w) => w.Pays), ['₹2,500 (Counsellor)', '₹5,000 (Direct)']);
  const paula = c.verified['2026-10|Paula Jimenez'];
  assert.equal(paula.length, 32);
  assert.equal(paula[29].Pays, 'Student #30 of 32 this month: $0');
  assert.equal(paula[30].Pays, 'Student #31 of 32 this month: $50');
  const sum = paula.reduce((a, w) => a + Number(w.Pays.split('$')[1]), 0);
  assert.equal(sum, c.commission.find((x) => x['Team Member'] === 'Paula Jimenez').Commission); // 2 x $50 = $100
  assert.equal(c.verified['2026-10|Lucas Moreno'], undefined); // no verified wins -> no list
});

test('commission views date every deal by the Airtable Client Date (HubSpot close date only when there is no Airtable record)', () => {
  // closed in HubSpot on 31 Oct, Client Date 2 Nov, no call -> unverified in NOVEMBER, listed in the Closed Won Check for November
  const h = hs({
    deals: [deal('A', 2, 'a@x.com', '2026-10-31T10:00:00Z'), deal('B', 2, 'b@x.com', '2026-10-30T10:00:00Z')],
    clients: [client('r1', 'a@x.com', '', '2026-11-02')], // B has no Airtable record -> dated by its close date (30 Oct)
  });
  const c = run(h, [], '2026-10-01', '2026-11-30');
  const row = (mo) => c.commission.find((x) => x['Team Member'] === 'Arth Agarwal' && x.Month === mo);
  assert.equal(row('2026-11')['Unverified Wins'], 1);
  assert.equal(row('2026-10')['Unverified Wins'], 1);
  assert.deepEqual(c.unverified['2026-11|Arth Agarwal'].map((w) => w.Client), ['Client A']);
  const nov = run(h, [], '2026-11-01', '2026-11-30').verify;
  assert.deepEqual(nov.map((w) => [w.Client, w.Date, w['HubSpot Closed']]), [['Client A', '2026-11-02', '2026-10-31']]);
  const oct = run(h, [], '2026-10-01', '2026-10-31').verify;
  assert.deepEqual(oct.map((w) => w.Client), ['Client B']);
  assert.match(oct[0].Details, /dated by the HubSpot close date/);
});
