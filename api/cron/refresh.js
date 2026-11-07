const { authorizeCron } = require('../../lib/auth');
const { json, query } = require('../../lib/http');
const service = require('../../lib/service');

// Cron target. ?force=1 refetches everything even if recently refreshed.
module.exports = async (req, res) => {
  if (!authorizeCron(req, res)) return;
  try { json(res, 200, await service.refresh({ force: query(req).force === '1' })); }
  catch (e) { json(res, 500, { error: e.message }); }
};
