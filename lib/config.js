// Targets shown as coloured chips. These are the sheet's own column-heading targets
// ("Portal Compliance (80+)", "20 Min Duration Compliance (50+)", "Average Call Duration (20+)", "Conversion Rate (30+)"),
// kept here in one place so they can be changed without touching the code. Every other number is calculated from API data.
const num = (v, d) => (v ? Number(v) : d);
// Sales team roster = exactly who appears in the portal and emails (names as in HubSpot). Each person's meetings, deals and
// contacts are dated in THEIR working time zone, so a US rep's evening call lands on the right day.
// Diego, Guillermo, Paula and Lucas work US hours (Eastern - set US_TZ to e.g. America/Chicago to change). Everyone else uses REPORT_TZ.
// To add a rep, add a line.
const US = process.env.US_TZ || 'America/New_York';
const REPS = [
  { name: 'Arth Agarwal' },
  { name: 'Diego Alvarez', tz: US },
  { name: 'Guillermo Chavarria', tz: US },
  { name: 'Lucas Moreno', tz: US },
  { name: 'Muskaan Mir' },
  { name: 'Paula Jimenez', tz: US },
  { name: 'Pavitra N' },
  { name: 'Ramya Warrier' },
];
const ROSTER = new Set(REPS.map((r) => r.name));
// Regional groups shown as extra rows in Metrics Summary and as options in the Team member filter.
// Ramya Warrier is in Team ROW for now.
const GROUPS = [
  { name: 'Team USA', members: ['Guillermo Chavarria', 'Lucas Moreno', 'Paula Jimenez', 'Diego Alvarez'] },
  { name: 'Team ROW', members: ['Muskaan Mir', 'Pavitra N', 'Arth Agarwal', 'Ramya Warrier'] },
];
// Commission rules (Commission Calculator tab). Everything resets each calendar month; the month is the Airtable Client Date.
// Only VERIFIED wins count: proof of conversation (Granola) + proof of payment (Airtable Follow Up Status = Client),
// or a discrepancy a manager accepted.
//  perClient:  fixed amount per verified client, by source (Counsellor / Direct, from Airtable's Counselor Source)
//  tiers:      marginal per-student tiers within the month: students 1-30 earn $0 each, 31-60 $50, 61-90 $75, 91+ $100
//  perMeeting: plus a fixed amount per meeting taken in the month (Granola-recorded or post-call sequence sent)
const INDIA = { currency: 'INR', perClient: { Counsellor: 2500, Direct: 5000 } };
const USA = { currency: 'USD', tiers: [{ upTo: 30, rate: 0 }, { upTo: 60, rate: 50 }, { upTo: 90, rate: 75 }, { upTo: Infinity, rate: 100 }] };
const COMMISSION = {
  'Arth Agarwal': INDIA, 'Muskaan Mir': INDIA, 'Pavitra N': INDIA,
  'Guillermo Chavarria': USA, 'Lucas Moreno': USA, 'Paula Jimenez': USA, 'Diego Alvarez': USA,
  'Ramya Warrier': { currency: 'USD', perClient: { Counsellor: 125, Direct: 125 }, perMeeting: 10 },
};
// Portal logins (e-mail = login ID). The password is the user's own e-mail address, except a user with `passwordEnv`,
// who signs in ONLY with the password in that environment variable. There is no password change on the portal. `name` must match the HubSpot owner name for reps, so their deals are recognised.
// RESOLVERS may accept / reject commission discrepancies (override with DISPUTE_RESOLVERS, comma-separated e-mails).
const USERS = [
  { email: 'yash@riseresearch.com', name: 'Yash Mundada', passwordEnv: 'YASH_PASSWORD' },
  { email: 'shreyans@riseresearch.com', name: 'Shreyans Lodha' },
  { email: 'sushant@riseresearch.com', name: 'Sushant' },
  { email: 'arth@riseresearch.com', name: 'Arth Agarwal' },
  { email: 'muskaan@riseresearch.com', name: 'Muskaan Mir' },
  { email: 'pavitra@riseresearch.com', name: 'Pavitra N' },
  { email: 'guillermo@riseresearch.com', name: 'Guillermo Chavarria' },
  { email: 'paula@riseresearch.com', name: 'Paula Jimenez' },
  { email: 'lucas@riseresearch.com', name: 'Lucas Moreno' },
  { email: 'diego@riseresearch.com', name: 'Diego Alvarez' },
  { email: 'ramya@riseresearch.com', name: 'Ramya Warrier' },
];
const RESOLVERS = () => (process.env.DISPUTE_RESOLVERS || 'yash@riseresearch.com').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const userByEmail = (e) => USERS.find((u) => u.email === String(e || '').trim().toLowerCase()) || null;
const userByName = (n) => USERS.find((u) => u.name === n) || null;
const tzOf = (name) => (REPS.find((r) => r.name === name) || {}).tz || process.env.REPORT_TZ || 'Asia/Kolkata';

module.exports = {
  REPS, ROSTER, GROUPS, tzOf, COMMISSION, USERS, RESOLVERS, userByEmail, userByName,
  TARGETS: {
    'Portal Compliance': num(process.env.TARGET_PORTAL, 80),
    '20 Min Duration Compliance': num(process.env.TARGET_20MIN, 50),
    'Average Call Duration': num(process.env.TARGET_AVG_DURATION, 20),
    'Conversion Rate': num(process.env.TARGET_CONVERSION, 30),
  },
};
