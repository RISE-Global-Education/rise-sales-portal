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
  assert.equal(feedbackAccess('sushant@riseresearch.com', 'Sushant'), null);
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
