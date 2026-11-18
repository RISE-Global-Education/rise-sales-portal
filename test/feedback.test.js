// Feedback: Yash / Shreyans give it; only the sales person it is for (and the givers) can see and comment. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const mem = {};
require.cache[path.join(__dirname, '../lib/store.js')] = { id: 'store', loaded: true, exports: { get: async (k) => (mem[k] ? JSON.parse(mem[k]) : null), put: async (k, v) => { mem[k] = JSON.stringify(v); } } };
const feedback = require('../lib/feedback');
const { feedbackAccess } = require('../lib/config');

const YASH = { name: 'Yash Mundada', feedback: 'give' };
const SHREYANS = { name: 'Shreyans Lodha', feedback: 'give' };
const PAULA = { name: 'Paula Jimenez', feedback: 'rep' };
const DIEGO = { name: 'Diego Alvarez', feedback: 'rep' };
const SUSHANT = { name: 'Sushant', feedback: null };

test('who gives, who receives', () => {
  assert.equal(feedbackAccess('yash@riseresearch.com', 'Yash Mundada'), 'give');
  assert.equal(feedbackAccess('shreyans@riseresearch.com', 'Shreyans Lodha'), 'give');
  assert.equal(feedbackAccess('paula@riseresearch.com', 'Paula Jimenez'), 'rep');
  assert.equal(feedbackAccess('sushanth@riseresearch.com', 'Sushant'), null);
});

test('a sales person sees only their own feedback and can comment on it', async () => {
  const a = await feedback.give(YASH, { rep: 'Paula Jimenez', text: '  Great discovery call structure  ' });
  const b = await feedback.give(SHREYANS, { rep: 'Diego Alvarez', text: 'Mention the portal earlier' });
  assert.equal(a.text, 'Great discovery call structure');
  assert.deepEqual((await feedback.list(PAULA)).items.map((x) => x.id), [a.id]);
  assert.deepEqual((await feedback.list(DIEGO)).items.map((x) => x.id), [b.id]);
  assert.deepEqual((await feedback.list(SUSHANT)).items, []);
  assert.deepEqual((await feedback.list(YASH)).items.map((x) => x.id), [b.id, a.id]); // givers see all, newest first
  assert.deepEqual((await feedback.list(PAULA)).people, []); // the roster is only for givers

  const { comment } = await feedback.comment(PAULA, { id: a.id, text: 'Thanks, will keep it up' });
  await feedback.comment(SHREYANS, { id: a.id, text: 'Nice' });
  assert.equal(comment.by, 'Paula Jimenez');
  assert.deepEqual((await feedback.list(PAULA)).items[0].comments.map((c) => c.by), ['Paula Jimenez', 'Shreyans Lodha']);
  await assert.rejects(feedback.comment(DIEGO, { id: a.id, text: 'hi' }), { status: 404 }); // not his feedback
});

test('only givers give; only the author deletes; bad input is refused', async () => {
  await assert.rejects(feedback.give(PAULA, { rep: 'Paula Jimenez', text: 'x' }), { status: 403 });
  await assert.rejects(feedback.give(YASH, { rep: 'Someone Else', text: 'x' }), { status: 400 });
  await assert.rejects(feedback.give(YASH, { rep: 'Paula Jimenez', text: '  ' }), { status: 400 });
  const f = await feedback.give(YASH, { rep: 'Lucas Moreno', text: 'Follow up faster' });
  await assert.rejects(feedback.comment(YASH, { id: f.id, text: ' ' }), { status: 400 });
  await assert.rejects(feedback.remove(SHREYANS, f.id), { status: 403 });
  await assert.rejects(feedback.remove({ name: 'Lucas Moreno', feedback: 'rep' }, f.id), { status: 403 });
  await feedback.remove(YASH, f.id);
  assert.ok(!(await feedback.list(YASH)).items.some((x) => x.id === f.id));
});

test('attachments: images and files on feedback and comments, served only to people who can see them', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');
  const img = await feedback.upload(YASH, { name: 'call.png', type: 'image/png', data: png });
  const doc = await feedback.upload(YASH, { name: 'notes.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1').toString('base64') });
  assert.deepEqual(Object.keys(img).sort(), ['id', 'name', 'size', 'type']); // the bytes never go back in lists
  const f = await feedback.give(YASH, { rep: 'Paula Jimenez', text: '', files: [img.id, doc.id] }); // text optional with files
  assert.equal(f.text, '');
  assert.deepEqual(f.files.map((x) => x.name), ['call.png', 'notes.pdf']);

  const got = await feedback.download(PAULA, img.id);
  assert.equal(got.inline, true);
  assert.equal(got.data.toString('base64'), png);
  assert.equal((await feedback.download(PAULA, doc.id)).inline, false); // documents are downloads
  await assert.rejects(feedback.download(DIEGO, img.id), { status: 404 }); // not his feedback
  await assert.rejects(feedback.download(SUSHANT, img.id), { status: 404 });

  const reply = await feedback.upload(PAULA, { name: 'shot.jpg', type: 'image/jpeg', data: png });
  const { comment } = await feedback.comment(PAULA, { id: f.id, files: [reply.id] });
  assert.equal(comment.files[0].id, reply.id);
  assert.equal((await feedback.download(YASH, reply.id)).name, 'shot.jpg');
  // an unsent upload can't be fetched, and nobody can attach someone else's upload
  const loose = await feedback.upload(YASH, { name: 'x.png', type: 'image/png', data: png });
  await assert.rejects(feedback.download(YASH, loose.id), { status: 404 });
  await assert.rejects(feedback.comment(PAULA, { id: f.id, text: 'hi', files: [loose.id] }), { status: 400 });
});

test('attachments: bad files are refused', async () => {
  const data = Buffer.from('hi').toString('base64');
  await assert.rejects(feedback.upload(SUSHANT, { name: 'a.png', type: 'image/png', data }), { status: 403 });
  await assert.rejects(feedback.upload(YASH, { name: 'run.exe', data }), { status: 400 });
  await assert.rejects(feedback.upload(YASH, { name: 'page.html', type: 'text/html', data }), { status: 400 });
  await assert.rejects(feedback.upload(YASH, { name: 'empty.png', data: '' }), { status: 400 });
  await assert.rejects(feedback.upload(YASH, { name: 'big.png', data: Buffer.alloc(feedback.FILE_MAX + 1).toString('base64') }), { status: 400 });
  const ids = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => feedback.upload(YASH, { name: i + '.png', type: 'image/png', data }).then((f) => f.id)));
  await assert.rejects(feedback.give(YASH, { rep: 'Paula Jimenez', text: 'x', files: ids }), { status: 400 }); // 5 at most
  await assert.rejects(feedback.give(YASH, { rep: 'Paula Jimenez', text: 'x', files: ['../../etc/passwd'] }), { status: 400 });
});
