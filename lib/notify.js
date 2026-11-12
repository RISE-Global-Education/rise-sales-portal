// E-mails about commission discrepancies (same SMTP as the reports). Never throws: a mail problem must not undo the action.
//  - raised:   to DISPUTE_NOTIFY_TO (comma-separated; default yash@riseresearch.com)
//  - comment:  to everyone in the conversation except the author (Yash + the deal's rep + whoever raised it)
//  - resolved: to the deal's rep and whoever raised it
const mailer = require('./mailer');
const { participants } = require('./disputes');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const notifyTo = () => (process.env.DISPUTE_NOTIFY_TO || 'yash@riseresearch.com').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const AIRTABLE = () => `https://airtable.com/${process.env.DISPUTES_BASE || 'appMn20DaFCQaMPig'}/${process.env.DISPUTES_TABLE || 'tbluL9dBxK46KAzz2'}`;
const cell = (v) => (/^https?:\/\//i.test(v) ? `<a href="${esc(v)}">${esc(v)}</a>` : esc(v).replace(/\n/g, '<br>'));
const table = (rows) => `<table cellpadding="6" style="border-collapse:collapse;font:14px Arial,sans-serif">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td style="color:#6B6B6B;vertical-align:top">${k}</td><td>${cell(v)}</td></tr>`).join('')}</table>`;
const textRows = (rows) => rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
const title = (d) => `${d.client || 'deal'}${d.rep ? ' (' + d.rep + ')' : ''}`;
const files = (n) => (n ? `${n} file${n === 1 ? '' : 's'} attached` : '');
const open = (portal) => (portal ? `<p><a href="${esc(portal)}">Open the Discrepancies page on the Sales Portal</a></p>` : '');

function message(kind, d, extra = {}, portal = '') {
  const base = [['Client', d.client], ['Rep', d.rep], ['Reason', d.reason]];
  if (kind === 'raised') {
    const rows = [...base, ['Explanation', d.details], ['Proof link', d.link], ['HubSpot deal', d.dealLink], ['Attachments', files((d.attachments || []).length)], ['Raised by', d.raisedBy]];
    return { to: notifyTo(), subject: `Commission discrepancy raised: ${title(d)}`,
      html: `<p>A commission discrepancy was raised on the Sales Portal.</p>${table(rows)}<p>Review it, reply and accept or reject it on the portal (or change <b>Status</b> in <a href="${AIRTABLE()}">Airtable</a>). ${d.dealId ? ' Accepting it makes the deal count as verified for commission.' : ' It is not linked to a Closed Won deal, so accepting it does not change commission.'}</p>${open(portal)}`,
      text: `A commission discrepancy was raised on the Sales Portal.\n\n${textRows(rows)}\n\n${portal || AIRTABLE()}` };
  }
  if (kind === 'comment') {
    const c = extra.comment;
    const rows = [['Comment', c.message], ['Attachments', files((c.attachments || []).length)]];
    return { to: [...new Set([...notifyTo(), ...participants(d)])], subject: `New comment on discrepancy: ${title(d)}`,
      html: `<p><b>${esc(c.author)}</b> commented on the discrepancy for <b>${esc(title(d))}</b>.</p>${table(rows)}${open(portal)}`,
      text: `${c.author} commented on the discrepancy for ${title(d)}.\n\n${textRows(rows)}\n\n${portal}` };
  }
  // resolved
  const accepted = d.status === 'accepted';
  // only a discrepancy linked to a Closed Won deal changes commission
  const decision = d.dealId ? (accepted ? 'Accepted: the deal now counts as a verified win' : 'Rejected: the deal stays unverified') : (accepted ? 'Accepted' : 'Rejected');
  const rows = [...base, ['Decision', decision], ['Note', d.note], ['Resolved by', d.resolvedBy]];
  return { to: participants(d), subject: `Discrepancy ${accepted ? 'accepted' : 'rejected'}: ${title(d)}`,
    html: `<p>The discrepancy for <b>${esc(title(d))}</b> was <b>${accepted ? 'accepted' : 'rejected'}</b>.</p>${table(rows)}${open(portal)}`,
    text: `The discrepancy for ${title(d)} was ${accepted ? 'accepted' : 'rejected'}.\n\n${textRows(rows)}\n\n${portal}` };
}

// kind: 'raised' | 'comment' | 'resolved'; actor = the signed-in user (never e-mailed about their own action)
async function send(kind, d, actor, extra = {}, portal = '') {
  if (!mailer.configured()) return { sent: false, reason: 'SMTP not configured' };
  const m = message(kind, d, extra, portal);
  const to = m.to.filter((e) => e && e !== (actor && actor.email));
  if (!to.length) return { sent: false, reason: 'nobody else to tell' };
  try { await mailer.send(to.join(','), m.subject, m.html, m.text); return { sent: true, to }; }
  catch (e) { console.error('discrepancy e-mail failed:', e.message); return { sent: false, reason: e.message.split('\n')[0] }; }
}

module.exports = { send, message };
