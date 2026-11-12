// Local server: node server.js -> http://localhost:3000
// Same code the Vercel functions use (lib/service.js), with timers standing in for Vercel Cron.
const http = require('http');
const fs = require('fs');
const path = require('path');

try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const service = require('./lib/service');
const { authorize, login } = require('./lib/auth');
const { json, query, body } = require('./lib/http');

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try { console.log('refresh:', JSON.stringify(await service.refresh({ budgetMs: 20 * 60 * 1000, staleMs: 10 * 60 * 1000 }))); }
  catch (e) { console.error('Refresh failed:', e.message); }
  refreshing = false;
}
refresh();
setInterval(refresh, 15 * 60 * 1000);
setInterval(() => service.sendScheduled().then((r) => r.forEach(([k, v]) => v.sent && console.log('Sent', k, v.to))).catch((e) => console.error('Send failed', e.message)), 60 * 1000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/login' && req.method === 'POST') return login(req, res, (await body(req)).password);
  if (url.pathname === '/api/disputes') return require('./api/disputes')(req, res);
  if (url.pathname === '/api/data') {
    if (!authorize(req, res)) return;
    try { return json(res, 200, await service.getData(query(req))); } catch (e) { return json(res, 500, { error: e.message }); }
  }
  const p = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!p.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(p)) { res.writeHead(404); return res.end('Not found'); }
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.txt': 'text/plain', '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript' };
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'text/html' });
  res.end(fs.readFileSync(p));
}).listen(process.env.PORT || 3000, () => console.log('Sales portal on http://localhost:' + (process.env.PORT || 3000)));
