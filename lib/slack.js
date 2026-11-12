// Posts the report to a Slack channel through an Incoming Webhook (SLACK_WEBHOOK_URL).
const configured = () => /^https:\/\/hooks\.slack\.com\//.test(process.env.SLACK_WEBHOOK_URL || '');

const send = (payload) => fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });

// Slack's own table block (real columns, wraps on phones). data = { headers, rows, extra }
function tablePayload(subject, data, tag) {
  const cell = (v) => ({ type: 'raw_text', text: String(v) });
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${subject}*${tag ? '\n' + tag : ''}` } },
    { type: 'table', rows: [data.headers.map(cell), ...data.rows.map((r) => r.map(cell))], column_settings: data.headers.map((_, i) => (i ? { align: 'right' } : { is_wrapped: true })) },
  ];
  if (data.extra) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${data.extra}*` } });
  return { text: subject, blocks };
}

// fallback if Slack refuses the table block: one readable line per person (bold name, "label: value" pairs)
function listText(subject, data, tag) {
  const lines = data.rows.map((r, ri) => {
    const total = ri === data.rows.length - 1;
    return `${total ? '' : '• '}*${r[0]}*  ${r.slice(1).map((v, i) => `${data.headers[i + 1]}: ${v}`).join('  ·  ')}`;
  });
  return `*${subject}*${tag ? '\n' + tag : ''}\n\n${lines.join('\n')}${data.extra ? `\n\n*${data.extra}*` : ''}`;
}

// returns 'table' or 'list' (which layout Slack accepted)
async function post(subject, data, { tag = '<!channel>' } = {}) {
  const r = await send(tablePayload(subject, data, tag));
  if (r.ok) return 'table';
  const why = (await r.text()).slice(0, 120);
  const r2 = await send({ text: listText(subject, data, tag), mrkdwn: true });
  if (!r2.ok) throw new Error('Slack responded ' + r2.status + ' ' + (await r2.text()).slice(0, 100) + ' (table was: ' + why + ')');
  return 'list';
}
module.exports = { configured, post, listText, tablePayload };
