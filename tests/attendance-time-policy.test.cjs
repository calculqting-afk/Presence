const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../assets/js/core/AttendanceTimePolicy.js');
const stamp = value => ({ toMillis: () => Date.parse(value) });
test('exact timestamps distinguish zero/reversed duration from legitimate sub-minute attendance', async () => {
  const { attendanceTimeIssue, attendanceReviewLabel } = await load();
  const record = { eventDate: '2020-10-01', checkedInAt: stamp('2020-10-01T10:13:00+08:00'), checkedOutAt: stamp('2020-10-01T10:13:30+08:00') };
  assert.equal(attendanceTimeIssue(record), '');
  assert.equal(attendanceTimeIssue({ ...record, checkedOutAt: record.checkedInAt }), 'invalid-duration');
  assert.equal(attendanceTimeIssue({ ...record, checkedOutAt: stamp('2020-10-01T10:12:59+08:00') }), 'invalid-duration');
  assert.equal(attendanceReviewLabel('invalid-duration'), 'Needs review — invalid duration');
});
test('event-date review uses Philippine midnight and preserves uncompleted and partial records', async () => {
  const { attendanceTimeIssue, attendanceDay } = await load();
  assert.equal(attendanceDay('2020-09-30T16:00:00Z'), '2020-10-01');
  assert.equal(attendanceTimeIssue({ eventDate: '2020-10-01', checkedInAt: stamp('2020-09-30T16:00:00Z') }), '');
  assert.equal(attendanceTimeIssue({ eventDate: '2020-10-01', checkedInAt: stamp('2020-10-02T10:00:00+08:00') }), 'outside-event-date');
  assert.equal(attendanceTimeIssue({ checkedOutAt: stamp('2020-10-01T10:00:00+08:00') }), '');
  assert.equal(attendanceTimeIssue({ status: 'absent' }), '');
});
