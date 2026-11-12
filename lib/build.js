// Merges HubSpot + Granola into the normalized events metrics.js expects.
const MATCH_WINDOW_MS = 30 * 60 * 1000;      // Granola note <-> HubSpot meeting start-time tolerance
const SEQ_WINDOW_MS = 7 * 24 * 3600 * 1000;  // sequence email counts as follow-up if sent within 7 days after the call
// '[Granola] ...' meetings are logged by Granola for calls it recorded (duplicates of the booked meeting)
const SKIP_TITLE = /^\s*\[Granola\]|^\s*Canceled:|interview/i;
const { dayOf: iso, dayIn } = require('./tz');
const { tzOf } = require('./config');

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
  for (const g of granolaRows.filter((x) => isDiscovery(x.title, nameOfGranola(x)))) (gBy[nameOfGranola(g)] = gBy[nameOfGranola(g)] || []).push({ ...g, rep: nameOfGranola(g), date: dayIn(g.startMs, tzOf(nameOfGranola(g))) || g.date, used: false });

  // contact id -> lead country (so meetings / Granola notes can be filtered by the lead's country)
  const countryOfContact = {};
  for (const l of hs.leads) if (l.country && l.country !== 'Unknown') countryOfContact[l.id] = l.country;
  const countryFor = (contacts) => { for (const c of contacts) if (countryOfContact[c]) return countryOfContact[c]; return 'Unknown'; };

  // contact -> start times of all live (non-canceled/rescheduled) meetings; used to drop reschedule leftovers
  const startsByContact = {};
  for (const m of hs.meetings) {
    if (!m.startMs || m.outcome === 'CANCELED' || m.outcome === 'RESCHEDULED' || SKIP_TITLE.test(m.title) || !isDiscovery(m.title, ownerName(m.owner))) continue;
    for (const c of hs.meetingContacts[m.id] || []) (startsByContact[c] = startsByContact[c] || []).push(m.startMs);
  }
  const hasLaterMeeting = (contacts, startMs) => contacts.some((c) => (startsByContact[c] || []).some((t) => t > startMs + 60e3));

  const now = Date.now();
  const gByContact = {}; // HubSpot contact -> Granola notes matched to that contact's HubSpot meetings (commission proof)
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
    if (g) { g.used = true; for (const c of contacts) (gByContact[c] = gByContact[c] || []).push(g); }
    // Unrecorded meeting whose contact has a later meeting = reschedule leftover: ignore it
    if (!g && hasLaterMeeting(contacts, m.startMs)) continue;
    const country = countryFor(contacts);
    if (g) g.country = country;
    const postCallSent = sentAfter(pc, contacts, m.startMs);
    const date = dayIn(m.startMs, tzOf(rep));
    if (!g && !postCallSent) continue;                                   // neither recorded nor followed up: not a counted meeting
    meetings.push({
      id: m.id, date, rep, country, title: m.title, granola: !!g, durationMin: g ? g.durationMin : null, portal: g ? g.portal : false, postCallSent,
    });
  }
  // recorded Granola calls with no HubSpot meeting (e.g. ad-hoc) still count as recorded
  for (const list of Object.values(gBy)) for (const g of list) if (!g.used) {
    g.country = g.country || 'Unknown';
    meetings.push({ id: 'g' + g.id, date: g.date, rep: g.rep, country: 'Unknown', title: g.title, granola: true, durationMin: g.durationMin, portal: g.portal, postCallSent: false });
  }

  const dated = (x, msKey, dateKey) => ({ ...x, rep: ownerName(x.owner), [dateKey]: dayIn(x[msKey], tzOf(ownerName(x.owner))) || x[dateKey] });
  // a deal's country = its contact's country; the deal's own country field is only the fallback
  const deals = hs.deals.filter((d) => ownerName(d.owner)).map((d) => { const c = countryFor(d.contacts || []); return { ...dated(d, 'closedMs', 'closedDate'), country: c !== 'Unknown' ? c : d.country || 'Unknown' }; });
  const dealMoves = hs.dealMoves.filter((x) => ownerName(x.owner)).map((x) => dated(x, 'tsMs', 'date'));
  const openDeals = hs.openDeals.filter((x) => ownerName(x.owner)).map((x) => ({ ...x, rep: ownerName(x.owner) }));
  // claimedDate = the day the lead was assigned to its current owner (HubSpot 'Owner assigned date'), in the rep's own time zone
  const leads = hs.leads.filter((l) => ownerName(l.owner)).map((l) => { const x = dated(l, 'createdMs', 'date'); x.claimedDate = l.claimedMs ? dayIn(l.claimedMs, tzOf(x.rep)) : null; return x; });
  const tasks = hs.tasks.filter((t) => ownerName(t.owner)).map((t) => ({ ...t, rep: ownerName(t.owner) }));
  return { stages: hs.stages, dealMoves, openDeals, meetings, deals, leads, tasks, wins: verifyWins(hs, deals, granolaRows, nameOfGranola, gByContact), airtableLink: hs.airtableLink || "", granola: Object.values(gBy).flat().map(({ used, ...g }) => ({ ...g, country: g.country || 'Unknown' })) };
}

// ---- Commission proof: every Closed Won deal needs proof of conversation (Granola) AND proof of payment (Airtable) ----
// Conversation: a Granola note OWNED BY THE DEAL'S REP, with a transcript, where one of the deal's e-mails (deal e-mail,
//   contact e-mail / student e-mail / additional e-mails) is an attendee or calendar invitee - or a Granola note matched to
//   the rep's HubSpot meeting with the deal's contact. A call found only under another person is reported, not accepted.
// Payment: a record in the Airtable form-responses table with Follow Up Status = Client whose Student or Parent e-mail is one
//   of the deal's e-mails. One Airtable client can prove only one deal (a parent with two children = two records), so a
//   second deal claiming the same payment is flagged as a possible duplicate.
const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
function verifyWins(hs, deals, granolaRows, nameOfGranola, gByContact) {
  const clients = hs.clients || [];
  const cEmails = hs.contactEmails || {};
  // e-mail -> Granola notes (older cached notes have no e-mail list: read the e-mails out of the attendee text)
  const notesByEmail = {};
  for (const g of granolaRows) {
    const emails = g.emails || (String(g.attendees || '').match(EMAIL_RE) || []).map((e) => e.toLowerCase());
    for (const e of new Set(emails)) (notesByEmail[e] = notesByEmail[e] || []).push(g);
  }
  const hasTranscript = (g) => (g.transcript != null ? g.transcript : g.durationMin != null);
  const callOf = (g, via) => ({ link: g.link, date: g.date, startMs: g.startMs, title: String(g.title || '').trim(), transcript: hasTranscript(g), durationMin: g.durationMin, via });
  // e-mail -> Airtable clients
  const payByEmail = {};
  for (const c of clients) for (const [e, kind] of [[c.studentEmail, 's'], [c.parentEmail, 'p']]) if (e) (payByEmail[e] = payByEmail[e] || []).push({ c, kind });
  const usedPay = new Map(); // airtable id -> deal id
  const sorted = deals.slice().sort((a, b) => (a.closedMs || 0) - (b.closedMs || 0));
  const emailsOf = (d) => [...new Set([d.dealEmail, ...(d.contacts || []).flatMap((c) => cEmails[c] || [])].filter(Boolean))];
  // payment: first every deal whose e-mail is a client's STUDENT e-mail, then parent-e-mail matches for the rest
  // (so a parent-only match never takes the record a sibling's deal matches by student e-mail)
  const payOf = {};
  for (const kind of ['s', 'p']) for (const d of sorted) {
    if (payOf[d.id]) continue;
    const hit = emailsOf(d).flatMap((e) => payByEmail[e] || []).find((x) => x.kind === kind && !usedPay.has(x.c.id));
    if (hit) { usedPay.set(hit.c.id, d.id); payOf[d.id] = { ...hit.c, matchedOn: kind === 's' ? 'student e-mail' : 'parent e-mail' }; }
  }

  const out = [];
  for (const d of sorted) {
    const emails = emailsOf(d);

    // --- proof of conversation ---
    const mine = [], others = new Set();
    for (const e of emails) for (const g of notesByEmail[e] || []) {
      if (/@riseresearch\.com$/i.test(e)) continue; // never accept a match on a staff address
      if (nameOfGranola(g) === d.rep) mine.push(callOf(g, 'attendee e-mail')); else if (nameOfGranola(g)) others.add(nameOfGranola(g));
    }
    for (const c of d.contacts || []) for (const g of gByContact[c] || []) if (g.rep === d.rep) mine.push(callOf(g, 'HubSpot meeting'));
    // best call: one with a transcript, the last one before the close (else the first one after it)
    const before = (x) => !d.closedMs || x.startMs <= d.closedMs + 864e5;
    mine.sort((a, b) => (b.transcript - a.transcript) || (before(b) - before(a)) || (before(a) ? b.startMs - a.startMs : a.startMs - b.startMs));
    const call = mine[0] || null;
    // no proof: point at the rep's own call whose title names the client (e.g. joined from another e-mail) - NOT counted,
    // only shown so the rep can raise a discrepancy with it as proof
    let hint = null;
    const first = String(d.name || '').trim().split(/\s+/)[0] || '';
    if (!call && first.length >= 3) {
      const re = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const near = granolaRows.filter((g) => nameOfGranola(g) === d.rep && re.test(g.title || '') && (!d.closedMs || (g.startMs <= d.closedMs + 864e5 && g.startMs >= d.closedMs - 90 * 864e5)))
        .sort((a, b) => b.startMs - a.startMs)[0];
      if (near) hint = { link: near.link, date: near.date, title: String(near.title || '').replace(/\s+/g, ' ').trim(), emails: (near.emails || []).filter((e) => !/@riseresearch\.com$/i.test(e)) };
    }

    // --- proof of payment ---
    const pay = payOf[d.id] || null;
    const taken = pay ? null : emails.flatMap((e) => payByEmail[e] || []).find((x) => usedPay.has(x.c.id));
    const payTakenBy = taken ? usedPay.get(taken.c.id) : null;

    out.push({
      id: d.id, name: d.name || '', rep: d.rep, country: d.country, closedDate: d.closedDate, emails,
      call, callOtherRep: call ? [] : [...others], hint, pay, payTakenBy,
      link: hs.portalId ? `https://app.hubspot.com/contacts/${hs.portalId}/record/0-3/${d.id}` : '',
    });
  }
  return out;
}

module.exports = { build };
