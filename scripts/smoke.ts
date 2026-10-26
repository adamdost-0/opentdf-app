import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { PublicConfig } from '../src/shared.js';
import { MAX_CIPHER_BYTES } from '../src/shared.js';
import { collectBytes, decryptFile } from '../src/web/tdf.js';
import { isPolicyDenial } from './smoke-checks.js';
import { required, reportFailure, trustedEndpoint } from './settings.js';

async function main() {
  const apiUrl = trustedEndpoint(required('SMOKE_API_URL'));
  const platformUrl = trustedEndpoint(required('OPENTDF_PLATFORM_URL'));
  const id = required('SMOKE_FILE_ID');
  const allowed = required('SMOKE_ALLOW_TOKEN');
  const mode = process.env.SMOKE_MODE ?? 'allow-deny';
  if (!['allow-deny', 'revoked'].includes(mode)) {
    throw new Error('SMOKE_MODE must be allow-deny or revoked');
  }
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid SMOKE_FILE_ID');
  const denied =
    mode === 'allow-deny' ? required('SMOKE_DENY_TOKEN') : undefined;
  const expected =
    mode === 'revoked'
      ? required('SMOKE_EXPECTED_SHA256')
      : process.env.SMOKE_EXPECTED_SHA256;
  if (expected && !/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error(
      'SMOKE_EXPECTED_SHA256 must be a lowercase SHA-256 hex digest',
    );
  }
  const configResponse = await fetch(`${apiUrl}/api/config`, {
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  if (!configResponse.ok)
    throw new Error('Application configuration unavailable');
  const config: PublicConfig = await configResponse.json();
  if (
    config.platformUrl !== platformUrl ||
    new URL(config.kasUrl).origin !== new URL(platformUrl).origin
  ) {
    throw new Error(
      'Application configuration does not match the trusted platform',
    );
  }
  async function retrieve(token: string) {
    const response = await fetch(
      `${apiUrl}/api/files/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      },
    );
    if (!response.ok || !response.body) {
      throw new Error(
        `Ciphertext retrieval failed (${response.status}); not a KAS denial`,
      );
    }
    return collectBytes(response.body, MAX_CIPHER_BYTES);
  }
  async function expectDenial(bytes: Uint8Array, token: string) {
    try {
      await decryptFile(bytes, config, async () => token);
    } catch (error) {
      if (!isPolicyDenial(error)) throw error;
      return;
    }
    throw new Error(
      'FAIL: KAS released plaintext when a policy denial was expected',
    );
  }
  const bytes = await retrieve(allowed);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expected) assert.equal(sha256, expected, 'Ciphertext changed');
  if (mode === 'revoked') {
    await expectDenial(bytes, allowed);
    console.log(JSON.stringify({ result: 'PASS', mode, id, sha256 }));
    return;
  }
  const plaintext = await decryptFile(bytes, config, async () => allowed);
  plaintext.fill(0);
  assert.ok(denied);
  const deniedBytes = await retrieve(denied);
  assert.deepEqual(
    deniedBytes,
    bytes,
    'The two identities retrieved different ciphertext',
  );
  await expectDenial(deniedBytes, denied);
  console.log(JSON.stringify({ result: 'PASS', mode, id, sha256 }));
}

main().catch(reportFailure);
