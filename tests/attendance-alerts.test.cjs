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
    events: [{ id: 'morning', name: 'Morning', audienceSections: ['2A'], openAt: new Date(now - minute), closeAt: new Date(now + minute), checkOutClosesAt: new Date(now + 12 * minute) }], ...overrides };
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
test('check-in becomes checkout; completion cancels; removed participants can still check out', async () => {
  const { AttendanceAlertPolicy: P } = await load('AttendanceAlertPolicy');
  const s = state({ attendance: [{ eventId: 'morning', checkedInAt: new Date(now) }] });
  s.student.section = '1A';
  assert.ok(P.reminders(s, now).every(x => x.action === 'checkout'));
  assert.equal(P.reminders(s, now).length, 2);
  s.attendance[0].checkedOutAt = new Date(now); assert.equal(P.reminders(s, now).length, 0);
});
test('reopened checkout cannot invite new check-in and pre-opening thresholds are omitted', async () => {
  const { AttendanceAlertPolicy: P } = await load('AttendanceAlertPolicy');
  const s = state(); s.events[0].checkoutOnlyReopened = true; assert.equal(P.reminders(s, now).length, 0);
  s.events[0].checkoutOnlyReopened = false; s.events[0].openAt = new Date(now + 10 * minute);
  assert.equal(P.reminders(s, now).length, 0);
});
function nativeFixture() {
  let pending = [{ id: 1, extra: { anotherFeature: true } }], delivered = [], permission = 'granted';
  const calls = [];
  const native = {
    getPending: async () => ({ notifications: pending }), getDeliveredNotifications: async () => ({ notifications: delivered }),
    cancel: async ({ notifications }) => { calls.push('cancel'); pending = pending.filter(x => !notifications.some(y => x.id === y.id)); },
    removeDeliveredNotifications: async () => { delivered = []; },
    checkPermissions: async () => ({ display: permission }), requestPermissions: async () => ({ display: permission }),
    createChannel: async () => {}, schedule: async ({ notifications }) => { calls.push('schedule'); pending.push(...notifications); }
  };
  return { globals: { PresenceNative: { isNative: true, localNotifications: native } }, calls, pending: () => pending,
    deny: () => { permission = 'denied'; } };
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
  const inApp = { checked: true }, phone = { checked: false }, status = {}, message = {};
  const root = { querySelector: s => ({ '[data-alert-in-app]': inApp, '[data-alert-phone]': phone, '[data-alert-status]': status })[s],
    addEventListener: (type, handler) => events.set(type, handler), removeEventListener: type => events.delete(type) };
  const banner = { hidden: true, dataset: {}, querySelector: () => message };
  const document = { hidden: false, querySelector: s => s === '#attendanceAlertSettings' ? root : banner, addEventListener() {}, removeEventListener() {} };
  const window = { addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} };
  return { document, window, events, inApp, phone, status, banner, message,
    storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
}
test('in-app banner updates remaining time, switches to checkout and clears on completion/expiry', async () => {
  let clock = now;
  const { AttendanceAlertsController: C } = await load('AttendanceAlertsController', { Date: class extends Date { static now() { return clock; } } });
  const ui = uiFixture(), s = state();
  const controller = new C({ ...ui, uid: 'student', getState: () => s }); controller.initialize();
  assert.equal(ui.banner.hidden, true); assert.equal(ui.phone.disabled, true);
  clock += 3 * minute; controller.update(); assert.equal(ui.banner.hidden, false); assert.match(ui.message.textContent, /Check-in closes soon/);
  clock += minute; controller.update(); assert.match(ui.message.textContent, /8 minutes remaining/);
  s.attendance = [{ eventId: 'morning', checkedInAt: new Date(now) }]; controller.update(); assert.match(ui.message.textContent, /Checkout closes soon/);
  s.attendance[0].status = 'completed'; controller.update(); assert.equal(ui.banner.hidden, true);
  s.attendance = []; clock = now + 13 * minute; controller.update(); assert.equal(ui.banner.hidden, true);
  controller.dispose(); assert.equal(ui.events.size, 0);
});
test('denied phone permission leaves in-app enabled; opt-out cancels scheduled reminders', async () => {
  const f = nativeFixture(), { AttendanceAlertsController: C } = await load('AttendanceAlertsController', f.globals);
  const ui = uiFixture(), s = state(), controller = new C({ ...ui, uid: 'student', getState: () => s });
  controller.initialize(); f.deny(); ui.phone.checked = true; await ui.events.get('change')({ target: ui.phone });
  assert.equal(ui.phone.checked, false); assert.equal(ui.inApp.checked, true); assert.match(ui.status.textContent, /not granted/);
  controller.dispose();
});

test('offline transition retains scheduled phone alarms; explicit opt-out clears them offline', async () => {
  const f = nativeFixture(), { AttendanceAlertsController: C } = await load('AttendanceAlertsController', f.globals);
  const ui = uiFixture(), s = state();
  ui.storage.setItem('presenceAttendanceAlerts:student', JSON.stringify({ phone: true }));
  const controller = new C({ ...ui, uid: 'student', getState: () => s }); controller.initialize();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.pending().length, 3);
  s.ready = false; controller.update(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.pending().length, 3);
  ui.phone.checked = false; await ui.events.get('change')({ target: ui.phone });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.pending().length, 1);
  await controller.stop();
});
