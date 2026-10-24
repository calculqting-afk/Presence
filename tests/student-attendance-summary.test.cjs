const test = require('node:test');
const assert = require('node:assert/strict');
const stamp = iso => ({ toDate: () => new Date(iso), toMillis: () => +new Date(iso) });
const now = +new Date('2026-10-25T12:00:00+08:00');
const student = { uid: 'student', active: true, section: '2A', createdAt: stamp('2025-01-01T00:00:00Z') };
function event(id = 'morning', overrides = {}) {
  return { id, sessionGroupId: 'assembly', sessionBaseName: 'Assembly', name: 'Assembly — Morning', sessionPeriod: 'morning', date: '2026-10-25',
    openAt: stamp('2026-10-25T07:00:00+08:00'), closeAt: stamp('2026-10-25T10:00:00+08:00'), checkOutClosesAt: stamp('2026-10-25T11:00:00+08:00'),
    attendanceRoster: { student: '2A' }, audienceSections: ['2A'], rosterCapturedAt: stamp('2026-10-24T00:00:00Z'), ...overrides };
}
const attendance = (overrides = {}) => ({ id: 'r1', eventId: 'morning', studentUid: 'student', checkedInAt: stamp('2026-10-25T08:00:00+08:00'), arrivalStatus: 'present', ...overrides });
async function project(events, records = [], filters = {}, overrides = {}, time = now) {
  const { StudentAttendanceSummaryService } = await import('../assets/js/controllers/StudentAttendanceSummaryService.js');
  return new StudentAttendanceSummaryService().project({ student, events, attendance: records, verified: true, ...overrides }, filters, time);
}
test('present/late describe arrival while incomplete is a separate completion dimension', async () => {
  const a = event(), b = event('afternoon', { sessionPeriod: 'afternoon' });
  const result = await project([a, b], [attendance(), attendance({ eventId: b.id, arrivalStatus: 'late', checkedOutAt: stamp('2026-10-25T10:30:00+08:00') })]);
  assert.equal(result.counts.present, 1); assert.equal(result.counts.late, 1); assert.equal(result.counts.incomplete, 1); assert.equal(result.counts.absent, 0);
  assert.equal(result.rows[0].label, 'Incomplete — missed checkout'); assert.equal(result.rows[1].label, 'Completed');
  assert.equal(result.rows[0].canRequest, true); assert.equal(result.rows[0].requestKind, 'missed-checkout');
});
test('open sessions await checkout until the exact final cutoff, never premature incomplete', async () => {
  const end = stamp('2026-10-25T12:00:00+08:00'), e = event('morning', { checkOutClosesAt: end });
  const atCutoff = await project([e], [attendance()]);
  assert.equal(atCutoff.counts.awaiting, 1); assert.equal(atCutoff.counts.incomplete, 0); assert.equal(atCutoff.rows[0].canRequest, false);
  assert.equal((await project([e], [attendance()], {}, {}, now + 1)).counts.incomplete, 1);
});
test('verified closed roster absence is different from future/pending and unverified history', async () => {
  const future = event('future', { sessionGroupId: 'future', openAt: stamp('2026-10-26T07:00:00+08:00'), checkOutClosesAt: stamp('2026-10-26T12:00:00+08:00'), date: '2026-10-26' });
  const legacy = event('legacy', { attendanceRoster: undefined, audienceSections: undefined, audience: 'All students' });
  const result = await project([event(), future, legacy]);
  assert.equal(result.counts.absent, 1); assert.equal(result.counts.pending, 1); assert.equal(result.counts.review, 1);
  assert.equal(result.rows.find(row => row.eventId === 'morning').requestKind, 'missed-check-in');
  assert.equal(result.rows.find(row => row.eventId === 'legacy').canRequest, false);
});
test('cached/unverified snapshots never confirm absences or missed checkouts', async () => {
  const result = await project([event(), event('missing')], [attendance()], {}, { verified: false });
  assert.equal(result.counts.absent, 0); assert.equal(result.counts.incomplete, 0); assert.equal(result.counts.review, 2);
  assert.equal(result.rows.every(row => !row.canRequest), true);
});
test('provisional late-added students are not declared absent; excluded sessions stay out', async () => {
  const provisional = event('provisional', { attendanceRoster: {}, sectionAssignedAt: { '2A': stamp('2026-10-25T08:00:00+08:00') } });
  const result = await project([provisional, event('excluded', { attendanceRoster: { other: '1A' }, audienceSections: ['1A'] })], [], {}, { student: { ...student, createdAt: stamp('2026-10-25T08:00:00+08:00') } });
  assert.equal(result.counts.absent, 0); assert.equal(result.rows.length, 1); assert.equal(result.rows[0].status, 'review');
});
test('month, grouped event and period filters count morning/afternoon independently', async () => {
  const events = [event(), event('afternoon', { sessionPeriod: 'afternoon' }), event('september', { date: '2026-09-30', sessionGroupId: 'older' })];
  const all = await project(events); assert.equal(all.counts.absent, 3);
  const selected = await project(events, [], { month: '2026-10', event: 'assembly', session: 'afternoon' });
  assert.equal(selected.rows.length, 1); assert.equal(selected.rows[0].eventId, 'afternoon'); assert.equal(selected.counts.absent, 1);
  assert.equal((await project(events, [], { month: '2026-08' })).rows.length, 0);
});
test('linked sessions share one event card; the period dropdown filters both cards and counts', async () => {
  const events = [event(), event('afternoon', { sessionPeriod: 'afternoon' }), event('unrelated', { sessionGroupId: 'another-event' })];
  const both = await project(events);
  assert.equal(both.cards.length, 2); assert.equal(both.rows.length, 3);
  assert.deepEqual(both.cards[0].sessions.map(row => row.eventId), ['morning', 'afternoon']);
  assert.equal(both.counts.absent, 3);
  const afternoon = await project(events, [], { session: 'afternoon' });
  assert.equal(afternoon.cards.length, 1); assert.equal(afternoon.cards[0].sessions.length, 1);
  assert.equal(afternoon.cards[0].sessions[0].eventId, 'afternoon'); assert.equal(afternoon.counts.absent, 1);
  const anotherDate = await project([event(), event('different-date', { date: '2026-10-24' })]);
  assert.equal(anotherDate.cards.length, 2, 'Even a reused group ID never merges different dates');
});
test('duplicate sessions count once and other students records never enter the summary', async () => {
  const result = await project([event()], [attendance(), attendance({ id: 'r2', arrivalStatus: 'late', updatedAt: stamp('2026-10-25T10:00:00+08:00'), checkedOutAt: stamp('2026-10-25T10:30:00+08:00') }), attendance({ studentUid: 'another', eventId: 'private' })]);
  assert.equal(result.rows.length, 1); assert.equal(result.counts.present, 0); assert.equal(result.counts.late, 1); assert.equal(result.counts.incomplete, 0);
});
test('orphaned records, checkout-only records and invalid/reversed times need review, not absence', async () => {
  const result = await project([event(), event('partial'), event('reverse')], [attendance({ eventId: 'deleted', eventName: 'Removed event', eventDate: '2026-10-25' }),
    attendance({ checkedInAt: { toMillis: () => NaN } }), attendance({ eventId: 'partial', checkedInAt: null, checkedOutAt: stamp('2026-10-25T10:00:00+08:00') }),
    attendance({ eventId: 'reverse', checkedOutAt: stamp('2026-10-25T07:00:00+08:00') })]);
  assert.equal(result.counts.review, 4); assert.equal(result.counts.absent, 0); assert.equal(result.counts.incomplete, 0);
});

function node() {
  const children = [], handlers = new Map(), nodes = new Map();
  return { children, handlers, value: '', dataset: {}, hidden: false, textContent: '', classList: { toggle() {} },
    setAttribute(key, value) { this[key] = value; }, append(value) { children.push(value); }, replaceChildren() { children.length = 0; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
    addEventListener(key, handler) { handlers.set(key, handler); }, removeEventListener(key) { handlers.delete(key); } };
}
test('summary controller switches views, safely renders, filters and disposes listeners/timer', async () => {
  const { StudentAttendanceSummaryController } = await import('../assets/js/controllers/StudentAttendanceSummaryController.js');
  const root = node(), records = node(), corrections = node(), tabs = ['records', 'summary'].map(name => Object.assign(node(), { dataset: { attendanceTab: name } }));
  let timer, cleared = 0, request;
  const document = { hidden: false, querySelector: selector => ({ '#studentAttendanceSummary': root, '#studentAttendanceRecordsPanel': records, '#studentCorrectionRequests': corrections })[selector], querySelectorAll: () => tabs, createElement: node };
  const window = Object.assign(node(), { setInterval: fn => { timer = fn; return 1; }, clearInterval: () => cleared++ });
  const state = { student, events: [event('morning', { name: '<img src=x onerror=alert(1)>', sessionBaseName: '<script>name</script>' })], attendance: [], verified: true, view: 'attendances' };
  const controller = new StudentAttendanceSummaryController({ document, window, getState: () => state, now: () => now, requestCorrection: (...args) => { request = args; } });
  controller.initialize(); assert.equal(root.hidden, true); assert.equal(records.hidden, false);
  assert.equal(corrections.hidden, true);
  tabs[1].handlers.get('click')(); assert.equal(root.hidden, false); assert.equal(records.hidden, true);
  assert.equal(corrections.hidden, false);
  corrections.querySelector('reason').value = 'Preserved request draft';
  tabs[0].handlers.get('click')(); assert.equal(corrections.hidden, true); assert.equal(records.hidden, false);
  tabs[1].handlers.get('click')(); assert.equal(corrections.hidden, false); assert.equal(corrections.querySelector('reason').value, 'Preserved request draft');
  assert.equal(root.querySelector('[data-summary-count="absent"]').textContent, 1);
  const card = root.querySelector('[data-summary-list]').children[0]; assert.equal(card.children[0].textContent, '<script>name</script>');
  root.handlers.get('click')({ target: { closest: selector => selector === '[data-summary-correction]' ? { dataset: { summaryCorrection: 'morning' } } : null } });
  assert.deepEqual(request, ['morning', 'missed-check-in']);
  state.events.push(event('afternoon', { sessionPeriod: 'afternoon', sessionBaseName: '<script>name</script>' }));
  controller.render();
  assert.equal(controller.result.cards.length, 1);
  assert.equal(root.querySelector('[data-summary-list]').children.length, 1);
  let sessions = root.querySelector('[data-summary-list]').children[0].children[2].children;
  assert.deepEqual(sessions.map(section => section.dataset.summarySession), ['morning', 'afternoon']);
  controller.session.value = 'afternoon'; controller.form.handlers.get('change')();
  sessions = root.querySelector('[data-summary-list]').children[0].children[2].children;
  assert.equal(sessions.length, 1); assert.equal(sessions[0].dataset.summarySession, 'afternoon');
  assert.equal(root.querySelector('[data-summary-count="absent"]').textContent, 1);
  root.handlers.get('click')({ target: { closest: selector => selector === '[data-summary-correction]' ? { dataset: { summaryCorrection: 'afternoon' } } : null } });
  assert.deepEqual(request, ['afternoon', 'missed-check-in']);
  controller.month.value = '2026-08'; controller.form.handlers.get('change')(); assert.equal(controller.result.rows.length, 0);
  state.verified = false; controller.root.querySelector('[data-summary-clear]').handlers.get('click')(); timer();
  assert.equal(controller.result.counts.absent, 0); assert.match(root.querySelector('[data-summary-status]').textContent, /Waiting for server/);
  controller.dispose(); assert.equal(cleared, 1); assert.equal(root.handlers.size, 0);
});
