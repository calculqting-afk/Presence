// Builds display-only records. Absences are intentionally not written to
// Firestore: a missing check-in and checkout becomes an absence only after the
// entire attendance period ends, and an administrator can still correct it later.
export class AttendanceRecordProjectionService {
  constructor({ getEvents, checkoutCloseDate, now = () => new Date() }) {
    Object.assign(this, { getEvents, checkoutCloseDate, now });
  }

  project(records, { from = '', to = '', eventId = 'all', status = '' } = {}, attendanceContext = records) {
    const actual = records || [];
    // A generated absence is only meaningful for the unfiltered view or the
    // dedicated absence filter. Other status filters must show actual records
    // only—for example, "Late check-in" must never append absent students.
    if (status && status !== 'absent') return actual;
    // Filtering can intentionally omit completed records (for example while
    // viewing "Did not attend"). Use the unfiltered loaded history to decide
    // who truly has attendance, while returning only the filtered rows.
    const attendance = attendanceContext || actual;
    const keys = new Set(attendance.map(record => this.recordKey(record.studentUid, record.eventId)));
    // Older duplicate event documents can have different Firestore IDs while
    // representing the same student-facing event. A real record for that
    // schedule must win over a display-only absence from the duplicate.
    const attendanceBySchedule = new Set(attendance.map(record => this.scheduleKey(record.studentUid, record)));
    const currentTime = this.now();
    const absences = this.getEvents().flatMap(event => {
      if ((eventId && eventId !== 'all' && event.id !== eventId)
        || (from && event.date < from) || (to && event.date > to)
        || currentTime <= this.checkoutCloseDate(event)) return [];
      return Object.entries(event.attendanceRoster || {}).flatMap(([studentUid]) => {
        if (keys.has(this.recordKey(studentUid, event.id))
          || attendanceBySchedule.has(this.scheduleKey(studentUid, event))) return [];
        return [{
          id: `absent:${studentUid}:${event.id}`,
          displayOnly: true,
          studentUid,
          eventId: event.id,
          eventName: event.name,
          eventType: event.type,
          eventDate: event.date,
          timeIn: event.timeIn,
          timeOut: event.timeOut,
          location: event.location,
          audience: event.audience,
          status: 'absent',
          arrivalStatus: 'absent'
        }];
      });
    });
    return [...actual, ...absences];
  }
  recordKey(studentUid, eventId) {
    return `${studentUid || ''}:${eventId || ''}`;
  }
  scheduleKey(studentUid, event) {
    const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
    return [studentUid, event.eventDate || event.date, event.eventName || event.name, event.timeIn, event.timeOut, event.audience]
      .map(normalize)
      .join('\u001f');
  }
}
