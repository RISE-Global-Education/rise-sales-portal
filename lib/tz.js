// All "which day is this?" decisions use one timezone (default IST). Override with REPORT_TZ in .env.
const TZ = process.env.REPORT_TZ || 'Asia/Kolkata';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayOf = (v) => {
  if (v == null || v === '') return null;
  const ms = typeof v === 'number' ? v : isNaN(v) ? Date.parse(v) : Number(v);
  return isNaN(ms) ? null : fmt.format(new Date(ms));
};
const today = () => dayOf(Date.now());
const addDays = (d, n) => dayOf(Date.parse(d + 'T12:00:00Z') + n * 864e5);
// ms timestamp of 00:00 (report timezone) on date string d. Uses the zone's real UTC offset at that moment.
const offsetMs = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};
const dayStartMs = (d) => { const g = Date.parse(d + 'T00:00:00Z'); return g - offsetMs(g - offsetMs(g)); };
const dayEndMs = (d) => dayStartMs(addDays(d, 1)) - 1;
module.exports = { TZ, dayOf, today, addDays, dayStartMs, dayEndMs };
