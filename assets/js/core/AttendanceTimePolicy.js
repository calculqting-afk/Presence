export function attendanceMilliseconds(value) {
  if (value == null || value === '' || typeof value === 'boolean') return NaN;
  return value?.toMillis?.() ?? value?.toDate?.()?.getTime?.() ?? new Date(value).getTime();
}
export function attendanceDay(value) {
  const time = attendanceMilliseconds(value);
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : '';
}
export function attendanceTimeIssue(record, event) {
  const start = attendanceMilliseconds(record?.checkedInAt || record?.attendedAt);
  const end = attendanceMilliseconds(record?.checkedOutAt);
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) return 'invalid-duration';
  const day = event?.date || record?.eventDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(day || '') &&
      (Number.isFinite(start) && attendanceDay(start) !== day || Number.isFinite(end) && attendanceDay(end) !== day)) return 'outside-event-date';
  return '';
}
export function attendanceReviewLabel(issue) {
  return issue === 'invalid-duration' ? 'Needs review — invalid duration' : issue === 'outside-event-date' ? 'Needs review — event date mismatch' : '';
}
