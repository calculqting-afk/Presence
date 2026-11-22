const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { discoverTests } = require('../../tools/run-tests.cjs');

test('nested test discovery separates emulator suites and rejects unknown selections', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-test-discovery-'));
  try {
    for (const name of ['tests/attendance/nested/qr.test.cjs', 'tests/accounts/login.test.cjs', 'tests/emulator/security.emulator.cjs', 'tests/emulator/hidden.test.cjs', 'tests/attendance/helper.cjs']) {
      const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '');
    }
    assert.equal(discoverTests(root).length, 2);
    assert.equal(discoverTests(root, true).length, 1);
    assert.deepEqual(discoverTests(root, false, ['attendance']).map(file => path.basename(file)), ['qr.test.cjs']);
    assert.deepEqual(discoverTests(root, false, ['qr']).map(file => path.basename(file)), ['qr.test.cjs']);
    assert.throws(() => discoverTests(root, false, ['missing']), /Unknown/);
    assert.throws(() => discoverTests(root, false, ['../attendance']), /Choose/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('emulator execution refuses missing or nonlocal addresses before running suites', () => {
  for (const host of ['', 'production.example:8080']) {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../tools/run-tests.cjs'), '--emulator'], {
      env: { ...process.env, FIRESTORE_EMULATOR_HOST: host }, encoding: 'utf8', cwd: os.tmpdir()
    });
    assert.equal(result.status, 1); assert.match(result.stderr, /No emulator tests were started/);
  }
});
