const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

test('summary correction shortcut only prefills the existing form and never duplicates or submits requests', async () => {
  const f = await fixture(), messages = [], select = { value: '', options: [{ value: 'morning' }] }, kind = { value: '' };
  let focused = 0;
  const rootNode = { scrollIntoView() {}, querySelector: selector => ({ '[data-request-event]': select, '[name="kind"]': kind, '[name="reason"]': { focus: () => focused++ } })[selector] };
  const ui = new f.exports.CorrectionRequestsController({ root: rootNode, db: {}, user: { uid: 'student' }, escapeHtml: String, notify: (...args) => messages.push(args) });
  ui.initialized = true; ui.available = true; ui.refreshEvents = () => {};
  assert.equal(ui.focusSession('morning', 'missed-checkout'), true);
  assert.equal(select.value, 'morning'); assert.equal(kind.value, 'missed-checkout'); assert.equal(focused, 1);
  ui.requests = [{ eventId: 'morning', status: 'approved' }];
  assert.equal(ui.focusSession('morning', 'missed-checkout'), false); assert.match(messages.at(-1)[0], /already submitted/);
  ui.requests = []; assert.equal(ui.focusSession('unavailable', 'missed-check-in'), false);
  ui.available = false; assert.equal(ui.focusSession('morning', 'missed-check-in'), false);
  assert.equal(focused, 1);
});

async function fixture() {
  const stored = new Map([
    ['students/student', { uid: 'student', accountId: '123', firstName: 'Test', lastName: 'Student', section: '2A', active: true }],
    ['students/admin', { uid: 'admin', active: true, role: 'attendance_admin', firstName: 'Alex', middleName: 'Test', lastName: 'Reviewer' }],
    ['events/morning', { id: 'morning', name: 'Morning', type: 'Activity', date: '2020-10-01', timeIn: '07:00', timeOut: '11:00', location: 'School', audience: 'All students', checkOutClosesAt: new Date('2020-10-01T12:00:00+08:00'), attendanceRoster: { student: '2A' } }]
  ]);
  let writes = [], failAt = 0;
  const reference = (...args) => {
    const parts = args.map(part => typeof part === 'object' ? part.path || '' : part).filter(Boolean);
    if (args.length === 1) parts.push('audit-1');
    return { path: parts.join('/'), id: parts.at(-1) };
  };
  const snapshot = ref => ({ exists: () => stored.has(ref.path), data: () => stored.get(ref.path) });
  const transaction = async (_, run) => {
    const pending = [];
    await run({ get: async ref => { assert.equal(pending.length, 0, 'all transaction reads precede writes'); return snapshot(ref); },
      set: (ref, data) => { pending.push([ref.path, data]); if (pending.length === failAt) throw Error('Save unavailable'); } });
    for (const [key, data] of pending) stored.set(key, data);
    writes = pending;
  };
  let listener, errorListener, liveReference, unsubscribed = false;
  const sdk = { doc: reference, collection: reference, runTransaction: transaction, serverTimestamp: () => 'SERVER', Timestamp: { fromDate: date => date },
    query: (...args) => args, where: (...args) => args, getDocFromServer: async ref => snapshot(ref),
    onSnapshot: (ref, options, next, error) => { liveReference = ref; listener = next; errorListener = error; return () => { unsubscribed = true; }; } };
  const context = vm.createContext({ console }), cache = new Map();
  const load = file => { if (!cache.has(file)) cache.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file })); return cache.get(file); };
  const entry = new vm.SourceTextModule("export * from './CorrectionRequestService.js'; export * from './AttendanceCorrectionController.js'; export * from './CorrectionRequestsController.js'; export * from '../core/permissions.js';", { context, identifier: path.join(root, 'assets/js/controllers/test-entry.js') });
  const firebase = new vm.SyntheticModule(Object.keys(sdk), function() { for (const [key, value] of Object.entries(sdk)) this.setExport(key, value); }, { context });
  await entry.link((specifier, parent) => specifier.startsWith('https:') ? firebase : load(path.resolve(path.dirname(parent.identifier), specifier.split('?')[0])));
  await entry.evaluate();
  const service = new entry.namespace.CorrectionRequestService({ db: {}, user: { uid: 'student' }, transaction });
  const reviewer = new entry.namespace.CorrectionRequestService({ db: {}, user: { uid: 'admin' }, role: 'attendance_admin', transaction });
  const correction = new entry.namespace.AttendanceCorrectionController({ db: {}, user: { uid: 'admin' }, role: 'attendance_admin',
    getStudents: () => [stored.get('students/student')], getEvents: () => [stored.get('events/morning')], transaction });
  return { service, reviewer, correction, stored, exports: entry.namespace, emit: data => listener(data), failListener: () => errorListener(), get liveReference() { return liveReference; }, get unsubscribed() { return unsubscribed; }, get writes() { return writes; }, failWrite: index => { failAt = index; } };
}
const submission = { eventId: 'morning', kind: 'missed-check-in', reason: 'Staff verified my participation.' };
const correction = { studentUid: 'student', eventId: 'morning', checkIn: '2020-10-01T07:30', checkOut: '2020-10-01T11:00', arrival: 'present', reason: 'Verified against the event staff log', requestId: 'student_morning' };

test('manual correction request context separates safe reason text and clears it for normal corrections', async () => {
  const f = await fixture(), reason = { textContent: '' }, context = { hidden: true, querySelector: () => reason };
  f.exports.renderCorrectionRequestContext(context, { correctionRequestId: 'student_morning', correctionRequestReason: '<script>text only</script>\nSecond line' });
  assert.equal(context.hidden, false);
  assert.equal(reason.textContent, '<script>text only</script>\nSecond line');
  f.exports.renderCorrectionRequestContext(context, {});
  assert.equal(context.hidden, true); assert.equal(reason.textContent, '');
  f.exports.renderCorrectionRequestContext(null, {});
  const css = fs.readFileSync(path.join(root, 'assets/css/dashboard.css'), 'utf8');
  assert.match(css, /\.correction-request-context \{[^}]*grid-column: 1 \/ -1;/);
  const html = fs.readFileSync(path.join(root, 'pages/admin-dashboard.html'), 'utf8');
  assert.ok(html.indexOf('id="correctionRequestContext"') < html.indexOf('id="correctionCheckIn"'));
  assert.match(html, /data-correction-request-reason/);
});

test('student submits one session request and immutable submission history without any attendance or fine write', async () => {
  const f = await fixture(); await f.service.create(submission);
  assert.deepEqual(f.writes.map(([key]) => key), ['attendanceCorrectionRequests/student_morning', 'attendanceCorrectionRequests/student_morning/history/submitted']);
  assert.equal(f.writes[0][1].status, 'pending');
  assert.equal(f.writes[1][1].reason, submission.reason);
  await assert.rejects(f.service.create(submission), /already submitted/);
});
test('invalid, ineligible, inactive, and still-open requests fail without writes', async () => {
  const f = await fixture();
  await assert.rejects(f.service.create({ ...submission, reason: 'bad' }), /reason/);
  await assert.rejects(f.service.create({ ...submission, kind: 'approve' }), /problem/);
  f.stored.get('events/morning').checkOutClosesAt = new Date(Date.now() + 3600000);
  await assert.rejects(f.service.create(submission), /closes/);
  f.stored.get('students/student').active = false;
  await assert.rejects(f.service.create(submission), /active/);
  assert.equal(f.writes.length, 0);
});
test('approval atomically creates attendance, before-after audit, request decision, and decision history', async () => {
  const f = await fixture(); await f.service.create(submission); await f.correction.save(correction);
  assert.equal(f.writes.length, 5);
  const attendance = f.stored.get('attendance/student_morning'), request = f.stored.get('attendanceCorrectionRequests/student_morning');
  assert.equal(attendance.status, 'completed'); assert.equal(attendance.correctionId, 'audit-1');
  assert.equal(request.status, 'approved'); assert.equal(request.correctionId, attendance.correctionId);
  assert.equal(request.reviewedByName, 'Alex Test Reviewer'); assert.equal(request.reviewedBy, 'admin');
  assert.equal(request.reason, submission.reason); assert.equal(request.decisionReason, correction.reason);
  assert.equal(f.stored.get('attendance/student_morning/corrections/audit-1').before, null);
  assert.equal(f.stored.get('attendanceCorrectionRequests/student_morning/history/decision').action, 'approved');
  assert.equal(f.stored.get('attendanceCorrectionRequests/student_morning/history/decision').byName, 'Alex Test Reviewer');
  assert.ok(!f.writes.some(([key]) => key.startsWith('fines/')));
});
test('failed atomic approval leaves attendance absent and the request pending', async () => {
  const f = await fixture(); await f.service.create(submission); f.failWrite(4);
  await assert.rejects(f.correction.save(correction), /Save unavailable/);
  assert.equal(f.stored.has('attendance/student_morning'), false);
  assert.equal(f.stored.get('attendanceCorrectionRequests/student_morning').status, 'pending');
});
test('decline saves a reason without attendance changes and prevents a stale second review', async () => {
  const f = await fixture(); await f.service.create(submission); await f.reviewer.decline('student_morning', 'Unable to verify participation');
  assert.equal(f.stored.get('attendanceCorrectionRequests/student_morning').status, 'declined');
  assert.equal(f.stored.get('attendanceCorrectionRequests/student_morning').reviewedByName, 'Alex Test Reviewer');
  assert.equal(f.stored.has('attendance/student_morning'), false);
  await assert.rejects(f.correction.save(correction), /no longer pending/);
  await assert.rejects(f.reviewer.decline('student_morning', 'Another decision'), /no longer pending/);
  await assert.rejects(f.service.decline('student_morning', 'Student attempt'), /role/);
});
test('approval cannot cross the request student/session identity', async () => {
  const f = await fixture(); await f.service.create(submission);
  f.stored.get('attendanceCorrectionRequests/student_morning').eventId = 'afternoon';
  await assert.rejects(f.correction.save(correction), /no longer pending/);
  assert.equal(f.stored.has('attendance/student_morning'), false);
});
test('super admin decisions use the admin profile name and retain the original snapshot after a rename', async () => {
  const f = await fixture(); await f.service.create(submission);
  f.stored.set('adminProfiles/root', { displayName: 'Melloohi' });
  const reviewer = new f.exports.CorrectionRequestService({ db: {}, user: { uid: 'root' }, role: 'super_admin' });
  await reviewer.decline('student_morning', 'Participation could not be verified');
  assert.equal(f.stored.get('attendanceCorrectionRequests/student_morning').reviewedByName, 'Melloohi');
  f.stored.get('adminProfiles/root').displayName = 'Changed name';
  assert.equal(f.stored.get('attendanceCorrectionRequests/student_morning').reviewedByName, 'Melloohi');
});

test('student UI scopes its listener, escapes reasons, waits for server acknowledgement and cleans up', async () => {
  const f = await fixture();
  const nodes = { '[data-request-list]': { innerHTML: '' }, '[data-request-sync]': {}, '[data-request-event]': { value: '', innerHTML: '' } };
  const rootNode = { innerHTML: '', addEventListener() {}, removeEventListener() {}, querySelector: selector => nodes[selector] || null };
  const ui = new f.exports.CorrectionRequestsController({ root: rootNode, db: {}, user: { uid: 'student' }, getEvents: () => [f.stored.get('events/morning')], getStudent: () => f.stored.get('students/student'), escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'), notify() {} });
  ui.initialize();
  assert.equal(JSON.stringify(f.liveReference[1]), JSON.stringify(['studentUid', '==', 'student']));
  const docs = [{ id: 'student_morning', data: () => ({ studentUid: 'student', eventId: 'morning', kind: 'missed-check-in', reason: '<script>attack</script>', status: 'pending' }) }];
  f.emit({ docs, metadata: { hasPendingWrites: true } }); assert.equal(ui.requests.length, 0);
  f.emit({ docs, metadata: { hasPendingWrites: false, fromCache: false } });
  assert.match(nodes['[data-request-list]'].innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(nodes['[data-request-list]'].innerHTML, /data-review-request|data-decline-request|<script>/);
  assert.match(nodes['[data-request-list]'].innerHTML, /Awaiting admin review/);
  const decision = { ...docs[0].data(), status: 'declined', reviewedBy: 'private-uid', reviewedByName: 'Alex <Reviewer>', decisionReason: 'Not verified' };
  f.emit({ docs: [{ id: 'student_morning', data: () => decision }], metadata: {} });
  assert.match(nodes['[data-request-list]'].innerHTML, /Reviewed by Alex &lt;Reviewer&gt;/);
  assert.doesNotMatch(nodes['[data-request-list]'].innerHTML, /private-uid/);
  delete decision.reviewedByName;
  f.emit({ docs: [{ id: 'student_morning', data: () => decision }], metadata: {} });
  assert.match(nodes['[data-request-list]'].innerHTML, /Reviewed by Administrator/);
  ui.dispose(); assert.equal(f.unsubscribed, true);
  f.emit({ docs: [], metadata: {} }); assert.equal(ui.requests.length, 1);
});
test('only attendance correction roles receive the admin request queue', async () => {
  const f = await fixture();
  for (const role of ['super_admin', 'head_admin', 'attendance_admin']) assert.ok(f.exports.ROLE_VIEWS[role].includes('correction-requests'));
  for (const role of ['student_manager', 'student']) assert.ok(!f.exports.ROLE_VIEWS[role].includes('correction-requests'));
});
test('admin pending badge and review action preserve exact student/session and clear stale counts on sync errors', async () => {
  const f = await fixture(), labels = {};
  const nodes = { '[data-request-list]': { innerHTML: '' }, '[data-request-sync]': {}, '[data-request-filter]': { value: 'pending', addEventListener() {}, removeEventListener() {} } };
  const rootNode = { innerHTML: '', addEventListener() {}, removeEventListener() {}, querySelector: selector => nodes[selector] || null };
  const badge = { hidden: true, closest: () => ({ setAttribute: (key, value) => { labels[key] = value; } }) };
  let opened;
  const ui = new f.exports.CorrectionRequestsController({ root: rootNode, badge, db: {}, user: { uid: 'admin' }, role: 'attendance_admin', getEvents: () => [f.stored.get('events/morning')], getStudents: () => [f.stored.get('students/student')], onApprove: record => { opened = record; }, escapeHtml: String, notify() {} });
  ui.initialize();
  const docs = [{ id: 'student_morning', data: () => ({ studentUid: 'student', eventId: 'morning', kind: 'missed-check-in', reason: submission.reason, status: 'pending' }) }];
  f.emit({ docs, metadata: {} });
  assert.equal(badge.hidden, false); assert.equal(badge.textContent, '1');
  assert.match(labels['aria-label'], /1 pending/);
  const button = { dataset: { reviewRequest: 'student_morning' } };
  await ui.click({ target: { closest: selector => selector === '[data-review-request]' ? button : null } });
  assert.equal(opened.studentUid, 'student'); assert.equal(opened.eventId, 'morning');
  assert.equal(opened.correctionRequestId, 'student_morning');
  f.failListener(); assert.equal(badge.hidden, true);
  ui.render(); assert.equal(badge.hidden, true);
  ui.dispose();
});

test('request submit shows a spinner until acknowledgement, blocks duplicate taps, and restores the button', async () => {
  const f = await fixture(), attrs = new Map(), classes = new Set(), messages = [];
  const button = { innerHTML: 'Submit request', textContent: 'Submit request', disabled: false,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), removeAttribute: key => attrs.delete(key),
    classList: { toggle: (key, value) => value ? classes.add(key) : classes.delete(key), remove: key => classes.delete(key) } };
  let resetCount = 0, calls = 0, resolve;
  const form = { querySelector: () => button, matches: () => true, reset: () => { resetCount++; }, elements: { eventId: { value: 'morning' }, kind: { value: 'missed-check-in' }, reason: { value: submission.reason } } };
  const ui = new f.exports.CorrectionRequestsController({ root: {}, db: {}, user: { uid: 'student' }, escapeHtml: String, notify: (...args) => messages.push(args) });
  ui.initialized = true;
  ui.service.create = () => { calls++; return new Promise(done => { resolve = done; }); };
  const pending = ui.submit({ target: form });
  assert.equal(button.disabled, true); assert.equal(attrs.get('aria-busy'), 'true');
  assert.match(button.innerHTML, /attendance-button-spinner/); assert.match(button.innerHTML, /Submitting request/);
  assert.equal(messages.length, 0);
  await ui.submit({ target: form }); assert.equal(calls, 1);
  resolve(); await pending;
  assert.equal(button.disabled, false); assert.equal(attrs.has('aria-busy'), false); assert.equal(button.innerHTML, 'Submit request');
  assert.equal(resetCount, 1); assert.equal(messages[0][0], 'Request submitted');
  ui.service.create = async () => { throw Error('Connection unavailable'); };
  await ui.submit({ target: form });
  assert.equal(button.disabled, false); assert.equal(ui.busy, false); assert.equal(resetCount, 1);
  assert.equal(form.elements.reason.value, submission.reason); assert.equal(messages[1][0], 'Request not saved');
});
