// Airtable adapter (read-only): the paid-client list used as PROOF OF PAYMENT for Closed Won deals.
// Source: base "Student Pipeline" -> the form-responses table "Research Scholar Application".
//  - paid      = Follow Up Status is "Client"   (same 934 records as the "Yash Tests, do not delete" view)
//  - date      = Client Date (the month the commission falls in)
//  - source    = Counselor Source (see below)
// Override with the env vars below (AIRTABLE_CLIENTS_VIEW, if set, is used instead of the Follow Up Status filter).
// Each client's "Counselor Source" link says whether the sale came through a counsellor or was direct: the link to the
// Counselor Record whose Company Name is "Direct" (or no link at all) = Direct; any other counsellor = Counsellor.
const API = 'https://api.airtable.com/v0';
const BASE = () => process.env.AIRTABLE_BASE || 'appyvj8Xh10kGWbJN';
const TABLE = () => process.env.AIRTABLE_CLIENTS_TABLE || 'tblpsa6QdGW9qmyll';
const VIEW = () => process.env.AIRTABLE_CLIENTS_VIEW || '';
const PAID_FORMULA = "{Follow Up Status}='Client'";
const COUNSELORS = () => process.env.AIRTABLE_COUNSELORS_TABLE || 'tblzcy02PoVxhAXId';
const TOKEN = () => process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN || process.env.AIRTABLE_TOKEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function at(path, tries = 4) {
  for (let i = 0; i < tries; i++) {
    let res;
    try { res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + TOKEN() }, signal: AbortSignal.timeout(60000) }); }
    catch (e) { await sleep(1500 * (i + 1)); continue; }
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(30000 / (tries - i)); continue; } // Airtable: 5 req/s, 30s penalty
    throw new Error(`Airtable ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
  }
  throw new Error('Airtable retries exhausted: ' + path);
}

async function all(table, params) {
  const out = [];
  let offset;
  do {
    const q = new URLSearchParams(params);
    q.set('pageSize', '100');
    if (offset) q.set('offset', offset);
    const r = await at(`/${BASE()}/${table}?${q}`);
    out.push(...(r.records || []));
    offset = r.offset;
    await sleep(220);
  } while (offset);
  return out;
}

const em = (v) => String(v || '').trim().toLowerCase();
const fieldsQ = (names) => names.map((n) => ['fields[]', n]);

// -> { airtableConfigured, airtableLink, clients: [{ id, name, studentEmail, parentEmail, clientDate, status, pkg, counselor, source }], link }
async function load() {
  if (!TOKEN()) return { airtableConfigured: false, clients: [] };
  const counselors = {};
  for (const r of await all(COUNSELORS(), fieldsQ(['Company Name', 'Counselor ID']))) counselors[r.id] = { name: String(r.fields['Company Name'] || '').trim(), code: r.fields['Counselor ID'] || '' };
  const rows = await all(TABLE(), [VIEW() ? ['view', VIEW()] : ['filterByFormula', PAID_FORMULA], ...fieldsQ(['Name', 'Student Email ID', 'Parent Email ID', 'Counselor Source', 'Client Date', 'Acceptance Status', 'Research Package'])]);
  const clients = rows.map((r) => {
    const f = r.fields;
    const c = (f['Counselor Source'] || []).map((id) => counselors[id]).find(Boolean);
    const counselor = c ? c.name : '';
    return {
      id: r.id, name: String(f.Name || '').trim(), studentEmail: em(f['Student Email ID']), parentEmail: em(f['Parent Email ID']),
      clientDate: f['Client Date'] || null, status: f['Acceptance Status'] || '', pkg: f['Research Package'] || '',
      counselor, source: !counselor || /^direct$/i.test(counselor) ? 'Direct' : 'Counsellor',
    };
  });
  return { airtableConfigured: true, clients, airtableLink: `https://airtable.com/${BASE()}/${TABLE()}` };
}

module.exports = { load };
