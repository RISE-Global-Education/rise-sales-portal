// Merges HubSpot + Granola into the normalized events metrics.js expects.
const MATCH_WINDOW_MS = 30 * 60 * 1000;      // Granola note <-> HubSpot meeting start-time tolerance
const SEQ_WINDOW_MS = 7 * 24 * 3600 * 1000;  // sequence email counts as follow-up if sent within 7 days after the call
// '[Granola] ...' meetings are logged by Granola for calls it recorded (duplicates of the booked meeting)
const SKIP_TITLE = /^\s*\[Granola\]|^\s*Canceled:|interview/i;
const { dayOf: iso } = require('./tz');

// Only DISCOVERY CALLS are counted (not interviews, onboarding / program-overview calls, partner or internal meetings).
// A discovery call is either titled "... Discovery Call ..." or is a booking made through a rep's personal meeting link,
// which HubSpot/Granola title "<Prospect> and <Rep name>".
const isDiscovery = (title, repName) => {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (/interview/i.test(t)) return false;
  if (/discovery call/i.test(t)) return true;
  const first = String(repName || '').split(/\s+/)[0];
  return !!first && new RegExp(`^.+ and ${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t);
};

function build(hs, granolaRows) {
  const ownerName = (id) => hs.owners[id]?.name;
  const byEmail = Object.fromEntries(Object.values(hs.owners).filter((o) => o.email).map((o) => [o.email, o.name]));
  const nameOfGranola = (g) => byEmail[(g.repEmail || '').toLowerCase()] || g.rep;

  // index sequence emails by contact
  const idx = (list) => { const m = {}; for (const e of list) (m[e.contact] = m[e.contact] || []).push(e.ts); return m; };
  const pc = idx(hs.postCallEmails);
  const sentAfter = (index, contacts, startMs) =>
    contacts.some((c) => (index[c] || []).some((t) => t >= startMs - 3600e3 && t <= startMs + SEQ_WINDOW_MS));

  // Granola notes per rep, for matching to HubSpot meetings
  const gBy = {};
  for (const g of granolaRows.filter((x) => isDiscovery(x.title, nameOfGranola(x)))) (gBy[nameOfGranola(g)] = gBy[nameOfGranola(g)] || []).push({ ...g, rep: nameOfGranola(g), date: iso(g.startMs) || g.date, used: false });

  // contact -> start times of all live (non-canceled/rescheduled) meetings; used to drop reschedule leftovers
  const startsByContact = {};
  for (const m of hs.meetings) {
    if (!m.startMs || m.outcome === 'CANCELED' || m.outcome === 'RESCHEDULED' || SKIP_TITLE.test(m.title) || !isDiscovery(m.title, ownerName(m.owner))) continue;
    for (const c of hs.meetingContacts[m.id] || []) (startsByContact[c] = startsByContact[c] || []).push(m.startMs);
  }
  const hasLaterMeeting = (contacts, startMs) => contacts.some((c) => (startsByContact[c] || []).some((t) => t > startMs + 60e3));

  const now = Date.now();
  const meetings = [];
  for (const m of hs.meetings) {
    const rep = ownerName(m.owner);
    if (!rep || !m.startMs || m.startMs > now) continue;                 // future / unowned
    if (m.outcome === 'CANCELED' || m.outcome === 'RESCHEDULED') continue;
    if (SKIP_TITLE.test(m.title)) continue;                              // Granola's own HubSpot log, cancellations, hiring interviews
    if (!isDiscovery(m.title, rep)) continue;                            // discovery calls only
    const contacts = hs.meetingContacts[m.id] || [];
    const cands = (gBy[rep] || []).filter((g) => !g.used && Math.abs(g.startMs - m.startMs) <= MATCH_WINDOW_MS);
    cands.sort((a, b) => Math.abs(a.startMs - m.startMs) - Math.abs(b.startMs - m.startMs));
    const g = cands[0];
    if (g) g.used = true;
    // Unrecorded meeting whose contact has a later meeting = reschedule leftover: ignore it
    if (!g && hasLaterMeeting(contacts, m.startMs)) continue;
    const postCallSent = sentAfter(pc, contacts, m.startMs);
    const date = iso(m.startMs);
    if (!g && !postCallSent) continue;                                   // neither recorded nor followed up: not a counted meeting
    meetings.push({
      id: m.id, date, rep, title: m.title, granola: !!g, durationMin: g ? g.durationMin : null, portal: g ? g.portal : false, postCallSent,
    });
  }
  // recorded Granola calls with no HubSpot meeting (e.g. ad-hoc) still count as recorded
  for (const list of Object.values(gBy)) for (const g of list) if (!g.used) {
    meetings.push({ id: 'g' + g.id, date: g.date, rep: g.rep, title: g.title, granola: true, durationMin: g.durationMin, portal: g.portal, postCallSent: false });
  }

  const deals = hs.deals.filter((d) => ownerName(d.owner)).map((d) => ({ ...d, rep: ownerName(d.owner) }));
  const dealMoves = hs.dealMoves.filter((x) => ownerName(x.owner)).map((x) => ({ ...x, rep: ownerName(x.owner) }));
  const openDeals = hs.openDeals.filter((x) => ownerName(x.owner)).map((x) => ({ ...x, rep: ownerName(x.owner) }));
  const leads = hs.leads.filter((l) => ownerName(l.owner)).map((l) => ({ ...l, rep: ownerName(l.owner) }));
  const tasks = hs.tasks.filter((t) => ownerName(t.owner)).map((t) => ({ ...t, rep: ownerName(t.owner) }));
  return { stages: hs.stages, dealMoves, openDeals, meetings, deals, leads, tasks, granola: Object.values(gBy).flat().map(({ used, ...g }) => g) };
}

module.exports = { build };
