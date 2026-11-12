// Commission discrepancies raised on the portal ("my deal should count"), with a comment thread and attachments.
//  - RAISE: any signed-in user, for a Closed Won deal (dealId) or free-form (client name / e-mail). The raiser is the
//    signed-in user. Screenshots / files can be attached.
//  - COMMENT: the resolver(s) (Yash), the deal's rep and whoever raised it - an ongoing conversation, with attachments.
//  - RESOLVE: resolvers only (RESOLVERS in lib/config.js). Accepted = the deal counts as verified for commission
//    (it moves from Unverified to Verified Wins); Rejected = it stays unverified. Changing Status in Airtable also works.
// Storage: Airtable base "Commission Discrepancies": tables "Discrepancies" and "Comments" (linked); attachments are
// uploaded into their Attachments fields. Without an Airtable token (tests) everything is kept in the portal store.
const crypto = require('crypto');
const store = require('./store');
const { RESOLVERS, userByName } = require('./config');

const REASONS = ['Call happened but was not detected', 'Client paid but payment was not detected', 'Deal belongs to another rep', 'Other'];
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const fail = (status, msg) => Object.assign(new Error(msg), { status });

// ---------- attachments: images or PDF, at most 3 files and 3 MB together (Vercel accepts ~4.5 MB per request) ----------
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'];
const MAX_FILES = 3, MAX_BYTES = 3 * 1024 * 1024;
function files(list) {
  const out = (Array.isArray(list) ? list : []).filter(Boolean);
  if (out.length > MAX_FILES) throw fail(400, `Attach at most ${MAX_FILES} files.`);
  let total = 0;
  return out.map((f) => {
    const type = String(f.type || '').toLowerCase(), name = clip(f.name, 120).replace(/[\\/]/g, '_') || 'file';
    if (!TYPES.includes(type)) throw fail(400, `${name}: only images (PNG, JPG, GIF, WebP) and PDF can be attached.`);
    const data = String(f.data || '').replace(/^data:[^,]*,/, '');
    const size = Buffer.byteLength(data, 'base64');
    if (!size) throw fail(400, `${name} is empty.`);
    total += size;
    if (total > MAX_BYTES) throw fail(400, 'Attachments are too large: 3 MB in total at most.');
    return { name, type, data, size };
  });
}

// ---------- Airtable backend ----------
const TOKEN = () => process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN || process.env.AIRTABLE_TOKEN;
const BASE = () => process.env.DISPUTES_BASE || 'appMn20DaFCQaMPig';
const T_DISP = () => process.env.DISPUTES_TABLE || 'tbluL9dBxK46KAzz2';
const T_COMM = () => process.env.DISPUTES_COMMENTS_TABLE || 'tblJQl6IrdAVZIol3';
const useAirtable = () => !!TOKEN() && process.env.DISPUTES_STORE !== 'local';
async function at(method, url, body) {
  for (let i = 0; i < 4; i++) {
    let res;
    try { res = await fetch(url, { method, headers: { Authorization: 'Bearer ' + TOKEN(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) }); }
    catch (e) { if (i === 3) throw e; await new Promise((r) => setTimeout(r, 1000 * (i + 1))); continue; }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && i < 3) { await new Promise((r) => setTimeout(r, 2000 * (i + 1))); continue; }
    throw fail(502, `Airtable ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
const tbl = (t) => `https://api.airtable.com/v0/${BASE()}/${t}`;
async function all(t) {
  const out = [];
  let offset;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    if (offset) q.set('offset', offset);
    const r = await at('GET', tbl(t) + '?' + q);
    out.push(...(r.records || []));
    offset = r.offset;
  } while (offset);
  return out;
}
// upload straight into the record's Attachments field (Airtable content API, up to 5 MB per file)
async function upload(recordId, list) {
  for (const f of list) await at('POST', `https://content.airtable.com/v0/${BASE()}/${recordId}/Attachments/uploadAttachment`, { contentType: f.type, file: f.data, filename: f.name });
}
const atts = (v) => (v || []).map((a) => ({ name: a.filename, type: a.type, size: a.size, url: a.url, thumb: a.thumbnails && a.thumbnails.large ? a.thumbnails.large.url : null }));
const fromRec = (r) => {
  const f = r.fields || {};
  return {
    id: r.id, at: f['Raised At'] || r.createdTime, dealId: f['Deal ID'] || null, client: f.Client || '', rep: f.Rep || '',
    raisedBy: f['Raised By'] || '', raisedByEmail: String(f['Raised By Email'] || '').toLowerCase(),
    reason: f.Reason || 'Other', details: f.Details || '', link: f['Proof Link'] || '', dealLink: f['HubSpot Deal'] || '',
    status: String(f.Status || 'Open').toLowerCase(), resolvedAt: f['Resolved At'] || null, resolvedBy: f['Resolved By'] || '', note: f['Resolution Note'] || '',
    attachments: atts(f.Attachments), comments: [],
  };
};
const commentFromRec = (r) => {
  const f = r.fields || {};
  return { id: r.id, dispute: (f.Discrepancy || [])[0] || null, author: f.Author || '', authorEmail: String(f['Author Email'] || '').toLowerCase(), message: f.Message || '', at: f['Posted At'] || r.createdTime, attachments: atts(f.Attachments) };
};

let memo = null; // short cache: the portal reads the list on every page load (an Airtable edit shows within ~20s)
async function list(fresh = false) {
  if (!useAirtable()) return (await store.get('disputes')) || [];
  if (!fresh && memo && Date.now() - memo.at < 20000) return memo.list;
  const [ds, cs] = await Promise.all([all(T_DISP()), all(T_COMM())]);
  const out = ds.map(fromRec).filter((d) => d.client || d.dealId); // skip blank rows added in Airtable
  const byId = Object.fromEntries(out.map((d) => [d.id, d]));
  for (const c of cs.map(commentFromRec).sort((a, b) => (a.at < b.at ? -1 : 1))) if (byId[c.dispute]) byId[c.dispute].comments.push(c);
  memo = { at: Date.now(), list: out };
  return out;
}

// who may take part in a discrepancy's conversation
const isResolver = (user) => RESOLVERS().includes(user.email);
const canComment = (d, user) => isResolver(user) || d.raisedByEmail === user.email || (d.rep && d.rep === user.name);

async function raise(user, b) {
  const reason = REASONS.includes(b.reason) ? b.reason : 'Other';
  const details = clip(b.details, 2000), client = clip(b.client, 200), dealId = b.dealId ? clip(b.dealId, 40) : null;
  if (!dealId && !client) throw fail(400, 'Name the deal or client.');
  if (!details) throw fail(400, 'Add a short explanation.');
  const link = clip(b.link, 500);
  if (link && !/^https?:\/\//i.test(link)) throw fail(400, 'The proof link must start with http:// or https://');
  const dealLink = /^https:\/\/app\.hubspot\.com\//.test(b.dealLink || '') ? clip(b.dealLink, 500) : '';
  const fs = files(b.files);
  memo = null;
  const existing = await list();
  if (dealId && existing.some((d) => d.dealId === dealId && d.status === 'open')) throw fail(409, 'There is already an open discrepancy for this deal: add a comment to it instead.');
  const d = { at: new Date().toISOString(), dealId, client, rep: clip(b.rep, 80), raisedBy: user.name, raisedByEmail: user.email, reason, details, link, dealLink, status: 'open', attachments: [], comments: [] };
  if (useAirtable()) {
    const r = await at('POST', tbl(T_DISP()), { typecast: true, records: [{ fields: {
      Client: client, Status: 'Open', Rep: d.rep || undefined, Reason: reason, Details: details, 'Proof Link': link || undefined,
      'Raised By': user.name, 'Raised By Email': user.email, 'Raised At': d.at, 'Deal ID': dealId || undefined, 'HubSpot Deal': dealLink || undefined,
    } }] });
    const id = r.records[0].id;
    await upload(id, fs);
    memo = null;
    return { ...fromRec(r.records[0]), attachments: fs.map((f) => ({ name: f.name, type: f.type, size: f.size })) };
  }
  Object.assign(d, { id: crypto.randomBytes(6).toString('hex'), attachments: fs.map((f) => ({ name: f.name, type: f.type, size: f.size })) });
  existing.push(d);
  await store.put('disputes', existing);
  return d;
}

async function comment(user, b) {
  const message = clip(b.message, 4000), fs = files(b.files);
  if (!message && !fs.length) throw fail(400, 'Write a comment or attach a file.');
  memo = null;
  const ds = await list(true);
  const d = ds.find((x) => x.id === b.id);
  if (!d) throw fail(404, 'Discrepancy not found.');
  if (!canComment(d, user)) throw fail(403, 'Only Yash, the deal’s rep and the person who raised it can comment here.');
  const c = { author: user.name, authorEmail: user.email, message, at: new Date().toISOString(), attachments: fs.map((f) => ({ name: f.name, type: f.type, size: f.size })) };
  if (useAirtable()) {
    const r = await at('POST', tbl(T_COMM()), { records: [{ fields: { Author: user.name, 'Author Email': user.email, Message: message, 'Posted At': c.at, Discrepancy: [d.id] } }] });
    c.id = r.records[0].id;
    await upload(c.id, fs);
    memo = null;
  } else {
    c.id = crypto.randomBytes(6).toString('hex');
    d.comments.push(c);
    await store.put('disputes', ds);
  }
  return { dispute: d, comment: c };
}

async function resolve(user, b) {
  if (!isResolver(user)) throw fail(403, 'Only Yash can resolve discrepancies.');
  if (!['accepted', 'rejected'].includes(b.decision)) throw fail(400, 'decision must be accepted or rejected');
  memo = null;
  const ds = await list(true);
  const d = ds.find((x) => x.id === b.id);
  if (!d) throw fail(404, 'Discrepancy not found.');
  if (d.status !== 'open') throw fail(409, `This discrepancy is already ${d.status}.`);
  Object.assign(d, { status: b.decision, resolvedAt: new Date().toISOString(), resolvedBy: user.name, note: clip(b.note, 1000) });
  if (useAirtable()) {
    await at('PATCH', tbl(T_DISP()) + '/' + encodeURIComponent(d.id), { typecast: true, fields: { Status: b.decision === 'accepted' ? 'Accepted' : 'Rejected', 'Resolved By': user.name, 'Resolved At': d.resolvedAt, 'Resolution Note': d.note } });
    memo = null;
  } else await store.put('disputes', ds);
  return d;
}

// e-mail addresses of the people in a discrepancy's conversation (for notifications)
const participants = (d) => [...new Set([d.raisedByEmail, (userByName(d.rep) || {}).email].filter(Boolean))];

module.exports = { REASONS, TYPES, MAX_FILES, MAX_BYTES, list, raise, comment, resolve, canComment, isResolver, participants };
