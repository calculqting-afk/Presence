// Shared policy: a check-in is participation; a missed checkout needs review,
// not an automatic absence or fine. Legacy eligibility is never invented.
export class AttendanceSummaryService {
  constructor({ closeDate, checkoutCloseDate, now = () => new Date() }) {
    Object.assign(this, { closeDate, checkoutCloseDate, now });
  }

  captureRoster(students, event) {
    return Object.fromEntries(students.filter(student => student.active !== false
      && this.matchesAudience(student, event)).map(student => [student.uid, student.section || '']));
  }

  matchesAudience(student, event) {
    return !event.audience || event.audience === 'All students' || event.audience === `Section ${student.section}`;
  }

  eligibility(student, event) {
    if (event.attendanceRoster) return Object.hasOwn(event.attendanceRoster, student.uid) ? 'eligible' : 'excluded';
    const joined = student.createdAt?.toDate?.();
    if (joined && joined > this.closeDate(event)) return 'excluded';
    return this.matchesAudience(student, event) ? 'unknown' : 'excluded';
  }

  needsReview(record, event) {
    return Boolean(record.checkedInAt || record.attendedAt) && !record.checkedOutAt
      && Boolean(event?.checkOutClosesAt || (event?.date && event?.timeOut)) && this.now() > this.checkoutCloseDate(event);
  }

  summarize(student, events, records, { coverageFrom = '', coverageConfirmed = true } = {}) {
    const own = records.filter(record => record.studentUid === student.uid);
    const attended = new Set(own.map(record => record.eventId));
    const absences = [], unverified = [];
    for (const event of events) {
      if (this.now() <= this.checkoutCloseDate(event) || attended.has(event.id)) continue;
      const eligibility = this.eligibility(student, event);
      if (eligibility === 'excluded') continue;
      if (!coverageConfirmed || eligibility === 'unknown' || (coverageFrom && event.date < coverageFrom)) unverified.push(event);
      else absences.push(event);
    }
    return { absences, unverified, attendedIds: attended, attendedCount: own.length,
      presentDays: new Set(own.map(record => record.eventDate)).size,
      review: own.filter(record => this.needsReview(record, events.find(event => event.id === record.eventId))) };
  }

  today(students, events, records, date) {
    const scheduled = events.filter(event => event.date === date);
    const expected = new Set(), unverified = new Set();
    for (const student of students.filter(item => item.active !== false)) {
      for (const event of scheduled) {
        const eligibility = this.eligibility(student, event);
        if (eligibility === 'eligible') expected.add(student.uid);
        else if (eligibility === 'unknown') unverified.add(student.uid);
      }
    }
    const present = new Set(records.filter(record => record.eventDate === date
      && (record.checkedInAt || record.attendedAt)).map(record => record.studentUid));
    const pending = [...expected].filter(uid => !present.has(uid)).length;
    const eligiblePresent = [...expected].filter(uid => present.has(uid)).length;
    return { present: present.size, pending, expected: expected.size, unverified: unverified.size,
      rate: expected.size ? Math.round(eligiblePresent / expected.size * 100) : 0 };
  }
}
