// Discrepancies: raise / comment / resolve with the signed-in user, attachments, e-mails, Airtable writes. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.DISPUTES_STORE = 'local'; // in-memory store below unless a test switches to the (mocked) Airtable backend
const mem = {}, sent = [];
const fake = (file, exports) => { require.cache[path.join(__dirname, '../lib', file)] = { id: file, loaded: true, exports }; };
fake('store.js', { get: async (k) => (mem[k] ? JSON.parse(mem[k]) : null), put: async (k, v) => { mem[k] = JSON.stringify(v); } });
fake('mailer.js', { configured: () => true, send: async (to, subject, html, text) => { sent.push({ to, subject, html, text }); } });
const disputes = require('../lib/disputes');
const notify = require('../lib/notify');
const authApi = require('../api/auth');
const api = require('../api/disputes');
process.env.YASH_PASSWORD = 'yash-env-pass';

const YASH = { email: 'yash@riseresearch.com', name: 'Yash Mundada' };
const ARTH = { email: 'arth@riseresearch.com', name: 'Arth Agarwal' };
const SHREYANS = { email: 'shreyans@riseresearch.com', name: 'Shreyans Lodha' };
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
  assert.match(sent[0].subject, /raised: Lisa Murayama \(Arth Agarwal\)/);
  assert.match(sent[0].html, /1 file attached/);
  assert.match(sent[0].html, /http:\/\/portal\.test\/#disputes|https:\/\/portal\.test\/#disputes/);
  assert.equal((await as(ARTH, { action: 'raise', dealId: 'D1', details: 'again' })).statusCode, 409);
});

test('conversation: Yash, the rep and the raiser can comment (with files); others cannot; each comment e-mails the others', async () => {
  const [d] = await disputes.list();
  sent.length = 0;
  const y = await as(YASH, { action: 'comment', id: d.id, message: 'Can you share the Zoom recording?' });
  assert.equal(y.statusCode, 200);
  assert.deepEqual(sent.at(-1).to.split(','), ['arth@riseresearch.com']); // Yash is not e-mailed about his own comment
  assert.match(sent.at(-1).subject, /New comment on discrepancy: Lisa Murayama/);
  const a = await as(ARTH, { action: 'comment', id: d.id, message: 'Here it is', files: [PNG] });
  assert.equal(a.statusCode, 200);
  assert.deepEqual(sent.at(-1).to.split(','), ['yash@riseresearch.com']);
  assert.equal((await as(ARTH, { action: 'comment', id: d.id, message: '' })).statusCode, 400);
  assert.equal((await as(SHREYANS, { action: 'comment', id: d.id, message: 'hi' })).statusCode, 403);
  const [after] = await disputes.list();
  assert.deepEqual(after.comments.map((c) => [c.author, c.message, c.attachments.length]), [['Yash Mundada', 'Can you share the Zoom recording?', 0], ['Arth Agarwal', 'Here it is', 1]]);
});

test('resolve: only Yash; accepted / rejected once; the rep and the raiser are e-mailed', async () => {
  const [d] = await disputes.list();
  assert.equal((await as(ARTH, { action: 'resolve', id: d.id, decision: 'accepted' })).statusCode, 403);
  assert.equal((await as(YASH, { action: 'resolve', id: d.id, decision: 'maybe' })).statusCode, 400);
  sent.length = 0;
  const r = await as(YASH, { action: 'resolve', id: d.id, decision: 'accepted', note: 'Recording confirms the call' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.dispute.status, 'accepted');
  assert.equal(r.body.dispute.resolvedBy, 'Yash Mundada');
  assert.equal(sent[0].to, 'arth@riseresearch.com');
  assert.match(sent[0].subject, /Discrepancy accepted: Lisa Murayama/);
  assert.equal((await as(YASH, { action: 'resolve', id: d.id, decision: 'rejected' })).statusCode, 409);
  // a resolved deal can be raised again
  assert.equal((await as(ARTH, { action: 'raise', dealId: 'D1', client: 'Lisa Murayama', details: 'new issue' })).statusCode, 200);
});

test('a discrepancy raised by someone else for a rep: rep, raiser and Yash are all in the conversation', async () => {
  const r = await as(SHREYANS, { action: 'raise', dealId: 'D7', client: 'Raja Kukkadapu', rep: 'Arth Agarwal', reason: 'Deal belongs to another rep', details: 'I took this call' });
  sent.length = 0;
  assert.equal((await as(ARTH, { action: 'comment', id: r.body.dispute.id, message: 'Agreed' })).statusCode, 200);
  assert.deepEqual(sent.at(-1).to.split(',').sort(), ['shreyans@riseresearch.com', 'yash@riseresearch.com']);
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
    await assert.rejects(disputes.resolve(YASH, { id: d.id, decision: 'accepted' }), /already rejected/);
  } finally { global.fetch = realFetch; process.env.DISPUTES_STORE = 'local'; delete process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN; }
});

test('notify.message: subjects for each kind', () => {
  const d = { client: 'C', rep: 'Arth Agarwal', reason: 'Other', raisedByEmail: 'shreyans@riseresearch.com', status: 'rejected', attachments: [] };
  assert.match(notify.message('raised', d).subject, /^Commission discrepancy raised: C \(Arth Agarwal\)$/);
  assert.match(notify.message('comment', d, { comment: { author: 'Yash', message: 'm', attachments: [] } }).subject, /^New comment on discrepancy/);
  const m = notify.message('resolved', d);
  assert.match(m.subject, /^Discrepancy rejected: C/);
  assert.deepEqual(m.to.sort(), ['arth@riseresearch.com', 'shreyans@riseresearch.com']);
});

test('e-mails only promise "counts as verified" for discrepancies linked to a deal', () => {
  const base = { client: 'C', rep: 'Arth Agarwal', reason: 'Other', raisedByEmail: 'arth@riseresearch.com', status: 'accepted', attachments: [] };
  assert.match(notify.message('resolved', { ...base, dealId: 'D1' }).html, /now counts as a verified win/);
  const general = notify.message('resolved', { ...base, dealId: null }).html;
  assert.doesNotMatch(general, /verified/); assert.match(general, /Accepted/);
  assert.match(notify.message('raised', { ...base, dealId: null }).html, /not linked to a Closed Won deal/);
});
