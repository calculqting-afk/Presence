const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
async function loadModule(relative) {
  const context = vm.createContext({ URL, console });
  const modules = new Map();
  function load(file) {
    if (!modules.has(file)) modules.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file }));
    return modules.get(file);
  }
  const entry = load(path.join(root, relative));
  await entry.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier.split('?')[0])));
  await entry.evaluate(); return entry.namespace;
}
function browser() {
  const handlers = new Map(); const placeholder = { hidden: true, remove() { this.removed = true; } };
  const document = { querySelector: selector => selector === '.content' ? { insertAdjacentHTML() {} } : placeholder,
    addEventListener: (name, callback) => handlers.set(name, callback), removeEventListener: name => handlers.delete(name) };
  const window = { location: { href: 'https://school.test/Presence/pages/student-dashboard.html?survey=event' },
    addEventListener: (name, callback) => handlers.set(name, callback), removeEventListener: name => handlers.delete(name) };
  return { document, window, handlers, placeholder };
}
test('lazy surveys download once on first use, preserve QR routing, and reflect navigation while loading', async () => {
  const { LazySurveyController } = await loadModule('assets/js/controllers/LazySurveyController.js');
  const env = browser(); let resolve, reads = 0, initialized = 0, disposed = 0, lastView;
  const feature = { section: {}, initialize() { initialized++; }, dispose() { disposed++; }, onView(event) { lastView = event.detail.viewName; } };
  const controller = new LazySurveyController({ ...env, openView() {}, showToast() {}, load: () => { reads++; return new Promise(done => { resolve = done; }); } });
  controller.initialize(); controller.initialize(); assert.equal(reads, 0); assert.equal(controller.pendingEventId, 'event');
  controller.onView({ detail: { viewName: 'surveys' } });
  const pending = controller.ensureLoaded(); assert.equal(controller.ensureLoaded(), pending);
  await Promise.resolve(); assert.equal(reads, 1);
  controller.onView({ detail: { viewName: 'events' } }); resolve(feature); await pending;
  assert.equal(initialized, 1); assert.equal(feature.pendingEventId, 'event'); assert.equal(feature.section.hidden, true); assert.equal(lastView, 'dashboard');
  controller.dispose(); assert.equal(disposed, 1); assert.equal(env.handlers.size, 0);
});
test('lazy survey failure can retry and disposal prevents late initialization', async () => {
  const { LazySurveyController } = await loadModule('assets/js/controllers/LazySurveyController.js');
  const env = browser(); let attempts = 0, resolve, disposed = 0;
  const controller = new LazySurveyController({ ...env, openView() {}, showToast() {}, load: () => { if (++attempts === 1) throw Error('offline'); return new Promise(done => { resolve = done; }); } });
  controller.initialize(); await controller.ensureLoaded(); assert.equal(controller.loading, null);
  const retry = controller.ensureLoaded(); await Promise.resolve(); controller.dispose();
  resolve({ dispose() { disposed++; }, initialize() { throw Error('must not initialize after disposal'); } }); await retry;
  assert.equal(attempts, 2); assert.equal(disposed, 1);
});
test('survey refresh requests recent and archived events concurrently and renders the list once', async () => {
  const { SurveyController } = await loadModule('assets/js/controllers/SurveyController.js');
  let resolveRecent, resolveArchives, recent = 0, archives = 0, renders = 0;
  const state = { generation: 0, visible: true, canManage: true, section: { querySelector: () => ({}) },
    repository: { events() { recent++; return new Promise(resolve => { resolveRecent = resolve; }); }, archivedEvents() { archives++; return new Promise(resolve => { resolveArchives = resolve; }); } },
    renderList() { renders++; }, pendingEventId: null };
  const pending = SurveyController.prototype.refresh.call(state);
  assert.equal(recent, 1); assert.equal(archives, 1); assert.equal(renders, 0);
  resolveRecent([]); resolveArchives([]); await pending; assert.equal(renders, 1);
});
test('dashboard timing records a completed stage once without transmitting anything', async () => {
  const { DashboardPerformanceController } = await loadModule('assets/js/controllers/DashboardPerformanceController.js');
  const marks = [], measures = [];
  const metrics = new DashboardPerformanceController({ role: 'student', performance: { mark: name => marks.push(name), measure: (...args) => measures.push(args), clearMarks() {} } });
  metrics.start('profile'); metrics.start('profile'); metrics.finish('profile'); metrics.finish('profile');
  assert.equal(marks.length, 2); assert.equal(measures.length, 1); assert.equal(measures[0][0], 'presence:student:profile');
});
test('QR code library loads once on demand, preserves project paths and retries failures', async () => {
  const { QrCodeLoader } = await loadModule('assets/js/controllers/QrCodeLoader.js');
  const scripts = []; const window = { location: { href: 'https://school.test/Presence/pages/admin-dashboard.html' } };
  const document = { createElement: () => ({ remove() {} }), head: { append: script => scripts.push(script) } };
  const loader = new QrCodeLoader({ document, window });
  assert.equal(scripts.length, 0); const pending = loader.load(); assert.equal(loader.load(), pending);
  assert.equal(scripts[0].src, 'https://school.test/Presence/assets/vendor/qrcode-generator.js?v=2.0.4');
  scripts[0].onerror(); await assert.rejects(pending, /could not load/);
  const next = loader.load(); window.qrcode = () => {}; scripts[1].onload();
  assert.equal(await next, window.qrcode); assert.equal(await loader.load(), window.qrcode); assert.equal(scripts.length, 2);
});
