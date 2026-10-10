const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/login-theme.js'), 'utf8');

function page(saved, blocked = false) {
  const events = {}, attributes = {}, writes = [], registrations = {};
  const addEvent = (name, callback) => { events[name] = callback; registrations[name] = (registrations[name] || 0) + 1; };
  const removeEvent = (name, callback) => { if (events[name] === callback) delete events[name]; };
  const root = { dataset: {} }, label = {}, meta = {};
  const button = { setAttribute: (name, value) => { attributes[name] = value; }, addEventListener: addEvent, removeEventListener: removeEvent };
  const storage = {
    getItem: () => { if (blocked) throw Error('Storage denied'); return saved; },
    setItem: (key, value) => { if (blocked) throw Error('Storage denied'); writes.push([key, value]); }
  };
  const context = vm.createContext({
    localStorage: storage,
    document: { readyState: 'loading', documentElement: root, querySelector: selector => selector === '#themeToggle' ? button : selector === '#themeToggleLabel' ? label : { setAttribute: (name, value) => { meta[name] = value; } },
      addEventListener: addEvent, removeEventListener: removeEvent },
    window: { addEventListener: addEvent, removeEventListener: removeEvent }
  });
  vm.runInContext(source, context);
  const controller = vm.runInContext('loginThemeController', context);
  return { events, attributes, root, label, writes, meta, storage, controller, registrations };
}

test('login theme defaults to light and restores only valid saved choices before DOM ready', () => {
  for (const saved of [null, undefined, 'invalid', 'light']) assert.equal(page(saved).root.dataset.theme, 'light');
  const dark = page('dark'); assert.equal(dark.root.dataset.theme, 'dark'); assert.equal(dark.meta.content, '#0b1426');
  dark.events.DOMContentLoaded(); assert.equal(dark.attributes['aria-pressed'], 'true'); assert.equal(dark.label.textContent, 'Light');
});

test('login toggle updates theme, accessible action, browser color and persisted preference both ways', () => {
  const state = page(null); state.events.DOMContentLoaded();
  state.events.click(); assert.equal(state.root.dataset.theme, 'dark');
  assert.equal(state.attributes['aria-label'], 'Switch to light mode'); assert.equal(state.attributes['aria-pressed'], 'true');
  assert.equal(state.label.textContent, 'Light'); assert.deepEqual(state.writes[0], ['presence.loginTheme', 'dark']);
  state.events.click(); assert.equal(state.root.dataset.theme, 'light');
  assert.equal(state.meta.content, '#f5f9ff'); assert.equal(state.attributes['aria-label'], 'Switch to dark mode');
  assert.equal(state.attributes['aria-pressed'], 'false'); assert.deepEqual(state.writes[1], ['presence.loginTheme', 'light']);
});

test('blocked browser storage does not prevent toggling or initialize authentication', () => {
  const state = page(null, true); state.events.DOMContentLoaded(); state.events.click();
  assert.equal(state.root.dataset.theme, 'dark'); assert.equal(state.writes.length, 0);
});

test('theme follows other tabs without persisting again and ignores unrelated storage changes', () => {
  const state = page('light'); state.events.DOMContentLoaded();
  state.events.storage({ key: 'other', newValue: 'dark', storageArea: state.storage }); assert.equal(state.root.dataset.theme, 'light');
  state.events.storage({ key: 'presence.loginTheme', newValue: 'dark', storageArea: {} }); assert.equal(state.root.dataset.theme, 'light');
  state.events.storage({ key: 'presence.loginTheme', newValue: 'dark', storageArea: state.storage }); assert.equal(state.root.dataset.theme, 'dark');
  assert.equal(state.writes.length, 0);
  state.events.storage({ key: null, newValue: null, storageArea: state.storage }); assert.equal(state.root.dataset.theme, 'light');
});

test('ThemeController initialization is idempotent and disposal removes owned listeners', () => {
  const state = page('dark');
  state.controller.initialize(); assert.equal(state.registrations.storage, 1);
  state.events.DOMContentLoaded(); state.controller.bindToggle(); assert.equal(state.registrations.click, 1);
  state.controller.dispose(); assert.equal(state.events.click, undefined); assert.equal(state.events.storage, undefined);
  state.controller.toggleTheme(); assert.equal(state.writes.length, 0);
  state.controller.initialize(); state.events.DOMContentLoaded(); state.events.click();
  assert.equal(state.root.dataset.theme, 'light'); assert.equal(state.writes.length, 1);
});
