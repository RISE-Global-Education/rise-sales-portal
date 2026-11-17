// E-mails about commission discrepancies (same SMTP as the reports). Never throws: a mail problem must not undo the action.
// Every e-mail (raised, comment, accepted/rejected, reopened) goes ONLY to DISPUTE_NOTIFY_TO (comma-separated; default
// yash@riseresearch.com), never to Yash about his own action. All e-mails about discrepancies raised on the same day
// share one subject and thread headers, so each day is a single e-mail thread (16th in one, 17th in another, ...).
const mailer = require('./mailer');
const { dayOf, today } = require('./tz');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const notifyTo = () => (process.env.DISPUTE_NOTIFY_TO || 'yash@riseresearch.com').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const AIRTABLE = () => `https://airtable.com/${process.env.DISPUTES_BASE || 'appMn20DaFCQaMPig'}/${process.env.DISPUTES_TABLE || 'tbluL9dBxK46KAzz2'}`;
const cell = (v) => (/^https?:\/\//i.test(v) ? `<a href="${esc(v)}">${esc(v)}</a>` : esc(v).replace(/\n/g, '<br>'));
const table = (rows) => `<table cellpadding="6" style="border-collapse:collapse;font:14px Arial,sans-serif">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td style="color:#6B6B6B;vertical-align:top">${k}</td><td>${cell(v)}</td></tr>`).join('')}</table>`;
const textRows = (rows) => rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
const title = (d) => `${d.client || 'deal'}${d.rep ? ' (' + d.rep + ')' : ''}`;
const files = (n) => (n ? `${n} file${n === 1 ? '' : 's'} attached` : '');
const DOMAIN = () => (process.env.MAIL_FROM || process.env.SMTP_USER || 'riseresearch.com').replace(/^.*@/, '').replace(/[>\s].*$/, '') || 'riseresearch.com';
// One thread per DAY: every e-mail about the discrepancies raised on the same date (report timezone, IST by default) -
// raised, comments, decisions, even ones sent days later - shares one subject and replies to the same day thread id.
const raisedDay = (d) => dayOf(d.at) || today();
const dayLabel = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayRoot = (d) => `<discrepancies-${raisedDay(d)}@${DOMAIN()}>`;
const threadHeaders = (kind, d) => ({ inReplyTo: dayRoot(d), references: [dayRoot(d)],
  messageId: `<discrepancy-${String(d.id || 'x').replace(/[^\w.-]/g, '')}-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN()}>` });
const subjectOf = (kind, d) => `Commission discrepancies raised on ${dayLabel(raisedDay(d))}`;
const open = (portal) => (portal ? `<p><a href="${esc(portal)}">Open the Discrepancies page on the Sales Portal</a></p>` : '');

function message(kind, d, extra = {}, portal = '') {
  const base = [['Client', d.client], ['Rep', d.rep], ['Reason', d.reason]];
  if (kind === 'raised') {
    const rows = [...base, ['Explanation', d.details], ['Proof link', d.link], ['HubSpot deal', d.dealLink], ['Attachments', files((d.attachments || []).length)], ['Raised by', d.raisedBy]];
    return { to: notifyTo(), subject: subjectOf(kind, d),
      html: `<p>A commission discrepancy was raised on the Sales Portal for <b>${esc(title(d))}</b>.</p>${table(rows)}<p>Review it, reply and accept or reject it on the portal (or change <b>Status</b> in <a href="${AIRTABLE()}">Airtable</a>). ${d.dealId ? ' Accepting it makes the deal count as verified for commission.' : ' It is not linked to a Closed Won deal, so accepting it does not change commission.'}</p>${open(portal)}`,
      text: `A commission discrepancy was raised on the Sales Portal for ${title(d)}.\n\n${textRows(rows)}\n\n${portal || AIRTABLE()}` };
  }
  if (kind === 'comment') {
    const c = extra.comment;
    const rows = [['Comment', c.message], ['Attachments', files((c.attachments || []).length)]];
    return { to: notifyTo(), subject: subjectOf(kind, d),
      html: `<p><b>${esc(c.author)}</b> commented on the discrepancy for <b>${esc(title(d))}</b>.</p>${table(rows)}${open(portal)}`,
      text: `${c.author} commented on the discrepancy for ${title(d)}.\n\n${textRows(rows)}\n\n${portal}` };
  }
  // reopened (a resolver set it back to Open)
  if (d.status === 'open') {
    const rows = [...base, ['Status', `Open again (was ${d.previous || 'resolved'})`], ['Reopened by', d.reopenedBy]];
    return { to: notifyTo(), subject: subjectOf(kind, d),
      html: `<p>The discrepancy for <b>${esc(title(d))}</b> was <b>reopened</b> and is waiting for a decision again.</p>${table(rows)}${open(portal)}`,
      text: `The discrepancy for ${title(d)} was reopened and is waiting for a decision again.\n\n${textRows(rows)}\n\n${portal}` };
  }
  // resolved (or changed from one decision to the other)
  const accepted = d.status === 'accepted';
  // only a discrepancy linked to a Closed Won deal changes commission
  const decision = d.dealId ? (accepted ? 'Accepted: the deal now counts as a verified win' : 'Rejected: the deal stays unverified') : (accepted ? 'Accepted' : 'Rejected');
  const rows = [...base, ['Decision', decision], ['Note', d.note], ['Resolved by', d.resolvedBy]];
  const changed = d.previous && d.previous !== 'open' ? ` (changed from ${d.previous})` : '';
  return { to: notifyTo(), subject: subjectOf(kind, d),
    html: `<p>The discrepancy for <b>${esc(title(d))}</b> was <b>${accepted ? 'accepted' : 'rejected'}</b>${changed}.</p>${table(rows)}${open(portal)}`,
    text: `The discrepancy for ${title(d)} was ${accepted ? 'accepted' : 'rejected'}.\n\n${textRows(rows)}\n\n${portal}` };
}

// kind: 'raised' | 'comment' | 'resolved'; actor = the signed-in user (never e-mailed about their own action)
async function send(kind, d, actor, extra = {}, portal = '') {
  if (!mailer.configured()) return { sent: false, reason: 'SMTP not configured' };
  const m = message(kind, d, extra, portal);
  const headers = threadHeaders(kind, d);
  const to = m.to.filter((e) => e && e !== (actor && actor.email));
  if (!to.length) return { sent: false, reason: 'nobody else to tell' };
  try { await mailer.send(to.join(','), m.subject, m.html, m.text, undefined, headers); return { sent: true, to }; }
  catch (e) { console.error('discrepancy e-mail failed:', e.message); return { sent: false, reason: e.message.split('\n')[0] }; }
}

module.exports = { send, message, threadHeaders };
