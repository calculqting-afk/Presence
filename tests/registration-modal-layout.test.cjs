const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('registration errors use theme-aware red instead of dialog paragraph muted text', () => {
  const css = fs.readFileSync(path.join(__dirname, '../assets/css/style.css'), 'utf8');
  assert.match(css, /\.dialog \.registration-error\s*\{[^}]*color:\s*var\(--danger\)/);
});

test('registration dialogs bound their height to the viewport and scroll internally', () => {
  const css = fs.readFileSync(path.join(__dirname, '../assets/css/style.css'), 'utf8');
  const rule = css.match(/\.registration-dialog\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule, 'Shared registration dialog rule exists');
  assert.match(rule, /box-sizing:\s*border-box/);
  assert.match(rule, /min-height:\s*0/);
  assert.match(rule, /max-height:\s*calc\(100vh - 48px\)/);
  assert.match(rule, /max-height:\s*calc\(100dvh - 48px\)/);
  assert.match(rule, /overflow-y:\s*auto/);
  assert.match(rule, /overscroll-behavior-y:\s*contain/);
  assert.doesNotMatch(css, /\.registration-dialog\s*\{[^}]*max-height:\s*none/);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  for (const id of ['registrationDialog', 'registrationStatusDialog']) {
    assert.match(html, new RegExp(`id="${id}"[\\s\\S]*?<section class="[^"]*registration-dialog`));
  }
});

test('registration submit appears above Cancel in visual and keyboard order', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const form = html.match(/<form id="registrationForm"[\s\S]*?<\/form>/)?.[0];
  assert.ok(form);
  assert.match(form, /Send registration request<\/button>\s*<button[^>]*data-close-registration[^>]*>Cancel<\/button>/);
  const css = fs.readFileSync(path.join(__dirname, '../assets/css/style.css'), 'utf8');
  assert.match(css, /#registrationForm \.dialog-actions\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*flex-direction:\s*column;[^}]*align-items:\s*center/);
  assert.match(css, /#registrationForm \.dialog-actions \.dialog-action\s*\{[^}]*width:\s*min\(100%, 320px\)/);
  assert.match(css, /\.dialog \.registration-error\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
});
