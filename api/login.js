const { login } = require('../lib/auth');
const { json, body } = require('../lib/http');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  login(req, res, (await body(req)).password);
};
