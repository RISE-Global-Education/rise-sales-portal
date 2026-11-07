// Computes the four tabs that replicate the sales spreadsheet, for a date range (+ optional rep).
// Input is the output of lib/build.js.
// People excluded everywhere: Granola-only people, plus Yash and Shreyans (managers; the sheet also leaves them out of its rep table).
// Edit this list to change.
const HIDDEN = new Set(['Alina Mathew', 'Anoushka Shaha', 'Sanya Mundhra', 'Shubhvi Jindal', 'Yash Mundada', 'Shreyans Lodha']);
const tz = require('./tz');
const inR = (d, from, to) => d && d >= from && d <= to;
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 + '%' : '—');
const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : '—');
// Overdue count at a moment: created by then, due before it, and not completed by then (HubSpot's own is_overdue rule, replayed in time).
const overdueAt = (tasks, ms) => { let n = 0; for (const t of tasks) if (t.createdMs <= ms && t.dueMs < ms && (t.doneMs == null || t.doneMs > ms)) n++; return n; };
const endOf = (d) => Math.min(tz.dayEndMs(d), Date.now());
const taken = (m) => m.granola || m.postCallSent; // meeting counts if on Granola OR post-call sequence sent

function compute(all, from, to, today, rep) {
  const keep = (x) => !HIDDEN.has(x.rep);
  const data = { meetings: all.meetings.filter(keep), deals: all.deals.filter(keep), tasks: all.tasks.filter(keep), noshowSeq: all.noshowSeq.filter(keep), leads: (all.leads || []).filter(keep), stages: all.stages || [], dealMoves: (all.dealMoves || []).filter(keep), openDeals: (all.openDeals || []).filter(keep), granola: all.granola.filter(keep) };
  const ok = (x) => !rep || x.rep === rep;
  const meetings = data.meetings.filter((m) => ok(m) && inR(m.date, from, to));
  const granola = data.granola.filter((g) => ok(g) && inR(g.date, from, to));
  const deals = data.deals.filter((d) => ok(d) && inR(d.closedDate, from, to));
  const nsSeq = data.noshowSeq.filter((s) => ok(s) && inR(s.date, from, to));
  const tasks = data.tasks.filter(ok);
  // Average overdue per day across the range (the sheet averages its daily overdue entries the same way)
  const firstTask = data.tasks.reduce((m, t) => (t.createdDate && t.createdDate < m ? t.createdDate : m), today);
  const avgOverdue = (list) => {
    let a = from < firstTask ? firstTask : from; const b = to > today ? today : to, vals = [];
    for (; a <= b; a = tz.addDays(a, 1)) vals.push(overdueAt(list, endOf(a)));
    return vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : 0;
  };
  const repTasks = (r) => data.tasks.filter((t) => t.rep === r);
  // Sidebar: only reps with a meeting or Granola note in the last 60 days (hides inactive people)
  const cutoff = new Date(new Date(today).getTime() - 60 * 864e5).toISOString().slice(0, 10);
  const reps = [...new Set([...data.meetings, ...data.granola].filter((x) => x.date >= cutoff).map((x) => x.rep))].filter(Boolean).sort();
  // Compliance rows: anyone with activity in the selected range
  const active = new Set([...meetings, ...granola, ...deals].map((x) => x.rep));

  // Daily Tracker: one row per date + person with activity
  const key = (d, r) => d + '|' + r, rows = {};
  const row = (d, r) => (rows[key(d, r)] = rows[key(d, r)] || { Date: d, Person: r, tk: 0, rec: 0, pc: 0, ns: 0, nsSent: 0 });
  for (const m of meetings) {
    const x = row(m.date, m.rep);
    if (taken(m)) x.tk++;
    if (m.granola) { x.rec++; if (m.postCallSent) x.pc++; } else x.ns++;
  }
  for (const s of nsSeq) if (s.sent) row(s.date, s.rep).nsSent++;
  const daily = Object.values(rows).sort((a, b) => (a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : a.Person.localeCompare(b.Person))).map((x) => ({
    Date: x.Date,
    Person: x.Person,
    'No of Meets Taken': x.tk,
    'Overdue Tasks (Count)': overdueAt(repTasks(x.Person), endOf(x.Date)),
    'Granola Recorded': x.tk ? (x.rec >= x.tk ? 'Yes' : 'No') : 'NA',
    'Post-Call Sequence Sent': x.rec ? (x.pc >= x.rec ? 'Yes' : 'No') : 'NA',
    'No-Shows (Count)': x.ns,
    'No-Show Template Sent': x.ns ? (x.nsSent >= x.ns ? 'Yes' : 'No') : 'NA',
  }));

  // Compliance Score Monitor. (The sheet computes the Granola / Post-Call / No-Show-Sequence percentages per DAY from hand-typed Yes/No cells;
  // here they are per MEETING, which is stricter-by-detail but closer to the sheet's numbers than a strict all-meetings-that-day rule.)
  const compliance = [...new Set([...reps, ...active])].sort().filter((r) => active.has(r) && (!rep || r === rep)).map((r) => {
    const mm = meetings.filter((m) => m.rep === r), gg = granola.filter((g) => g.rep === r);
    const tk = mm.filter(taken), rec = mm.filter((m) => m.granola), ns = mm.filter((m) => !m.granola);
    const nsSent = nsSeq.filter((s) => s.rep === r && s.sent).length;
    const dur = gg.map((g) => g.durationMin).filter((x) => x != null);
    const won = deals.filter((d) => d.rep === r).length;
    const rt = repTasks(r);
    return {
      'Team Member': r,
      'Avg Overdue Tasks': Math.round(avgOverdue(rt) * 10) / 10,
      'Total No-Shows': ns.length,
      'Granola Compliance': pct(rec.length, tk.length),
      'Post-Call Compliance': pct(rec.filter((m) => m.postCallSent).length, rec.length),
      'No-Show Sequence Compliance': ns.length ? pct(nsSent, ns.length) : '—',
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
    const ns = data.noshowSeq.filter((x) => pred(x) && inR(x.date, from, to));
    const tk = data.tasks.filter((t) => pred(t) && inR(t.createdDate, from, to));
    const taken_ = mm.filter(taken), rec = mm.filter((m) => m.granola);
    const dur = gg.map((g) => g.durationMin).filter((x) => x != null);
    const completed = tk.filter((t) => t.completedDate).length;
    const overdue = tk.filter((t) => !t.completedDate && t.dueDate < today).length;
    const booked = ld.filter((l) => l.booked).length;
    return {
      'Team Member': label,
      'Closed Won': dl.length,
      'Meetings Taken': taken_.length,
      'Contacts': ld.length,
      'Booked Call': booked,
      'Lead-to-Meeting %': pct(booked, ld.length),
      'Close Rate (of meetings)': pct(dl.length, taken_.length),
      'Close Rate (of contacts)': pct(dl.length, ld.length),
      'No-Shows': mm.length - rec.length,
      'No-Show Seq Sent': ns.filter((x) => x.sent).length,
      'Post-Call Sent': rec.filter((m) => m.postCallSent).length,
      'Post-Call Pending': rec.filter((m) => !m.postCallSent).length,
      'Tasks Created': tk.length,
      'Tasks Completed': completed,
      'Tasks Pending': tk.length - completed - overdue,
      'Tasks Overdue': overdue,
      'Overdue at End of Range': rt ? overdueAt(rt, endOf(to > today ? today : to)) : 0,
      'Avg Overdue Tasks': rt ? Math.round(avgOverdue(rt) * 10) / 10 : 0,
      'Portal Mentioned': gg.filter((g) => g.portal).length,
      'Avg Duration (min)': avg(dur),
    };
  };
  const team = summary('Team', () => true);
  const allRepRows = reps.map((r) => summary(r, (x) => x.rep === r, repTasks(r)));
  for (const k of ['Overdue at End of Range', 'Avg Overdue Tasks']) team[k] = Math.round(allRepRows.reduce((a, x) => a + x[k], 0) * 10) / 10; // team = sum of reps
  const metrics = [...allRepRows.filter((x) => !rep || x['Team Member'] === rep), team];

  // Deal Pipeline: deals that moved INTO each stage in the range, plus deals currently open in each stage
  const moves = data.dealMoves.filter((m) => inR(m.date, from, to));
  const openStages = data.stages.filter((st) => !/closed/i.test(st.label));
  const pipe = (label, pred) => ({
    'Team Member': label,
    ...Object.fromEntries(data.stages.map((st) => ['Moved to ' + st.label, moves.filter((m) => pred(m) && m.stage === st.id).length])),
    ...Object.fromEntries(openStages.map((st) => ['Open now: ' + st.label, data.openDeals.filter((d) => pred(d) && d.stage === st.id).length])),
  });
  const pipeline = [...reps.filter((r) => !rep || r === rep).map((r) => pipe(r, (x) => x.rep === r)), pipe('Team', () => true)];

  return { range: [from, to], targets: require('./config').TARGETS, reps, compliance, dashboard, daily, tracker, metrics, pipeline };
}

module.exports = { compute };
