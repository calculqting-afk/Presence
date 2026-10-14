// Builds display-only records. Absences are intentionally not written to
// Firestore: a missing check-in and checkout becomes an absence only after the
// entire attendance period ends, and an administrator can still correct it later.
export class AttendanceRecordProjectionService {
  constructor({ getEvents, checkoutCloseDate, now = () => new Date() }) {
    Object.assign(this, { getEvents, checkoutCloseDate, now });
  }

  project(records, { from = '', to = '', eventId = 'all' } = {}) {
    const actual = records || [];
    const keys = new Set(actual.map(record => `${record.studentUid}:${record.eventId}`));
    const currentTime = this.now();
    const absences = this.getEvents().flatMap(event => {
      if ((eventId && eventId !== 'all' && event.id !== eventId)
        || (from && event.date < from) || (to && event.date > to)
        || currentTime <= this.checkoutCloseDate(event)) return [];
      return Object.entries(event.attendanceRoster || {}).flatMap(([studentUid]) => {
        if (keys.has(`${studentUid}:${event.id}`)) return [];
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
}
