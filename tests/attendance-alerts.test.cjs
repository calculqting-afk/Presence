const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
async function load(name, globals = {}) {
  const context = vm.createContext({ Date, console, ...globals }), modules = new Map();
  function get(file) {
    if (!modules.has(file)) modules.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file }));
    return modules.get(file);
  }
  const entry = get(path.join(root, 'assets/js/controllers', name + '.js'));
  await entry.link((specifier, ref) => get(path.resolve(path.dirname(ref.identifier), specifier)));
  await entry.evaluate(); return entry.namespace;
}
const now = Date.now(), minute = 60000;
function state(overrides = {}) {
  return { ready: true, student: { uid: 'student', active: true, section: '2A' }, attendance: [],
    events: [{ id: 'morning', name: 'Morning', audienceSections: ['2A'], openAt: new Date(now - 3 * minute), closeAt: new Date(now + minute), checkOutClosesAt: new Date(now + 12 * minute) }], ...overrides };
}
test('warnings use final cutoff, 10/5 thresholds and separate session IDs', async () => {
  const { AttendanceAlertPolicy: P } = await load('AttendanceAlertPolicy');
  const s = state(); s.events.push({ ...s.events[0], id: 'afternoon', name: 'Afternoon' });
  const result = P.reminders(s, now);
  assert.equal(result.length, 4);
  assert.deepEqual(Array.from(new Set(result.map(x => x.minutes))).sort((a, b) => a - b), [5, 10]);
  assert.equal(new Set(result.map(x => x.key)).size, 4);
  assert.ok(result.every(x => x.action === 'check-in' && x.close === now + 12 * minute));
});
test('unready, inactive, noneligible, expired and malformed events cannot trigger warnings', async () => {
  const { AttendanceAlertPolicy: P } = await load('AttendanceAlertPolicy');
  assert.equal(P.reminders(state({ ready: false }), now).length, 0);
  assert.equal(P.reminders(state({ student: { uid: 'student', active: false, section: '2A' } }), now).length, 0);
  assert.equal(P.reminders(state({ student: { uid: 'student', active: true, section: '1A' } }), now).length, 0);
  const s = state(); s.events[0].checkOutClosesAt = new Date(now - 1); assert.equal(P.reminders(s, now).length, 0);
  delete s.events[0].openAt; delete s.events[0].closeAt; delete s.events[0].checkOutClosesAt; assert.equal(P.reminders(s, now).length, 0);
});

test('opening stages use actual check-in/checkout start times and retain separate session identities', async () => {
  const { AttendanceAlertPolicy: P } = await load('AttendanceAlertPolicy');
  const s = state(); s.events[0].openAt = new Date(now + minute);
  const checkIn = P.reminders(s, now);
  assert.equal(checkIn.length, 3); assert.equal(checkIn[0].kind, 'opening'); assert.equal(checkIn[0].at, now + minute);
  assert.equal(checkIn[0].title, 'Check-in is open'); assert.match(checkIn[0].body, /opens/);
  assert.ok(checkIn.every(item => item.action === 'check-in'));
  s.attendance = [{ eventId: 'morning', checkedInAt: new Date(now) }];
  const checkout = P.reminders(s, now);
  assert.equal(checkout[0].kind, 'opening'); assert.equal(checkout[0].title, 'Checkout is open'); assert.equal(checkout[0].at, +s.events[0].closeAt);
  assert.notEqual(checkout[0].key, checkIn[0].key);
  s.events[0].closeAt = new Date(now + 2 * minute);
  assert.notEqual(P.reminders(s, now)[0].key, checkout[0].key, 'Schedule edits replace the old opening notification');
  s.events.push({ ...s.events[0], id: 'afternoon' });
  s.attendance.push({ eventId: 'afternoon', checkedInAt: new Date(now) });
  assert.equal(new Set(P.reminders(s, now).filter(item => item.kind === 'opening').map(item => item.key)).size, 2);
});

test('opening alerts do not duplicate a cutoff at the same instant or replay stale openings', async () => {
  const { AttendanceAlertPolicy: P } = await load('AttendanceAlertPolicy');
  const s = state(); s.events[0].openAt = new Date(now + 2 * minute);
  const reminders = P.reminders(s, now);
  assert.equal(reminders.filter(item => item.at === now + 2 * minute).length, 1);
  assert.equal(reminders[0].kind, 'opening');
  s.events[0].openAt = new Date(now - 3 * minute);
  assert.equal(P.reminders(s, now).some(item => item.kind === 'opening'), false);
});
test('check-in becomes checkout; completion cancels; removed participants can still check out', async () => {
  const { AttendanceAlertPolicy: P } = await load('AttendanceAlertPolicy');
  const s = state({ attendance: [{ eventId: 'morning', checkedInAt: new Date(now) }] });
  s.student.section = '1A';
  assert.ok(P.reminders(s, now).every(x => x.action === 'checkout'));
  assert.equal(P.reminders(s, now).length, 3);
  s.attendance[0].checkedOutAt = new Date(now); assert.equal(P.reminders(s, now).length, 0);
});
test('reopened checkout cannot invite new check-in and pre-opening thresholds are omitted', async () => {
  const { AttendanceAlertPolicy: P } = await load('AttendanceAlertPolicy');
  const s = state(); s.events[0].checkoutOnlyReopened = true; assert.equal(P.reminders(s, now).length, 0);
  s.events[0].checkoutOnlyReopened = false; s.events[0].openAt = new Date(now + 10 * minute);
  const reminders = P.reminders(s, now);
  assert.equal(reminders.length, 1); assert.equal(reminders[0].kind, 'opening');
});
function nativeFixture() {
  let pending = [{ id: 1, extra: { anotherFeature: true } }], delivered = [], permission = 'granted', permissionResult;
  const calls = [];
  const native = {
    getPending: async () => ({ notifications: pending }), getDeliveredNotifications: async () => ({ notifications: delivered }),
    cancel: async ({ notifications }) => { calls.push('cancel'); pending = pending.filter(x => !notifications.some(y => x.id === y.id)); },
    removeDeliveredNotifications: async () => { delivered = []; },
    checkPermissions: async () => ({ display: permission }), requestPermissions: async () => { calls.push('permission'); permission = permissionResult || permission; return { display: permission }; },
    createChannel: async () => {}, schedule: async ({ notifications }) => { calls.push('schedule'); pending.push(...notifications); }
  };
  return { globals: { PresenceNative: { isNative: true, localNotifications: native } }, calls, pending: () => pending,
    deny: () => { permission = 'denied'; }, setPermission: value => { permission = value; }, setPermissionResult: value => { permissionResult = value; } };
}
const reminder = key => ({ key, eventId: 'event', at: Date.now() + 600000, title: 'Checkout closes soon', body: 'Event' });
test('native reconciliation replaces changed schedules and never touches unrelated notifications', async () => {
  const f = nativeFixture(), N = await load('PhoneAttendanceReminders', f.globals);
  N.activatePhoneReminders('student'); await N.replacePhoneReminders('student', [reminder('old')]);
  await N.replacePhoneReminders('student', [reminder('old')]); assert.equal(f.calls.filter(x => x === 'schedule').length, 1);
  await N.replacePhoneReminders('student', [reminder('new')]);
  assert.equal(f.pending().length, 2); assert.equal(f.pending()[1].extra.key, 'new');
  assert.equal(f.pending()[1].isExactNotification, false);
  await N.clearPhoneReminders(); assert.equal(f.pending().length, 1); assert.equal(f.pending()[0].id, 1);
});

test('APK schedules opening notifications and replaces check-in alerts with checkout alerts after saved check-in', async () => {
  const f = nativeFixture(), N = await load('PhoneAttendanceReminders', f.globals), { AttendanceAlertPolicy: P } = await load('AttendanceAlertPolicy');
  const s = state(); s.events[0].openAt = new Date(now + minute);
  N.activatePhoneReminders('student'); await N.replacePhoneReminders('student', P.reminders(s, now));
  const opening = f.pending().find(item => item.extra?.kind === 'opening');
  assert.equal(opening.title, 'Check-in opening reminder'); assert.equal(+opening.schedule.at, +s.events[0].openAt);
  s.attendance = [{ eventId: 'morning', checkedInAt: new Date(now) }];
  await N.replacePhoneReminders('student', P.reminders(s, now));
  assert.ok(f.pending().filter(item => item.extra?.presenceAttendance).every(item => item.title.startsWith('Checkout')));
  s.attendance[0].status = 'completed'; await N.replacePhoneReminders('student', P.reminders(s, now));
  assert.equal(f.pending().length, 1); await N.clearPhoneReminders();
});
test('logout fences queued old-account scheduling; permission denial prevents scheduling', async () => {
  const f = nativeFixture(), N = await load('PhoneAttendanceReminders', f.globals);
  N.activatePhoneReminders('old'); const scheduled = N.replacePhoneReminders('old', [reminder('old')]);
  await N.clearPhoneReminders(); await scheduled; await N.replacePhoneReminders('old', [reminder('stale')]);
  assert.equal(f.pending().length, 1);
  N.activatePhoneReminders('new'); f.deny(); assert.equal(await N.requestPhoneReminders(), false);
  await N.replacePhoneReminders('new', [reminder('new')]); assert.equal(f.pending().length, 1);
});
test('phone queue caps future notifications and web fallback needs no OS permission', async () => {
  const f = nativeFixture(), N = await load('PhoneAttendanceReminders', f.globals);
  N.activatePhoneReminders('student'); await N.replacePhoneReminders('student', Array.from({ length: 100 }, (_, i) => reminder(String(i))));
  assert.equal(f.pending().length, 61);
  const web = await load('PhoneAttendanceReminders'); assert.equal(web.supportsPhoneReminders(), false);
  await web.clearPhoneReminders();
});

function uiFixture() {
  const events = new Map(), storage = new Map();
  const message = {};
  const banner = { hidden: true, dataset: {}, querySelector: () => message };
  const document = { hidden: false, querySelector: s => s === '#attendanceAlertBanner' ? banner : null, addEventListener() {}, removeEventListener() {} };
  const window = { addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} };
  return { document, window, events, banner, message,
    storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
}
test('in-app banner updates remaining time, switches to checkout and clears on completion/expiry', async () => {
  let clock = now;
  const { AttendanceAlertsController: C } = await load('AttendanceAlertsController', { Date: class extends Date { static now() { return clock; } } });
  const ui = uiFixture(), s = state();
  const controller = new C({ ...ui, uid: 'student', getState: () => s }); controller.initialize();
  assert.equal(ui.banner.hidden, true); assert.equal(controller.phoneSync, undefined);
  clock += 3 * minute; controller.update(); assert.equal(ui.banner.hidden, false); assert.match(ui.message.textContent, /Check-in closes soon/);
  clock += minute; controller.update(); assert.match(ui.message.textContent, /8 minutes remaining/);
  s.attendance = [{ eventId: 'morning', checkedInAt: new Date(now) }]; controller.update(); assert.match(ui.message.textContent, /Checkout closes soon/);
  s.attendance[0].status = 'completed'; controller.update(); assert.equal(ui.banner.hidden, true);
  s.attendance = []; clock = now + 13 * minute; controller.update(); assert.equal(ui.banner.hidden, true);
  controller.dispose(); assert.equal(ui.events.size, 0);
});

test('in-app opening banners appear at the start, switch to checkout, and expire without late replay', async () => {
  let clock = now;
  const { AttendanceAlertsController: C } = await load('AttendanceAlertsController', { Date: class extends Date { static now() { return clock; } } });
  const ui = uiFixture(), s = state(); s.events[0].openAt = new Date(now + minute);
  s.events[0].closeAt = new Date(now + 20 * minute); s.events[0].checkOutClosesAt = new Date(now + 40 * minute);
  const controller = new C({ ...ui, uid: 'student', getState: () => s }); controller.initialize();
  assert.equal(ui.banner.hidden, true);
  clock += minute; controller.update(); assert.equal(ui.banner.hidden, false); assert.match(ui.message.textContent, /Check-in is open/); assert.doesNotMatch(ui.message.textContent, /minutes remaining/);
  clock += 3 * minute; controller.update(); assert.equal(ui.banner.hidden, true);
  s.attendance = [{ eventId: 'morning', checkedInAt: new Date(clock) }]; clock = now + 20 * minute;
  controller.update(); assert.match(ui.message.textContent, /Checkout is open/);
  s.attendance[0].status = 'completed'; controller.update(); assert.equal(ui.banner.hidden, true); controller.dispose();
});
test('APK asks once for future reminders, denial preserves in-app alerts, settings grant enables background scheduling', async () => {
  const f = nativeFixture(); f.setPermission('prompt'); f.setPermissionResult('denied');
  const { AttendanceAlertsController: C } = await load('AttendanceAlertsController', { ...f.globals, Date: class extends Date { static now() { return now + 3 * minute; } } });
  const ui = uiFixture(), s = state(), controller = new C({ ...ui, uid: 'student', getState: () => s });
  controller.initialize(); await controller.phoneSync;
  assert.equal(ui.banner.hidden, false); assert.equal(f.calls.filter(x => x === 'permission').length, 1); assert.equal(f.pending().length, 1);
  f.setPermission('prompt'); controller.update(); await controller.phoneSync;
  assert.equal(f.calls.filter(x => x === 'permission').length, 1);
  assert.equal(ui.storage.getItem('presenceAttendancePhonePrompted'), '1');
  f.setPermission('granted'); controller.update(); await controller.phoneSync; assert.equal(f.pending().length, 2);
  s.attendance = [{ eventId: 'morning', status: 'completed' }]; controller.update(); await controller.phoneSync;
  assert.equal(f.pending().length, 1); assert.equal(ui.banner.hidden, true); await controller.stop();
});

test('automatic APK reminders survive offline transitions; synced removal and logout cancel them', async () => {
  const f = nativeFixture(), { AttendanceAlertsController: C } = await load('AttendanceAlertsController', f.globals);
  const ui = uiFixture(), s = state();
  const controller = new C({ ...ui, uid: 'student', getState: () => s }); controller.initialize();
  await controller.phoneSync; assert.equal(f.pending().length, 3);
  s.ready = false; controller.update(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.pending().length, 3);
  s.ready = true; s.events = []; controller.update(); await controller.phoneSync; assert.equal(f.pending().length, 1);
  await controller.stop();
});

test('website never asks for phone permission even if a non-native bridge exists', async () => {
  let prompts = 0;
  const { AttendanceAlertsController: C } = await load('AttendanceAlertsController', { PresenceNative: { isNative: false, localNotifications: { requestPermissions: () => prompts++ } } });
  const ui = uiFixture(), controller = new C({ ...ui, uid: 'student', getState: () => state() });
  controller.initialize(); controller.update(); assert.equal(prompts, 0); assert.equal(controller.phoneSync, undefined); controller.dispose();
  const html = fs.readFileSync(path.join(root, 'pages/student-dashboard.html'), 'utf8');
  assert.doesNotMatch(html, /attendanceAlertSettings|data-alert-in-app|data-alert-phone/);
  assert.match(html, /id="attendanceAlertBanner"/);
});

test('APK permission prompts wait for eligible future reminders and foreground visibility', async () => {
  const f = nativeFixture(); f.setPermission('prompt'); f.setPermissionResult('granted');
  const { AttendanceAlertsController: C } = await load('AttendanceAlertsController', f.globals);
  const ui = uiFixture(), s = state({ events: [] }), controller = new C({ ...ui, uid: 'student', getState: () => s });
  controller.initialize(); await controller.phoneSync; assert.equal(f.calls.includes('permission'), false);
  ui.document.hidden = true; s.events = state().events; controller.update(); await controller.phoneSync; assert.equal(f.calls.includes('permission'), false);
  ui.document.hidden = false; controller.update(); await controller.phoneSync;
  assert.equal(f.calls.filter(x => x === 'permission').length, 1); assert.equal(f.pending().length, 3);
  await controller.stop();
});

test('logout during an Android permission prompt never schedules old-account reminders', async () => {
  const f = nativeFixture(); f.setPermission('prompt'); let resolve;
  f.globals.PresenceNative.localNotifications.requestPermissions = () => new Promise(done => { resolve = done; });
  const { AttendanceAlertsController: C } = await load('AttendanceAlertsController', f.globals);
  const ui = uiFixture(), controller = new C({ ...ui, uid: 'student', getState: () => state() });
  controller.initialize(); await new Promise(done => setImmediate(done));
  const pending = controller.phoneSync; await controller.stop(); resolve({ display: 'granted' }); await pending;
  assert.equal(f.calls.includes('schedule'), false); assert.equal(f.pending().length, 1);
});
