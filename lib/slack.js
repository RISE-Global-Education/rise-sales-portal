// Posts the report to a Slack channel through an Incoming Webhook (SLACK_WEBHOOK_URL).
const configured = () => /^https:\/\/hooks\.slack\.com\//.test(process.env.SLACK_WEBHOOK_URL || '');

// the report's aligned text table goes in a code block (Slack has no real tables); the title is bold
function format(subject, text) { return `*${subject}*\n\`\`\`\n${String(text || '').trim()}\n\`\`\``; }

async function post(subject, text) {
  const r = await fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: format(subject, text), mrkdwn: true }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Slack responded ' + r.status + ' ' + (await r.text()).slice(0, 100));
}
module.exports = { configured, post, format };
