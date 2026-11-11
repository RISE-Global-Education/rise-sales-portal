// HubSpot adapter (Private App token, CRM v3/v4, read-only). Zero dependencies.
// Split into independent PARTS so a refresh can be done in small time-boxed steps (needed for serverless).
// lib/service.js stores each part; lib/build.js merges them with Granola.
const { dayOf: day } = require('./tz');

const BASE = 'https://api.hubapi.com';
const TOKEN = () => process.env.HUBSPOT_TOKEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CONFIG = {
  closedWonStage: process.env.HS_CLOSED_WON_STAGE || '4028500709', // "Sales Pipeline - 21 July 2026" -> Closed Won
  // Every "Post Call ..." variant (Basic, india, roW, Lab, clone, per-rep copies) plus the "Publication Pathway" sequence.
  // "Post acceptance payment reminder" is deliberately not matched (it is not a post-call follow-up).
  postCallSeqRegex: new RegExp(process.env.HS_POSTCALL_SEQ_REGEX || 'post.?call|publication pathway', 'i'),
};

async function hs(path, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      res = await fetch(BASE + path, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${TOKEN()}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60000), // never hang on a stalled connection
      });
    } catch (e) { await sleep(1500 * (i + 1)); continue; }
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
    throw new Error(`HubSpot ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
  }
  throw new Error('HubSpot retries exhausted: ' + path);
}

// HubSpot's search API returns at most ~10,000 results per query. To read everything, results are sorted by a date
// property and, when a query reaches the cap, the next query restarts from the last date seen (duplicates removed).
const DATE_PROP = { tasks: 'hs_createdate', meetings: 'hs_timestamp', emails: 'hs_timestamp' }; // others use createdate
const PAGE_CAP = Number(process.env.HS_PAGE_CAP || 9900);

async function searchAll(object, body) {
  const dateProp = DATE_PROP[object] || 'createdate';
  const props = [...new Set([...(body.properties || []), dateProp])];
  const out = [], seen = new Set();
  let cursor = null; // ms timestamp to continue from after hitting the cap
  while (true) {
    const groups = body.filterGroups.map((g) => ({ filters: [...g.filters, ...(cursor != null ? [{ propertyName: dateProp, operator: 'GTE', value: String(cursor) }] : [])] }));
    let after, n = 0, added = 0, last = null;
    do {
      const page = await hs(`/crm/v3/objects/${object}/search`, { ...body, filterGroups: groups, properties: props, sorts: [{ propertyName: dateProp, direction: 'ASCENDING' }], limit: 100, after });
      for (const r of page.results) { last = r; if (!seen.has(r.id)) { seen.add(r.id); out.push(r); added++; } }
      n += page.results.length;
      after = page.paging?.next?.after;
      await sleep(220); // search API ~5 req/s
    } while (after && n < PAGE_CAP);
    if (!after) break;                                  // read everything
    const t = Date.parse(last.properties[dateProp]);
    if (!added || isNaN(t) || t === cursor) { console.error(`HubSpot ${object}: could not page past ${out.length} records`); break; }
    cursor = t;
  }
  return out;
}

// objectType -> contacts association map { fromId: [contactId...] }
// lead country = the contact's HubSpot 'Country/Region' (blank = Unknown); one spelling per country
const ctry = (...v) => { const x = v.find((y) => y && String(y).trim()); return x ? String(x).trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown'; };
async function contactsFor(objectType, ids) {
  const map = {};
  for (let i = 0; i < ids.length; i += 500) {
    const r = await hs(`/crm/v4/associations/${objectType}/contacts/batch/read`, { inputs: ids.slice(i, i + 500).map((id) => ({ id })) });
    for (const x of r.results || []) map[x.from.id] = (x.to || []).map((t) => String(t.toObjectId));
    await sleep(150);
  }
  return map;
}

const PARTS = {
  // owners (id -> {name,email}), sequences, and the Sales pipeline's stages
  async base() {
    const [active, archived] = await Promise.all([hs('/crm/v3/owners?limit=500'), hs('/crm/v3/owners?limit=500&archived=true')]); // former reps still own historical deals
    const owners = {}, userIds = [];
    for (const o of [...active.results, ...archived.results]) {
      owners[o.id] = { name: `${o.firstName || ''} ${o.lastName || ''}`.trim(), email: (o.email || '').toLowerCase() };
      if (o.userId) userIds.push(o.userId);
    }
    const seqs = {};
    for (const u of userIds) {
      try {
        const s = await hs(`/automation/v4/sequences?limit=100&userId=${u}`);
        for (const q of s.results || []) seqs[q.id] = seqs[q.id] || q.name;
      } catch (e) { /* user without sequence seat */ }
      await sleep(120);
    }
    const pipelines = await hs('/crm/v3/pipelines/deals');
    const sp = pipelines.results.find((x) => x.stages.some((st) => st.id === CONFIG.closedWonStage));
    const stages = sp.stages.slice().sort((a, b) => a.displayOrder - b.displayOrder).map((st) => ({ id: st.id, label: st.label }));
    return { owners, seqs, stages, pipelineId: sp.id, postCallIds: Object.keys(seqs).filter((k) => CONFIG.postCallSeqRegex.test(seqs[k])) };
  },

  // Closed Won deals + every Sales-pipeline deal's stage history (movement) + deals currently open
  async deals(b) {
    const deals = (await searchAll('deals', {
      filterGroups: [{ filters: [{ propertyName: 'dealstage', operator: 'EQ', value: CONFIG.closedWonStage }] }],
      properties: ['hubspot_owner_id', 'closedate', 'hs_closed_won_date', 'deal_country'],
    })).map((d) => ({ id: d.id, country: ctry(d.properties.deal_country), owner: d.properties.hubspot_owner_id, closedDate: day(d.properties.hs_closed_won_date || d.properties.closedate), closedMs: Date.parse(d.properties.hs_closed_won_date || d.properties.closedate) }));

    // each closed-won deal's contacts, so a deal takes its lead's (contact) country
    const dealContacts = await contactsFor('deals', deals.map((d) => d.id));
    for (const d of deals) d.contacts = dealContacts[d.id] || [];

    const pipeDeals = await searchAll('deals', {
      filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: b.pipelineId }] }],
      properties: ['hubspot_owner_id', 'dealstage', 'deal_country'],
    });
    const dealMoves = [];
    for (let i = 0; i < pipeDeals.length; i += 50) {
      const r = await hs('/crm/v3/objects/deals/batch/read', {
        inputs: pipeDeals.slice(i, i + 50).map((d) => ({ id: d.id })),
        properties: ['hubspot_owner_id', 'dealstage', 'deal_country'], propertiesWithHistory: ['dealstage'],
      });
      for (const d of r.results || []) {
        for (const h of d.propertiesWithHistory?.dealstage || []) dealMoves.push({ deal: d.id, country: ctry(d.properties.deal_country), owner: d.properties.hubspot_owner_id, stage: h.value, date: day(h.timestamp), tsMs: Date.parse(h.timestamp) });
      }
      await sleep(150);
    }
    const openDeals = pipeDeals.filter((d) => !/closed/i.test(b.stages.find((st) => st.id === d.properties.dealstage)?.label || ''))
      .map((d) => ({ owner: d.properties.hubspot_owner_id, stage: d.properties.dealstage, country: ctry(d.properties.deal_country) }));
    return { deals, dealMoves, openDeals };
  },

  // leads = all contacts, dated by creation; booked = a meeting was booked through HubSpot's meetings tool
  async leads() {
    const leads = (await searchAll('contacts', {
      filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'HAS_PROPERTY' }] }],
      properties: ['hubspot_owner_id', 'createdate', 'engagements_last_meeting_booked', 'partner', 'country', 'hubspot_owner_assigneddate'],
    })).map((c) => ({ id: c.id, owner: c.properties.hubspot_owner_id, date: day(c.properties.createdate), createdMs: Date.parse(c.properties.createdate), booked: !!c.properties.engagements_last_meeting_booked, meta: /meta/i.test(c.properties.partner || ''), country: ctry(c.properties.country), claimedMs: c.properties.hubspot_owner_assigneddate ? Date.parse(c.properties.hubspot_owner_assigneddate) : null }));
    return { leads };
  },

  // tasks (skip HubSpot's demo "(Sample task)" records and unowned tasks)
  async tasks() {
    const tasks = (await searchAll('tasks', {
      filterGroups: [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'HAS_PROPERTY' }] }],
      properties: ['hubspot_owner_id', 'hs_createdate', 'hs_timestamp', 'hs_task_status', 'hs_task_completion_date', 'hs_task_subject'],
    })).filter((t) => !/^\(Sample task\)/.test(t.properties.hs_task_subject || ''))
      .map((t) => ({
        id: t.id, owner: t.properties.hubspot_owner_id, createdDate: day(t.properties.hs_createdate), dueDate: day(t.properties.hs_timestamp),
        // exact moments, so "overdue at time T" can be rebuilt for any past day (HubSpot only stores the live is_overdue flag)
        createdMs: Date.parse(t.properties.hs_createdate), dueMs: Date.parse(t.properties.hs_timestamp),
        doneMs: t.properties.hs_task_status === 'COMPLETED' ? Date.parse(t.properties.hs_task_completion_date || t.properties.hs_createdate) : null,
        completedDate: t.properties.hs_task_status === 'COMPLETED' ? day(t.properties.hs_task_completion_date || t.properties.hs_createdate) : null,
      }));
    return { tasks };
  },

  async meetings() {
    const raw = await searchAll('meetings', {
      filterGroups: [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'HAS_PROPERTY' }] }],
      properties: ['hubspot_owner_id', 'hs_timestamp', 'hs_meeting_outcome', 'hs_meeting_title'],
    });
    const meetings = raw.map((m) => ({
      id: m.id, owner: m.properties.hubspot_owner_id, startMs: Date.parse(m.properties.hs_timestamp),
      outcome: m.properties.hs_meeting_outcome, title: m.properties.hs_meeting_title || '',
    }));
    return { meetings, meetingContacts: await contactsFor('meetings', meetings.map((m) => m.id)) };
  },

  // post-call sequence emails -> contact + timestamp
  async emails(b) {
    const find = async (prop, ids) => {
      if (!ids.length) return [];
      const rows = await searchAll('emails', {
        filterGroups: [{ filters: [{ propertyName: prop, operator: 'IN', values: ids }] }],
        properties: ['hs_timestamp', 'hs_sequence_id', 'hs_template_id', 'hubspot_owner_id'],
      });
      const assoc = await contactsFor('emails', rows.map((r) => r.id));
      return rows.flatMap((r) => (assoc[r.id] || []).map((c) => ({ contact: c, ts: Date.parse(r.properties.hs_timestamp), owner: r.properties.hubspot_owner_id })));
    };
    return {
      postCallEmails: await find('hs_sequence_id', b.postCallIds),
    };
  },
};

// Tasks overdue RIGHT NOW straight from HubSpot (not completed and past their due time) -> { ownerId: count }.
// Used for the portal and emails so the figure never lags behind the hourly saved data.
async function overdueNow() {
  const rows = await searchAll('tasks', {
    filterGroups: [{ filters: [
      { propertyName: 'hs_task_status', operator: 'NEQ', value: 'COMPLETED' },
      { propertyName: 'hs_timestamp', operator: 'LT', value: String(Date.now()) },
      { propertyName: 'hubspot_owner_id', operator: 'HAS_PROPERTY' },
    ] }],
    properties: ['hubspot_owner_id', 'hs_task_subject'],
  });
  const out = {};
  for (const t of rows) {
    if (/^\(Sample task\)/.test(t.properties.hs_task_subject || '')) continue;
    out[t.properties.hubspot_owner_id] = (out[t.properties.hubspot_owner_id] || 0) + 1;
  }
  return out;
}

// Leads that came in between two moments and are still UNCLAIMED (no owner), and how many of those are Unqualified (Lead Status).
// Live from HubSpot (unowned contacts are not in the saved snapshot).
async function unclaimed(fromMs, toMs) {
  const count = async (extra) => {
    const r = await hs('/crm/v3/objects/contacts/search', { filterGroups: [{ filters: [
      { propertyName: 'createdate', operator: 'GTE', value: String(fromMs) },
      { propertyName: 'createdate', operator: 'LTE', value: String(toMs) },
      { propertyName: 'hubspot_owner_id', operator: 'NOT_HAS_PROPERTY' },
      ...extra,
    ] }], limit: 1 });
    return r.total || 0;
  };
  return { total: await count([]), unqualified: await count([{ propertyName: 'hs_lead_status', operator: 'EQ', value: 'UNQUALIFIED' }]) };
}

const ORDER = ['base', 'deals', 'leads', 'tasks', 'meetings', 'emails'];
module.exports = { PARTS, ORDER, CONFIG, overdueNow, unclaimed };
