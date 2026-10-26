import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/server/config.js';

const env = {
  ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  ENTRA_SPA_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
  ENTRA_API_AUDIENCE: '33333333-3333-4333-8333-333333333333',
  OPENTDF_PLATFORM_URL: 'https://platform.example.test',
  OPENTDF_ATTRIBUTE: 'https://example.test/attr/project/value/alpha',
  AZURE_STORAGE_ACCOUNT_URL: 'https://test.blob.core.windows.net',
};

test('loads explicit public identity configuration without exposing environment secrets', () => {
  const result = loadConfig({ ...env, UNRELATED_SECRET: 'do-not-expose' });
  assert.equal(result.apiScope, `api://${env.ENTRA_API_AUDIENCE}/Files.Access`);
  assert.equal(result.kasUrl, `${env.OPENTDF_PLATFORM_URL}/kas`);
  assert.equal(result.port, 3000);
  assert.equal('UNRELATED_SECRET' in result, false);
});

test('rejects missing identity and unsafe or mismatched endpoint configuration', () => {
  for (const overrides of [
    { ENTRA_TENANT_ID: '' },
    { ENTRA_API_AUDIENCE: 'not-a-guid' },
    { OPENTDF_PLATFORM_URL: 'http://public.example.test' },
    { OPENTDF_PLATFORM_URL: 'https://user:pass@platform.example.test' },
    { OPENTDF_KAS_URL: 'https://untrusted.example.test/kas' },
    { AZURE_STORAGE_ACCOUNT_URL: 'https://storage.example.test?secret=key' },
    { PORT: 'NaN' },
  ]) {
    assert.throws(() => loadConfig({ ...env, ...overrides }));
  }
});
