const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

async function build() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'mobile-web');
  fs.mkdirSync(output, { recursive: true });
  // Explicit public-file allowlist: never copy backend scripts or credentials.
  for (const entry of ['index.html', 'assets', 'pages']) {
    fs.cpSync(path.join(root, entry), path.join(output, entry), { recursive: true });
  }
  fs.mkdirSync(path.join(output, 'config'), { recursive: true });
  fs.copyFileSync(path.join(root, 'config/firebase-config.js'), path.join(output, 'config/firebase-config.js'));
  await esbuild.build({ entryPoints: [path.join(root, 'mobile/native-bridge.js')], bundle: true, format: 'iife',
    outfile: path.join(output, 'assets/vendor/presence-native.js'), minify: true, target: 'es2022' });
  for (const file of [path.join(output, 'index.html'), ...fs.readdirSync(path.join(output, 'pages')).filter(name => name.endsWith('.html')).map(name => path.join(output, 'pages', name))]) {
    const prefix = path.dirname(file) === output ? '' : '../';
    const html = fs.readFileSync(file, 'utf8').replace('<head>', `<head>\n  <script src="${prefix}assets/vendor/presence-native.js"></script>`);
    fs.writeFileSync(file, html);
  }
  console.log('Public website files and native bridge built in mobile-web.');
}
build().catch(error => { console.error(error); process.exitCode = 1; });
