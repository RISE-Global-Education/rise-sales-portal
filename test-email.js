// node test-email.js [daily|weekly]
// Sends ONE test report to SMTP_USER only (yourself), to confirm the email login works.
// It never emails Shreyans/Yash and does not touch the schedule.
const fs = require('fs');
const path = require('path');
try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}
const mailer = require('./lib/mailer');
const report = require('./lib/report');

(async () => {
  if (!mailer.configured()) return console.log('Fill in SMTP_USER and SMTP_PASS in .env first.');
  const snap = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'snapshot.json'), 'utf8'));
  const kind = process.argv[2] === 'weekly' ? 'weekly' : 'daily';
  const m = report[kind](snap.data);
  await mailer.send(process.env.SMTP_USER, '[TEST] ' + m.subject, m.html, m.text);
  console.log(`Test ${kind} email sent to ${process.env.SMTP_USER}. Check that inbox.`);
})().catch((e) => console.error('Failed:', e.message));
