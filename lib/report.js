// Builds the daily and weekly report bodies from a snapshot, as TABLES:
//   html = styled table for the e-mail, text = aligned plain-text table (e-mail fallback and the Slack code block).
const { compute } = require('./views');
const { today, addDays } = require('./tz');
const { GROUPS } = require('./config');
const isGroup = (name) => GROUPS.some((g) => g.name === name); // regional rows belong to the portal table, not the reports

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const monthName = (d) => new Date(d + 'T12:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
const longDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDate = (d) => longDate(d).replace(/ \d{4}$/, '');

// headers: [..]; rows: [[..]] (first column = name, rest = values); last row can be marked as a total
function table(headers, rows, { totalRow = false } = {}) {
  const cell = (v, i, tag, extra = '') => `<${tag} style="padding:8px 12px;border-bottom:1px solid #E5E2D9;text-align:${i === 0 ? 'left' : 'right'};white-space:nowrap;${extra}">${esc(v)}</${tag}>`;
  const html = `<table style="border-collapse:collapse;font:14px/1.4 Arial,sans-serif;color:#1D1D1F;border:1px solid #E5E2D9">
<thead><tr>${headers.map((h, i) => cell(h, i, 'th', 'background:#1C7C54;color:#fff;font-weight:600;border-bottom:0')).join('')}</tr></thead>
<tbody>${rows.map((r, ri) => `<tr style="background:${totalRow && ri === rows.length - 1 ? '#F0EDE4' : ri % 2 ? '#FBF8EF' : '#fff'}">${r.map((v, i) => cell(v, i, 'td', totalRow && ri === rows.length - 1 ? 'font-weight:700' : i === 0 ? 'font-weight:600' : '')).join('')}</tr>`).join('')}</tbody></table>`;
  const w = headers.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((v, i) => (i === 0 ? String(v).padEnd(w[i]) : String(v).padStart(w[i]))).join('  ');
  const sep = w.map((n) => '-'.repeat(n)).join('  ');
  const text = [line(headers), sep, ...rows.map((r, ri) => (totalRow && ri === rows.length - 1 ? sep + '\n' : '') + line(r))].join('\n');
  return { html, text };
}
// extra = optional line under the table (e.g. the unclaimed-leads figure)
const wrap = (intro, t, extra) => ({ html: `<div style="font:14px/1.6 Arial,sans-serif;color:#1D1D1F"><p style="margin:0 0 12px">${esc(intro)}</p>${t.html}${extra ? `<p style="margin:14px 0 0;font-weight:600">${esc(extra)}</p>` : ''}</div>`, text: `${intro}\n\n${t.text}${extra ? `\n\n${extra}` : ''}` });
const unclaimedLine = (u, label) => (u ? `Leads unclaimed (${label}): ${u.total} (${u.unqualified} unqualified)` : '');

// Daily: one row per rep + a Total row.
//   Closed Won and Meetings Taken = this month so far (both start again each month) · Overdue Tasks = overdue right now
//   Meetings = taken yesterday (recorded on Granola OR post-call sequence sent) · Leads claimed = assigned to the rep yesterday
function daily(data, asOf = today(), opts = {}) {
  const day = addDays(asOf, -1);
  const month = monthName(asOf);
  const mtd = compute(data, asOf.slice(0, 8) + '01', asOf, asOf, '', opts).metrics;  // month-to-date Closed Won, overdue now
  const yday = compute(data, day, day, asOf, '', opts).metrics;                      // the day before
  const of = (list, name, k) => (list.find((y) => y['Team Member'] === name) || {})[k] || 0;
  const people = mtd.filter((m) => m['Team Member'] !== 'Team' && !isGroup(m['Team Member'])).map((m) => [
    m['Team Member'], m['Closed Won'], m['Meetings Taken'], m['Overdue Tasks'], of(yday, m['Team Member'], 'Meetings Taken'), of(yday, m['Team Member'], 'Leads Claimed'),
  ]);
  const sum = (i) => people.reduce((a, r) => a + r[i], 0);
  const rows = [...people, ['Total', sum(1), sum(2), sum(3), sum(4), sum(5)]];
  const headers = ['Team Member', `${month} Closed Won`, `${month} Meetings Taken`, 'Overdue Tasks', `Meetings (${shortDate(day)})`, `Leads claimed (${shortDate(day)})`];
  const t = table(headers, rows, { totalRow: true });
  const extra = unclaimedLine(opts.unclaimed, longDate(day));
  const b = wrap(`Daily report for ${longDate(day)}.`, t, extra);
  return { subject: `Sales daily report – ${longDate(day)}`, html: b.html, text: b.text, data: { headers, rows, extra } };
}

// Weekly: same idea over the 7 full days before the send date (sent Sunday -> previous Sunday..Saturday); Team row last.
function weekly(data, asOf = today(), opts = {}) {
  const to = addDays(asOf, -1), from = addDays(asOf, -7);
  const range = `${shortDate(from)} – ${longDate(to)}`;
  const metrics = compute(data, from, to, asOf, '', opts).metrics.filter((m) => !isGroup(m['Team Member']));
  const rows = metrics.map((m) => [
    m['Team Member'], m['Closed Won'], m['Meetings Taken'], m['Leads Claimed'],
    `${m['Lead-to-Meeting %']} (${m['Booked Call']}/${m['Contacts']})`, `${m['Close Rate (of meetings)']} (${m['Closed Won']}/${m['Meetings Taken']})`, m['Overdue Tasks'],
  ]);
  const headers = ['Team Member', 'Closed Won', 'Meetings taken', 'Leads claimed', 'Lead-to-Meeting (booked/contacts)', 'Close Rate (won/meetings)', 'Overdue Tasks'];
  const t = table(headers, rows, { totalRow: true });
  const extra = unclaimedLine(opts.unclaimed, range);
  const b = wrap(`Weekly report for ${range}.`, t, extra);
  return { subject: `Sales weekly report – ${range}`, html: b.html, text: b.text, data: { headers, rows, extra } };
}

module.exports = { daily, weekly };
