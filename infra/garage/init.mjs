// Prepares the object store (ADR 0029; in production from the API image, ADR 0033) through Garage's admin API:
// gives the single node its role, imports the API's key and creates the
// documents bucket the key may read and write. Safe to run again: each step is
// skipped when already done.
import { readFileSync } from 'node:fs';

const ADMIN = process.env.GARAGE_ADMIN_URL ?? 'http://garage:3903';
const token = readFileSync(process.env.GARAGE_ADMIN_TOKEN_FILE, 'utf8').trim();
const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
const secretAccessKey = readFileSync(process.env.STORAGE_SECRET_ACCESS_KEY_FILE, 'utf8').trim();
const bucket = process.env.STORAGE_BUCKET ?? 'pythagoras-documents';
const capacity = Number(process.env.STORAGE_CAPACITY_GB ?? 10) * 1024 ** 3;
const tag = process.env.STORAGE_NODE_TAG ?? 'dev';

async function call(method, path, body) {
  const response = await fetch(`${ADMIN}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) return { ok: false, status: response.status, text };
  return { ok: true, value: text ? JSON.parse(text) : null };
}
const must = async (method, path, body) => {
  const result = await call(method, path, body);
  if (!result.ok) throw new Error(`${method} ${path}: ${result.status} ${result.text.slice(0, 300)}`);
  return result.value;
};

const status = await must('GET', '/v2/GetClusterStatus');
const layout = await must('GET', '/v2/GetClusterLayout');
if (layout.roles.length === 0) {
  const node = status.nodes[0].id;
  await must('POST', '/v2/UpdateClusterLayout', { roles: [{ id: node, zone: 'dc1', capacity, tags: [tag] }] });
  await must('POST', '/v2/ApplyClusterLayout', { version: layout.version + 1 });
  console.log(`storage: node ${node.slice(0, 16)} given its role`);
}

const key = await call('GET', `/v2/GetKeyInfo?id=${encodeURIComponent(accessKeyId)}`);
if (!key.ok) {
  await must('POST', '/v2/ImportKey', { accessKeyId, secretAccessKey, name: 'pythagoras-api' });
  console.log('storage: API key imported');
}

let info = await call('GET', `/v2/GetBucketInfo?globalAlias=${encodeURIComponent(bucket)}`);
if (!info.ok) {
  await must('POST', '/v2/CreateBucket', { globalAlias: bucket });
  info = await call('GET', `/v2/GetBucketInfo?globalAlias=${encodeURIComponent(bucket)}`);
  console.log(`storage: bucket ${bucket} created`);
}
const granted = info.value.keys.find((k) => k.accessKeyId === accessKeyId);
if (!granted?.permissions?.read || !granted?.permissions?.write) {
  await must('POST', '/v2/AllowBucketKey', {
    bucketId: info.value.id,
    accessKeyId,
    permissions: { read: true, write: true, owner: false },
  });
  console.log('storage: API key may read and write the bucket');
}
console.log('storage: ready');
