const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mountUpdateControls } = require('../../mobile/update-controls.js');

function element() {
  const listeners = new Map();
  return { hidden: true, disabled: false, textContent: '', listeners,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); } };
}
function fixture() {
  const panel = element(), button = element(), message = element(), version = element(), window = element();
  panel.querySelector = query => query === 'button' ? button : query === '[role="status"]' ? message : version;
  const current = { version: '1.8.25', supported: true, state: 'current', message: 'You’re up to date.' };
  let listener, calls = 0, removed = 0;
  const updates = { getStatus: async () => current,
    addListener: async (name, callback) => { listener = callback; return { remove: () => removed++ }; },
    check: async () => { calls++; return current; } };
  return { panel, button, message, version, window, updates, current, emit: state => listener(state),
    document: { querySelector: () => panel }, calls: () => calls, removed: () => removed };
}
test('native login controls show installed version, automatic failures and fresh status on focus', async () => {
  const f = fixture(); const cleanup = await mountUpdateControls(f);
  assert.equal(f.panel.hidden, false); assert.equal(f.version.textContent, 'Installed version: 1.8.25');
  f.emit({ ...f.current, state: 'failed', message: 'Server limited requests.', retrySeconds: 60 });
  assert.match(f.message.textContent, /Server limited.*60 seconds/);
  await f.window.listeners.get('focus')(); assert.match(f.message.textContent, /up to date/);
  cleanup(); assert.equal(f.removed(), 1); assert.equal(f.button.listeners.size, 0);
  f.emit({ ...f.current, message: 'stale' }); assert.notEqual(f.message.textContent, 'stale');
});
test('manual check blocks duplicate taps and recovers after bridge failure', async () => {
  const f = fixture(); let resolve;
  f.updates.check = () => { f.count = (f.count || 0) + 1; return new Promise(done => resolve = done); };
  const cleanup = await mountUpdateControls(f), click = f.button.listeners.get('click');
  const pending = click(); await click(); assert.equal(f.count, 1);
  resolve({ ...f.current, state: 'checking', message: 'Checking…' }); await pending;
  assert.equal(f.button.disabled, true);
  f.emit({ ...f.current }); assert.equal(f.button.disabled, false);
  f.updates.check = async () => { throw Error('bridge unavailable'); };
  await click(); assert.equal(f.button.disabled, false); assert.match(f.message.textContent, /Couldn’t start/);
  cleanup();
});
test('web pages make no native calls and restored login pages retain controls', async () => {
  let calls = 0;
  await mountUpdateControls({ document: { querySelector: () => null }, updates: { getStatus: () => calls++ } });
  assert.equal(calls, 0);
  const f = fixture(); const cleanup = await mountUpdateControls(f);
  f.window.listeners.get('pagehide')({ persisted: true }); assert.equal(f.removed(), 0);
  cleanup(); cleanup(); assert.equal(f.removed(), 1);
});
test('unavailable native controls report failure without claiming the app is current', async () => {
  const f = fixture(); f.updates.getStatus = async () => { throw Error('plugin missing'); };
  const cleanup = await mountUpdateControls(f);
  assert.equal(f.panel.hidden, false); assert.equal(f.button.disabled, true);
  assert.match(f.message.textContent, /unavailable/); assert.doesNotMatch(f.message.textContent, /up to date/);
  cleanup();
});
test('late status reads and check responses cannot overwrite newer native events', async () => {
  const f = fixture(); const cleanup = await mountUpdateControls(f);
  let resolveStatus;
  f.updates.getStatus = () => new Promise(resolve => resolveStatus = resolve);
  const focus = f.window.listeners.get('focus')();
  f.emit({ ...f.current, state: 'failed', message: 'Latest check failed.' });
  resolveStatus(f.current); await focus;
  assert.equal(f.message.textContent, 'Latest check failed.');
  let resolveCheck;
  f.updates.check = () => new Promise(resolve => resolveCheck = resolve);
  const checking = f.button.listeners.get('click')();
  f.emit({ ...f.current, state: 'available', message: 'A newer update is available.' });
  resolveCheck({ ...f.current, state: 'checking', message: 'Checking…' }); await checking;
  assert.equal(f.message.textContent, 'A newer update is available.');
  assert.equal(f.button.disabled, false);
  cleanup();
});
