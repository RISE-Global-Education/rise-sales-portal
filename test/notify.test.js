// Raising a discrepancy e-mails yash@riseresearch.com (fake mailer + in-memory store: nothing is sent). Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.DISPUTES_STORE = 'local';
const mem = {}, sent = [];
let failMail = false;
const fake = (file, exports) => { require.cache[path.join(__dirname, '../lib', file)] = { id: file, loaded: true, exports }; };
fake('store.js', { get: async (k) => (mem[k] ? JSON.parse(mem[k]) : null), put: async (k, v) => { mem[k] = JSON.stringify(v); } });
fake('mailer.js', { configured: () => true, send: async (...a) => { if (failMail) throw new Error('SMTP down'); sent.push(a); } });
const api = require('../api/disputes');

const call = async (body) => {
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = JSON.parse(b); } };
  await api({ method: 'POST', headers: {}, body }, res);
  return res;
};

test('raising a discrepancy e-mails yash@riseresearch.com with the details and the Airtable link', async () => {
  delete process.env.DISPUTE_NOTIFY_TO;
  const res = await call({ dealId: 'D1', client: 'Lisa <b>Murayama</b>', rep: 'Arth Agarwal', reason: 'Call happened but was not detected', details: 'She joined as a calendar invitee', link: 'https://notes.granola.ai/d/x', raisedBy: 'Arth', dealLink: 'https://app.hubspot.com/contacts/1/record/0-3/D1' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.notified, true);
  assert.equal(sent.length, 1);
  const [to, subject, html, text] = sent[0];
  assert.equal(to, 'yash@riseresearch.com');
  assert.equal(subject, 'Commission discrepancy raised: Lisa <b>Murayama</b> (Arth Agarwal)');
  assert.match(html, /Lisa &lt;b&gt;Murayama&lt;\/b&gt;/); // escaped in the HTML body
  assert.match(html, /She joined as a calendar invitee/);
  assert.match(html, /href="https:\/\/app\.hubspot\.com\/contacts\/1\/record\/0-3\/D1"/);
  assert.match(html, /airtable\.com\/appMn20DaFCQaMPig/);
  assert.match(text, /Raised by: Arth/);
});

test('a failed e-mail does not lose the discrepancy; a failed raise sends no e-mail; recipient can be changed', async () => {
  failMail = true;
  const res = await call({ client: 'Client X', rep: 'Arth Agarwal', details: 'x', raisedBy: 'Arth', dealLink: 'javascript:alert(1)' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.notified, false);
  assert.ok(JSON.parse(mem.disputes).some((d) => d.client === 'Client X')); // saved anyway
  failMail = false;
  const before = sent.length;
  assert.equal((await call({ client: 'Y', raisedBy: 'Arth' })).statusCode, 400); // no explanation -> rejected
  assert.equal(sent.length, before);
  process.env.DISPUTE_NOTIFY_TO = 'a@riseresearch.com,b@riseresearch.com';
  await call({ client: 'Client Z', details: 'z', raisedBy: 'Arth', dealLink: 'javascript:alert(1)' });
  assert.equal(sent.at(-1)[0], 'a@riseresearch.com,b@riseresearch.com');
  assert.doesNotMatch(sent.at(-1)[2], /javascript:/); // only real HubSpot links are put in the e-mail
  delete process.env.DISPUTE_NOTIFY_TO;
});
