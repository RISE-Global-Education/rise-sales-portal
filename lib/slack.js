// Posts the report to a Slack channel through an Incoming Webhook (SLACK_WEBHOOK_URL).
const configured = () => /^https:\/\/hooks\.slack\.com\//.test(process.env.SLACK_WEBHOOK_URL || '');

// plain-text report -> Slack mrkdwn: bold title and names, real bullets
function format(subject, text) {
  const body = String(text || '').split('\n').map((l) => (/^[^\s\-•].*:$/.test(l) ? `*${l.slice(0, -1)}*` : l.replace(/^- /, '• '))).join('\n');
  return `*${subject}*\n\n${body}`;
}

async function post(subject, text) {
  const r = await fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: format(subject, text), mrkdwn: true }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Slack responded ' + r.status + ' ' + (await r.text()).slice(0, 100));
}
module.exports = { configured, post, format };
