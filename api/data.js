const { authorize } = require('../lib/auth');
const { json, query } = require('../lib/http');
const service = require('../lib/service');

module.exports = async (req, res) => {
  if (!authorize(req, res)) return;
  try { json(res, 200, await service.getData(query(req))); }
  catch (e) { json(res, 500, { error: e.message }); }
};
