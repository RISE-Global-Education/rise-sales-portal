const { authorize } = require('../lib/auth');
const { json, query } = require('../lib/http');
const service = require('../lib/service');
const spam = require('../lib/spam');
const checkins = require('../lib/checkins');
const feedback = require('../lib/feedback');

module.exports = async (req, res) => {
  const user = await authorize(req, res);
  if (!user) return;
  try {
    const q = query(req);
    const [data, spamChecks, checkinList, feedbackList] = await Promise.all([service.getData(q), spam.list(q.from, q.to), checkins.list(q.from, q.to), feedback.list(user)]);
    json(res, 200, { ...data, spam: spamChecks, checkins: checkinList, feedback: feedbackList, me: user });
  }
  catch (e) { json(res, 500, { error: e.message }); }
};
