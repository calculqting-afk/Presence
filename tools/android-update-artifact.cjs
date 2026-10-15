const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class AndroidUpdateArtifactService {
  constructor(root = path.resolve(__dirname, '..')) { this.root = root; }

  create(variant = 'debug') {
    if (!['debug', 'beta'].includes(variant)) throw new Error('Unsupported APK variant');
    const directory = path.join(this.root, 'android/app/build/outputs/apk', variant);
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'output-metadata.json'), 'utf8'));
    const element = metadata.elements[0];
    if (!element || !Number.isInteger(element.versionCode) || element.versionCode < 1
        || path.basename(element.outputFile) !== element.outputFile) throw new Error('Invalid APK build metadata');
    const source = path.join(directory, element.outputFile);
    const destination = path.join(directory, 'Presence.apk');
    fs.copyFileSync(source, destination);
    const manifest = {
      packageId: metadata.applicationId,
      versionCode: element.versionCode,
      versionName: element.versionName,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex'),
    };
    fs.writeFileSync(path.join(directory, 'presence-update.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`GitHub release assets ready: ${destination} and presence-update.json`);
    return manifest;
  }
}

module.exports = { AndroidUpdateArtifactService };
