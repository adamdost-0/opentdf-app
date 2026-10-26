import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PermissionDeniedError, NetworkError } from '@opentdf/sdk';
import { isPolicyDenial } from '../scripts/smoke-checks.js';

test('accepts an explicit SDK permission denial including a wrapped cause', () => {
  assert.equal(isPolicyDenial(new PermissionDeniedError('denied')), true);
  assert.equal(
    isPolicyDenial(
      new Error('decrypt failed', {
        cause: new PermissionDeniedError('denied'),
      }),
    ),
    true,
  );
});

test('does not mistake network, authentication, or arbitrary failures for policy denial', () => {
  for (const error of [
    new NetworkError('unavailable'),
    new Error('403 forbidden'),
    new Error('token expired'),
    undefined,
  ]) {
    assert.equal(isPolicyDenial(error), false);
  }
});
