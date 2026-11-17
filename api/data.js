const { authorize } = require('../lib/auth');
const { json, query } = require('../lib/http');
const service = require('../lib/service');
const spam = require('../lib/spam');
const checkins = require('../lib/checkins');
const feedback = require('../lib/feedback');
const disputes = require('../lib/disputes');

module.exports = async (req, res) => {
  const user = await authorize(req, res);
  if (!user) return;
  try {
    const q = query(req);
    const [data, spamChecks, checkinList, feedbackList] = await Promise.all([service.getData(q), spam.list(q.from, q.to), checkins.list(q.from, q.to), feedback.list(user)]);
    // discrepancies: computed from all of them (accepted ones verify deals for everyone), but each person is only sent
    // the ones they may see - Yash / Shreyans all, everyone else only their own
    if (data.disputesRaw) {
      const mine = disputes.visibleTo(user, data.disputesRaw), ids = new Set(mine.map((d) => d.id));
      data.disputesRaw = mine;
      data.disputes = (data.disputes || []).filter((r) => ids.has(r.Thread));
      // nor other reps' open-discrepancy counts in the Commission table
      if (!disputes.seesAll(user)) data.commission = (data.commission || []).map((r) => (r['Team Member'] === user.name ? r : { ...r, 'Open Discrepancies': '' }));
    }
    json(res, 200, { ...data, spam: spamChecks, checkins: checkinList, feedback: feedbackList, me: user });
  }
  catch (e) { json(res, 500, { error: e.message }); }
};
