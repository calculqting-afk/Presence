const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/controllers/LaunchIntroController.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'assets/js/launch-intro.js'), 'utf8');

function page({ storage = new Map(), reduced = false, blocked = false, search = '' } = {}) {
  const attributes = new Map(), listeners = new Map(), timers = new Map(), motionListeners = new Map();
  let timerId = 0;
  const motion = { matches: reduced, addEventListener: (name, fn) => motionListeners.set(name, fn),
    removeEventListener: (name, fn) => { if (motionListeners.get(name) === fn) motionListeners.delete(name); } };
  const document = { documentElement: { setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name) } };
  const window = { location: { search }, matchMedia: () => motion,
    setTimeout: (callback, ms) => { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout: id => timers.delete(id),
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); } };
  const context = vm.createContext({ window, document, URLSearchParams,
    sessionStorage: { getItem: key => { if (blocked) throw Error('Storage denied'); return storage.get(key); }, setItem: (key, value) => storage.set(key, value) } });
  vm.runInContext(source + '\n' + bootstrap, context);
  return { window, attributes, timers, listeners, motionListeners, storage, controller: vm.runInContext('launchIntro', context) };
}

test('launch intro starts once, sets a 2.5-second deadline and releases all resources', () => {
  const p = page(); assert.equal(p.attributes.has('data-launch-intro'), true);
  assert.equal(p.timers.size, 1); assert.equal([...p.timers.values()][0].ms, 2500);
  p.controller.initialize(); assert.equal(p.timers.size, 1);
  [...p.timers.values()][0].callback();
  assert.equal(p.attributes.has('data-launch-intro'), false); assert.equal(p.timers.size, 0);
  assert.equal(p.listeners.size, 0); assert.equal(p.motionListeners.size, 0);
  p.controller.dispose(); assert.equal(p.attributes.size, 0);
});

test('returning to login in the same session skips intro; a new session can show it', () => {
  const storage = new Map(); page({ storage });
  assert.equal(page({ storage }).attributes.has('data-launch-intro'), false);
  assert.equal(page().attributes.has('data-launch-intro'), true);
});

test('reduced motion, QR links and blocked storage never delay login', () => {
  for (const options of [{ reduced: true }, { search: '?survey=event_1' }, { blocked: true }]) {
    const p = page(options); assert.equal(p.attributes.size, 0); assert.equal(p.timers.size, 0);
  }
});

test('interaction, page exit and switching to reduced motion dismiss the intro immediately', () => {
  for (const name of ['keydown', 'pointerdown', 'pagehide']) {
    const p = page(); p.listeners.get(name)();
    assert.equal(p.attributes.size, 0); assert.equal(p.timers.size, 0); assert.equal(p.listeners.size, 0);
  }
  const p = page(); p.motionListeners.get('change')({ matches: true }); assert.equal(p.attributes.size, 0);
});

test('intro is decorative, fails open without JavaScript and keeps authentication bootstrap unchanged', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'assets/css/launch-intro.css'), 'utf8');
  assert.match(html, /class="launch-intro" aria-hidden="true" hidden/);
  assert.match(html, /class="launch-intro__name">Presence/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /presence-intro-exit 2\.5s/);
  assert.match(css, /100% \{ opacity: 0; visibility: hidden; pointer-events: none;/);
  assert.ok(html.indexOf('launch-intro.js') < html.indexOf('fonts.googleapis.com'));
  assert.doesNotMatch(source + bootstrap, /import.*firebase|fetch\s*\(/i);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'assets/js/script.js'), 'utf8'), /launchIntro/);
  for (const role of ['student', 'admin']) assert.doesNotMatch(fs.readFileSync(path.join(root, `pages/${role}-dashboard.html`), 'utf8'), /launch-intro/);
});
