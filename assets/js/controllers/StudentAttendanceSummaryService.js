import { attendanceTimeIssue, attendanceReviewLabel } from '../core/AttendanceTimePolicy.js';
import { AttendanceSummaryService } from './AttendanceSummaryService.js';
import { AttendanceViews } from './AttendanceViews.js';
import { EventAudiencePolicy } from './EventAudiencePolicy.js';

// Read-only projection: arrival and completion are separate dimensions.
export class StudentAttendanceSummaryService {
  static milliseconds(value) {
    const time = value?.toMillis?.() ?? value?.toDate?.()?.getTime?.() ?? (value instanceof Date ? +value : NaN);
    return Number.isFinite(time) ? time : NaN;
  }
  project({ student, events = [], attendance = [], verified = false }, filters = {}, now = Date.now()) {
    const counts = { present: 0, late: 0, absent: 0, incomplete: 0, awaiting: 0, pending: 0, review: 0 };
    if (!student?.uid) return { rows: [], cards: [], counts, options: [], verified: false };
    const policy = new AttendanceSummaryService({ closeDate: event => new Date(AttendanceViews.time(event, 'closeAt')),
      checkoutCloseDate: event => new Date(AttendanceViews.time(event, 'checkOutClosesAt')), now: () => new Date(now) });
    const unique = new Map();
    const rank = record => Math.max(0, ...['correctedAt', 'updatedAt', 'checkedOutAt', 'checkedInAt', 'attendedAt']
      .map(field => StudentAttendanceSummaryService.milliseconds(record[field])).filter(Number.isFinite));
    for (const record of attendance.filter(item => item.studentUid === student.uid && item.eventId)) {
      const previous = unique.get(record.eventId);
      if (!previous || rank(record) > rank(previous) || (rank(record) === rank(previous) && String(record.id) > String(previous.id))) unique.set(record.eventId, record);
    }
    const byId = new Map(events.map(event => [event.id, event]));
    const ids = new Set([...byId.keys(), ...unique.keys()]);
    const options = new Map(), rows = [];
    for (const id of ids) {
      const event = byId.get(id), record = unique.get(id);
      const eligibility = event ? policy.eligibility(student, event) : 'unknown';
      if (!record && (eligibility === 'excluded' || student.active === false)) continue;
      const title = event ? AttendanceViews.title(event) : record.eventName || 'Unavailable event';
      const date = event?.date || record?.eventDate || '';
      const group = event?.sessionGroupId || id;
      const session = event && (['morning', 'afternoon'].includes(event.sessionPeriod) || /^\d{2}:\d{2}$/.test(event.timeIn || '')) ? AttendanceViews.label(event) : 'Unknown';
      options.set(group, { id: group, label: `${title}${date ? ` · ${date}` : ''}` });
      const close = event ? AttendanceViews.time(event, 'checkOutClosesAt') : NaN;
      const open = event ? AttendanceViews.time(event, 'openAt') : NaN;
      const checkIn = StudentAttendanceSummaryService.milliseconds(record?.checkedInAt || record?.attendedAt);
      const checkOut = StudentAttendanceSummaryService.milliseconds(record?.checkedOutAt);
      const hasCheckIn = Number.isFinite(checkIn), hasCheckOut = Number.isFinite(checkOut);
      const timeIssue = attendanceTimeIssue(record, event);
      const malformed = Boolean(timeIssue) || Boolean(record && ((record.checkedInAt || record.attendedAt) && !hasCheckIn
        || record.checkedOutAt && !hasCheckOut || hasCheckIn && checkIn > now || hasCheckOut && (!hasCheckIn || checkOut < checkIn || checkOut > now)));
      let status = 'review', label = attendanceReviewLabel(timeIssue) || 'Needs review';
      if (event && Number.isFinite(close) && !malformed) {
        if (hasCheckIn && hasCheckOut) { status = record.arrivalStatus === 'late' ? 'late' : 'present'; label = 'Completed'; }
        else if (hasCheckIn) {
          if (now <= close) { status = 'awaiting'; label = 'Awaiting checkout'; }
          else if (verified) { status = 'incomplete'; label = 'Incomplete — missed checkout'; }
        } else if (!record || ['absent', 'pending'].includes(record.status)) {
          if (now <= close) { status = 'pending'; label = Number.isFinite(open) && now < open ? 'Not open yet' : 'Not yet checked in'; }
          else if (verified && eligibility === 'eligible' && student.active !== false) { status = 'absent'; label = 'Absent'; }
        }
      }
      const arrival = hasCheckIn && !malformed ? record.arrivalStatus === 'late' ? 'Late' : 'Present' : '';
      rows.push({ eventId: id, group, title, date, session, status, label, arrival, checkIn: hasCheckIn ? checkIn : null,
        checkOut: hasCheckOut ? checkOut : null, corrected: record?.recordSource === 'admin-corrected',
        canRequest: verified && event && (['absent', 'incomplete'].includes(status) || Boolean(timeIssue) && now > close) && EventAudiencePolicy.canAttend(student, event),
        requestKind: timeIssue ? 'incorrect-attendance' : status === 'incomplete' ? 'missed-checkout' : 'missed-check-in' });
    }
    const selected = rows.filter(row => (!filters.month || row.date.slice(0, 7) === filters.month)
      && (!filters.event || row.group === filters.event)
      && (!filters.session || filters.session === 'both' || row.session.toLowerCase() === filters.session));
    // Explicit period order within the same event, even though Alphabetical is Afternoon first.
    selected.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)
      || ({ Morning: 0, Afternoon: 1, Unknown: 2 }[a.session] - { Morning: 0, Afternoon: 1, Unknown: 2 }[b.session]));
    for (const row of selected) {
      if (row.arrival === 'Present') counts.present++;
      if (row.arrival === 'Late') counts.late++;
      if (Object.hasOwn(counts, row.status) && !['present', 'late'].includes(row.status)) counts[row.status]++;
    }
    const cards = new Map();
    for (const row of selected) {
      // Group only explicitly linked sessions on the same event date. Matching
      // titles alone must never merge unrelated events or correction targets.
      const key = `${row.group}\u0000${row.date}`;
      if (!cards.has(key)) cards.set(key, { title: row.title, date: row.date, sessions: [] });
      cards.get(key).sessions.push(row);
    }
    return { rows: selected, cards: [...cards.values()], counts, options: [...options.values()].sort((a, b) => b.label.localeCompare(a.label)), verified };
  }
}
