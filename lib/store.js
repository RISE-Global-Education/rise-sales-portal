// Key/value JSON storage.
//  - On Vercel (or when BLOB_READ_WRITE_TOKEN is set): a PRIVATE Vercel Blob store.
//  - Locally: files in ./data (so `node server.js` works with no setup).
//    Blob reads always go to origin storage (see get), so a read right after a write sees that write.
const fs = require('fs');
const path = require('path');

const useBlob = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL);
const file = (key) => path.join(__dirname, '..', 'data', key + '.json');

async function get(key) {
  if (useBlob()) {
    const { get: blobGet } = require('@vercel/blob');
    // useCache: false - read origin, not the CDN copy. The CDN keeps serving the previous version for a minute or more
    // after an overwrite, and every save here is read-modify-write of the whole file, so a cached read silently undid
    // recent saves (Spam Check dropdowns reverting to "Not checked").
    const r = await blobGet(key + '.json', { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return JSON.parse(await new Response(r.stream).text());
  }
  try { return JSON.parse(fs.readFileSync(file(key), 'utf8')); } catch { return null; }
}

async function put(key, obj) {
  const body = JSON.stringify(obj);
  if (useBlob()) {
    const { put: blobPut } = require('@vercel/blob');
    await blobPut(key + '.json', body, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    return;
  }
  fs.mkdirSync(path.dirname(file(key)), { recursive: true });
  fs.writeFileSync(file(key), body);
}

module.exports = { get, put };
