import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAuthenticator } from '../src/server/auth.js';
import { HttpError } from '../src/server/errors.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const apiAudience = '22222222-2222-4222-8222-222222222222';
const spaClientId = '33333333-3333-4333-8333-333333333333';
const config = { tenantId, apiAudience, spaClientId };
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let authenticate: ReturnType<typeof createAuthenticator>;

before(async () => {
  keys = await generateKeyPair('RS256');
  const publicKey = await exportJWK(keys.publicKey);
  authenticate = createAuthenticator(
    config,
    createLocalJWKSet({ keys: [{ ...publicKey, kid: 'test', alg: 'RS256' }] }),
  );
});

async function issueToken(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    tid: tenantId,
    azp: spaClientId,
    ver: '2.0',
    roles: ['Files.User'],
    scp: 'Files.Access',
    iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    aud: apiAudience,
    sub: 'test-user',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .sign(keys.privateKey);
}

test('accepts a correctly signed delegated file-user token', async () => {
  await authenticate(`Bearer ${await issueToken()}`);
});

for (const [label, claims] of [
  ['wrong audience', { aud: 'graph' }],
  ['wrong issuer', { iss: 'https://untrusted.example' }],
  ['expired token', { exp: 1 }],
  ['wrong tenant', { tid: 'another-tenant' }],
  ['wrong calling app', { azp: 'another-client' }],
  ['missing role', { roles: ['Project.Alpha'] }],
  ['role substring', { roles: ['Files.User.Admin'] }],
  ['missing delegated scope', { scp: undefined }],
  ['scope substring', { scp: 'Files.Access.All' }],
] as const) {
  test(`rejects ${label}`, async () => {
    await assert.rejects(
      authenticate(`Bearer ${await issueToken(claims)}`),
      HttpError,
    );
  });
}

test('rejects missing and malformed authorization headers', async () => {
  for (const header of [
    undefined,
    '',
    'Basic test',
    'Bearer a b',
    'Bearer bad',
  ]) {
    await assert.rejects(authenticate(header), HttpError);
  }
});
