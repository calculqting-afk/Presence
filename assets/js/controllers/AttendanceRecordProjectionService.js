// Builds display-only records. Absences are intentionally not written to
// Firestore: a missing check-in and checkout becomes an absence only after the
// entire attendance period ends, and an administrator can still correct it later.
import { EventAudiencePolicy } from './EventAudiencePolicy.js';
import { CoursePolicy } from '../core/CoursePolicy.js';
export class AttendanceRecordProjectionService {
  constructor({ getEvents, getStudents = () => [], checkoutCloseDate, now = () => new Date() }) {
    Object.assign(this, { getEvents, getStudents, checkoutCloseDate, now });
  }

  project(records, { from = '', to = '', eventId = 'all', status = '', section = '', search = '', course = '', includePending = false } = {}, attendanceContext = records) {
    const actual = records || [];
    // Only absence/review views may add roster-only rows. A deleted profile
    // needs review, not a confirmed absence; late/completed views stay actual-only.
    if (status && !['absent', 'review'].includes(status)) return actual;
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
        || (!includePending && currentTime <= this.checkoutCloseDate(event))) return [];
      const pending = currentTime <= this.checkoutCloseDate(event);
      if (pending && status === 'absent') return [];
      const students = new Map(this.getStudents().map(student => [student.uid, student]));
      const roster = { ...(event.attendanceRoster || {}) };
      if (Array.isArray(event.audienceSections)) for (const [uid, section] of Object.entries(roster)) if (!EventAudiencePolicy.selected(event).includes(section)) delete roster[uid];
      const unverified = new Set();
      for (const student of students.values()) {
        if (Object.hasOwn(roster, student.uid) || student.active === false) continue;
        if (!EventAudiencePolicy.matches(student, event)) continue;
        if (Array.isArray(event.audienceSections) && !EventAudiencePolicy.canAttend(student, event)) continue;
        const joined = student.createdAt?.toDate?.();
        if (joined && joined > this.checkoutCloseDate(event)) continue;
        roster[student.uid] = student.section || '';
        if (!joined || !Number.isFinite(joined.getTime())) unverified.add(student.uid);
      }
      return Object.entries(roster).flatMap(([studentUid, rosterSection]) => {
        const assignmentUnverified = EventAudiencePolicy.addedAfterOpening({ ...students.get(studentUid), uid: studentUid, section: rosterSection }, event);
        if (assignmentUnverified) unverified.add(studentUid);
        if (section && rosterSection !== section) return [];
        const student = students.get(studentUid);
        if (course && CoursePolicy.normalize(student?.course) !== course) return [];
        const profileMissing = !student;
        if ((status === 'absent' && (profileMissing || (Array.isArray(event.audienceSections) && unverified.has(studentUid))))
          || (status === 'review' && !profileMissing && !unverified.has(studentUid))) return [];
        const text = [student?.firstName, student?.middleName, student?.lastName, student?.accountId, student?.email].join(' ').toLowerCase();
        if (search && !text.includes(search.toLowerCase())) return [];
        if (keys.has(this.recordKey(studentUid, event.id))
          || attendanceBySchedule.has(this.scheduleKey(studentUid, event))) return [];
        return [{
          id: `absent:${studentUid}:${event.id}`,
          displayOnly: true,
          pending,
          rosterUnverified: unverified.has(studentUid),
          assignmentUnverified,
          profileMissing,
          rosterSection,
          studentUid,
          eventId: event.id,
          eventName: event.name,
          eventType: event.type,
          eventDate: event.date,
          timeIn: event.timeIn,
          timeOut: event.timeOut,
          location: event.location,
          audience: event.audience,
          status: profileMissing || (Array.isArray(event.audienceSections) && unverified.has(studentUid)) ? 'review' : pending ? 'pending' : 'absent',
          arrivalStatus: profileMissing || (Array.isArray(event.audienceSections) && unverified.has(studentUid)) || pending ? 'unknown' : 'absent'
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
