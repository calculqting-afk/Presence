const test = require('node:test');
const assert = require('node:assert/strict');

async function fixture(options = {}) {
  const { AttendanceReadinessController } = await import('../assets/js/controllers/AttendanceReadinessController.js');
  const fields = new Map();
  const field = selector => { if (!fields.has(selector)) fields.set(selector, { textContent: '', disabled: false, hidden: false }); return fields.get(selector); };
  const dialog = Object.assign(new EventTarget(), { querySelector: field, setAttribute() {}, showModal() {}, close() {}, remove() {} });
  const window = Object.assign(new EventTarget(), { navigator: { onLine: true, permissions: { query: async () => ({ state: 'prompt' }) } }, setInterval: () => 1, clearInterval() {} });
  const document = { body: { append() {}, setAttribute() {}, removeAttribute() {} }, createElement: () => dialog };
  const controller = new AttendanceReadinessController({ document, window, readFace: async () => true,
    location: { read: async () => ({ coords: { latitude: 10, longitude: 124, accuracy: 5 } }) }, ...options });
  const pending = controller.require({ requiresGeofence: options.geofence !== false });
  await new Promise(resolve => setImmediate(resolve));
  return { controller, pending, window, dialog, field };
}

test('readiness requires explicit GPS check only for events requiring location', async () => {
  const f = await fixture();
  assert.equal(f.controller.faceReady, true); assert.equal(f.controller.connected, true);
  assert.equal(f.controller.ready(), false);
  await f.controller.checkLocation(f.dialog);
  assert.equal(f.controller.ready(), true);
  assert.match(f.field('[data-state="gps"]').textContent, /accuracy ±5 m/);
  f.controller.locationAt = Date.now() - 31000; f.controller.render();
  assert.equal(f.controller.ready(), false);
  assert.match(f.field('[data-state="gps"]').textContent, /expired/);
  f.controller.close(false); assert.equal(await f.pending, false);
  const g = await fixture({ geofence: false });
  assert.equal(g.controller.ready(), true);
  assert.match(g.field('[data-state="gps"]').textContent, /Not required/); g.controller.dispose();
});

test('unregistered face, failed server verification and offline state cannot continue', async () => {
  const f = await fixture({ readFace: async () => false, geofence: false });
  assert.equal(f.controller.ready(), false); assert.equal(f.field('[data-action="face"]').hidden, false);
  f.controller.readFace = async () => { throw Error('unreachable'); };
  await f.controller.check(f.dialog);
  assert.equal(f.controller.connected, false); assert.equal(f.controller.ready(), false);
  f.controller.readFace = async () => true; await f.controller.check(f.dialog);
  assert.equal(f.controller.ready(), true);
  f.window.navigator.onLine = false; f.window.dispatchEvent(new Event('offline'));
  assert.equal(f.controller.ready(), false); f.controller.dispose();
});

test('denied, unavailable and invalid GPS results remain blocked and retryable', async () => {
  const f = await fixture();
  for (const error of [Object.assign(Error('Allow location in settings'), { code: 1 }), Object.assign(Error('GPS timed out'), { code: 3 })]) {
    f.controller.location = { read: async () => { throw error; } };
    await f.controller.checkLocation(f.dialog);
    assert.equal(f.controller.ready(), false); assert.equal(f.field('[data-action="location"]').disabled, false);
  }
  f.controller.location = { read: async () => ({ coords: { latitude: NaN, longitude: 124, accuracy: 5 } }) };
  await f.controller.checkLocation(f.dialog); assert.equal(f.controller.locationAt, 0);
  f.controller.dispose();
});

test('closing during a location request ignores its late result', async () => {
  let resolveLocation;
  const f = await fixture({ location: { read: () => new Promise(resolve => { resolveLocation = resolve; }) } });
  const location = f.controller.checkLocation(f.dialog);
  f.controller.close(false); assert.equal(await f.pending, false);
  resolveLocation({ coords: { latitude: 10, longitude: 124, accuracy: 5 } });
  await location; assert.equal(f.controller.locationAt, 0); assert.equal(f.controller.dialog, null);
});

test('Android Back cancels preparation without allowing late checks to proceed', async () => {
  const f = await fixture();
  f.window.dispatchEvent(new Event('presence:readiness-back'));
  assert.equal(await f.pending, false); assert.equal(f.controller.dialog, null);
});
