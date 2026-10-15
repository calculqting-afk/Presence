const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('login hero omits benefit rows and keeps a compact gap before the login card', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../assets/css/style.css'), 'utf8');
  assert.doesNotMatch(html, /Fast check-in|Clear records|class="feature-row"/);
  assert.match(html, /id="hero-title"/);
  assert.match(html, /id="loginForm"/);
  assert.match(css, /\.hero-intro\s*\{[^}]*margin:\s*30px 0 0;/);
  assert.match(css, /@media \(max-width: 880px\)\s*\{\s*\.hero\s*\{[^}]*gap:\s*32px;/);
});
