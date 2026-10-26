import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

for (const script of ['bootstrap', 'smoke']) {
  test(`${script} fails explicitly when integration inputs are absent`, () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', `scripts/${script}.ts`],
      { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing configuration:/);
    assert.doesNotMatch(result.stdout, /PASS/);
  });
}
