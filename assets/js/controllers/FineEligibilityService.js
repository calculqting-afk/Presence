// A missing check-in becomes a fine candidate only after a confirmed event ends.
export class FineEligibilityService {
  constructor({ summary, loadEvent, loadAttendance }) {
    Object.assign(this, { summary, loadEvent, loadAttendance });
  }
  candidates(student, events, records, coverage = {}) {
    if (!student) return [];
    const finished = events.filter(event => {
      const end = this.summary.checkoutCloseDate(event).getTime();
      return Number.isFinite(end) && this.summary.now().getTime() > end;
    });
    return this.summary.summarize(student, finished, records, coverage).absences;
  }
  async verify(student, eventId) {
    const [event, records] = await Promise.all([this.loadEvent(eventId), this.loadAttendance(student.uid)]);
    if (!event || !this.candidates(student, [event], records).some(item => item.id === eventId)) {
      throw new Error('This student has no confirmed absence for this event. Upcoming, ongoing, attended, and unverified events cannot receive a missed-attendance fine.');
    }
    return event;
  }
}
