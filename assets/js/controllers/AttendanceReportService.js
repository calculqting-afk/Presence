import { AttendanceRecordProjectionService } from './AttendanceRecordProjectionService.js';

export class AttendanceReportService {
  constructor({ summary, checkoutCloseDate, now = () => new Date() }) { Object.assign(this, { summary, checkoutCloseDate, now }); }
  scheduleKey(event) {
    return [event.date || event.eventDate, event.name || event.eventName, event.timeIn, event.timeOut, event.audience]
      .map(value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()).join('\u001f');
  }
  eventIds(event, events) {
    return [...new Set([event.id, ...events.filter(item => this.scheduleKey(item) === this.scheduleKey(event)).map(item => item.id)])].sort();
  }
  static date(value) {
    const date = value?.toDate?.() || (value instanceof Date ? value : typeof value === 'number' ? new Date(value) : null);
    return date && Number.isFinite(date.getTime()) ? date : null;
  }
  static time(value) {
    return this.date(value)?.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }) || 'Not recorded';
  }
  static clean(value) {
    const text = String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (text.length > 512) throw new Error('A report field exceeds 512 characters. Review the event/student details or search filter.');
    return text;
  }
  schedule(event) {
    const time = value => {
      const date = AttendanceReportService.date(value);
      if (date) return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
      const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
      if (!match || +match[1] > 23 || +match[2] > 59) return 'Not set';
      const hour = +match[1];
      return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
    };
    return {
      checkIn: time(event.openAt || event.timeIn),
      checkInCutoff: time(event.lateAfterAt || event.checkInClosesAt || event.checkInCutoff || event.closeAt || event.timeOut),
      checkOut: time(event.closeAt || event.timeOut),
      checkOutCutoff: time(event.checkOutClosesAt || event.checkOutCutoff || this.checkoutCloseDate(event))
    };
  }
  snapshot({ event, records, students, filters = {}, verifiedAt }) {
    const now = this.now(), closes = this.checkoutCloseDate(event);
    if (!closes || !Number.isFinite(+closes)) throw new Error('The event has no valid attendance closing time. Review its schedule before exporting.');
    const closed = now > closes;
    const byUid = new Map(students.map(student => [student.uid, student]));
    // Duplicate schedule documents must not create phantom absences or double counts.
    const unique = new Map();
    const rank = record => +(AttendanceReportService.date(record.correctedAt) || AttendanceReportService.date(record.updatedAt)
      || AttendanceReportService.date(record.checkedOutAt) || AttendanceReportService.date(record.checkedInAt) || AttendanceReportService.date(record.attendedAt) || 0);
    for (const record of records) {
      const key = record.studentUid || `unknown:${record.id}`;
      const previous = unique.get(key);
      if (!previous || rank(record) > rank(previous) || (rank(record) === rank(previous) && String(record.id) > String(previous.id))) unique.set(key, { ...record, eventId: event.id });
    }
    const actual = [...unique.values()];
    const projection = new AttendanceRecordProjectionService({ getEvents: () => [event], getStudents: () => students, checkoutCloseDate: this.checkoutCloseDate, now: () => now });
    const projected = projection.project(actual, { eventId: event.id }, actual);
    if (!closed) {
      const roster = event.attendanceRoster || Object.fromEntries(students.filter(student => student.active !== false && this.summary.matchesAudience(student, event)
        && !(AttendanceReportService.date(student.createdAt) > this.checkoutCloseDate(event))).map(student => [student.uid, student.section]));
      for (const [uid, section] of Object.entries(roster)) if (!unique.has(uid)) projected.push({ studentUid: uid, eventId: event.id, pending: true, rosterSection: section });
    }
    const search = String(filters.search || '').toLocaleLowerCase();
    let rows = projected.filter(record => {
      const student = byUid.get(record.studentUid);
      return !search || [student?.firstName, student?.middleName, student?.lastName, student?.accountId, student?.email, record.studentId, record.studentName].join(' ').toLocaleLowerCase().includes(search);
    }).map(record => {
      const student = byUid.get(record.studentUid), checkIn = record.checkedInAt || record.attendedAt;
      const profileMissing = !student;
      const review = profileMissing || record.rosterUnverified || (!checkIn && record.checkedOutAt) || this.summary.needsReview(record, event);
      const absent = !record.pending && !review && !checkIn && (record.status === 'absent' || record.arrivalStatus === 'absent');
      const status = profileMissing ? 'review' : record.pending ? 'pending' : review ? 'review' : absent ? 'absent' : record.checkedOutAt ? 'completed' : checkIn ? 'checked-in' : 'review';
      return {
        studentId: AttendanceReportService.clean(student?.accountId || record.studentId || 'Unavailable'),
        name: AttendanceReportService.clean([student?.firstName, student?.middleName, student?.lastName].filter(Boolean).join(' ') || record.studentName || 'Deleted/missing student profile'),
        sortName: AttendanceReportService.clean(student?.lastName || record.studentName || ''),
        course: AttendanceReportService.clean(record.studentCourse || student?.course || 'Unavailable'),
        section: AttendanceReportService.clean(event.attendanceRoster?.[record.studentUid] ?? record.rosterSection ?? student?.section ?? record.section ?? 'Unavailable'),
        checkIn: AttendanceReportService.time(checkIn), checkOut: AttendanceReportService.time(record.checkedOutAt),
        arrival: record.pending && !profileMissing ? 'Not yet checked in' : absent ? 'Absent' : !checkIn ? 'No check-in' : record.arrivalStatus === 'late' ? 'Late' : 'Present',
        completion: profileMissing ? 'Needs review - profile missing' : status === 'completed' ? 'Completed' : status === 'review' ? 'Needs review' : status === 'absent' ? 'Absent' : status === 'pending' ? 'Pending' : 'Checked in',
        status, late: Boolean(checkIn) && record.arrivalStatus === 'late', corrected: record.recordSource === 'admin-corrected'
      };
    });
    rows = rows.filter(row => (!filters.section || row.section === filters.section)
      && (!filters.status || (filters.status === 'late' ? row.late : row.status === filters.status)));
    const lastName = String(filters.sort || '').startsWith('last-name');
    const direction = String(filters.sort || '').endsWith('-desc') ? -1 : 1;
    rows.sort((a, b) => direction * (lastName ? a.sortName : a.name).localeCompare(lastName ? b.sortName : b.name) || a.studentId.localeCompare(b.studentId));
    if (rows.length > 5000) throw new Error('This report exceeds 5,000 rows. Select a section to reduce its size.');
    const totals = { rows: rows.length, present: 0, late: 0, completed: 0, review: 0, absent: 0, pending: 0 };
    for (const row of rows) {
      if (['checked-in', 'completed'].includes(row.status) || (row.status === 'review' && row.checkIn !== 'Not recorded')) totals.present++;
      if (row.late) totals.late++;
      if (Object.hasOwn(totals, row.status)) totals[row.status]++;
    }
    const safe = AttendanceReportService.clean;
    return { title: 'Live attendance report', school: 'Southern Leyte State University - Bontoc Campus',
      event: { id: event.id, name: safe(event.name), date: safe(event.date), location: safe(event.location), audience: safe(event.audience || 'All students'), time: safe([event.timeIn, event.timeOut].filter(Boolean).join(' - ')), schedule: this.schedule(event) },
      filters: { section: safe(filters.section || 'All sections'), status: safe(filters.status || 'All statuses'), search: safe(filters.search || ''), sort: safe(filters.sort || 'name-asc') },
      rows, totals, generatedAt: now.toISOString(), verifiedAt: verifiedAt.toISOString(), timezone: 'Asia/Manila', closed, duplicateCount: records.length - unique.size,
      note: `${closed ? 'Event closed.' : 'Event not final. Pending students are not automatically absent.'} ${records.length - unique.size} duplicate attendance record(s) consolidated. Late and completed counts may overlap with present. Names/course use the current profile; section uses the event roster when available.`,
      filtered: Boolean(filters.section || filters.status || filters.search) };
  }
}
