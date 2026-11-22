/* File storage in Cloudflare R2 (S3-compatible), used for profile photos.

   Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (an R2 API token with
   "Object Read & Write" on the bucket). R2_BUCKET defaults to "worklay".
   Optional:
   - R2_PUBLIC_URL: the bucket's public custom domain (e.g. https://files.worklay.com). When set,
     photos are linked there directly; otherwise the bucket stays private and the app serves them.
   - R2_ENDPOINT: override the S3 endpoint (e.g. https://<account>.eu.r2.cloudflarestorage.com for
     EU-jurisdiction buckets, or a local S3-compatible server for testing).
   Without the keys, uploads are switched off. */
import { AwsClient } from 'aws4fetch';

export function createStorage() {
  const accountId = process.env.R2_ACCOUNT_ID || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
  const bucket = process.env.R2_BUCKET || 'worklay';
  const endpoint = (process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')).replace(/\/+$/, '');
  const publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
  const enabled = !!(endpoint && accessKeyId && secretAccessKey);
  const client = enabled ? new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' }) : null;

  // Keys only ever contain [a-z0-9/._-], so path segments need no extra encoding.
  const objectUrl = key => `${endpoint}/${bucket}/${key}`;

  async function put(key, body, contentType) {
    const r = await client.fetch(objectUrl(key), {
      method: 'PUT', body,
      headers: { 'Content-Type': contentType, 'Content-Length': String(body.length), 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
    if (!r.ok) throw new Error(`Storage upload failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  }

  // Returns the fetch Response (body is a stream) or null if the object doesn't exist.
  async function get(key) {
    const r = await client.fetch(objectUrl(key));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Storage download failed (${r.status})`);
    return r;
  }

  async function remove(key) {
    const r = await client.fetch(objectUrl(key), { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw new Error(`Storage delete failed (${r.status})`);
  }

  // Link used by the front end: direct from the public domain if there is one, otherwise via the app.
  const urlFor = key => (key ? (publicUrl ? `${publicUrl}/${key}` : `/api/files/${key}`) : null);

  return { enabled, put, get, remove, urlFor };
}

// Recognise real image files by their first bytes instead of trusting the browser's file type.
export function detectImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}
