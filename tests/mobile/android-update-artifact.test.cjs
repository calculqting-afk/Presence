const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { AndroidUpdateArtifactService } = require('../../tools/android-update-artifact.cjs');

test('Android update artifacts use actual built APK metadata and checksum', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-update-test-'));
  try {
    const directory = path.join(root, 'android/app/build/outputs/apk/beta');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'app-beta.apk'), 'test-apk-bytes');
    fs.writeFileSync(path.join(root, 'RELEASE_NOTES_v1.2.md'), 'A'.repeat(4000));
    fs.mkdirSync(path.join(root, 'config'));
    fs.writeFileSync(path.join(root, 'config/update-highlights.json'), JSON.stringify({ '1.2': ['Clearer updates.', 'Faster retry.'] }));
    fs.writeFileSync(path.join(directory, 'output-metadata.json'), JSON.stringify({
      applicationId: 'io.github.calculatingafk.presence',
      elements: [{ versionCode: 3, versionName: '1.2', outputFile: 'app-beta.apk' }],
    }));
    const service = new AndroidUpdateArtifactService(root);
    const manifest = service.create('beta');
    assert.equal(manifest.versionCode, 3);
    assert.equal(manifest.versionName, '1.2');
    assert.equal(manifest.apkUrl, 'https://github.com/calculqting-afk/Presence/releases/download/v1.2/Presence.apk');
    assert.equal(manifest.sizeBytes, Buffer.byteLength('test-apk-bytes'));
    assert.equal(manifest.notes, '• Clearer updates.\n• Faster retry.');
    assert.doesNotMatch(manifest.notes, /AAAA/);
    assert.equal(service.highlights('1.3'), '');
    fs.writeFileSync(path.join(root, 'config/update-highlights.json'), JSON.stringify({ '1.2': ['A'.repeat(141)] }));
    assert.throws(() => service.highlights('1.2'), /short/);
    assert.equal(manifest.sha256, crypto.createHash('sha256').update('test-apk-bytes').digest('hex'));
    assert.equal(fs.readFileSync(path.join(directory, 'Presence.apk'), 'utf8'), 'test-apk-bytes');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'presence-update.json'))), manifest);
    assert.throws(() => service.create('../release'), /Unsupported/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
