// Builds the daily and weekly email bodies (HTML) from a snapshot.
const { compute } = require('./views');
const { today, addDays } = require('./tz');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const monthName = (d) => new Date(d + 'T12:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
const longDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// Daily: one short block per rep, exactly:
//   <Rep>:
//   - <Month> Closed Won: <count this month so far; starts again each month>
//   - Overdue Tasks: <tasks overdue right now>
//   - Meetings taken on <yesterday's date>: <count>
// Meetings count only if recorded on Granola OR the post-call sequence was sent.
function daily(data, asOf = today(), opts = {}) {
  const day = addDays(asOf, -1);
  const month = monthName(asOf);
  const mtd = compute(data, asOf.slice(0, 8) + '01', asOf, asOf, '', opts).metrics;  // month-to-date Closed Won, overdue now
  const yday = compute(data, day, day, asOf, '', opts).metrics;                      // meetings taken the day before
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

// Weekly: same per-person layout, covering the 7 full days before the send date
// (sent Sunday morning -> previous Sunday..Saturday), followed by a Team block.
function weekly(data, asOf = today(), opts = {}) {
  const to = addDays(asOf, -1), from = addDays(asOf, -7);
  const range = `${longDate(from).replace(/ \d{4}$/, '')} – ${longDate(to)}`;
  const metrics = compute(data, from, to, asOf, '', opts).metrics;
  const blocks = metrics.map((m) => ({
    name: m['Team Member'],
    lines: [
      `Closed Won (${range}): ${m['Closed Won']}`,
      `Meetings taken (${range}): ${m['Meetings Taken']}`,
      `Lead-to-Meeting: ${m['Lead-to-Meeting %']} (${m['Booked Call']} booked / ${m['Contacts']} contacts)`,
      `Close Rate: ${m['Close Rate (of meetings)']} (${m['Closed Won']} won / ${m['Meetings Taken']} meetings)`,
      `Overdue Tasks: ${m['Overdue Tasks']}`,
    ],
  }));
  const html = `<div style="font:14px/1.6 Arial,sans-serif;color:#111">${blocks.map((b) => `<p style="margin:0 0 4px"><b>${esc(b.name)}:</b></p>
<ul style="margin:0 0 16px;padding-left:20px">${b.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`).join('\n')}</div>`;
  const text = blocks.map((b) => `${b.name}:\n${b.lines.map((l) => `- ${l}`).join('\n')}`).join('\n\n');
  return { subject: `Sales weekly report – ${range}`, html, text };
}

module.exports = { daily, weekly };
