const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const projectRoot = path.resolve(__dirname, '..');

function discoverTests(root = projectRoot, emulator = false, filters = []) {
  const directory = path.join(root, 'tests');
  const files = [];
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const relative = path.relative(directory, file).split(path.sep).join('/');
        if (emulator ? relative.startsWith('emulator/') && relative.endsWith('.emulator.cjs')
          : !relative.startsWith('emulator/') && relative.endsWith('.test.cjs')) files.push(file);
      }
    }
  }
  walk(directory);
  if (!filters.length) return files;
  for (const filter of filters) {
    if (!/^[a-z0-9-]+$/.test(filter)) throw Error('Choose a test group or filename without its suffix.');
    if (!files.some(file => matches(file, filter))) throw Error('Unknown test group or filename: ' + filter);
  }
  return files.filter(file => filters.some(filter => matches(file, filter)));
  function matches(file, filter) {
    return path.relative(directory, file).split(path.sep)[0] === filter
      || path.basename(file).replace(/\.(?:test|emulator)\.cjs$/, '') === filter;
  }
}

function main(args = process.argv.slice(2)) {
  const emulator = args.includes('--emulator'), list = args.includes('--list');
  const unknown = args.find(arg => arg.startsWith('--') && !['--emulator', '--list'].includes(arg));
  if (unknown) throw Error('Unknown test option: ' + unknown);
  const files = discoverTests(projectRoot, emulator, args.filter(arg => !arg.startsWith('--')));
  if (!files.length) throw Error('No matching test files found.');
  if (list) {
    for (const file of files) console.log(path.relative(projectRoot, file).split(path.sep).join('/'));
    console.log(files.length + (emulator ? ' emulator' : ' regular') + ' test files');
    return;
  }
  if (emulator && !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
    throw Error('Set FIRESTORE_EMULATOR_HOST to a running local emulator (127.0.0.1:PORT). No emulator tests were started.');
  }
  const batches = emulator ? files.map(file => [file]) : [['--test', ...files]];
  // Emulator suites share demo data, so run them sequentially and stop on failure.
  for (const batch of batches) {
    const result = spawnSync(process.execPath, ['--experimental-vm-modules', ...batch], { cwd: projectRoot, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status || 1; return; }
  }
}
module.exports = { discoverTests, main };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
