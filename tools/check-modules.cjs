const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
const scripts = [...files('assets/js'), ...files('assets/vendor'), ...files('config'), 'functions/index.js', 'functions/recover-student-password.cjs'];
let failed = false;
for (const file of scripts.filter(file => /\.(?:js|cjs)$/.test(file))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { failed = true; process.stderr.write(result.stderr); }
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/(?:from\s*|import\s*\()(["'])(\.[^"']+)\1/g)) {
    const target = path.resolve(path.dirname(file), match[2].split('?')[0]);
    if (!fs.existsSync(target)) { failed = true; console.error(`${file}: missing module ${match[2]}`); }
  }
}
JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
if (failed) process.exitCode = 1;
else console.log('JavaScript syntax, local import paths, and hosting JSON passed.');
