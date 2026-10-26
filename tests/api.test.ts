import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server/app.js';
import { HttpError } from '../src/server/errors.js';
import { MAX_CIPHER_BYTES } from '../src/shared.js';
import type { FileStore } from '../src/server/storage.js';

const config = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  spaClientId: '22222222-2222-4222-8222-222222222222',
  apiAudience: '33333333-3333-4333-8333-333333333333',
  apiScope: 'api://33333333-3333-4333-8333-333333333333/Files.Access',
  platformUrl: 'https://platform.example.test',
  kasUrl: 'https://platform.example.test/kas',
  attribute: 'https://example.test/attr/project/value/alpha',
};
const stored = new Map<string, Buffer>();
const store: FileStore = {
  async list() {
    return {
      files: [...stored].map(([id, bytes]) => ({
        id,
        size: bytes.length,
        createdAt: '2026-10-25T00:00:00Z',
      })),
      hasMore: false,
    };
  },
  async put(id, bytes) {
    stored.set(id, bytes);
  },
  async get(id) {
    const bytes = stored.get(id);
    if (!bytes) throw new HttpError(404, 'file_not_found');
    return bytes;
  },
};
let app: Awaited<ReturnType<typeof buildApp>>;
const authorization = 'Bearer test';
const ciphertext = Buffer.from([0x50, 0x4b, 0x03, 0x04, 42, 43]);

beforeEach(async () => {
  stored.clear();
  app = await buildApp(config, store, async (header) => {
    if (header !== authorization) throw new HttpError(401, 'invalid_token');
  });
});
afterEach(async () => app.close());

test('protects file endpoints but exposes only public configuration', async () => {
  assert.equal((await app.inject('/api/files')).statusCode, 401);
  const result = await app.inject('/api/config');
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json(), config);
});

test('requires authentication on percent-encoded file routes', async () => {
  const id = randomUUID();
  for (const request of [
    { method: 'GET' as const, url: '/api/%66iles' },
    {
      method: 'POST' as const,
      url: '/api/%66iles',
      headers: { 'content-type': 'application/octet-stream' },
      payload: ciphertext,
    },
    { method: 'GET' as const, url: `/api/%66iles/${id}` },
  ]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 401);
  }
  assert.equal(stored.size, 0);
});

test('stores and returns identical bytes without plaintext processing', async () => {
  const upload = await app.inject({
    method: 'POST',
    url: '/api/files',
    headers: { authorization, 'content-type': 'application/octet-stream' },
    payload: ciphertext,
  });
  assert.equal(upload.statusCode, 201);
  const { id } = upload.json<{ id: string }>();
  const download = await app.inject({
    url: `/api/files/${id}`,
    headers: { authorization },
  });
  assert.equal(download.statusCode, 200);
  assert.deepEqual(download.rawPayload, ciphertext);
  assert.equal(download.headers['cache-control'], 'no-store');
  const listing = await app.inject({
    url: '/api/files',
    headers: { authorization },
  });
  assert.equal(listing.json().files[0].id, id);
});

test('rejects plaintext content types and non-TDF prefixes', async () => {
  for (const contentType of ['text/plain', 'application/json']) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/files',
      headers: { authorization, 'content-type': contentType },
      payload: 'plaintext',
    });
    assert.equal(response.statusCode, 415);
  }
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/files',
    headers: { authorization, 'content-type': 'application/octet-stream' },
    payload: 'plaintext',
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(stored.size, 0);
});

test('rejects oversized bytes and invalid identifiers', async () => {
  const oversized = await app.inject({
    method: 'POST',
    url: '/api/files',
    headers: { authorization, 'content-type': 'application/octet-stream' },
    payload: Buffer.alloc(MAX_CIPHER_BYTES + 1),
  });
  assert.equal(oversized.statusCode, 413);
  const invalid = await app.inject({
    url: '/api/files/not-a-uuid',
    headers: { authorization },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(stored.size, 0);
});

test('missing files and infrastructure errors are not successful downloads', async () => {
  const missing = await app.inject({
    url: `/api/files/${randomUUID()}`,
    headers: { authorization },
  });

  assert.equal(missing.statusCode, 404);
  const failing = await buildApp(
    config,
    {
      ...store,
      async list() {
        throw new Error('sensitive internal details');
      },
    },
    async () => {},
  );
  try {
    const response = await failing.inject('/api/files');
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'service_unavailable');
    assert.doesNotMatch(response.body, /sensitive internal/);
    assert.ok(response.json().requestId);
  } finally {
    await failing.close();
  }
});

test('serves the production index without duplicating the static plugin route', async () => {
  const production = await buildApp(
    config,
    store,
    async () => {},
    fileURLToPath(new URL('./fixtures/', import.meta.url)),
  );
  try {
    const response = await production.inject('/');
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /OpenTDF fixture/);
    assert.equal((await production.inject('/api/missing')).statusCode, 404);
  } finally {
    await production.close();
  }
});
