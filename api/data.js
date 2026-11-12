const { authorize } = require('../lib/auth');
const { json, query } = require('../lib/http');
const service = require('../lib/service');

module.exports = async (req, res) => {
  const user = await authorize(req, res);
  if (!user) return;
  try { json(res, 200, { ...(await service.getData(query(req))), me: user }); }
  catch (e) { json(res, 500, { error: e.message }); }
};
