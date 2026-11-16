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
  // also re-fetch, once, notes saved before attendee/invitee e-mails were stored (needed for the commission call proof);
  // newest first, so recent deals are covered first if the time budget runs out (the next refresh continues)
  const todo = notes.filter((n) => !cache[n.id] || !cache[n.id].emails || (cache[n.id].startMs && cache[n.id].startMs > cutoff))
    .sort((a, b) => !!(cache[a.id] && cache[a.id].emails) - !!(cache[b.id] && cache[b.id].emails) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
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

// ---------- Daily Checkin: a pasted Granola link -> that note's full summary ----------
// The link (https://notes.granola.ai/d/<uuid>) is the note's web_url, which is not its API id (not_…), so it is
// matched against the cached notes' links first. A note newer than the last hourly refresh is not cached yet, so
// the newest notes the cache has not seen are then fetched until one matches.
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const linkKey = (u) => { const m = String(u || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); return m ? m[0].toLowerCase() : null; };
const isGranolaLink = (u) => { try { const h = new URL(u).hostname; return /^https?:$/.test(new URL(u).protocol) && (h === 'granola.ai' || h.endsWith('.granola.ai')) && !!linkKey(u); } catch { return false; } };
const summaryOf = (d) => ({ link: d.web_url || '', title: d.title || '', summary: String(d.summary_text || d.summary_markdown || '').trim() });

async function noteByLink(link, cache = {}, deadline = Date.now() + 20000) {
  if (!isGranolaLink(link)) throw fail(400, 'Paste a Granola note link (https://notes.granola.ai/d/…).');
  if (!key()) throw fail(503, 'Granola is not connected (GRANOLA_API_KEY is missing), so the summary can’t be fetched.');
  const k = linkKey(link);
  const cached = Object.values(cache).find((r) => linkKey(r.link) === k);
  if (cached) return summaryOf(await gget(`${API}/notes/${encodeURIComponent(cached.id)}`));
  // newest first; stop at the first page the cache already fully covers
  let cursor;
  for (let page = 0; page < 5 && Date.now() < deadline; page++) {
    const data = await gget(`${API}/notes?page_size=30${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    const notes = data.notes || [], fresh = notes.filter((n) => !cache[n.id]);
    const listed = notes.find((n) => linkKey(n.web_url) === k);
    if (listed) return summaryOf(await gget(`${API}/notes/${encodeURIComponent(listed.id)}`));
    for (let i = 0; i < fresh.length && Date.now() < deadline; i += CONCURRENCY) {
      const details = await Promise.all(fresh.slice(i, i + CONCURRENCY).map((n) => gget(`${API}/notes/${encodeURIComponent(n.id)}`).catch(() => null)));
      const hit = details.find((d) => d && linkKey(d.web_url) === k);
      if (hit) return summaryOf(hit);
    }
    if (!fresh.length || !data.hasMore || !data.cursor) break;
    cursor = data.cursor;
  }
  throw fail(404, 'Couldn’t find that note in Granola. Check the link, and that the note belongs to the team’s Granola workspace.');
}

module.exports = { load, noteByLink, isGranolaLink };
