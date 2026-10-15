const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AndroidUpdateArtifactService } = require('./android-update-artifact.cjs');

class AndroidBuildService {
  constructor(root = path.resolve(__dirname, '..')) { this.root = root; }
  build() {
    const portable = path.join(this.root, '.android-tools/jdk21');
    const installed = fs.existsSync(portable) ? fs.readdirSync(portable).map(name => path.join(portable, name))
      .find(directory => fs.existsSync(path.join(directory, 'bin/java.exe'))) : undefined;
    const javaHome = installed || process.env.JAVA_HOME;
    if (!javaHome) throw new Error('Configure JAVA_HOME with JDK 21, or select JDK 21 in Android Studio. See ANDROID.md.');
    const task = process.argv.includes('--beta') ? 'assembleBeta' : 'assembleDebug';
    const result = spawnSync(process.platform === 'win32' ? 'cmd.exe' : './gradlew',
      process.platform === 'win32' ? ['/d', '/s', '/c', `gradlew.bat ${task}`] : [task],
      { cwd: path.join(this.root, 'android'), env: { ...process.env, JAVA_HOME: javaHome }, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    if (result.status === 0) new AndroidUpdateArtifactService(this.root).create(process.argv.includes('--beta') ? 'beta' : 'debug');
  }
}
try { new AndroidBuildService().build(); } catch (error) { console.error(error.message); process.exitCode = 1; }
