// Commission discrepancies raised on the portal ("my deal should count").
//  - Anyone on the portal can RAISE one, for a Closed Won deal (dealId) or free-form (client name / e-mail).
//  - Managers RESOLVE it only in Airtable, by changing the Status field to Accepted (the deal then counts as verified
//    for commission) or Rejected. The portal has no accept / reject: it just reads Status back (within ~20 seconds).
// Storage: Airtable base "Commission Discrepancies" -> table "Discrepancies" (override with DISPUTES_BASE / DISPUTES_TABLE).
// Without an Airtable token (local dev, tests) they are kept in the portal's own store under the key 'disputes'.
const crypto = require('crypto');
const store = require('./store');

const REASONS = ['Call happened but was not detected', 'Client paid but payment was not detected', 'Deal belongs to another rep', 'Other'];
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const fail = (status, msg) => Object.assign(new Error(msg), { status });

// ---------- Airtable backend ----------
const TOKEN = () => process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN || process.env.AIRTABLE_TOKEN;
const URL_ = () => `https://api.airtable.com/v0/${process.env.DISPUTES_BASE || 'appMn20DaFCQaMPig'}/${process.env.DISPUTES_TABLE || 'tbluL9dBxK46KAzz2'}`;
const useAirtable = () => !!TOKEN() && process.env.DISPUTES_STORE !== 'local';
async function at(method, path = '', body) {
  for (let i = 0; i < 4; i++) {
    let res;
    try { res = await fetch(URL_() + path, { method, headers: { Authorization: 'Bearer ' + TOKEN(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) }); }
    catch (e) { if (i === 3) throw e; await new Promise((r) => setTimeout(r, 1000 * (i + 1))); continue; }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && i < 3) { await new Promise((r) => setTimeout(r, 2000 * (i + 1))); continue; }
    throw fail(502, `Airtable ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
const fromRec = (r) => {
  const f = r.fields || {};
  return {
    id: r.id, at: f['Raised At'] || r.createdTime, dealId: f['Deal ID'] || null, client: f.Client || '', rep: f.Rep || '', raisedBy: f['Raised By'] || '',
    reason: f.Reason || 'Other', details: f.Details || '', link: f['Proof Link'] || '', status: String(f.Status || 'Open').toLowerCase(),
    resolvedAt: f['Resolved At'] || null, resolvedBy: f['Resolved By'] || '', note: f['Resolution Note'] || '',
  };
};
let memo = null; // short cache: the portal reads the list on every page load (so an Airtable Status change shows within ~20s)
async function list(fresh = false) {
  if (!useAirtable()) return (await store.get('disputes')) || [];
  if (!fresh && memo && Date.now() - memo.at < 20000) return memo.list;
  const out = [];
  let offset;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    if (offset) q.set('offset', offset);
    const r = await at('GET', '?' + q);
    out.push(...(r.records || []).map(fromRec).filter((d) => d.client || d.dealId)); // skip blank rows added in Airtable
    offset = r.offset;
  } while (offset);
  memo = { at: Date.now(), list: out };
  return out;
}

async function raise(b) {
  const reason = REASONS.includes(b.reason) ? b.reason : 'Other';
  const details = clip(b.details, 2000), raisedBy = clip(b.raisedBy, 80), client = clip(b.client, 200), dealId = b.dealId ? clip(b.dealId, 40) : null;
  if (!raisedBy) throw fail(400, 'Say who is raising it.');
  if (!dealId && !client) throw fail(400, 'Name the deal or client.');
  if (!details) throw fail(400, 'Add a short explanation.');
  const link = clip(b.link, 500);
  if (link && !/^https?:\/\//i.test(link)) throw fail(400, 'The proof link must start with http:// or https://');
  memo = null;
  const all = await list();
  if (dealId && all.some((d) => d.dealId === dealId && d.status === 'open')) throw fail(409, 'There is already an open discrepancy for this deal.');
  const d = { at: new Date().toISOString(), dealId, client, rep: clip(b.rep, 80), raisedBy, reason, details, link, status: 'open' };
  if (useAirtable()) {
    const r = await at('POST', '', { typecast: true, records: [{ fields: {
      Client: client, Status: 'Open', Rep: d.rep || undefined, Reason: reason, Details: details, 'Proof Link': link || undefined, 'Raised By': raisedBy,
      'Raised At': d.at, 'Deal ID': dealId || undefined, 'HubSpot Deal': clip(b.dealLink, 500) || undefined,
    } }] });
    memo = null;
    return fromRec(r.records[0]);
  }
  d.id = crypto.randomBytes(6).toString('hex');
  all.push(d);
  await store.put('disputes', all);
  return d;
}

module.exports = { REASONS, list, raise };
