const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const load = file => import(`file:///${path.join(root, file).replaceAll('\\', '/')}`);

async function fixture() {
  const { AttendanceSummaryService } = await load('assets/js/controllers/AttendanceSummaryService.js');
  const { FineEligibilityService } = await load('assets/js/controllers/FineEligibilityService.js');
  const summary = new AttendanceSummaryService({ now: () => new Date('2026-10-12T12:00:00Z'),
    closeDate: event => new Date(event.end), checkoutCloseDate: event => new Date(event.end) });
  const student = { uid: 'student', section: '2A' };
  const events = [
    { id: 'future', end: '2026-10-14T04:00:00Z', attendanceRoster: { student: '2A' } },
    { id: 'ongoing', end: '2026-10-12T13:00:00Z', attendanceRoster: { student: '2A' } },
    { id: 'boundary', end: '2026-10-12T12:00:00Z', attendanceRoster: { student: '2A' } },
    { id: 'absent', end: '2026-10-11T04:00:00Z', attendanceRoster: { student: '2A' } },
    { id: 'present', end: '2026-10-11T04:00:00Z', attendanceRoster: { student: '2A' } },
    { id: 'excluded', end: '2026-10-11T04:00:00Z', attendanceRoster: { other: '2B' } },
    { id: 'legacy', end: '2026-10-11T04:00:00Z' },
    { id: 'invalid', end: 'invalid', attendanceRoster: { student: '2A' } }
  ];
  const records = [{ studentUid: 'student', eventId: 'present', checkedInAt: new Date() }];
  const service = new FineEligibilityService({ summary, loadEvent: async id => events.find(item => item.id === id), loadAttendance: async () => records });
  return { student, events, records, service };
}

test('fine candidates require an ended event, confirmed roster and no attendance; missed checkout is not an absence', async () => {
  const f = await fixture();
  assert.deepEqual(f.service.candidates(f.student, f.events, f.records).map(item => item.id), ['absent']);
  assert.deepEqual(f.service.candidates(null, f.events, f.records), []);
  assert.deepEqual(f.service.candidates(f.student, f.events, f.records, { coverageConfirmed: false }), []);
});

test('server preflight rejects future/ongoing/attended/unverified events and newly saved attendance', async () => {
  const f = await fixture();
  for (const id of ['future', 'ongoing', 'boundary', 'present', 'excluded', 'legacy', 'invalid', 'deleted']) {
    await assert.rejects(f.service.verify(f.student, id), /no confirmed absence/);
  }
  assert.equal((await f.service.verify(f.student, 'absent')).id, 'absent');
  f.records.push({ studentUid: 'student', eventId: 'absent', checkedInAt: new Date() });
  await assert.rejects(f.service.verify(f.student, 'absent'), /no confirmed absence/);
});

test('fine preflight fails closed when server verification is unavailable', async () => {
  const f = await fixture();
  f.service.loadAttendance = async () => { throw new Error('offline'); };
  await assert.rejects(f.service.verify(f.student, 'absent'), /offline/);
});

test('fine Rules enforce server end time, roster membership and canonical attendance absence', () => {
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const block = rules.split('function confirmedFineAbsence(data)')[1].split('match /dismissedHistory')[0];
  assert.match(block, /request.time > event.checkOutClosesAt/);
  assert.match(block, /data.studentUid in event.attendanceRoster/);
  assert.match(block, /!exists\(/);
  assert.match(block, /allow create:[\s\S]*confirmedFineAbsence\(request.resource.data\)/);
  assert.match(block, /request.resource.data.studentUid == resource.data.studentUid/);
  assert.match(block, /request.resource.data.eventId == resource.data.eventId/);
});
