const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

class AndroidBuildService {
  constructor(root = path.resolve(__dirname, '..')) { this.root = root; }
  build() {
    const portable = path.join(this.root, '.android-tools/jdk21');
    const installed = fs.existsSync(portable) ? fs.readdirSync(portable).map(name => path.join(portable, name))
      .find(directory => fs.existsSync(path.join(directory, 'bin/java.exe'))) : undefined;
    const javaHome = installed || process.env.JAVA_HOME;
    if (!javaHome) throw new Error('Configure JAVA_HOME with JDK 21, or select JDK 21 in Android Studio. See ANDROID.md.');
    const result = spawnSync(process.platform === 'win32' ? 'cmd.exe' : './gradlew',
      process.platform === 'win32' ? ['/d', '/s', '/c', 'gradlew.bat assembleDebug'] : ['assembleDebug'],
      { cwd: path.join(this.root, 'android'), env: { ...process.env, JAVA_HOME: javaHome }, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
}
try { new AndroidBuildService().build(); } catch (error) { console.error(error.message); process.exitCode = 1; }
