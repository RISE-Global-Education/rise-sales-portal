// E-mail sent when someone raises a commission discrepancy on the portal.
// Recipient: DISPUTE_NOTIFY_TO (comma-separated), default yash@riseresearch.com. Uses the same SMTP as the reports.
const mailer = require('./mailer');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const recipients = () => process.env.DISPUTE_NOTIFY_TO || 'yash@riseresearch.com';
const AIRTABLE = () => `https://airtable.com/${process.env.DISPUTES_BASE || 'appMn20DaFCQaMPig'}/${process.env.DISPUTES_TABLE || 'tbluL9dBxK46KAzz2'}`;

function message(d, dealLink) {
  const rows = [
    ['Client', d.client], ['Rep', d.rep], ['Reason', d.reason], ['Explanation', d.details],
    ['Proof link', d.link], ['HubSpot deal', dealLink], ['Raised by', d.raisedBy],
  ].filter(([, v]) => v);
  const link = (v) => (/^https?:\/\//i.test(v) ? `<a href="${esc(v)}">${esc(v)}</a>` : esc(v).replace(/\n/g, '<br>'));
  const subject = `Commission discrepancy raised: ${d.client || 'deal'}${d.rep ? ' (' + d.rep + ')' : ''}`;
  const html = `<p>A commission discrepancy was raised on the Sales Portal.</p>
<table cellpadding="6" style="border-collapse:collapse;font:14px Arial,sans-serif">${rows.map(([k, v]) => `<tr><td style="color:#6B6B6B;vertical-align:top">${k}</td><td>${link(v)}</td></tr>`).join('')}</table>
<p>To resolve it, change <b>Status</b> to Accepted or Rejected in Airtable: <a href="${AIRTABLE()}">Commission Discrepancies</a>.<br>An accepted deal then counts as verified for commission.</p>`;
  const text = `A commission discrepancy was raised on the Sales Portal.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nResolve it in Airtable (Status: Accepted / Rejected): ${AIRTABLE()}`;
  return { to: recipients(), subject, html, text };
}

// -> { sent: true } | { sent: false, reason }. Never throws: a mail problem must not undo a raised discrepancy.
async function disputeRaised(d, dealLink) {
  if (!mailer.configured()) return { sent: false, reason: 'SMTP not configured' };
  const m = message(d, dealLink);
  try { await mailer.send(m.to, m.subject, m.html, m.text); return { sent: true }; }
  catch (e) { console.error('discrepancy e-mail failed:', e.message); return { sent: false, reason: e.message.split('\n')[0] }; }
}

module.exports = { disputeRaised, message };
