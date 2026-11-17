// Discrepancies: raise / comment / resolve with the signed-in user, attachments, e-mails, Airtable writes. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.DISPUTES_STORE = 'local'; // in-memory store below unless a test switches to the (mocked) Airtable backend
const mem = {}, sent = [];
const fake = (file, exports) => { require.cache[path.join(__dirname, '../lib', file)] = { id: file, loaded: true, exports }; };
fake('store.js', { get: async (k) => (mem[k] ? JSON.parse(mem[k]) : null), put: async (k, v) => { mem[k] = JSON.stringify(v); } });
fake('mailer.js', { configured: () => true, send: async (to, subject, html, text, bcc, headers) => { sent.push({ to, subject, html, text, headers }); } });
const disputes = require('../lib/disputes');
const notify = require('../lib/notify');
const authApi = require('../api/auth');
const api = require('../api/disputes');
process.env.YASH_PASSWORD = 'yash-env-pass';

const YASH = { email: 'yash@riseresearch.com', name: 'Yash Mundada' };
const ARTH = { email: 'arth@riseresearch.com', name: 'Arth Agarwal' };
const SHREYANS = { email: 'shreyans@riseresearch.com', name: 'Shreyans Lodha' };
const DIEGO = { email: 'diego@riseresearch.com', name: 'Diego Alvarez' };
const PNG = { name: 'shot.png', type: 'image/png', data: Buffer.from('fake png bytes').toString('base64') };

// sign in for real through the login API (Yash: YASH_PASSWORD; others: their e-mail) and keep the cookie
const cookies = {};
async function authCall(cookie, body) {
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = JSON.parse(b); } };
  await authApi({ method: 'POST', headers: { cookie }, body }, res);
  return res.headers['set-cookie'] ? res.headers['set-cookie'].split(';')[0] : cookie;
}
async function cookieFor(user) {
  if (cookies[user.email]) return cookies[user.email];
  const c = await authCall('', { action: 'login', email: user.email, password: user.email === YASH.email ? 'yash-env-pass' : user.email });
  return (cookies[user.email] = c);
}
// call the discrepancies API as a signed-in user
async function as(user, body, method = 'POST') {
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = JSON.parse(b); } };
  await api({ method, headers: { cookie: await cookieFor(user), host: 'portal.test' }, body }, res);
  return res;
}

test('signed-out requests are refused', async () => {
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = JSON.parse(b); } };
  await api({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('raise: the raiser is the signed-in user; validation; one open discrepancy per deal; Yash is e-mailed', async () => {
  assert.equal((await as(ARTH, { action: 'raise', dealId: 'D1' })).statusCode, 400); // no explanation
  assert.equal((await as(ARTH, { action: 'raise', dealId: 'D1', details: 'x', link: 'javascript:alert(1)' })).statusCode, 400);
  assert.equal((await as(ARTH, { action: 'raise', dealId: 'D1', details: 'x', files: [{ name: 'a.exe', type: 'application/x-msdownload', data: 'AAAA' }] })).statusCode, 400);
  assert.equal((await as(ARTH, { action: 'raise', dealId: 'D1', details: 'x', files: [PNG, PNG, PNG, PNG] })).statusCode, 400);
  const big = { name: 'big.png', type: 'image/png', data: Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64') };
  assert.equal((await as(ARTH, { action: 'raise', dealId: 'D1', details: 'x', files: [big] })).statusCode, 400);
  sent.length = 0;
  const r = await as(ARTH, { action: 'raise', dealId: 'D1', client: 'Lisa Murayama', rep: 'Arth Agarwal', reason: 'Call happened but was not detected', details: 'She joined as a calendar invitee', raisedBy: 'Someone Else', files: [PNG], dealLink: 'https://app.hubspot.com/contacts/1/record/0-3/D1' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.dispute.raisedBy, 'Arth Agarwal');           // from the session, not the request body
  assert.equal(r.body.dispute.raisedByEmail, 'arth@riseresearch.com');
  assert.deepEqual(r.body.dispute.attachments.map((a) => a.name), ['shot.png']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'yash@riseresearch.com');
  assert.match(sent[0].subject, /^Commission discrepancies raised on \d{1,2} \w{3} \d{4}$/);
  assert.match(sent[0].html, /raised on the Sales Portal for <b>Lisa Murayama \(Arth Agarwal\)<\/b>/);
  assert.match(sent[0].html, /1 file attached/);
  assert.match(sent[0].html, /http:\/\/portal\.test\/#disputes|https:\/\/portal\.test\/#disputes/);
  assert.equal((await as(ARTH, { action: 'raise', dealId: 'D1', details: 'again' })).statusCode, 409);
});

test('conversation: Yash / Shreyans, the rep and the raiser can comment (with files); others cannot; each comment e-mails Yash only', async () => {
  const [d] = await disputes.list();
  sent.length = 0;
  const y = await as(YASH, { action: 'comment', id: d.id, message: 'Can you share the Zoom recording?' });
  assert.equal(y.statusCode, 200);
  assert.equal(sent.length, 0); // only Yash is e-mailed, and never about his own comment
  const a = await as(ARTH, { action: 'comment', id: d.id, message: 'Here it is', files: [PNG] });
  assert.equal(a.statusCode, 200);
  assert.deepEqual(sent.at(-1).to.split(','), ['yash@riseresearch.com']);
  assert.match(sent.at(-1).subject, /^Commission discrepancies raised on /); // same day thread as the "raised" mail
  assert.match(sent.at(-1).headers.inReplyTo, /^<discrepancies-\d{4}-\d{2}-\d{2}@/);
  assert.equal((await as(ARTH, { action: 'comment', id: d.id, message: '' })).statusCode, 400);
  assert.equal((await as(DIEGO, { action: 'comment', id: d.id, message: 'hi' })).statusCode, 403); // another rep
  const [after] = await disputes.list();
  assert.deepEqual(after.comments.map((c) => [c.author, c.message, c.attachments.length]), [['Yash Mundada', 'Can you share the Zoom recording?', 0], ['Arth Agarwal', 'Here it is', 1]]);
});

test('resolve: Yash / Shreyans only; status can be changed again or reopened; only Yash is e-mailed', async () => {
  const [d] = await disputes.list();
  assert.equal((await as(ARTH, { action: 'resolve', id: d.id, decision: 'accepted' })).statusCode, 403);
  assert.equal((await as(YASH, { action: 'resolve', id: d.id, decision: 'maybe' })).statusCode, 400);
  sent.length = 0;
  const r = await as(YASH, { action: 'resolve', id: d.id, decision: 'accepted', note: 'Recording confirms the call' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.dispute.status, 'accepted');
  assert.equal(r.body.dispute.resolvedBy, 'Yash Mundada');
  assert.equal(sent.length, 0); // Yash made the decision himself: nobody else is e-mailed
  assert.equal((await as(YASH, { action: 'resolve', id: d.id, decision: 'accepted' })).statusCode, 409); // no change
  // Shreyans can change the decision later, and reopen it; each change e-mails Yash in the same thread
  sent.length = 0;
  const ch = await as(SHREYANS, { action: 'resolve', id: d.id, decision: 'rejected', note: 'Payment bounced' });
  assert.equal(ch.statusCode, 200);
  assert.deepEqual([ch.body.dispute.status, ch.body.dispute.resolvedBy, ch.body.dispute.note], ['rejected', 'Shreyans Lodha', 'Payment bounced']);
  assert.equal(sent[0].to, 'yash@riseresearch.com'); assert.match(sent[0].subject, /^Commission discrepancies raised on /);
  assert.match(sent[0].html, /was <b>rejected<\/b> \(changed from accepted\)/);
  const ro = await as(SHREYANS, { action: 'resolve', id: d.id, decision: 'open' });
  assert.equal(ro.statusCode, 200);
  assert.deepEqual([ro.body.dispute.status, ro.body.dispute.resolvedBy, ro.body.dispute.note], ['open', '', '']);
  assert.match(sent[1].html, /was <b>reopened<\/b>/); assert.equal(sent[1].to, 'yash@riseresearch.com');
  assert.equal((await as(DIEGO, { action: 'resolve', id: d.id, decision: 'accepted' })).statusCode, 403);
  assert.equal((await as(YASH, { action: 'resolve', id: d.id, decision: 'accepted' })).statusCode, 200);
  // a resolved deal can be raised again
  assert.equal((await as(ARTH, { action: 'raise', dealId: 'D1', client: 'Lisa Murayama', details: 'new issue' })).statusCode, 200);
});

test('a discrepancy raised by someone else for a rep: rep, raiser and Yash are all in the conversation, only Yash is e-mailed', async () => {
  const r = await as(SHREYANS, { action: 'raise', dealId: 'D7', client: 'Raja Kukkadapu', rep: 'Arth Agarwal', reason: 'Deal belongs to another rep', details: 'I took this call' });
  sent.length = 0;
  assert.equal((await as(ARTH, { action: 'comment', id: r.body.dispute.id, message: 'Agreed' })).statusCode, 200);
  assert.deepEqual(sent.at(-1).to.split(','), ['yash@riseresearch.com']);
  assert.equal((await as(SHREYANS, { action: 'comment', id: r.body.dispute.id, message: 'thanks' })).statusCode, 200);
});

test('a failed e-mail never loses the action', async () => {
  require.cache[path.join(__dirname, '../lib/mailer.js')].exports.send = async () => { throw new Error('SMTP down'); };
  const r = await as(ARTH, { action: 'raise', client: 'Client X', rep: 'Arth Agarwal', details: 'x' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.notified, false);
  assert.ok((await disputes.list()).some((d) => d.client === 'Client X'));
});

test('Airtable backend: records, comment link, attachment uploads, Status set in Airtable read back', async () => {
  const calls = [];
  const recs = { tbluL9dBxK46KAzz2: [], tblJQl6IrdAVZIol3: [] };
  const realFetch = global.fetch;
  global.fetch = async (url, o) => {
    const body = o.body && JSON.parse(o.body);
    calls.push({ url, method: o.method, body });
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    const t = Object.keys(recs).find((k) => url.includes(k));
    if (url.includes('uploadAttachment')) return ok({});
    if (o.method === 'GET') return ok({ records: recs[t] });
    if (o.method === 'POST') { const r = { id: 'rec' + (calls.length), createdTime: new Date().toISOString(), fields: body.records[0].fields }; recs[t].push(r); return ok({ records: [r] }); }
    if (o.method === 'PATCH') { const r = recs[t].find((x) => url.endsWith(x.id)); Object.assign(r.fields, body.fields); return ok(r); }
  };
  process.env.DISPUTES_STORE = ''; process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = 'tok';
  try {
    const d = await disputes.raise(ARTH, { dealId: 'D9', client: 'Client D9', rep: 'Arth Agarwal', details: 'Zoom', files: [PNG] });
    const post = calls.find((c) => c.method === 'POST');
    assert.equal(post.body.records[0].fields.Status, 'Open');
    assert.equal(post.body.records[0].fields['Raised By Email'], 'arth@riseresearch.com');
    const up = calls.find((c) => c.url.includes('uploadAttachment'));
    assert.equal(up.url, `https://content.airtable.com/v0/appMn20DaFCQaMPig/${d.id}/Attachments/uploadAttachment`);
    assert.deepEqual([up.body.contentType, up.body.filename, up.body.file], ['image/png', 'shot.png', PNG.data]);
    const { comment } = await disputes.comment(YASH, { id: d.id, message: 'ok?' });
    assert.deepEqual(calls.find((c) => c.url.includes('tblJQl6IrdAVZIol3') && c.method === 'POST').body.records[0].fields.Discrepancy, [d.id]);
    const listed = (await disputes.list(true)).find((x) => x.id === d.id);
    assert.deepEqual(listed.comments.map((c) => c.id), [comment.id]);
    recs.tbluL9dBxK46KAzz2[0].fields.Status = 'Rejected'; // changed directly in Airtable
    assert.equal((await disputes.list(true))[0].status, 'rejected');
    await assert.rejects(disputes.resolve(YASH, { id: d.id, decision: 'rejected' }), /already rejected/);
    await disputes.resolve(SHREYANS, { id: d.id, decision: 'open' });
    const patch = calls.filter((c) => c.method === 'PATCH').at(-1).body.fields;
    assert.deepEqual([patch.Status, patch['Resolved By'], patch['Resolution Note']], ['Open', null, null]);
  } finally { global.fetch = realFetch; process.env.DISPUTES_STORE = 'local'; delete process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN; }
});

test('notify.message: one subject per raised day, every mail only to Yash', () => {
  const d = { client: 'C', rep: 'Arth Agarwal', reason: 'Other', raisedByEmail: 'shreyans@riseresearch.com', status: 'rejected', attachments: [], at: '2026-11-16T09:00:00Z' };
  const c = notify.message('comment', d, { comment: { author: 'Arth', message: 'm', attachments: [] } });
  const m = notify.message('resolved', d);
  for (const x of [notify.message('raised', d), c, m, notify.message('resolved', { ...d, status: 'open' })]) {
    assert.equal(x.subject, 'Commission discrepancies raised on 16 Nov 2026');
    assert.deepEqual(x.to, ['yash@riseresearch.com']);
  }
  assert.match(m.html, /discrepancy for <b>C \(Arth Agarwal\)<\/b> was <b>rejected<\/b>/);
  assert.equal(notify.message('raised', { ...d, at: '2026-11-17T09:00:00Z' }).subject, 'Commission discrepancies raised on 17 Nov 2026');
});

test('notify: all discrepancies raised on the same day (IST) share one thread; other days get their own', () => {
  const h = (kind, id, at) => notify.threadHeaders(kind, { id, at });
  const a = h('raised', 'rec1', '2026-11-16T04:00:00Z'), b = h('raised', 'rec2', '2026-11-16T17:00:00Z'); // 9:30 and 22:30 IST
  const later = h('comment', 'rec1', '2026-11-16T04:00:00Z'); // a comment days later stays in the day it was raised
  assert.match(a.inReplyTo, /^<discrepancies-2026-11-16@[^>]+>$/);
  assert.equal(b.inReplyTo, a.inReplyTo); assert.equal(later.inReplyTo, a.inReplyTo); assert.deepEqual(b.references, [a.inReplyTo]);
  assert.notEqual(a.messageId, b.messageId);
  assert.notEqual(h('raised', 'rec3', '2026-11-16T19:00:00Z').inReplyTo, a.inReplyTo); // 00:30 IST on the 17th
});

test('e-mails only promise "counts as verified" for discrepancies linked to a deal', () => {
  const base = { client: 'C', rep: 'Arth Agarwal', reason: 'Other', raisedByEmail: 'arth@riseresearch.com', status: 'accepted', attachments: [] };
  assert.match(notify.message('resolved', { ...base, dealId: 'D1' }).html, /now counts as a verified win/);
  const general = notify.message('resolved', { ...base, dealId: null }).html;
  assert.doesNotMatch(general, /verified/); assert.match(general, /Accepted/);
  assert.match(notify.message('raised', { ...base, dealId: null }).html, /not linked to a Closed Won deal/);
});

test('visibility: Yash and Shreyans see every discrepancy; anyone else only theirs', () => {
  const list = [
    { id: 'a', rep: 'Arth Agarwal', raisedByEmail: 'arth@riseresearch.com' },
    { id: 'b', rep: 'Paula Jimenez', raisedByEmail: 'paula@riseresearch.com' },
    { id: 'c', rep: 'Arth Agarwal', raisedByEmail: 'ramya@riseresearch.com' }, // about Arth's deal, raised by someone else
    { id: 'd', rep: 'Diego Alvarez', raisedByEmail: 'arth@riseresearch.com' }, // raised by Arth about another rep's deal
  ];
  const ids = (u) => disputes.visibleTo(u, list).map((d) => d.id);
  assert.deepEqual(ids(YASH), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(SHREYANS), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(ARTH), ['a', 'c', 'd']);
  assert.deepEqual(ids({ email: 'paula@riseresearch.com', name: 'Paula Jimenez' }), ['b']);
  assert.deepEqual(ids({ email: 'nobody@riseresearch.com', name: 'Nobody' }), []);
  assert.deepEqual(ids(null), []);
});
