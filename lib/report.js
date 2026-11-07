// Builds the daily and weekly email bodies (HTML) from a snapshot.
const { compute } = require('./views');
const { today, addDays } = require('./tz');

const table = (cols, rows) => `<table style="border-collapse:collapse;font:13px Arial,sans-serif">
<tr>${cols.map((c) => `<th style="border:1px solid #ccc;padding:4px 8px;background:#f1f3f5;text-align:left">${c}</th>`).join('')}</tr>
${rows.map((r) => `<tr style="${r['Team Member'] === 'Team' ? 'font-weight:bold;background:#fafafa' : ''}">${cols.map((c) => `<td style="border:1px solid #ccc;padding:4px 8px;text-align:${c === 'Team Member' ? 'left' : 'right'}">${r[c]}</td>`).join('')}</tr>`).join('')}</table>`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const monthName = (d) => new Date(d + 'T12:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
const longDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// Daily: one short block per rep, exactly:
//   <Rep>:
//   - <Month> Closed Won: <count this month so far; starts again each month>
//   - Overdue Tasks: <tasks overdue right now>
//   - Meetings taken on <yesterday's date>: <count>
// Meetings count only if recorded on Granola OR the post-call sequence was sent.
function daily(data, asOf = today()) {
  const day = addDays(asOf, -1);
  const month = monthName(asOf);
  const mtd = compute(data, asOf.slice(0, 8) + '01', asOf, asOf, '').metrics;  // month-to-date Closed Won, overdue now
  const yday = compute(data, day, day, asOf, '').metrics;                      // meetings taken the day before
  const people = mtd.filter((m) => m['Team Member'] !== 'Team').map((m) => ({
    name: m['Team Member'],
    won: m['Closed Won'],
    overdue: m['Overdue Tasks'],
    meetings: (yday.find((y) => y['Team Member'] === m['Team Member']) || {})['Meetings Taken'] || 0,
  }));
  const label = [`${month} Closed Won`, 'Overdue Tasks', `Meetings taken on ${longDate(day)}`];
  const html = `<div style="font:14px/1.6 Arial,sans-serif;color:#111">${people.map((p) => `<p style="margin:0 0 4px"><b>${esc(p.name)}:</b></p>
<ul style="margin:0 0 16px;padding-left:20px"><li>${label[0]}: ${p.won}</li><li>${label[1]}: ${p.overdue}</li><li>${label[2]}: ${p.meetings}</li></ul>`).join('\n')}</div>`;
  const text = people.map((p) => `${p.name}:\n- ${label[0]}: ${p.won}\n- ${label[1]}: ${p.overdue}\n- ${label[2]}: ${p.meetings}`).join('\n\n');
  return { subject: `Sales daily report – ${longDate(day)}`, html, text };
}

// Weekly: the 7 full days before the send date (sent Sunday morning -> previous Sunday..Saturday).
function weekly(data, asOf = today()) {
  const to = addDays(asOf, -1), from = addDays(asOf, -7);
  const r = compute(data, from, to, asOf, '');
  const cols = ['Team Member', 'Closed Won', 'Meetings Taken', 'Contacts', 'Booked Call', 'Lead-to-Meeting %', 'Close Rate (of meetings)', 'Close Rate (of contacts)', 'Post-Call Sent', 'Post-Call Pending'];
  return {
    subject: `Sales weekly report – ${from} to ${to}`,
    html: `<p>Weekly sales performance, <b>${from}</b> to <b>${to}</b>. Individual and team totals.</p>${table(cols, r.metrics)}
<p style="color:#666;font:12px Arial">Meetings are counted only if recorded on Granola or the post-call sequence was sent through HubSpot.</p>`,
  };
}

module.exports = { daily, weekly };
