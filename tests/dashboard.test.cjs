const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
test('student action presentation omits forbidden controls for every role and profile layout', async () => {
  const { StudentActionsPresenter } = await isolatedModule('assets/js/controllers/StudentActionsPresenter.js');
  const { hasPermission } = await isolatedModule('assets/js/core/permissions.js');
  for (const role of ['super_admin', 'head_admin', 'attendance_admin', 'student_manager', 'unknown']) {
    const presenter = new StudentActionsPresenter({ can: action => hasPermission(role, action), escapeHtml: value => String(value).replaceAll('"', '&quot;') });
    for (const profile of [false, true]) {
      const html = presenter.render({ uid: 'student"1', hasFaceRegistration: true, profile });
      assert.equal(html.includes('data-password-student'), hasPermission(role, 'changePasswords'), role);
      assert.equal(html.includes('data-delete-student'), hasPermission(role, 'deleteStudents'), role);
      assert.equal(html.includes('data-reset-face'), hasPermission(role, 'resetFace'), role);
      assert.equal(html.includes(profile ? 'data-edit-student' : 'data-view-student'), hasPermission(role, profile ? 'editStudents' : 'viewStudents'), role);
      if (html) assert.ok(html.includes('student&quot;1'));
      assert.ok(!presenter.render({ uid: 'student', hasFaceRegistration: false, profile }).includes('data-reset-face'));
    }
  }
  const admin = fs.readFileSync(path.join(root, 'assets/js/admin/AdminDashboard.js'), 'utf8');
  assert.equal((admin.match(/studentActions.render\(/g) || []).length, 2);
  assert.match(fs.readFileSync(path.join(root, 'assets/js/dashboard.js'), 'utf8'), /Manage student details and face registration/);
});

test('authentication progress blocks duplicates, restores failures and remains locked for redirect', async () => {
  const { AuthActionController } = await isolatedModule('assets/js/controllers/AuthActionController.js', {}, { document: undefined });
  const controller = new AuthActionController();
  const button = { innerHTML: 'Continue', disabled: false };
  const sidebar = { innerHTML: 'Logout', disabled: false };
  let resolveAction;
  let calls = 0;
  const pending = controller.run({ buttons: [button, sidebar], label: 'Logging out…', successLabel: 'Logged out', action: () => {
    calls++; return new Promise(resolve => { resolveAction = resolve; });
  } });
  assert.match(button.innerHTML, /attendance-button-spinner/);
  assert.match(sidebar.innerHTML, /Logging out/);
  assert.equal(button.disabled, true);
  assert.equal(await controller.run({ buttons: [button], action: () => { calls++; } }), false);
  assert.equal(calls, 1);
  resolveAction(false); assert.equal(await pending, false);
  assert.equal(controller.busy, false); assert.equal(button.innerHTML, 'Continue');
  assert.equal(sidebar.innerHTML, 'Logout'); assert.equal(sidebar.disabled, false);
  await assert.rejects(controller.run({ buttons: [button], label: 'Signing in…', action: async () => { throw new Error('offline'); } }), /offline/);
  assert.equal(button.disabled, false); assert.equal(controller.busy, false);
  assert.equal(await controller.run({ buttons: [button], label: 'Signing in…', successLabel: 'Signed in', action: async () => {} }), true);
  assert.match(button.innerHTML, /Signed in/); assert.equal(button.disabled, true);
  assert.equal(controller.busy, true);
  controller.dispose(); controller.dispose();
});

test('login and both dashboard pages load shared authentication progress styles', () => {
  for (const filename of ['index.html', 'pages/admin-dashboard.html', 'pages/student-dashboard.html']) {
    assert.match(fs.readFileSync(path.join(root, filename), 'utf8'), /button-loading.css\?v=20261010-auth-progress/);
  }
  const css = fs.readFileSync(path.join(root, 'assets/css/button-loading.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(fs.readFileSync(path.join(root, 'assets/js/script.js'), 'utf8'), /loginAction.run/);
  assert.match(fs.readFileSync(path.join(root, 'assets/js/dashboard.js'), 'utf8'), /logoutAction.run/);
});

test('button loading state restores labels and accessibility and survives replacement buttons', async () => {
  const browser = fakeBrowser();
  const { ButtonLoadingController } = await isolatedModule('assets/js/controllers/ButtonLoadingController.js', {}, browser);
  const controller = new ButtonLoadingController();
  const button = browser.document.querySelector('#loadingTest');
  const attributes = new Map();
  button.setAttribute = (key, value) => attributes.set(key, value);
  button.getAttribute = key => attributes.get(key) ?? null;
  button.removeAttribute = key => attributes.delete(key);
  button.innerHTML = 'Check in'; button.disabled = false;
  assert.equal(controller.start('in:event', button, 'Checking in…'), true);
  assert.equal(controller.start('in:event', button, 'Duplicate'), false);
  assert.equal(button.disabled, true); assert.equal(attributes.get('aria-busy'), 'true');
  controller.update('in:event', 'Verifying location…');
  assert.match(button.innerHTML, /Verifying location/);
  const replacement = browser.document.querySelector('#replacement'); replacement.innerHTML = 'Check in'; replacement.disabled = false;
  controller.attach('in:event', replacement); assert.match(replacement.innerHTML, /Verifying location/); assert.equal(replacement.disabled, true);
  controller.reset('in:event');
  assert.equal(button.innerHTML, 'Check in'); assert.equal(replacement.innerHTML, 'Check in');
  assert.equal(button.disabled, false); assert.equal(replacement.disabled, false); assert.equal(attributes.has('aria-busy'), false);
  controller.start('out:event', button, 'Checking out…'); controller.finish('out:event', 'Checked out'); controller.reset('out:event');
  assert.match(button.innerHTML, /Checked out/); assert.ok(!button.innerHTML.includes('attendance-button-spinner'));
  assert.equal(attributes.get('aria-busy'), 'false'); assert.equal(button.disabled, true);
  controller.dispose(); controller.dispose();
});

test('check-in displays real pending progress and restores the button after face verification fails', async () => {
  let rejectRead;
  const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks({ getDocFromServer: () => new Promise((_, reject) => { rejectRead = reject; }) }), { document: gridDocument });
  const controller = new StudentAttendanceController({ getState: () => ({ events: [{ id: 'event' }], attendance: [] }), showError() {} });
  const button = { dataset: { attendEvent: 'event' }, innerHTML: 'Check in', disabled: false };
  const pending = controller.handleEventClick({ target: { closest: selector => selector === '[data-attend-event]' ? button : null } });
  assert.equal(button.disabled, true); assert.match(button.innerHTML, /Checking in/);
  rejectRead(new Error('Offline')); await pending;
  assert.equal(button.disabled, false); assert.equal(button.innerHTML, 'Check in'); assert.equal(controller.loading.operations.size, 0);
  controller.dispose();
});
test('event schedules label opening, late threshold and checkout close separately', async () => {
  const { EventSchedulePresenter } = await isolatedModule('assets/js/controllers/EventSchedulePresenter.js');
  const escapeHtml = value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const presenter = new EventSchedulePresenter({ formatTime: value => value, escapeHtml, addMinutes: () => '16:30' });
  const event = { timeIn: '16:00', checkInCutoff: '16:10', timeOut: '16:15', checkOutCutoff: '16:25', location: '<script>' };
  const html = presenter.render(event);
  assert.match(html, /Check-in/); assert.match(html, /Check-out/);
  assert.match(html, /Late after<\/dt><dd>16:10/);
  assert.match(html, /Closes<\/dt><dd>16:25/);
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
  assert.match(presenter.render({ timeIn: '16:00', timeOut: '16:15' }), /Closes<\/dt><dd>16:30/);
  assert.match(presenter.render({}), /Not set/);
  for (const role of ['admin', 'student']) assert.match(fs.readFileSync(path.join(root, `assets/js/${role}/${role === 'admin' ? 'Admin' : 'Student'}Dashboard.js`), 'utf8'), /schedulePresenter.render\(event\)/);
});
test('event form pairs each attendance opening with its cutoff', () => {
  const html = fs.readFileSync(path.join(root, 'pages/admin-dashboard.html'), 'utf8');
  const form = html.match(/<form id="eventForm">([\s\S]*?)<\/form>/)[1];
  assert.match(form, /class="field full"><label for="eventLocation"/);
  const times = [...form.matchAll(/<label for="(eventTimeIn|eventCheckInCutoff|eventTimeOut|eventCheckOutCutoff)"/g)].map(match => match[1]);
  assert.deepEqual(times, ['eventTimeIn', 'eventCheckInCutoff', 'eventTimeOut', 'eventCheckOutCutoff']);
});
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
    if (specifier.startsWith('https:')) return mock('sdk', {
      collection: (...args) => ({ path: args.join('/') }), doc: (...args) => ({ path: args.join('/'), id: args.length === 1 ? 'audit-1' : args.at(-1) }),
      Timestamp: { fromDate: date => date }, serverTimestamp: () => 'server-time', runTransaction: async () => {},
      query: (...args) => args, where: (...args) => args, orderBy: (...args) => args, limit: size => ({ limit: size }), startAfter: cursor => ({ cursor }),
      onSnapshot: () => () => {}, getDocsFromServer: async () => ({ docs: [] })
    });
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

test('submission preflight failure never writes and identifies the failing stage', async () => {
  const { AttendanceSubmissionService } = await isolatedModule('assets/js/controllers/AttendanceSubmissionService.js');
  let writes = 0;
  const service = new AttendanceSubmissionService({ read: async () => { throw Object.assign(new Error('Denied'), { code: 'permission-denied' }); }, write: async () => writes++ });
  await assert.rejects(service.submit({ reference: { id: 'student_event' }, matches: () => false, payload: {} }), error => error.attendanceStage === 'preflight');
  assert.equal(writes, 0); assert.equal(service.pending.size, 0);
  service.read = async () => ({ exists: () => false });
  service.write = async () => { throw Object.assign(new Error('Denied'), { code: 'permission-denied' }); };
  await assert.rejects(service.submit({ reference: { id: 'student_event' }, matches: () => false, payload: {} }), error => error.attendanceStage === 'write');
  assert.equal(service.pending.size, 0);
});

test('attendance policy rejects malformed, reversed and nonfinite window dates', async () => {
  const { AttendancePolicy } = await isolatedModule('assets/js/controllers/AttendanceController.js', { currentUser: {}, currentUserRole: 'student', formatEventTime: value => value });
  const policy = new AttendancePolicy({ eventOpenDate: event => event.open, eventCloseDate: event => event.close, eventCheckInCloseDate: event => event.cutoff });
  for (const event of [
    { open: new Date(NaN), close: new Date(3000), cutoff: new Date(2000) },
    { open: new Date(3000), close: new Date(1000), cutoff: new Date(2000) },
    { open: new Date(1000), close: new Date(3000), cutoff: new Date(4000) },
    { open: new Date(1000), close: new Date(3000), cutoff: new Date(500) }
  ]) assert.equal(policy.evaluateCheckIn(event, new Date(2000)).reason, 'invalid-window');
});

test('invalid GPS cannot pass either geometry check and errors distinguish preflight from save', async () => {
  const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks(), { document: gridDocument });
  const messages = [];
  const controller = new StudentAttendanceController({ showError: (...args) => messages.push(args) });
  for (const coords of [{ latitude: NaN, longitude: 121 }, { latitude: 14, longitude: 181 }, { latitude: 91, longitude: 121 }, { latitude: '14', longitude: 121 }]) {
    controller.getCurrentCheckInLocation = async () => ({ coords });
    await assert.rejects(controller.verifiedGeofenceLocation({ id: 'event' }), error => error.geofenceIssue === 'location');
  }
  assert.match(controller.submissionErrorMessage({ code: 'permission-denied', attendanceStage: 'preflight' }), /before saving/);
  assert.match(controller.submissionErrorMessage({ code: 'permission-denied', attendanceStage: 'write' }), /save/);
  controller.showLocationError({ locationErrorCode: 3, message: 'GPS timed out' });
  assert.equal(messages.at(-1)[1], 'GPS timed out');
  controller.dispose();
});

test('attendance rules separate missing-document preflight from owner-scoped queries', () => {
  // Structural regression only; actual authorization must also be tested in the emulator.
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const attendance = rules.slice(rules.indexOf('match /attendance/{attendanceId}'), rules.indexOf('match /corrections/{correctionId}'));
  assert.match(attendance, /allow get:/);
  assert.match(attendance, /exists\(\/databases\/\$\(database\)\/documents\/attendance\/\$\(attendanceId\)\)/);
  assert.match(attendance, /request.auth.uid.matches/);
  assert.match(attendance, /attendanceId.matches/);
  assert.match(attendance, /allow list: if canViewAttendanceReports\(\)\s*\|\| \(isStudent\(\) && resource.data.studentUid == request.auth.uid\)/);
});

const polygonArea = { enabled: true, type: 'polygon', vertices: [
  { latitude: 14, longitude: 121 }, { latitude: 14, longitude: 121.001 },
  { latitude: 14.001, longitude: 121.001 }, { latitude: 14.001, longitude: 121 }
] };

test('circle legacy data and polygon boundaries share inside/outside checks', async () => {
  const { GeofenceBoundary } = await isolatedModule('assets/js/controllers/GeofenceBoundary.js');
  const circle = GeofenceBoundary.create({ latitude: 14, longitude: 121, radiusMeters: 100 });
  assert.equal(circle.evaluate({ latitude: 14, longitude: 121 }).inside, true);
  assert.equal(circle.evaluate({ latitude: 14.01, longitude: 121 }).inside, false);
  const polygon = GeofenceBoundary.create(polygonArea);
  assert.equal(polygon.evaluate({ latitude: 14.0005, longitude: 121.0005 }).inside, true);
  assert.equal(polygon.evaluate({ latitude: 14, longitude: 121 }).inside, true);
  assert.equal(polygon.evaluate({ latitude: 14.0005, longitude: 121.0011 }).inside, false);
  assert.equal(polygon.evaluate({ latitude: 14.0005, longitude: 121.0011 }, 20).inside, true);
  assert.equal(polygon.evaluate({ latitude: 14.0005, longitude: 121.002 }, 20).inside, false);
  assert.equal(GeofenceBoundary.create({ ...polygonArea, vertices: [...polygonArea.vertices].reverse() }).evaluate({ latitude: 14.0005, longitude: 121.0005 }).inside, true);
});

test('polygon rejects incomplete, duplicate, crossed, collinear and oversized boundaries', async () => {
  const { GeofenceBoundary } = await isolatedModule('assets/js/controllers/GeofenceBoundary.js');
  const v = polygonArea.vertices;
  for (const vertices of [v.slice(0, 2), [v[0], v[1], v[1], v[3]], [v[0], v[2], v[1], v[3]],
    [v[0], v[1], { latitude: 14, longitude: 121.002 }], Array(11).fill(v[0]),
    [v[0], v[1], { latitude: 15, longitude: 122 }], [v[0], v[1], { latitude: NaN, longitude: 121 }]]) {
    assert.throws(() => GeofenceBoundary.create({ type: 'polygon', vertices }));
  }
  assert.throws(() => GeofenceBoundary.create({ type: 'unknown' }));
});

test('concave polygon excludes a point in its bounding box but outside its shape', async () => {
  const { GeofenceBoundary } = await isolatedModule('assets/js/controllers/GeofenceBoundary.js');
  const boundary = GeofenceBoundary.create({ type: 'polygon', vertices: [
    { latitude: 14, longitude: 121 }, { latitude: 14, longitude: 121.002 },
    { latitude: 14.001, longitude: 121.001 }, { latitude: 14.002, longitude: 121.002 },
    { latitude: 14.002, longitude: 121 }
  ] });
  assert.equal(boundary.evaluate({ latitude: 14.001, longitude: 121.0018 }).inside, false);
  assert.equal(boundary.evaluate({ latitude: 14.001, longitude: 121.0005 }).inside, true);
});

test('student polygon verification uses capped accuracy and checks malformed boundaries before GPS', async () => {
  let area = polygonArea;
  const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks({ getDocFromServer: async () => ({ exists: () => true, data: () => area }) }), { document: gridDocument });
  const controller = new StudentAttendanceController({});
  let gps = 0, longitude = 121.0005;
  controller.getCurrentCheckInLocation = async () => { gps++; return { coords: { latitude: 14.0005, longitude, accuracy: 500 } }; };
  assert.equal((await controller.verifiedGeofenceLocation({ id: 'event' })).distanceMeters, 0);
  longitude = 121.002;
  await assert.rejects(controller.verifiedGeofenceLocation({ id: 'event' }), error => error.geofenceIssue === 'outside' && error.boundaryType === 'polygon');
  area = { ...polygonArea, vertices: polygonArea.vertices.slice(0, 2) };
  await assert.rejects(controller.verifiedGeofenceLocation({ id: 'event' }), error => error.geofenceIssue === 'configuration');
  assert.equal(gps, 2);
  controller.dispose();
});

test('polygon editor requires closing, supports undo/clear, and round-trips saved shapes', async () => {
  const browser = fakeBrowser();
  const { GeofenceController } = await isolatedModule('assets/js/controllers/GeofenceController.js', {}, browser);
  const controller = new GeofenceController('event', { showToast() {} });
  controller.ensureMap = async () => ({ fitBounds() {} });
  controller.enabled.checked = true; controller.type.value = 'polygon';
  polygonArea.vertices.forEach(point => controller.addVertex(point.latitude, point.longitude));
  assert.throws(() => controller.validate(), /Close/);
  controller.closePolygon();
  assert.equal(controller.validate().vertices.length, 4);
  controller.set(polygonArea);
  assert.equal(controller.type.value, 'polygon'); assert.equal(controller.closed, true);
  assert.equal(controller.validate().vertices.length, 4);
  controller.undoLastPoint(); assert.equal(controller.closed, false); assert.equal(controller.vertices.length, 3);
  assert.throws(() => controller.validate(), /Close/);
  controller.clearPolygon(); assert.equal(controller.vertices.length, 0);
  assert.equal(controller.closeBoundary.disabled, true);
  controller.clear(); assert.equal(controller.type.value, 'circle'); assert.equal(controller.vertices.length, 0);
  controller.dispose(); controller.dispose();
});

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
  const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks({ setDoc: async (...args) => writes.push(args), getDocFromServer: async () => ({ exists: () => true, id: 'student-1_event', data: () => ({ studentUid: 'student-1', eventId: 'event', checkedInAt: 'original-time', status: writes.length ? 'completed' : 'checked-in', ...(writes.length ? { checkedOutAt: 'server-time' } : {}) }) }), showDashboardToast: title => messages.push(title) }), { document: gridDocument });
  const controller = new StudentAttendanceController({ bridge: { publish: (...args) => publications.push(args) } });
  await controller.checkOutAttendance({ eventId: 'event' }, {}, { disabled: false });
  assert.equal(writes[0][0].id, 'student-1_event'); assert.equal(writes[0][1].status, 'completed'); assert.equal(writes[0][2].merge, true);
  assert.equal(publications.length, 1); assert.equal(messages.at(-1), 'Checkout recorded');
});

test('checkout refuses missing, foreign or invalid server check-ins without writing', async () => {
  let saved = null, writes = 0;
  const messages = [];
  const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks({
    getDocFromServer: async () => ({ exists: () => saved !== null, data: () => saved }),
    setDoc: async () => writes++, showDashboardToast: (_, message) => messages.push(message)
  }), { document: gridDocument });
  const controller = new StudentAttendanceController({});
  const valid = { studentUid: 'student-1', eventId: 'event', status: 'checked-in', checkedInAt: 'original-time' };
  for (const candidate of [null, { ...valid, studentUid: 'other' }, { ...valid, eventId: 'other' }, { ...valid, status: 'invalid' }, { ...valid, checkedInAt: null }]) {
    saved = candidate;
    const button = { disabled: false };
    await controller.checkOutAttendance({ eventId: 'event' }, {}, button);
    assert.equal(button.disabled, false);
    assert.match(messages.at(-1), /saved check-in is required/);
  }
  assert.equal(writes, 0); assert.equal(controller.checkoutBusy.size, 0);
  controller.dispose();
});

test('already completed checkout retry preserves its timestamp without another write', async () => {
  let writes = 0, publications = 0;
  const saved = { studentUid: 'student-1', eventId: 'event', status: 'completed', checkedInAt: 'original-in', checkedOutAt: 'original-out' };
  const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks({
    getDocFromServer: async () => ({ exists: () => true, id: 'student-1_event', data: () => saved }), setDoc: async () => writes++
  }), { document: gridDocument });
  const controller = new StudentAttendanceController({ bridge: { publish: (_, data) => { publications++; assert.equal(data.checkedOutAt, 'original-out'); } } });
  await controller.checkOutAttendance({ eventId: 'event' }, {}, { disabled: false });
  assert.equal(writes, 0); assert.equal(publications, 1);
  controller.dispose();
});

test('checkout rule validates only allowed patch fields and preserves original check-in', () => {
  // Structural regression; run equivalent positive/negative cases in the emulator.
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const checkout = rules.slice(rules.indexOf('function studentCanCheckOut('), rules.indexOf('// A correction and its immutable'));
  assert.match(checkout, /attendanceId == request.auth.uid \+ "_" \+ previous.eventId/);
  assert.match(checkout, /previous.checkedInAt is timestamp/);
  assert.match(checkout, /data.checkedOutAt == request.time/);
  assert.match(checkout, /request.time >= event.closeAt && request.time <= event.checkOutClosesAt/);
  assert.match(checkout, /affectedKeys\(\).hasOnly\(\["checkOutLocation", "checkedOutAt", "status"\]\)/);
  assert.match(checkout, /validLocation\(data.checkOutLocation\)/);
  assert.match(rules, /\|\| studentCanCheckOut\(attendanceId, request.resource.data, resource.data\)/);
});

for (const arrivalStatus of ['present', 'late']) {
  test(`check-in saves ${arrivalStatus} with server timestamps and verifies its acknowledgement`, async () => {
    const writes = []; const publications = []; const messages = [];
    const record = { studentUid: 'student-1', eventId: 'event', status: 'checked-in', arrivalStatus, checkedInAt: 'server-time' };
    const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks({ setDoc: async (...args) => writes.push(args), getDocFromServer: async reference => ({ id: reference.id, exists: () => reference.collection === 'faceRegistrations' || writes.length > 0, data: () => reference.collection === 'faceRegistrations' ? { registered: true } : record }), showDashboardToast: title => messages.push(title) }), { document: gridDocument });
    const controller = new StudentAttendanceController({ getState: () => ({ events: [{ id: 'event' }], attendance: [] }), setFaceRegistration() {}, checkIn: { begin: async () => ({ available: true, arrivalStatus }) }, bridge: { publish: (...args) => publications.push(args) } });
    const button = { dataset: { attendEvent: 'event' }, disabled: false };
    await controller.handleEventClick({ target: { closest: selector => selector === '[data-attend-event]' ? button : null } });
    assert.equal(writes.length, 1); assert.equal(writes[0][0].id, 'student-1_event');
    assert.equal(writes[0][1].arrivalStatus, arrivalStatus); assert.equal(writes[0][1].checkedInAt, 'server-time');
    assert.equal(publications.length, 1);
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
  const document = { querySelector: selector => { if (!elements.has(selector)) elements.set(selector, { value: '', checked: false, addEventListener() {}, closest() { return this; }, insertAdjacentHTML() {} }); return elements.get(selector); } };
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
  const document = { querySelector: selector => { if (!nodes.has(selector)) nodes.set(selector, { addEventListener() {}, closest() { return this; }, insertAdjacentHTML() {} }); return nodes.get(selector); }, createElement: () => ({}), head: { append: element => assets.push(element) } };
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
  const document = { querySelector: element, querySelectorAll: () => [], body: element('body'), addEventListener() {}, removeEventListener() {} };
  const window = { addEventListener: (name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); }, removeEventListener: (name, callback) => listeners.get(name)?.delete(callback), emit: viewName => { for (const callback of listeners.get('presence:viewchange') || []) callback({ detail: { viewName } }); }, matchMedia: () => ({ matches: false, addEventListener() {} }), setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
  return { document, window, sessionStorage: { getItem: () => null, setItem() {} } };
}

for (const role of ['Student', 'Admin']) {
  test(`${role} dashboard initializes and disposes its view subscriptions`, async () => {
    const sharedSource = fs.readFileSync(path.join(root, 'assets/js/dashboard.js'), 'utf8');
    const names = sharedSource.match(/export \{ ([^}]+) \}/)[1].split(', ');
    const shared = Object.fromEntries(names.map(name => [name, () => '']));
    const active = new Map(); const started = [];
    Object.assign(shared, { currentUser: { uid: 'student-1', email: 'test@example.com' }, currentUserProfile: {}, currentUserRole: role === 'Student' ? 'student' : 'super_admin', activeView: 'dashboard', ASSIGNABLE_ROLE_LABELS: {}, sessionState: {}, db: {}, collection: (_, name) => name, doc: (_, name, id) => `${name}/${id}`, query: value => value, onSnapshot: (reference, optionsOrCallback, next) => { const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : next; started.push(reference); active.set(reference, callback); return () => active.delete(reference); }, setDoc: async () => {}, createDeviceSessionToken: () => 'test-session', FineModalController: class {}, Timestamp: { now: () => new Date(), fromMillis: value => new Date(value) } });
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
    assert.ok(html.includes('dashboard.js?v=20261010-surveys'));
  }
});

test('roster readiness follows cache-to-server metadata even when documents do not change', async () => {
  const source = fs.readFileSync(path.join(root, 'assets/js/dashboard.js'), 'utf8');
  const names = source.match(/export \{ ([^}]+) \}/)[1].split(', ');
  const shared = Object.fromEntries(names.map(name => [name, () => '']));
  const callbacks = new Map(), options = new Map(), messages = [];
  Object.assign(shared, { currentUser: { uid: 'admin', email: 'test@example.com' }, currentUserProfile: {}, currentUserRole: 'super_admin', activeView: 'create', ASSIGNABLE_ROLE_LABELS: {}, db: {},
    collection: (_, name) => name, doc: (_, name, id) => `${name}/${id}`, query: value => value,
    onSnapshot: (reference, optionsOrCallback, next) => {
      callbacks.set(reference, typeof optionsOrCallback === 'function' ? optionsOrCallback : next);
      if (typeof optionsOrCallback !== 'function') options.set(reference, optionsOrCallback);
      return () => callbacks.delete(reference);
    }, showDashboardToast: title => messages.push(title), FineModalController: class {}, Timestamp: { fromMillis: value => new Date(value) } });
  const browser = fakeBrowser();
  let submit;
  browser.document.querySelector('#eventForm').addEventListener = (type, callback) => { if (type === 'submit') submit = callback; };
  const { AdminDashboard } = await isolatedModule('assets/js/admin/AdminDashboard.js', shared, browser);
  const dashboard = new AdminDashboard(); dashboard.initialize(); browser.window.emit('create');
  assert.equal(options.get('students').includeMetadataChanges, true);
  const receive = callbacks.get('students');
  const docs = [];
  receive({ docs, metadata: { fromCache: true } });
  await submit({ preventDefault() {} }); assert.equal(messages.at(-1), 'Participant roster not ready');
  receive({ docs, metadata: { fromCache: false } });
  await submit({ preventDefault() {} }); assert.equal(messages.at(-1), 'Invalid attendance window');
  receive({ docs, metadata: { fromCache: true } });
  await submit({ preventDefault() {} }); assert.equal(messages.at(-1), 'Participant roster not ready');
  dashboard.dispose(); assert.equal(callbacks.size, 0);
});

test('fixed role permissions deny unknown roles/actions and keep Student Manager read-only reports', async () => {
  const { hasPermission: can, requirePermission, ROLE_VIEWS } = await import(pathToFileURL(path.join(root, 'assets/js/core/permissions.js')));
  for (const action of ['viewStudents', 'addStudents', 'editStudents', 'resetFace', 'viewFines', 'viewAbsences']) assert.equal(can('student_manager', action), true, action);
  for (const action of ['changePasswords', 'deleteStudents', 'changeRoles', 'manageFines', 'correctAttendance', 'manageEvents']) assert.equal(can('student_manager', action), false, action);
  for (const action of ['manageEvents', 'manageGeofences', 'correctAttendance']) assert.equal(can('attendance_admin', action), true, action);
  for (const action of ['viewFines', 'manageFines', 'editStudents', 'resetFace', 'changePasswords', 'changeRoles', 'resetData']) assert.equal(can('attendance_admin', action), false, action);
  for (const action of ['manageFines', 'changePasswords', 'correctAttendance', 'resetFace']) assert.equal(can('head_admin', action), true, action);
  for (const action of ['deleteStudents', 'deleteEvents', 'deleteFines', 'changeRoles', 'resetData']) assert.equal(can('head_admin', action), false, action);
  assert.equal(can('unknown', 'changeRoles'), false); assert.equal(can('super_admin', 'unknown'), false);
  assert.throws(() => requirePermission('student_manager', 'correctAttendance'), { code: 'permission-denied' });
  assert.ok(ROLE_VIEWS.student_manager.includes('assigned-fines')); assert.ok(!ROLE_VIEWS.student_manager.includes('assign-fine'));
  assert.ok(!ROLE_VIEWS.attendance_admin.includes('assigned-fines'));
});

test('manual corrections reject missing reasons, invalid dates and reversed checkout', async () => {
  const { correctionValues } = await isolatedModule('assets/js/controllers/AttendanceCorrectionController.js');
  const input = { checkIn: '2026-10-01T09:00', checkOut: '2026-10-01T10:00', arrival: 'present', reason: ' Verified attendance ' };
  assert.equal(correctionValues(input).reason, 'Verified attendance');
  for (const invalid of [{ reason: '   ' }, { reason: 'x'.repeat(1001) }, { checkIn: '' }, { checkIn: 'invalid' }, { checkIn: '2999-01-01T09:00' }, { checkOut: '2026-10-01T08:00' }, { arrival: 'fake' }]) {
    assert.throws(() => correctionValues({ ...input, ...invalid }));
  }
});

for (const role of ['head_admin', 'attendance_admin', 'student_manager']) {
  test(`${role} initializes only authorized report/directory listeners`, async () => {
    const names = fs.readFileSync(path.join(root, 'assets/js/dashboard.js'), 'utf8').match(/export \{ ([^}]+) \}/)[1].split(', ');
    const shared = Object.fromEntries(names.map(name => [name, () => '']));
    const active = new Map();
    Object.assign(shared, { currentUser: { uid: 'manager-1' }, currentUserProfile: {}, currentUserRole: role, activeView: 'dashboard', ASSIGNABLE_ROLE_LABELS: {}, db: {},
      collection: (_, name) => name, doc: (_, name, id) => `${name}/${id}`, query: value => value,
      onSnapshot: (reference, optionsOrCallback, next) => { const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : next; active.set(reference, callback); return () => active.delete(reference); }, FineModalController: class {}, Timestamp: { fromMillis: value => new Date(value) } });
    const browser = fakeBrowser();
    const { AdminDashboard } = await isolatedModule('assets/js/admin/AdminDashboard.js', shared, browser);
    const dashboard = new AdminDashboard(); dashboard.initialize();
    browser.window.emit('modify-students');
    assert.equal(active.has('fines'), role !== 'attendance_admin');
    assert.equal(active.has('faceRegistrations'), role !== 'attendance_admin');
    assert.equal(browser.document.querySelector('#addAttendanceCorrection').hidden, role === 'student_manager');
    assert.equal(active.has('adminProfiles/manager-1'), false);
    browser.window.emit('dashboard'); assert.equal(active.has('fines'), false);
    dashboard.dispose(); assert.equal(active.size, 0);
  });
}

test('attendance corrections atomically preserve the previous record and identify the actor', async () => {
  const { AttendanceCorrectionController } = await isolatedModule('assets/js/controllers/AttendanceCorrectionController.js');
  const writes = []; const before = { studentUid: 'student-1', eventId: 'event-1', status: 'checked-in', checkedOutAt: new Date('2026-10-01T11:00'), checkOutLocation: {} };
  const controller = new AttendanceCorrectionController({ db: {}, user: { uid: 'manager-1' }, role: 'attendance_admin',
    getStudents: () => [{ uid: 'student-1', accountId: '123', section: '2A', active: true }],
    getEvents: () => [{ id: 'event-1', name: 'Event', type: 'School Event', description: '', date: '2026-10-01', timeIn: '09:00', timeOut: '10:00', location: 'School', audience: 'Section 2A' }],
    transaction: async (_, run) => run({ get: async () => ({ exists: () => true, data: () => before }), set: (ref, data) => writes.push({ ref, data }) }) });
  const input = { studentUid: 'student-1', eventId: 'event-1', checkIn: '2026-10-01T09:00', checkOut: '', arrival: 'present', reason: 'Verified with event staff' };
  await controller.save(input);
  assert.equal(writes.length, 2); assert.equal(writes[0].data.correctedBy, 'manager-1'); assert.equal(writes[0].data.recordSource, 'admin-corrected');
  assert.equal(writes[1].data.before, before); assert.equal(writes[1].data.after, writes[0].data);
  assert.equal(writes[1].data.reason, input.reason); assert.equal(writes[1].data.at, 'server-time');
  assert.equal('checkedOutAt' in writes[0].data, false); assert.equal('checkOutLocation' in writes[0].data, false);
  controller.role = 'student_manager'; await assert.rejects(controller.save(input), { code: 'permission-denied' });
  assert.equal(writes.length, 2);
  controller.role = 'attendance_admin'; controller.getEvents = () => [{ id: 'event-1', audience: 'Section 1A' }];
  await assert.rejects(controller.save(input), /not assigned/); assert.equal(writes.length, 2);
});

test('shared summaries preserve roster eligibility after a section change and exclude nonparticipants', async () => {
  const { AttendanceSummaryService } = await isolatedModule('assets/js/controllers/AttendanceSummaryService.js');
  const summary = new AttendanceSummaryService({ closeDate: event => new Date(event.close), checkoutCloseDate: event => new Date(event.end), now: () => new Date(10000) });
  const student = { uid: 'a', section: '2B' };
  const events = [
    { id: 'rostered', date: '2026-10-01', close: 1000, end: 2000, audience: 'Section 2A', attendanceRoster: { a: '2A' } },
    { id: 'other', close: 1000, end: 2000, attendanceRoster: { b: '2B' } },
    { id: 'legacy', close: 1000, end: 2000, audience: 'All students' },
    { id: 'before-enrollment', close: 1000, end: 2000, audience: 'All students' }
  ];
  let result = summary.summarize(student, events, []);
  assert.equal(result.absences.length, 1); assert.equal(result.absences[0].id, 'rostered');
  assert.equal(result.unverified.length, 2);
  result = summary.summarize({ ...student, createdAt: { toDate: () => new Date(5000) } }, events, []);
  assert.equal(result.unverified.length, 0); assert.equal(result.absences.length, 1);
  result = summary.summarize(student, events, [], { coverageConfirmed: false });
  assert.equal(result.absences.length, 0);
  result = summary.summarize(student, events, [], { coverageFrom: '2026-10-02' });
  assert.equal(result.absences.length, 0);
});

test('missed checkout is review, not absence, and completed records leave review', async () => {
  const { AttendanceSummaryService } = await isolatedModule('assets/js/controllers/AttendanceSummaryService.js');
  let now = 1000;
  const summary = new AttendanceSummaryService({ closeDate: () => new Date(500), checkoutCloseDate: () => new Date(2000), now: () => new Date(now) });
  const event = { id: 'event', attendanceRoster: { a: '2A' }, checkOutClosesAt: true };
  const record = { studentUid: 'a', eventId: 'event', checkedInAt: true, eventDate: '2026-10-01' };
  assert.equal(summary.needsReview(record, event), false);
  now = 3000;
  const result = summary.summarize({ uid: 'a' }, [event], [record]);
  assert.equal(result.review.length, 1); assert.equal(result.absences.length, 0); assert.equal(result.attendedCount, 1);
  assert.equal(summary.needsReview({ ...record, checkedOutAt: true }, event), false);
});

test('today totals include scheduled active participants only and no event means zero pending', async () => {
  const { AttendanceSummaryService } = await isolatedModule('assets/js/controllers/AttendanceSummaryService.js');
  const summary = new AttendanceSummaryService({});
  const students = [{ uid: 'a' }, { uid: 'b' }, { uid: 'c', active: false }, { uid: 'd' }];
  const event = { date: '2026-10-01', attendanceRoster: { a: '2A', b: '2A', c: '2A' } };
  const records = [{ studentUid: 'a', eventDate: event.date, checkedInAt: true }];
  const totals = summary.today(students, [event], records, event.date);
  assert.equal(totals.pending, 1); assert.equal(totals.expected, 2); assert.equal(totals.rate, 50);
  assert.equal(summary.today(students, [], [], event.date).pending, 0);
  assert.equal(Object.keys(summary.captureRoster([{ uid: 'a', section: '2A' }, { uid: 'b', section: '2B' }, { uid: 'c', section: '2A', active: false }], { audience: 'Section 2A' })).join(','), 'a');
});

test('submission retries preserve existing attendance and reconcile a competing tab', async () => {
  const { AttendanceSubmissionService } = await isolatedModule('assets/js/controllers/AttendanceSubmissionService.js');
  let writes = 0, reads = 0;
  const snapshot = exists => ({ exists: () => exists, data: () => ({ checkedInAt: true }) });
  const service = new AttendanceSubmissionService({ read: async () => snapshot(true), write: async () => writes++ });
  const request = { reference: { id: 'a_event' }, matches: record => Boolean(record.checkedInAt), payload: {} };
  assert.equal((await service.submit(request)).state, 'existing'); assert.equal(writes, 0);
  service.read = async () => snapshot(++reads > 1);
  service.write = async () => { writes++; throw Object.assign(new Error('Duplicate rejected'), { code: 'permission-denied' }); };
  assert.equal((await service.submit(request)).state, 'existing'); assert.equal(writes, 1);
});

test('acknowledged save with failed confirmation is not reported as a failed save', async () => {
  const { AttendanceSubmissionService } = await isolatedModule('assets/js/controllers/AttendanceSubmissionService.js');
  let reads = 0;
  const service = new AttendanceSubmissionService({ read: async () => { if (++reads === 1) return { exists: () => false }; throw new Error('Offline'); }, write: async () => {} });
  const request = { reference: { id: 'a_event' }, matches: () => true, payload: {} };
  assert.equal((await service.submit(request)).state, 'confirmation-pending'); assert.equal(service.pending.size, 0);
  service.read = async () => ({ exists: () => false });
  service.write = async () => { throw new Error('Write rejected'); };
  await assert.rejects(service.submit(request), /Write rejected/);
});

test('concurrent submission is blocked while the first operation is pending', async () => {
  const { AttendanceSubmissionService } = await isolatedModule('assets/js/controllers/AttendanceSubmissionService.js');
  let finish;
  const service = new AttendanceSubmissionService({ read: async () => ({ exists: () => false }), write: () => new Promise(resolve => { finish = resolve; }) });
  const request = { reference: { id: 'a_event' }, matches: () => true, payload: {} };
  const first = service.submit(request); await Promise.resolve();
  assert.equal((await service.submit(request)).state, 'busy'); finish();
  assert.equal((await first).state, 'confirmation-pending'); assert.equal(service.pending.size, 0);
});

for (const outcome of ['late', 'closed', 'cancelled']) {
  test(`GPS crossing a cutoff handles ${outcome} before writing`, async () => {
    const writes = [], publications = [];
    const { StudentAttendanceController } = await isolatedModule('assets/js/controllers/StudentAttendanceController.js', attendanceMocks({
      setDoc: async (...args) => writes.push(args),
      getDocFromServer: async reference => ({ id: reference.id, exists: () => reference.collection === 'faceRegistrations' || writes.length > 0,
        data: () => reference.collection === 'faceRegistrations' ? { registered: true } : { studentUid: 'student-1', eventId: 'event', checkedInAt: true, arrivalStatus: 'late' } })
    }), { document: gridDocument });
    let begins = 0;
    const checkIn = { begin: async () => ++begins === 1 ? { available: true, arrivalStatus: 'present' }
      : outcome === 'cancelled' ? { available: false, cancelled: true } : { available: true, arrivalStatus: 'late' },
      policy: { evaluateCheckIn: () => outcome === 'closed' ? { available: false } : { available: true, arrivalStatus: 'late' } } };
    const controller = new StudentAttendanceController({ getState: () => ({ events: [{ id: 'event', requiresGeofence: true }], attendance: [] }), setFaceRegistration() {}, checkIn, bridge: { publish: (...args) => publications.push(args) } });
    controller.verifiedGeofenceLocation = async () => ({ latitude: 14, longitude: 121 });
    const button = { dataset: { attendEvent: 'event' } };
    await controller.handleEventClick({ target: { closest: selector => selector === '[data-attend-event]' ? button : null } });
    assert.equal(writes.length, outcome === 'late' ? 1 : 0);
    if (writes.length) assert.equal(writes[0][1].arrivalStatus, 'late');
    else assert.equal(button.disabled, false);
  });
}

test('history reads are bounded, date-filtered, and use server document cursors', async () => {
  const { AttendanceRepository } = await isolatedModule('assets/js/controllers/AttendanceHistoryController.js');
  const requests = [], docs = [{ id: 'one', data: () => ({ eventDate: '2026-10-01' }) }];
  const repository = new AttendanceRepository({}, async reference => { requests.push(reference); return { docs }; });
  const result = await repository.page({ from: '2026-10-01', to: '2026-10-02', size: 1 });
  assert.equal(result.more, true); assert.equal(result.cursor, docs[0]);
  assert.match(JSON.stringify(requests[0]), /eventDate.*desc/); assert.match(JSON.stringify(requests[0]), /2026-10-01/); assert.match(JSON.stringify(requests[0]), /limit/);
  await repository.page({ cursor: result.cursor });
  assert.equal(requests[1].some(item => item?.cursor === result.cursor), true);
});

test('history filters use historical sections and pagination discards stale responses', async () => {
  const browser = fakeBrowser();
  const { AttendanceHistoryController } = await isolatedModule('assets/js/controllers/AttendanceHistoryController.js', {}, browser);
  let finish, calls = 0; const rows = [], errors = [];
  const repository = { page: () => ++calls === 1 ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve({ records: [{ id: 'new', studentUid: 'a', eventId: 'event', eventDate: '2026-10-01' }], more: false }) };
  const controller = new AttendanceHistoryController({ repository, getStudents: () => [{ uid: 'a', section: '2B', firstName: 'Apollo' }],
    getEvents: () => [{ id: 'event', attendanceRoster: { a: '2A' } }], summary: { needsReview: () => true }, render: records => rows.push(records), notify: (...args) => errors.push(args) });
  controller.initialize(); controller.initialize();
  browser.document.querySelector('#attendanceSection').value = '2A';
  browser.document.querySelector('#attendanceStatus').value = 'review';
  browser.document.querySelector('#attendanceStudentSearch').value = 'apollo';
  const old = controller.reload(); const recent = controller.reload(); await recent;
  finish({ records: [{ id: 'stale' }], more: true }); await old;
  assert.equal(controller.records.length, 1); assert.equal(controller.filtered()[0].id, 'new');
  browser.document.querySelector('#attendanceFromDate').value = '2026-10-02'; browser.document.querySelector('#attendanceToDate').value = '2026-10-01';
  await controller.reload(); assert.equal(errors.at(-1)[0], 'Invalid date range'); assert.equal(calls, 2);
  controller.dispose();
});

test('student attendance pages retain filters and clamp after records change', async () => {
  const browser = fakeBrowser();
  const { StudentAttendanceListController } = await isolatedModule('assets/js/controllers/StudentAttendanceListController.js', {}, browser);
  const controller = new StudentAttendanceListController({ summary: { needsReview: record => record.review }, getEvents: () => [], render() {}, pageSize: 1 });
  controller.initialize();
  browser.document.querySelector('#studentAttendanceStatus').value = 'review';
  const records = [{ id: '1', review: true }, { id: '2', review: false }, { id: '3', review: true }];
  assert.equal(controller.select(records)[0].id, '1'); controller.page++;
  assert.equal(controller.select(records)[0].id, '3');
  assert.equal(controller.select([records[0]])[0].id, '1'); assert.equal(controller.page, 0);
  controller.dispose(); controller.dispose();
});

test('unknown network outcomes do not falsely claim a save was accepted', async () => {
  const { AttendanceSubmissionService } = await isolatedModule('assets/js/controllers/AttendanceSubmissionService.js');
  let reads = 0;
  const service = new AttendanceSubmissionService({ read: async () => { if (++reads === 1) return { exists: () => false }; throw new Error('Offline'); },
    write: async () => { throw Object.assign(new Error('Connection lost'), { code: 'unavailable' }); } });
  assert.equal((await service.submit({ reference: { id: 'a_event' }, matches: () => true, payload: {} })).state, 'unknown');
});

test('loading sparse matches fills the current page before advancing and live watch is disposed', async () => {
  const browser = fakeBrowser();
  const { AttendanceHistoryController } = await isolatedModule('assets/js/controllers/AttendanceHistoryController.js', {}, browser);
  let calls = 0, stops = 0, receive;
  const repository = { page: async () => ({ records: ++calls === 1 ? [{ id: '1' }] : [{ id: '2' }, { id: '3' }], more: true }),
    watch: (_, callback) => { receive = callback; return () => stops++; } };
  const controller = new AttendanceHistoryController({ repository, getStudents: () => [], getEvents: () => [], summary: { needsReview: () => false }, render() {}, notify() {}, pageSize: 2 });
  controller.initialize(); await controller.reload();
  await controller.onNext(); assert.equal(controller.page, 0); assert.equal(controller.records.length, 3);
  await controller.onNext(); assert.equal(controller.page, 1);
  controller.suspend(); assert.equal(stops, 1);
  receive([{ id: 'stale' }]); assert.equal(controller.records.length, 3);
  controller.dispose();
});

test('new attendance controllers reference controls that exist in their dashboard HTML', () => {
  const cases = [['AttendanceHistoryController.js', 'admin'], ['StudentAttendanceListController.js', 'student']];
  for (const [filename, role] of cases) {
    const source = fs.readFileSync(path.join(root, 'assets/js/controllers', filename), 'utf8');
    const html = fs.readFileSync(path.join(root, `pages/${role}-dashboard.html`), 'utf8');
    for (const match of source.matchAll(/(?:querySelector|value)\('(#\w+)'\)/g)) assert.ok(html.includes(`id="${match[1].slice(1)}"`), match[1]);
  }
});

test('shared attendance toolbar resets filters, expands accessibly, and cleans up once', async () => {
  const browser = fakeBrowser();
  const { AttendanceToolbarController } = await isolatedModule('assets/js/controllers/AttendanceToolbarController.js', {}, browser);
  const form = browser.document.querySelector('#attendanceFilters');
  let added = 0, removed = 0, resets = 0, clears = 0, focused = 0, expanded;
  form.reset = () => resets++;
  form.classList.toggle = (_, value) => { expanded = value; };
  for (const target of [browser.document, browser.document.querySelector('#attendanceClearFilters'), browser.document.querySelector('#attendanceToggleFilters')]) {
    target.addEventListener = () => added++;
    target.removeEventListener = () => removed++;
  }
  const toolbar = new AttendanceToolbarController({ form, prefix: 'attendance', onClear: () => clears++ });
  toolbar.initialize(); toolbar.initialize();
  assert.equal(added, 3); assert.equal(expanded, false);
  let aria;
  toolbar.toggle.setAttribute = (name, value) => { if (name === 'aria-expanded') aria = value; };
  toolbar.onToggle(); assert.equal(expanded, true); assert.equal(aria, 'true');
  toolbar.onReset(); assert.equal(resets, 1); assert.equal(clears, 1);
  toolbar.help.open = true;
  toolbar.help.querySelector('summary').focus = () => focused++;
  toolbar.onEscape({ key: 'Escape' });
  assert.equal(toolbar.help.open, false); assert.equal(focused, 1);
  toolbar.dispose(); toolbar.dispose(); assert.equal(removed, 3);
});

test('admin empty results keep Load more available when server records remain', async () => {
  const browser = fakeBrowser();
  const { AttendanceHistoryController } = await isolatedModule('assets/js/controllers/AttendanceHistoryController.js', {}, browser);
  let state;
  const controller = new AttendanceHistoryController({ repository: {}, getStudents: () => [], getEvents: () => [], summary: { needsReview: () => false }, render: (_, next) => { state = next; }, notify() {} });
  controller.initialize(); controller.records = []; controller.more = false; controller.draw();
  assert.equal(browser.document.querySelector('#attendancePagination').hidden, true);
  controller.more = true; controller.draw();
  assert.equal(browser.document.querySelector('#attendancePagination').hidden, false);
  assert.equal(controller.next.disabled, false); assert.equal(controller.next.textContent, 'Load more');
  assert.equal(state.partial, true);
  controller.dispose();
});

test('student pagination hides unnecessary controls and shows accurate ranges', async () => {
  const browser = fakeBrowser();
  const { StudentAttendanceListController } = await isolatedModule('assets/js/controllers/StudentAttendanceListController.js', {}, browser);
  const controller = new StudentAttendanceListController({ summary: { needsReview: () => false }, getEvents: () => [], render() {}, pageSize: 2 });
  controller.initialize(); controller.select([]);
  assert.equal(browser.document.querySelector('#studentAttendancePagination').hidden, true);
  const records = [{ id: '1' }, { id: '2' }, { id: '3' }];
  controller.select(records.slice(0, 2));
  assert.equal(browser.document.querySelector('#studentAttendancePaginationControls').hidden, true);
  controller.select(records); controller.page = 1; controller.select(records);
  assert.equal(browser.document.querySelector('#studentAttendancePaginationControls').hidden, false);
  assert.equal(browser.document.querySelector('#studentAttendancePageInfo').textContent, '3–3 of 3 records');
  controller.toolbar.onReset(); assert.equal(controller.page, 0);
  controller.dispose();
});

test('attendance toolbars have matching HTML controls and honest partial empty states', async () => {
  for (const [role, prefix] of [['admin', 'attendance'], ['student', 'studentAttendance']]) {
    const html = fs.readFileSync(path.join(root, `pages/${role}-dashboard.html`), 'utf8');
    for (const suffix of ['ClearFilters', 'ToggleFilters', 'Help', 'CurrentPage', 'Pagination', 'PaginationControls']) assert.ok(html.includes(`id="${prefix}${suffix}"`));
    assert.ok(html.includes('aria-expanded="false"'));
  }
  const { AttendanceToolbarController } = await isolatedModule('assets/js/controllers/AttendanceToolbarController.js');
  assert.match(AttendanceToolbarController.emptyState({ partial: true }), /Load more to continue searching/);
  assert.match(AttendanceToolbarController.emptyState({ filtered: true }), /Try clearing your filters/);
  assert.match(AttendanceToolbarController.emptyState({ busy: true }), /Loading attendance/);
});
