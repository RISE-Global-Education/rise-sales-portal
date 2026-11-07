// Targets shown as coloured chips. These are the sheet's own column-heading targets
// ("Portal Compliance (80+)", "20 Min Duration Compliance (50+)", "Average Call Duration (20+)", "Conversion Rate (30+)"),
// kept here in one place so they can be changed without touching the code. Every other number is calculated from API data.
const num = (v, d) => (v ? Number(v) : d);
module.exports = {
  TARGETS: {
    'Portal Compliance': num(process.env.TARGET_PORTAL, 80),
    '20 Min Duration Compliance': num(process.env.TARGET_20MIN, 50),
    'Average Call Duration': num(process.env.TARGET_AVG_DURATION, 20),
    'Conversion Rate': num(process.env.TARGET_CONVERSION, 30),
  },
};
