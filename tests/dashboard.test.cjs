const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
async function isolatedModule(relative, shared = {}, globals = {}) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, ...globals });
  const modules = new Map();
  const mock = (id, values) => {
    if (!modules.has(id)) modules.set(id, new vm.SyntheticModule(Object.keys(values), function() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context, identifier: id }));
    return modules.get(id);
  };
  const load = filename => {
    if (!modules.has(filename)) modules.set(filename, new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename }));
    return modules.get(filename);
  };
  const module = load(path.join(root, relative));
  await module.link((specifier, referencing) => {
    if (specifier.includes('dashboard.js')) return mock('shared', shared);
    if (specifier.includes('firebase-config.js')) return mock('config', { db: {} });
    if (specifier.startsWith('https:')) return mock('sdk', { collection: () => ({}), onSnapshot: () => () => {}, getDocsFromServer: async () => ({ docs: [] }) });
    return load(path.resolve(path.dirname(referencing.identifier), specifier.split('?')[0]));
  });
  await module.evaluate();
  return module.namespace;
}

test('the complete static module graph links with matching exports', async () => {
  const context = vm.createContext({});
  const modules = new Map();
  const sdkNames = new Set();
  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(filename);
      else if (entry.name.endsWith('.js')) {
        for (const match of fs.readFileSync(filename, 'utf8').matchAll(/import\s*\{([^}]+)\}\s*from\s*["']https:/g)) {
          for (const name of match[1].split(',').map(name => name.trim())) sdkNames.add(name);
        }
      }
    }
  }
  collect(path.join(root, 'assets/js')); collect(path.join(root, 'config'));
  const load = filename => {
    if (!modules.has(filename)) modules.set(filename, new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename }));
    return modules.get(filename);
  };
  const linker = (specifier, referencing) => {
    if (specifier.startsWith('https:')) {
      if (!modules.has(specifier)) modules.set(specifier, new vm.SyntheticModule([...sdkNames], function() {}, { context, identifier: specifier }));
      return modules.get(specifier);
    }
    return load(path.resolve(path.dirname(referencing.identifier), specifier.split('?')[0]));
  };
  for (const entry of ['assets/js/student/StudentDashboard.js', 'assets/js/admin/AdminDashboard.js']) {
    const module = load(path.join(root, entry));
    if (module.status === 'unlinked') await module.link(linker);
    assert.equal(module.status, 'linked');
  }
});

test('scoped listeners start once, stop on exit, and discard late callbacks', async () => {
  const { ScopedSubscriptions } = await import(pathToFileURL(path.join(root, 'assets/js/core/ScopedSubscriptions.js')));
  let starts = 0; let stops = 0; let received = 0; let callback;
  const subscriptions = new ScopedSubscriptions();
  subscriptions.register('directory', ['students'], guard => { starts++; callback = guard(() => received++); return () => stops++; });
  subscriptions.setView('dashboard'); assert.equal(starts, 0);
  subscriptions.setView('students'); subscriptions.setView('students'); assert.equal(starts, 1);
  callback(); assert.equal(received, 1);
  subscriptions.setView('dashboard'); assert.equal(stops, 1);
  callback(); assert.equal(received, 1);
  subscriptions.setView('students'); assert.equal(starts, 2);
  subscriptions.stop(); assert.equal(stops, 2);
});

test('shared summary listeners survive navigation and stop during disposal', async () => {
  const { ScopedSubscriptions } = await import(pathToFileURL(path.join(root, 'assets/js/core/ScopedSubscriptions.js')));
  let starts = 0; let stops = 0;
  const subscriptions = new ScopedSubscriptions();
  subscriptions.register('summary', ['*'], () => { starts++; return () => stops++; });
  subscriptions.setView('dashboard'); subscriptions.setView('profile');
  assert.equal(starts, 1); assert.equal(stops, 0);
  subscriptions.stop(); subscriptions.stop(); assert.equal(stops, 1);
});

test('attendance policy covers opening, cutoff, late window, and event-close boundaries', async () => {
  const { AttendancePolicy } = await isolatedModule('assets/js/controllers/AttendanceController.js', { currentUser: {}, currentUserRole: 'student', formatEventTime: value => value });
  const policy = new AttendancePolicy({ eventOpenDate: event => event.open, eventCloseDate: event => event.close, eventCheckInCloseDate: event => event.cutoff });
  const event = { open: new Date(1000), cutoff: new Date(2000), close: new Date(3000) };
  assert.equal(policy.evaluateCheckIn(null).available, false);
  assert.equal(policy.evaluateCheckIn(event, new Date(999)).available, false);
  assert.equal(policy.evaluateCheckIn(event, new Date(1000)).arrivalStatus, 'present');
  assert.equal(policy.evaluateCheckIn(event, new Date(2000)).arrivalStatus, 'present');
  assert.equal(policy.evaluateCheckIn(event, new Date(2001)).arrivalStatus, 'late');
  assert.equal(policy.evaluateCheckIn(event, new Date(2999)).available, true);
  assert.equal(policy.evaluateCheckIn(event, new Date(3000)).available, false);
});

test('late check-in cancellation prevents saving and confirmation rechecks the window', async () => {
  const { AttendanceCheckInController } = await isolatedModule('assets/js/controllers/AttendanceController.js', { currentUser: {}, currentUserRole: 'student', formatEventTime: value => value });
  const cancelled = new AttendanceCheckInController({ policy: { evaluateCheckIn: () => ({ available: true, arrivalStatus: 'late' }) }, lateModal: { open: async () => false } });
  assert.equal((await cancelled.begin({})).cancelled, true);
  let checks = 0;
  const expired = new AttendanceCheckInController({ policy: { evaluateCheckIn: () => (++checks === 1 ? { available: true, arrivalStatus: 'late' } : { available: false }) }, lateModal: { open: async () => true } });
  assert.equal((await expired.begin({})).available, false);
  assert.equal(checks, 2);
});

function attendanceMocks(overrides = {}) {
  return { currentUser: { uid: 'student-1' }, currentUserProfile: {}, showDashboardToast: () => {}, openView: () => {}, isCheckoutAvailable: () => true, db: {}, Timestamp: { now: () => new Date() }, doc: (_, collection, id) => ({ collection, id }), getDocFromServer: async () => ({ exists: () => true, data: () => ({ enabled: true, latitude: 14, longitude: 121, radiusMeters: 100 }) }), serverTimestamp: () => 'server-time', setDoc: async () => {}, ...overrides };
}
const gridDocument = { querySelector: () => ({ addEventListener() {}, removeEventListener() {} }) };

test('student geofence rejects missing configuration before requesting GPS', async () => {
  const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks({ getDocFromServer: async () => ({ exists: () => false, data: () => undefined }) }), { document: gridDocument });
  const controller = new StudentAttendanceController({});
  await assert.rejects(controller.verifiedGeofenceLocation({ id: 'event' }), error => error.geofenceIssue === 'configuration');
});

test('student geofence accepts inside location and caps GPS allowance outside', async () => {
  const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks(), { document: gridDocument });
  const controller = new StudentAttendanceController({});
  controller.getCurrentCheckInLocation = async () => ({ coords: { latitude: 14, longitude: 121, accuracy: 5 } });
  assert.equal((await controller.verifiedGeofenceLocation({ id: 'event' })).distanceMeters, 0);
  controller.getCurrentCheckInLocation = async () => ({ coords: { latitude: 15, longitude: 121, accuracy: 1000000 } });
  await assert.rejects(controller.verifiedGeofenceLocation({ id: 'event' }), error => error.geofenceIssue === 'outside');
});

test('checkout rejects a closed window without writing any record', async () => {
  let writes = 0;
  const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks({ isCheckoutAvailable: () => false, setDoc: async () => writes++ }), { document: gridDocument });
  const controller = new StudentAttendanceController({});
  await controller.checkOutAttendance({ eventId: 'event' }, {}, { disabled: false });
  assert.equal(writes, 0);
});

test('checkout preserves record identity and verifies the server acknowledgement', async () => {
  const writes = []; const publications = []; const messages = [];
  const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks({ setDoc: async (...args) => writes.push(args), getDocFromServer: async () => ({ exists: () => true, id: 'student-1_event', data: () => ({ status: 'completed', checkedOutAt: 'server-time' }) }), showDashboardToast: title => messages.push(title) }), { document: gridDocument });
  const controller = new StudentAttendanceController({ bridge: { publish: (...args) => publications.push(args) } });
  await controller.checkOutAttendance({ eventId: 'event' }, {}, { disabled: false });
  assert.equal(writes[0][0].id, 'student-1_event'); assert.equal(writes[0][1].status, 'completed'); assert.equal(writes[0][2].merge, true);
  assert.equal(publications.length, 2); assert.equal(messages.at(-1), 'Checkout recorded');
});

for (const arrivalStatus of ['present', 'late']) {
  test(`check-in saves ${arrivalStatus} with server timestamps and verifies its acknowledgement`, async () => {
    const writes = []; const publications = []; const messages = [];
    const record = { studentUid: 'student-1', eventId: 'event', status: 'checked-in', arrivalStatus, checkedInAt: 'server-time' };
    const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks({ setDoc: async (...args) => writes.push(args), getDocFromServer: async reference => ({ id: reference.id, exists: () => true, data: () => reference.collection === 'faceRegistrations' ? { registered: true } : record }), showDashboardToast: title => messages.push(title) }), { document: gridDocument });
    const controller = new StudentAttendanceController({ getState: () => ({ events: [{ id: 'event' }], attendance: [] }), setFaceRegistration() {}, checkIn: { begin: async () => ({ available: true, arrivalStatus }) }, bridge: { publish: (...args) => publications.push(args) } });
    const button = { dataset: { attendEvent: 'event' }, disabled: false };
    await controller.handleEventClick({ target: { closest: selector => selector === '[data-attend-event]' ? button : null } });
    assert.equal(writes.length, 1); assert.equal(writes[0][0].id, 'student-1_event');
    assert.equal(writes[0][1].arrivalStatus, arrivalStatus); assert.equal(writes[0][1].checkedInAt, 'server-time');
    assert.equal(publications.length, 2);
    assert.equal(messages.at(-1), arrivalStatus === 'late' ? 'Late attendance recorded' : 'Attendance recorded');
  });
}

test('unregistered face blocks check-in without writing attendance', async () => {
  let writes = 0; const errors = [];
  const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks({ setDoc: async () => writes++, getDocFromServer: async () => ({ data: () => ({ registered: false }) }) }), { document: gridDocument });
  const controller = new StudentAttendanceController({ getState: () => ({ events: [{ id: 'event' }], attendance: [] }), setFaceRegistration() {}, showError: title => errors.push(title) });
  const button = { dataset: { attendEvent: 'event' } };
  await controller.handleEventClick({ target: { closest: selector => selector === '[data-attend-event]' ? button : null } });
  assert.equal(writes, 0); assert.equal(errors[0], 'Facial recognition required');
});

test('geofence editor rejects blank coordinates instead of silently saving 0,0', async () => {
  const elements = new Map();
  const document = { querySelector: selector => { if (!elements.has(selector)) elements.set(selector, { value: '', checked: false, addEventListener() {} }); return elements.get(selector); } };
  const { GeofenceController } = await isolatedModule('assets/js/controllers/GeofenceController.js', {}, { document });
  const controller = new GeofenceController('event', { showToast() {} });
  controller.enabled.checked = true;
  assert.equal(Number.isNaN(controller.value().latitude), true);
  assert.equal(Number.isNaN(controller.value().longitude), true);
});

test('lazy map asset failures can be retried', async () => {
  const pending = [];
  const window = {};
  const document = { createElement: () => ({ remove() {} }), head: { append: element => pending.push(element) } };
  const { loadLeaflet } = await isolatedModule('assets/js/controllers/GeofenceController.js', {}, { document, window });
  const first = loadLeaflet(); assert.equal(loadLeaflet(), first); assert.equal(pending.length, 2);
  pending[0].onload(); pending[1].onerror(); await assert.rejects(first);
  const retry = loadLeaflet(); assert.equal(pending.length, 4);
  window.L = {}; pending[2].onload(); pending[3].onload(); await retry;
});

test('concurrent map requests initialize one map per editor', async () => {
  let mapCount = 0; const assets = []; const nodes = new Map();
  const map = { setView() { return this; }, on() {} };
  const window = { L: { map: () => { mapCount++; return map; }, tileLayer: () => ({ addTo() {} }) } };
  const document = { querySelector: selector => { if (!nodes.has(selector)) nodes.set(selector, { addEventListener() {} }); return nodes.get(selector); }, createElement: () => ({}), head: { append: element => assets.push(element) } };
  const { GeofenceController } = await isolatedModule('assets/js/controllers/GeofenceController.js', {}, { document, window });
  const controller = new GeofenceController('event', { showToast() {} });
  const first = controller.ensureMap(); const second = controller.ensureMap();
  assets[0].onload(); await Promise.all([first, second]);
  assert.equal(mapCount, 1);
});

function fakeBrowser() {
  const nodes = new Map(); const listeners = new Map();
  const element = selector => {
    if (!nodes.has(selector)) {
      const node = { value: '', checked: false, hidden: true, disabled: false, dataset: {}, style: {}, textContent: '', innerHTML: '', classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, removeEventListener() {}, insertAdjacentHTML() {}, setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, focus() {}, reset() {}, closest: () => node, querySelector: child => element(child), querySelectorAll: child => child === 'th' ? [element('th0'), element('th1'), element('th2'), element('th3')] : [] };
      nodes.set(selector, node);
    }
    return nodes.get(selector);
  };
  const document = { querySelector: element, querySelectorAll: () => [], body: element('body'), addEventListener() {} };
  const window = { addEventListener: (name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); }, removeEventListener: (name, callback) => listeners.get(name)?.delete(callback), emit: viewName => { for (const callback of listeners.get('presence:viewchange') || []) callback({ detail: { viewName } }); }, matchMedia: () => ({ matches: false, addEventListener() {} }), setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
  return { document, window, sessionStorage: { getItem: () => null, setItem() {} } };
}

for (const role of ['Student', 'Admin']) {
  test(`${role} dashboard initializes and disposes its view subscriptions`, async () => {
    const sharedSource = fs.readFileSync(path.join(root, 'assets/js/dashboard.js'), 'utf8');
    const names = sharedSource.match(/export \{ ([^}]+) \}/)[1].split(', ');
    const shared = Object.fromEntries(names.map(name => [name, () => '']));
    const active = new Map(); const started = [];
    Object.assign(shared, { currentUser: { uid: 'student-1', email: 'test@example.com' }, currentUserProfile: {}, currentUserRole: role === 'Student' ? 'student' : 'super_admin', activeView: 'dashboard', ASSIGNABLE_ROLE_LABELS: {}, sessionState: {}, db: {}, collection: (_, name) => name, doc: (_, name, id) => `${name}/${id}`, query: value => value, onSnapshot: (reference, callback) => { started.push(reference); active.set(reference, callback); return () => active.delete(reference); }, setDoc: async () => {}, createDeviceSessionToken: () => 'test-session', FineModalController: class {}, Timestamp: { now: () => new Date(), fromMillis: value => new Date(value) } });
    const browser = fakeBrowser();
    const module = await isolatedModule(`assets/js/${role.toLowerCase()}/${role}Dashboard.js`, shared, browser);
    const dashboard = new module[`${role}Dashboard`]();
    dashboard.initialize();
    browser.window.emit('dashboard');
    if (role === 'Admin') {
      assert.equal(active.has('presenceSessions'), false); assert.equal(active.has('faceRegistrations'), false);
      browser.window.emit('modify-students');
      assert.equal(active.has('presenceSessions'), true); assert.equal(active.has('faceRegistrations'), true);
      browser.window.emit('dashboard'); assert.equal(active.has('presenceSessions'), false);
    } else {
      assert.equal(active.has('dismissedHistory'), false);
      browser.window.emit('history'); assert.equal(active.has('dismissedHistory'), true);
      browser.window.emit('dashboard'); assert.equal(active.has('dismissedHistory'), false);
    }
    assert.ok(started.length > 0);
    dashboard.dispose(); assert.equal(active.size, 0);
  });
}

test('dashboard entry points use the same shared-module version', () => {
  for (const role of ['student', 'admin']) {
    const html = fs.readFileSync(path.join(root, `pages/${role}-dashboard.html`), 'utf8');
    assert.ok(html.includes('dashboard.js?v=20261009-oop'));
  }
});
