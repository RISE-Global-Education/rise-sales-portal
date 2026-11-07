// SMTP sender. Needs SMTP_USER + SMTP_PASS (for Gmail: an App Password) in .env.
const nodemailer = require('nodemailer');
const configured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);
async function send(to, subject, html, text) {
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 465), secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html, text });
}
module.exports = { send, configured };
