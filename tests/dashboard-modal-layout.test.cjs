const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('mobile dashboard modals stay centered with viewport-bounded internal scrolling', () => {
  const css = fs.readFileSync(path.join(root, 'assets/css/dashboard.css'), 'utf8');
  const backdrops = [...css.matchAll(/\.dashboard-modal-backdrop\s*\{([^}]+)\}/g)].map(match => match[1]);
  assert.match(backdrops[0], /place-items:\s*center/);
  assert.match(backdrops.at(-1), /align-items:\s*center/);
  assert.doesNotMatch(backdrops.at(-1), /align-items:\s*start/);
  assert.match(backdrops.at(-1), /padding:\s*12px/);
  assert.match(css, /\.dashboard-modal\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.dashboard-modal\s*\{\s*max-height:\s*calc\(100dvh - 24px\)/);
  for (const role of ['student', 'admin']) {
    const html = fs.readFileSync(path.join(root, `pages/${role}-dashboard.html`), 'utf8');
    assert.match(html, /dashboard\.css\?v=20261024-approval-badge/);
  }
});
