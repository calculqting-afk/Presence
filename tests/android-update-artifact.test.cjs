const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { AndroidUpdateArtifactService } = require('../tools/android-update-artifact.cjs');

test('Android update artifacts use actual built APK metadata and checksum', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-update-test-'));
  try {
    const directory = path.join(root, 'android/app/build/outputs/apk/beta');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'app-beta.apk'), 'test-apk-bytes');
    fs.writeFileSync(path.join(directory, 'output-metadata.json'), JSON.stringify({
      applicationId: 'io.github.calculatingafk.presence',
      elements: [{ versionCode: 3, versionName: '1.2', outputFile: 'app-beta.apk' }],
    }));
    const service = new AndroidUpdateArtifactService(root);
    const manifest = service.create('beta');
    assert.equal(manifest.versionCode, 3);
    assert.equal(manifest.versionName, '1.2');
    assert.equal(manifest.sha256, crypto.createHash('sha256').update('test-apk-bytes').digest('hex'));
    assert.equal(fs.readFileSync(path.join(directory, 'Presence.apk'), 'utf8'), 'test-apk-bytes');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'presence-update.json'))), manifest);
    assert.throws(() => service.create('../release'), /Unsupported/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
