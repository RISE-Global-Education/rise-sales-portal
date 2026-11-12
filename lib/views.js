// Computes the four tabs that replicate the sales spreadsheet, for a date range (+ optional rep).
// Input is the output of lib/build.js.
// Only people on the roster in lib/config.js are shown (this also leaves out managers and Granola-only people).
const { REPS, ROSTER, GROUPS, COMMISSION } = require('./config');
const inR = (d, from, to) => d && d >= from && d <= to;
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 + '%' : '—');
const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : '—');
// Tasks that are overdue RIGHT NOW: not completed and past their due time (HubSpot's own live is_overdue rule).
// Pending, created and completed tasks are deliberately not reported.
const overdueNow = (tasks) => { const now = Date.now(); let n = 0; for (const t of tasks) if (t.doneMs == null && t.dueMs < now) n++; return n; };
const taken = (m) => m.granola || m.postCallSent; // meeting counts if on Granola OR post-call sequence sent

function compute(all, from, to, today, rep, opts = {}) {
  // opts.overdue = { repName: count } from a live HubSpot query; falls back to the saved tasks when absent
  const ov = (name, list) => (opts.overdue ? opts.overdue[name] || 0 : overdueNow(list));
  // Filters. rep = '' | 'Name' | 'Team USA' | 'A|B|Team ROW' (several people and/or regions); opts.country = 'United States|India' (lead country)
  const tokens = String(rep || '').split('|').map((t) => t.trim()).filter(Boolean);
  const selNames = tokens.length ? new Set(tokens.flatMap((t) => { const g = GROUPS.find((x) => x.name === t); return g ? g.members : [t]; })) : null;
  const selGroups = new Set(tokens.filter((t) => GROUPS.some((g) => g.name === t)));
  const inSel = (name) => !selNames || selNames.has(name);
  const ok = (x) => inSel(x.rep);
  const cs = opts.country ? new Set(String(opts.country).split('|').map((c) => c.trim()).filter(Boolean)) : null;
  const cOk = (x) => !cs || cs.has(x.country || 'Unknown'); // tasks have no country, so they are never filtered by it
  const keep = (x) => ROSTER.has(x.rep);
  const kc = (x) => keep(x) && cOk(x);
  const data = { meetings: all.meetings.filter(kc), deals: all.deals.filter(kc), tasks: all.tasks.filter(keep), leads: (all.leads || []).filter(kc), stages: all.stages || [], dealMoves: (all.dealMoves || []).filter(kc), openDeals: (all.openDeals || []).filter(kc), granola: all.granola.filter(kc) };
  // every country seen on leads (for the filter list), most contacts first
  const cc = {}; for (const l of all.leads || []) if (keep(l)) cc[l.country || 'Unknown'] = (cc[l.country || 'Unknown'] || 0) + 1;
  const countries = Object.entries(cc).sort((a, b) => (a[0] === 'Unknown') - (b[0] === 'Unknown') || b[1] - a[1]).map(([name, n]) => ({ name, n }));
  const meetings = data.meetings.filter((m) => ok(m) && inR(m.date, from, to));
  const granola = data.granola.filter((g) => ok(g) && inR(g.date, from, to));
  const deals = data.deals.filter((d) => ok(d) && inR(d.closedDate, from, to));
  const repTasks = (r) => data.tasks.filter((t) => t.rep === r);
  // Everyone on the roster is always listed (a new rep with no meetings yet still appears, with zeros)
  const reps = REPS.map((r) => r.name).sort();

  // Daily Tracker: one row per date + person with activity
  const key = (d, r) => d + '|' + r, rows = {};
  const row = (d, r) => (rows[key(d, r)] = rows[key(d, r)] || { Date: d, Person: r, tk: 0, rec: 0, pc: 0 });
  for (const m of meetings) {
    if (!taken(m)) continue;
    const x = row(m.date, m.rep);
    if (taken(m)) x.tk++;
    if (m.granola) { x.rec++; if (m.postCallSent) x.pc++; }
  }
  const daily = Object.values(rows).sort((a, b) => (a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : a.Person.localeCompare(b.Person))).map((x) => ({
    Date: x.Date,
    Person: x.Person,
    'No of Meets Taken': x.tk,
    'Granola Recorded': x.tk ? (x.rec >= x.tk ? 'Yes' : 'No') : 'NA',
    'Post-Call Sequence Sent': x.rec ? (x.pc >= x.rec ? 'Yes' : 'No') : 'NA',
  }));

  // Compliance Score Monitor. (The sheet computes the Granola / Post-Call percentages per DAY from hand-typed Yes/No cells;
  // here they are per MEETING, which is stricter-by-detail but closer to the sheet's numbers than a strict all-meetings-that-day rule.)
  const compliance = reps.filter(inSel).map((r) => {
    const mm = meetings.filter((m) => m.rep === r), gg = granola.filter((g) => g.rep === r);
    const tk = mm.filter(taken), rec = mm.filter((m) => m.granola);
    const dur = gg.map((g) => g.durationMin).filter((x) => x != null);
    const won = deals.filter((d) => d.rep === r).length;
    const rt = repTasks(r);
    return {
      'Team Member': r,
      'Overdue Tasks': ov(r, rt),
      'Granola Compliance': pct(rec.length, tk.length),
      'Post-Call Compliance': pct(rec.filter((m) => m.postCallSent).length, rec.length),
      'Portal Compliance': pct(gg.filter((g) => g.portal).length, gg.length),
      '20 Min Duration Compliance': pct(dur.filter((d) => d >= 20).length, dur.length),
      'Average Call Duration': avg(dur),
      'Deals Closed': won,
      'Total Meetings Taken': tk.length,
      'Conversion Rate': pct(won, tk.length),
    };
  });

  // Dashboard (Granola meeting compliance)
  const d20 = granola.filter((g) => g.durationMin != null && g.durationMin >= 20).length;
  const dashboard = [
    ['Total Meetings', granola.length],
    ['Meetings 20+ Minutes', d20],
    ['Meetings Under 20 Minutes', granola.filter((g) => g.durationMin != null && g.durationMin < 20).length],
    ['20+ Minute Compliance', pct(d20, granola.length)],
    ['Portal Mentioned', granola.filter((g) => g.portal).length],
    ['Portal Not Mentioned', granola.filter((g) => !g.portal).length],
  ];

  // Meeting Tracker (Granola notes)
  const tracker = granola.slice().sort((a, b) => b.startMs - a.startMs).map((g) => ({
    Date: g.date, Meeting: g.title, Owner: g.rep, Attendees: g.attendees,
    'Scheduled Duration (min)': g.scheduledMin ?? '', 'Actual Transcript Duration (min)': g.durationMin ?? '',
    '20+ Minutes?': g.durationMin == null ? '' : g.durationMin >= 20 ? 'Yes' : 'No',
    'Portal Mentioned?': g.portal ? 'Yes' : 'No', 'Granola Note': g.link, Summary: g.summary,
  }));

  // Metrics Summary: every metric from the spec, per rep + team, for the selected range
  const summary = (label, pred, rt) => {
    const mm = data.meetings.filter((m) => pred(m) && inR(m.date, from, to));
    const gg = data.granola.filter((g) => pred(g) && inR(g.date, from, to));
    const dl = data.deals.filter((d) => pred(d) && inR(d.closedDate, from, to));
    const ld = data.leads.filter((l) => pred(l) && inR(l.date, from, to));
    const taken_ = mm.filter(taken), rec = mm.filter((m) => m.granola);
    const dur = gg.map((g) => g.durationMin).filter((x) => x != null);
    const booked = ld.filter((l) => l.booked).length;
    const mLd = ld.filter((l) => l.meta), mBooked = mLd.filter((l) => l.booked).length, oBooked = booked - mBooked;
    return {
      'Team Member': label,
      'Closed Won': dl.length,
      'Meetings Taken': taken_.length,
      'Contacts': ld.length,
      'Leads Claimed': data.leads.filter((l) => pred(l) && inR(l.claimedDate, from, to)).length,
      'Booked Call': booked,
      'Lead-to-Meeting %': pct(booked, ld.length),
      'Meta Contacts': mLd.length,
      'Meta Booked Call': mBooked,
      'Meta Lead-to-Meeting %': pct(mBooked, mLd.length),
      'Other Contacts': ld.length - mLd.length,
      'Other Booked Call': oBooked,
      'Other Lead-to-Meeting %': pct(oBooked, ld.length - mLd.length),
      'Close Rate (of meetings)': pct(dl.length, taken_.length),
      'Close Rate (of contacts)': pct(dl.length, ld.length),
      'Post-Call Sent': rec.filter((m) => m.postCallSent).length,
      'Post-Call Pending': rec.filter((m) => !m.postCallSent).length,
      'Overdue Tasks': rt ? ov(label, rt) : 0,
      'Portal Mentioned': gg.filter((g) => g.portal).length,
      'Avg Duration (min)': avg(dur),
    };
  };
  const team = summary('Team', ok); // 'Team' = everyone currently selected
  const allRepRows = reps.map((r) => summary(r, (x) => x.rep === r, repTasks(r)));
  team['Overdue Tasks'] = allRepRows.filter((x) => inSel(x['Team Member'])).reduce((a, x) => a + x['Overdue Tasks'], 0); // team = sum of the reps shown
  // regional subtotals: sum / recompute from the members' data
  const groupRows = GROUPS.map((g) => {
    const r = summary(g.name, (x) => g.members.includes(x.rep));
    r['Overdue Tasks'] = allRepRows.filter((x) => g.members.includes(x['Team Member'])).reduce((a, x) => a + x['Overdue Tasks'], 0);
    return r;
  });
  const metrics = [...allRepRows.filter((x) => inSel(x['Team Member'])), ...groupRows.filter((x) => !selNames || selGroups.has(x['Team Member'])), team];

  // Deal Pipeline: deals that moved INTO each stage in the range, plus deals currently open in each stage
  const moves = data.dealMoves.filter((m) => inR(m.date, from, to));
  const openStages = data.stages.filter((st) => !/closed/i.test(st.label));
  const pipe = (label, pred) => ({
    'Team Member': label,
    ...Object.fromEntries(data.stages.map((st) => ['Moved to ' + st.label, moves.filter((m) => pred(m) && m.stage === st.id).length])),
    ...Object.fromEntries(openStages.map((st) => ['Open now: ' + st.label, data.openDeals.filter((d) => pred(d) && d.stage === st.id).length])),
  });
  const pipeline = [...reps.filter(inSel).map((r) => pipe(r, (x) => x.rep === r)), pipe('Team', ok)];

  const { verify, commission, disputes, unverified, verified, rules } = commissionViews(all, from, to, inSel, cOk, opts.disputes || []);

  return { range: [from, to], targets: require('./config').TARGETS, reps, groups: GROUPS.map((g) => g.name), countries, compliance, dashboard, daily, tracker, metrics, pipeline, verify, commission, disputes, unverified, verified, rules, airtableLink: all.airtableLink || '' };
}

// ---------------- Closed Won Check + Commission Calculator + Discrepancies ----------------
// A win is VERIFIED when it has proof of conversation (the rep's own Granola note with the client, with a transcript)
// AND proof of payment (Airtable Follow Up Status = Client), or when a manager set a discrepancy raised for it to Accepted (in Airtable).
const month = (d) => (d ? d.slice(0, 7) : null);
const monthsIn = (from, to) => {
  const out = []; let [y, m] = from.slice(0, 7).split('-').map(Number); const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  return out;
};
// marginal tiers: tiers = [{upTo, rate}], e.g. 45 students with [30@$0, 60@$50, ...] = 30*0 + 15*50 = $750
const tierPay = (n, tiers) => { let prev = 0, sum = 0; for (const t of tiers) { sum += Math.max(0, Math.min(n, t.upTo) - prev) * t.rate; prev = t.upTo; if (n <= t.upTo) break; } return sum; };
const ruleText = (r) => (r.tiers ? 'Per student, marginal: 1-30 $0, 31-60 $50, 61-90 $75, 91+ $100'
  : r.perMeeting ? `$${r.perClient.Direct} per client + $${r.perMeeting} per meeting taken`
  : `Counsellor ₹${r.perClient.Counsellor.toLocaleString('en-IN')} · Direct ₹${r.perClient.Direct.toLocaleString('en-IN')} per client`);

function classify(w, accepted) {
  const call = !!w.call, tr = !!(w.call && w.call.transcript), pay = !!w.pay;
  if (call && tr && pay) return 'Verified';
  if (accepted) return 'Accepted (discrepancy)';
  const miss = [];
  if (!call) miss.push('call'); else if (!tr) miss.push('transcript');
  if (!pay) miss.push(w.payTakenBy ? 'payment (duplicate)' : 'payment');
  return 'Missing ' + miss.join(' + ');
}

function commissionViews(all, from, to, inSel, cOk, disputeList) {
  const wins = (all.wins || []).filter((w) => ROSTER.has(w.rep)).map((w) => ({ ...w }));
  const byId = Object.fromEntries(wins.map((w) => [w.id, w]));
  const accepted = new Set(disputeList.filter((d) => d.status === 'accepted' && d.dealId).map((d) => d.dealId));
  for (const w of wins) {
    w.status = classify(w, accepted.has(w.id));
    w.ok = w.status === 'Verified' || w.status === 'Accepted (discrepancy)';
    // a win's date everywhere in the commission views = its Airtable Client Date; a deal with no Airtable client record
    // (so no Client Date, and never verified by payment) falls back to its HubSpot close date
    w.date = (w.pay && w.pay.clientDate) || w.closedDate;
    w.month = month(w.date);
  }

  // Closed Won Check: every Closed Won deal closed in the selected dates, with its two proofs
  const newestFirst = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const toRow = (w) => {
      const notes = [];
      if (w.call) notes.push(`Call ${w.call.date || ''} (${w.call.via}${w.call.durationMin != null ? ', ' + w.call.durationMin + ' min' : ''})`);
      else if (w.callOtherRep.length) notes.push('Call found only under ' + w.callOtherRep.join(', '));
      if (!w.call && w.hint) notes.push(`Possible call (not counted, different e-mail): “${w.hint.title}” ${w.hint.date || ''}${w.hint.emails.length ? ' with ' + w.hint.emails.join(', ') : ''}`);
      if (w.pay) notes.push(`Paid: ${w.pay.name || 'client'} (${w.pay.matchedOn}${w.pay.counselor ? ', ' + w.pay.counselor : ''})`);
      else if (w.payTakenBy) { const o = byId[w.payTakenBy]; notes.push(`Payment record already proves ${o ? o.name + ' (' + o.rep + ')' : 'deal ' + w.payTakenBy}: possible duplicate deal`); }
      if (!w.pay) notes.push('No Airtable Client Date: dated by the HubSpot close date');
      if (!w.emails.length) notes.push('Deal has no e-mail in HubSpot');
      else if (!w.pay || !w.call) notes.push('E-mails checked: ' + w.emails.join(', '));
      return {
        Date: w.date, 'Team Member': w.rep, Client: w.name,
        'Call Proof': w.call ? 'Yes' : 'No', Transcript: w.call ? (w.call.transcript ? 'Yes' : 'No') : 'NA', 'Granola Note': w.call ? w.call.link : '',
        'Possible Call': !w.call && w.hint ? w.hint.link : '',
        'Payment Proof': w.pay ? 'Yes' : 'No', 'HubSpot Closed': w.closedDate, Source: w.pay ? w.pay.source : '—',
        Status: w.status, Details: notes.join(' · '), HubSpot: w.link, Discrepancy: w.id,
      };
    };
  const verify = wins.filter((w) => inSel(w.rep) && cOk(w) && inR(w.date, from, to)).sort(newestFirst).map(toRow);

  // Commission Calculator: one row per rep per calendar month touched by the selected dates (resets every month).
  // Ignores the Lead country filter: commission is per person.
  const known = wins.map((w) => w.month).filter(Boolean).sort();
  // a long range (e.g. "All time") starts at the first month with a win instead of listing empty years
  const start = monthsIn(from, to).length > 12 && known.length && from < known[0] ? known[0] + '-01' : from;
  const months = start <= to ? monthsIn(start, to) : [];
  const meetings = all.meetings.filter((m) => ROSTER.has(m.rep) && (m.granola || m.postCallSent)); // = "Meetings Taken"
  const commission = [], tot = {};
  const unverified = {}; // 'YYYY-MM|Rep' -> the unverified deals behind that row's count (opened from the eye icon)
  const verified = {};   // 'YYYY-MM|Rep' -> the verified deals behind 'Verified Wins', with what each one pays
  const rate = (t, i) => (t.find((x) => i <= x.upTo) || { rate: 0 }).rate; // tier rate of the i-th student
  for (const mo of months.slice().reverse()) for (const rep of REPS.map((r) => r.name).sort()) {
    const r = COMMISSION[rep];
    if (!r || !inSel(rep)) continue;
    const ok = wins.filter((w) => w.rep === rep && w.month === mo && w.ok)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const src = (w) => (w.pay ? w.pay.source : 'Counsellor'); // accepted without a payment record: the lower (counsellor) rate
    const nC = ok.filter((w) => src(w) === 'Counsellor').length, nD = ok.length - nC;
    const nMeet = r.perMeeting ? meetings.filter((m) => m.rep === rep && month(m.date) === mo).length : null;
    const amount = r.tiers ? tierPay(ok.length, r.tiers) : nC * r.perClient.Counsellor + nD * r.perClient.Direct + (r.perMeeting ? nMeet * r.perMeeting : 0);
    const split = !r.tiers && !r.perMeeting;
    // per-deal payout, in Client Date order (for the tiers: the n-th verified student of the month)
    const fmtAmt = (n) => (r.currency === 'INR' ? '₹' + n.toLocaleString('en-IN') : '$' + n.toLocaleString('en-US'));
    if (ok.length) verified[mo + '|' + rep] = ok.map((w, i) => ({
      ...toRow(w),
      Pays: r.tiers ? `Student #${i + 1} of ${ok.length} this month: ${fmtAmt(rate(r.tiers, i + 1))}`
        : `${fmtAmt(r.perClient[src(w)])}${split ? ' (' + src(w) + (w.pay ? '' : ', no payment record: counsellor rate') + ')' : ' per client'}`,
    }));
    commission.push({
      Month: mo, 'Team Member': rep, 'Verified Wins': ok.length,
      'Unverified Wins': (unverified[mo + '|' + rep] = wins.filter((w) => w.rep === rep && !w.ok && w.month === mo).sort(newestFirst).map(toRow)).length,
      Counsellor: split ? nC : '—', Direct: split ? nD : '—',
      'Meetings Taken': nMeet == null ? '—' : nMeet, Commission: amount, Currency: r.currency,
      'Open Discrepancies': disputeList.filter((d) => d.status === 'open' && d.rep === rep && (!d.dealId || !byId[d.dealId] || byId[d.dealId].month === mo)).length,
    });
    tot[r.currency] = (tot[r.currency] || 0) + amount;
  }
  for (const [cur, v] of Object.entries(tot)) commission.push({ Month: '', 'Team Member': `Team (${cur})`, 'Verified Wins': '', 'Unverified Wins': '', Counsellor: '', Direct: '', 'Meetings Taken': '', Commission: v, Currency: cur, 'Open Discrepancies': '' });

  // Discrepancies raised on the portal (open first, then newest first)
  const disputes = disputeList.filter((d) => !d.rep || inSel(d.rep))
    .sort((a, b) => ((a.status === 'open') !== (b.status === 'open') ? (a.status === 'open' ? -1 : 1) : a.at < b.at ? 1 : -1))
    .map((d) => ({
      Raised: d.at.slice(0, 10), 'Team Member': d.rep || '—', Client: d.dealId && byId[d.dealId] ? byId[d.dealId].name : d.client, Reason: d.reason, Details: d.details,
      Proof: d.link || '', 'Raised By': d.raisedBy, Status: d.status === 'open' ? 'Open' : d.status === 'accepted' ? 'Accepted' : 'Rejected',
      Resolution: d.status === 'open' ? '' : `${d.resolvedBy || ''}${d.note ? ': ' + d.note : ''}`,
      Comments: (d.comments || []).length, Files: (d.attachments || []).length + (d.comments || []).reduce((a, c) => a + (c.attachments || []).length, 0),
      Thread: d.id,
    }));
  for (const k of Object.keys(unverified)) if (!unverified[k].length) delete unverified[k];
  // each rep's rule in words (shown at the top of their Verified Wins dialog, not as a table column)
  const rules = Object.fromEntries(Object.entries(COMMISSION).map(([rep, r]) => [rep, ruleText(r)]));
  return { verify, commission, disputes, unverified, verified, rules };
}

module.exports = { compute, tierPay };
