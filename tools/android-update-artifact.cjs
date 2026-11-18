const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class AndroidUpdateArtifactService {
  constructor(root = path.resolve(__dirname, '..')) { this.root = root; }

  highlights(version) {
    const file = path.join(this.root, 'config/update-highlights.json');
    if (!fs.existsSync(file)) return '';
    const entries = JSON.parse(fs.readFileSync(file, 'utf8'))[version] || [];
    if (!Array.isArray(entries) || entries.length > 3
        || entries.some(text => typeof text !== 'string' || !text.trim() || text.length > 140 || /[\r\n]/.test(text))) {
      throw new Error('Update highlights must contain up to three short, single-line changes');
    }
    return entries.map(text => '• ' + text.trim()).join('\n');
  }

  create(variant = 'debug') {
    if (!['debug', 'beta'].includes(variant)) throw new Error('Unsupported APK variant');
    const directory = path.join(this.root, 'android/app/build/outputs/apk', variant);
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'output-metadata.json'), 'utf8'));
    const element = metadata.elements[0];
    if (!element || !Number.isInteger(element.versionCode) || element.versionCode < 1
        || path.basename(element.outputFile) !== element.outputFile) throw new Error('Invalid APK build metadata');
    const source = path.join(directory, element.outputFile);
    if (!/^[0-9]+(?:\.[0-9]+){1,3}$/.test(element.versionName)) throw new Error('Invalid APK version name');
    const destination = path.join(directory, 'Presence.apk');
    fs.copyFileSync(source, destination);
    const manifest = {
      packageId: metadata.applicationId,
      versionCode: element.versionCode,
      versionName: element.versionName,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex'),
      apkUrl: `https://github.com/calculqting-afk/Presence/releases/download/v${element.versionName}/Presence.apk`,
      sizeBytes: fs.statSync(destination).size,
      notes: this.highlights(element.versionName),
    };
    fs.writeFileSync(path.join(directory, 'presence-update.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`GitHub release assets ready: ${destination} and presence-update.json`);
    return manifest;
  }
}

module.exports = { AndroidUpdateArtifactService };
