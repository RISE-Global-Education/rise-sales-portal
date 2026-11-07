// Builds the daily and weekly email bodies (HTML) from a snapshot.
const { compute } = require('./views');
const { today, addDays } = require('./tz');

const table = (cols, rows) => `<table style="border-collapse:collapse;font:13px Arial,sans-serif">
<tr>${cols.map((c) => `<th style="border:1px solid #ccc;padding:4px 8px;background:#f1f3f5;text-align:left">${c}</th>`).join('')}</tr>
${rows.map((r) => `<tr style="${r['Team Member'] === 'Team' ? 'font-weight:bold;background:#fafafa' : ''}">${cols.map((c) => `<td style="border:1px solid #ccc;padding:4px 8px;text-align:${c === 'Team Member' ? 'left' : 'right'}">${r[c]}</td>`).join('')}</tr>`).join('')}</table>`;

// Recorded meetings (call happened) from the last `days` days up to `to` whose post-call sequence has not gone out yet.
function pendingFollowups(data, to, days = 7) {
  const from = addDays(to, -(days - 1));
  const vis = new Set(compute(data, from, to, to, '').reps);
  return data.meetings.filter((m) => m.granola && !m.postCallSent && m.date >= from && m.date <= to && vis.has(m.rep))
    .sort((a, b) => a.rep.localeCompare(b.rep) || (a.date < b.date ? 1 : -1));
}

// Daily: previous date, one row per rep. Meetings count only if on Granola OR post-call sequence sent.
function daily(data, asOf = today()) {
  const day = addDays(asOf, -1);
  const r = compute(data, day, day, asOf, '');
  const pend = pendingFollowups(data, day);
  const backlog = {};
  pend.forEach((m) => (backlog[m.rep] = (backlog[m.rep] || 0) + 1));
  const rows = r.metrics.map((m) => ({
    'Team Member': m['Team Member'], 'Closed Won': m['Closed Won'], 'Meetings Taken': m['Meetings Taken'],
    'Post-Call Sent': m['Post-Call Sent'], 'Post-Call Pending': m['Post-Call Pending'],
    'Pending (last 7 days)': m['Team Member'] === 'Team' ? pend.length : backlog[m['Team Member']] || 0,
  }));
  const MAX = 60;
  const list = pend.length
    ? `<h3 style="font:bold 14px Arial">Pending follow-ups (post-call sequence not sent, last 7 days)</h3>
<table style="border-collapse:collapse;font:13px Arial,sans-serif"><tr>${['Team Member', 'Date', 'Meeting'].map((c) => `<th style="border:1px solid #ccc;padding:4px 8px;background:#f1f3f5;text-align:left">${c}</th>`).join('')}</tr>
${pend.slice(0, MAX).map((m) => `<tr><td style="border:1px solid #ccc;padding:4px 8px">${m.rep}</td><td style="border:1px solid #ccc;padding:4px 8px">${m.date}</td><td style="border:1px solid #ccc;padding:4px 8px">${(m.title || '').replace(/\s+/g, ' ').trim().replace(/</g, '&lt;')}</td></tr>`).join('')}</table>${pend.length > MAX ? `<p style="font:12px Arial;color:#666">…and ${pend.length - MAX} more.</p>` : ''}`
    : '<p style="font:13px Arial">No pending follow-ups in the last 7 days.</p>';
  return {
    subject: `Sales daily report – ${day}`,
    html: `<p>Daily sales performance for <b>${day}</b>.</p>${table(['Team Member', 'Closed Won', 'Meetings Taken', 'Post-Call Sent', 'Post-Call Pending', 'Pending (last 7 days)'], rows)}${list}
<p style="color:#666;font:12px Arial">Meetings are counted only if recorded on Granola or the post-call sequence was sent through HubSpot. "Pending" = recorded calls with no post-call sequence sent yet.</p>`,
  };
}

// Weekly: the 7 full days before the send date (sent Sunday morning -> previous Sunday..Saturday).
function weekly(data, asOf = today()) {
  const to = addDays(asOf, -1), from = addDays(asOf, -7);
  const r = compute(data, from, to, asOf, '');
  const cols = ['Team Member', 'Closed Won', 'Meetings Taken', 'Contacts', 'Booked Call', 'Lead-to-Meeting %', 'Close Rate (of meetings)', 'Close Rate (of contacts)', 'No-Shows', 'No-Show Seq Sent', 'Post-Call Sent', 'Post-Call Pending'];
  return {
    subject: `Sales weekly report – ${from} to ${to}`,
    html: `<p>Weekly sales performance, <b>${from}</b> to <b>${to}</b>. Individual and team totals.</p>${table(cols, r.metrics)}
<p style="color:#666;font:12px Arial">Meetings are counted only if recorded on Granola or the post-call sequence was sent through HubSpot. A meeting with no Granola transcript is a no-show.</p>`,
  };
}

module.exports = { daily, weekly };
