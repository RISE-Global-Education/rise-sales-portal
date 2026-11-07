const { authorizeCron } = require('../../lib/auth');
const { json } = require('../../lib/http');
const service = require('../../lib/service');

module.exports = async (req, res) => {
  if (!authorizeCron(req, res)) return;
  try { json(res, 200, await service.sendReport('daily')); }
  catch (e) { json(res, 500, { error: e.message }); }
};
