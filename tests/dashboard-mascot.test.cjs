const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('both dashboards have one decorative mascot with motion fallback and no pause checkbox', () => {
  for (const role of ['admin', 'student']) {
    const html = fs.readFileSync(path.join(root, `pages/${role}-dashboard.html`), 'utf8');
    assert.equal((html.match(/class="welcome-mascot"/g) || []).length, 1);
    assert.doesNotMatch(html, /welcome-mascot-pause|welcome-mascot-control|welcomeMascotPause/);
    assert.match(html, /prefers-reduced-motion: reduce/);
    assert.match(html, /class="welcome-mascot-still"/);
    assert.ok(html.indexOf('prefers-reduced-motion') < html.indexOf('image/webp'));
    for (const asset of html.matchAll(/(?:src|srcset)="(\.\.\/assets\/emoji\/[^\"]+)"/g)) {
      assert.ok(fs.statSync(path.resolve(root, 'pages', asset[1])).size > 0);
    }
    assert.match(html, role === 'admin' ? /data-go-view="create">＋ Create event/ : /data-go-view="events"><span>◇<\/span> View events/);
  }
});

test('mascot floats with transforms and disables all motion for reduced motion', () => {
  const css = fs.readFileSync(path.join(root, 'assets/css/dashboard.css'), 'utf8');
  assert.match(css, /@keyframes presence-mascot-float[^\n]+translateY\(-5px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.welcome-mascot-motion[^}]+display: none; animation: none;/);
  assert.doesNotMatch(css, /welcome-mascot-pause|welcome-mascot-control/);
  const build = fs.readFileSync(path.join(root, 'tools/build-mobile.cjs'), 'utf8');
  assert.match(build, /\['index.html', 'assets', 'pages'\]/);
});
