// Granola adapter — ports the existing Apps Script logic to Node.
// Endpoints: GET /v1/notes (paginated), GET /v1/notes/:id?include=transcript
// Row: { id, date, rep, repEmail, startMs, title, scheduledMin, attendees, link, summary, durationMin, portal, granola:true, postCallSent:false }
//
// The cache (id -> row) is owned by lib/service.js (stored in Blob / data/). Only new notes and the last
// 7 days (which can still be updating) are fetched; the loop stops at `deadline` so it fits a serverless run.
const API = 'https://public-api.granola.ai/v1';
const RECHECK_DAYS = 7;
const CONCURRENCY = 5;

const key = () => process.env.GRANOLA_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gget(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    let res;
    try { res = await fetch(url, { headers: { Authorization: 'Bearer ' + key() }, signal: AbortSignal.timeout(60000) }); }
    catch (e) { await sleep(2000 * (i + 1)); continue; }
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (i + 1)); continue; }
    throw new Error(`Granola ${res.status} ${url}: ${await res.text()}`);
  }
  throw new Error('Granola retries exhausted: ' + url);
}

async function listNotes() {
  const all = [];
  let cursor;
  while (true) {
    let url = `${API}/notes?page_size=30`;
    if (cursor) url += '&cursor=' + encodeURIComponent(cursor);
    const data = await gget(url);
    all.push(...(data.notes || []));
    if (!data.hasMore || !data.cursor) break;
    cursor = data.cursor;
    await sleep(250);
  }
  return all;
}

// Same rules as the Apps Script: duration = first transcript start -> last transcript end; portal = word in summary/transcript.
function toRow(detail, id) {
  const cal = detail.calendar_event || {};
  const tr = Array.isArray(detail.transcript) ? detail.transcript : [];
  const starts = tr.map((t) => Date.parse(t.start_time)).filter((x) => !isNaN(x));
  const ends = tr.map((t) => Date.parse(t.end_time)).filter((x) => !isNaN(x));
  let durationMin = null;
  if (starts.length && ends.length) {
    const d = Math.max(...ends) - Math.min(...starts);
    if (d > 0) durationMin = Math.round(d / 60000);
  }
  const text = ((detail.summary_text || detail.summary_markdown || '') + ' ' + tr.map((t) => t.text || '').join(' ')).toLowerCase();
  const when = cal.scheduled_start_time || detail.created_at || '';
  return {
    id,
    date: String(when).slice(0, 10), // re-bucketed to the report timezone in lib/build.js
    rep: (detail.owner && (detail.owner.name || detail.owner.email)) || '',
    repEmail: (detail.owner && detail.owner.email) || '',
    startMs: Date.parse(when) || 0,
    title: detail.title || '',
    scheduledMin: (cal.scheduled_start_time && cal.scheduled_end_time) ? Math.round((Date.parse(cal.scheduled_end_time) - Date.parse(cal.scheduled_start_time)) / 60000) : null,
    attendees: (detail.attendees || []).map((p) => (p.name && p.email ? `${p.name} (${p.email})` : p.name || p.email || '')).filter(Boolean).join(', '),
    // every e-mail on the call (attendees + calendar invitees): proof of who the rep actually spoke to (commission check)
    emails: [...new Set([...(detail.attendees || []), ...(cal.invitees || [])].map((p) => String(p.email || '').trim().toLowerCase()).filter((e) => e.includes('@')))],
    transcript: tr.length > 0,
    link: detail.web_url || '',
    summary: (detail.summary_text || detail.summary_markdown || '').slice(0, 300),
    durationMin,
    portal: /\bportal\b/.test(text),
    granola: true,
    postCallSent: false,
    updatedAt: Date.now(),
  };
}

// cache: { [noteId]: row } -> { cache, complete }   (complete=false means the deadline hit; call again to continue)
async function load(cache = {}, deadline = Infinity) {
  if (!key()) return { cache, complete: true };
  const cutoff = Date.now() - RECHECK_DAYS * 864e5;
  const notes = await listNotes();
  const todo = notes.filter((n) => !cache[n.id] || (cache[n.id].startMs && cache[n.id].startMs > cutoff));
  let complete = true;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    if (Date.now() > deadline) { complete = false; break; }
    await Promise.all(todo.slice(i, i + CONCURRENCY).map(async (n) => {
      try { cache[n.id] = toRow(await gget(`${API}/notes/${encodeURIComponent(n.id)}?include=transcript`), n.id); }
      catch (e) { console.error('Granola note failed', n.id, e.message); }
    }));
    await sleep(300);
  }
  return { cache, complete };
}

module.exports = { load };
