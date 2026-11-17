const { authorize } = require('../lib/auth');
const { json, body, query } = require('../lib/http');
const feedback = require('../lib/feedback');

// Feedback tab. Givers (Yash, Shreyans) see everything; a sales person sees only the feedback written to them.
// GET                                   -> { people, items }
// POST { action: 'give', rep, text }    givers only                    -> { item }
// POST { action: 'comment', id, text }  the feedback's sales person / givers -> { item, comment }
// POST { action: 'edit', id, comment?, text }  the person who wrote it -> { item }   (edits are kept in its history)
// POST { action: 'delete', id }         the giver who wrote it          -> { ok: true }
// POST { action: 'upload', name, type, data(base64) }  one attachment  -> { file }   (then pass files: [ids] to give / comment)
// GET  ?file=<id>                       an attachment, if you can see its feedback
module.exports = async (req, res) => {
  const user = await authorize(req, res);
  if (!user) return;
  try {
    if (req.method === 'GET') {
      const id = query(req).file;
      if (!id) return json(res, 200, await feedback.list(user));
      const f = await feedback.download(user, id);
      res.statusCode = 200;
      // only safe raster images are shown inline; anything else is a download, never rendered by the browser
      res.setHeader('Content-Type', f.inline ? f.type : 'application/octet-stream');
      res.setHeader('Content-Disposition', `${f.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.end(f.data);
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
    const b = await body(req);
    if (b.action === 'give') return json(res, 200, { item: await feedback.give(user, b) });
    if (b.action === 'comment') return json(res, 200, await feedback.comment(user, b));
    if (b.action === 'edit') return json(res, 200, await feedback.edit(user, b));
    if (b.action === 'upload') return json(res, 200, { file: await feedback.upload(user, b) });
    if (b.action === 'delete') { await feedback.remove(user, b.id); return json(res, 200, { ok: true }); }
    return json(res, 400, { error: 'Unknown action.' });
  } catch (e) { json(res, e.status || 500, { error: e.message }); }
};
