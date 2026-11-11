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
const tzOf = (name) => (REPS.find((r) => r.name === name) || {}).tz || process.env.REPORT_TZ || 'Asia/Kolkata';

// Slack member IDs (Slack profile -> ⋮ -> Copy member ID, looks like U0123ABCD). Everyone listed here is tagged at the top of the Slack post.
// Not secret. Fill in as { 'Arth Agarwal': 'U0XXXXXXX', ... }; people without an ID are simply not tagged.
const SLACK_IDS = {
  'Arth Agarwal': 'U0B9LU3G0GK',
  'Diego Alvarez': 'U0C4PARL7NC',
  'Guillermo Chavarria': 'U0BSEF3HQ92',
  'Lucas Moreno': 'U0CC3SDP8MU',
  'Muskaan Mir': 'U0B9R7CRP2A',
  'Paula Jimenez': 'U0C88REG2MT',
  'Pavitra N': 'U0BAKQGCMDG',
  'Ramya Warrier': 'U0BJ6MABK44',
  // managers (the people who used to get the daily e-mail)
  'Yash Mundada': 'U09JPJKS4S2',
  'Shreyans': 'U0BAE4G6Q2C',
  'Sushanth Prabhu': 'U0BJ8GVKGSC',
};

module.exports = {
  SLACK_IDS,
  REPS, ROSTER, GROUPS, tzOf,
  TARGETS: {
    'Portal Compliance': num(process.env.TARGET_PORTAL, 80),
    '20 Min Duration Compliance': num(process.env.TARGET_20MIN, 50),
    'Average Call Duration': num(process.env.TARGET_AVG_DURATION, 20),
    'Conversion Rate': num(process.env.TARGET_CONVERSION, 30),
  },
};
