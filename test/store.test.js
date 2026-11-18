// Blob reads must bypass the CDN cache: every save is read-modify-write of a whole file, and a cached (older) read
// undid recent saves. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

test('Blob reads go to origin storage (useCache: false), never the CDN copy', async () => {
  const calls = [];
  const blobPath = require.resolve('@vercel/blob');
  require.cache[blobPath] = { id: blobPath, filename: blobPath, loaded: true, exports: {
    get: async (p, o) => { calls.push([p, o]); return { statusCode: 200, stream: new Response('{"a":1}').body }; },
  } };
  const prev = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = 'test';
  try {
    delete require.cache[require.resolve('../lib/store')];
    assert.deepEqual(await require('../lib/store').get('spam-checks'), { a: 1 });
    assert.deepEqual(calls, [['spam-checks.json', { access: 'private', useCache: false }]]);
  } finally {
    if (prev === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = prev;
    delete require.cache[blobPath]; delete require.cache[require.resolve('../lib/store')];
  }
});
