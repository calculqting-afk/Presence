import { EventAudiencePolicy } from './EventAudiencePolicy.js';

// Sessions use distinct event IDs, so the existing uid_event attendance key,
// timing rules, reports and corrections remain isolated for each session.
export class EventSessionPolicy {
  static scheduleFields = ['date', 'timeIn', 'checkInCutoff', 'timeOut', 'checkOutCutoff', 'openAt', 'checkInClosesAt', 'closeAt', 'checkOutClosesAt'];
  static afternoonId(id) { return `${id}_afternoon`; }
  static opened(event, now = new Date()) { const date = EventAudiencePolicy.date(event?.openAt); return Boolean(date && date <= now); }
  static assertSchedule(record, previous, now = new Date()) {
    if (!previous || !this.opened(previous, now)) return;
    if (this.scheduleFields.some(key => {
      const before = EventAudiencePolicy.date(previous[key]) || previous[key];
      const after = EventAudiencePolicy.date(record[key]) || record[key];
      return String(before) !== String(after);
    })) throw new Error('This session has opened. Its attendance schedule is locked; create another event for a different schedule.');
  }
  static prepare({ id, record, previous, afternoon, enabled, times, students, sections, timestamp, fromDate, now = new Date() }) {
    if (afternoon && !enabled) throw new Error('A published afternoon session cannot be disabled here. Its attendance and history must be preserved.');
    this.assertSchedule(record, previous, now);
    const baseName = record.name;
    const maximum = !previous || previous.sessionPeriod || enabled ? 145 : 160;
    if (!baseName || baseName.length > maximum) throw new Error(`Use an event name of 1–${maximum} characters.`);
    const primary = { ...record };
    if (!previous || previous.sessionPeriod || enabled) Object.assign(primary, {
      sessionPeriod: 'morning', sessionGroupId: id, sessionBaseName: baseName, name: `${baseName} — Morning`
    });
    if (!enabled) return { primary, afternoon: null };
    const [timeIn, checkInCutoff, timeOut, checkOutCutoff] = times;
    if (![timeIn, checkInCutoff, timeOut, checkOutCutoff].every(time => /^([01]\d|2[0-3]):[0-5]\d$/.test(time || ''))
      || timeIn < '12:00' || checkInCutoff <= timeIn || timeOut < checkInCutoff || checkOutCutoff <= timeOut
      || record.timeIn >= '12:00' || record.checkOutCutoff > timeIn) {
      throw new Error('Use a morning check-in before noon and an afternoon check-in at or after noon. Each session needs ordered check-in/checkout windows, and the morning must finish before the afternoon starts.');
    }
    const secondary = { ...record, name: `${baseName} — Afternoon`, sessionPeriod: 'afternoon', sessionGroupId: id, sessionBaseName: baseName,
      timeIn, checkInCutoff, timeOut, checkOutCutoff,
      openAt: fromDate(new Date(`${record.date}T${timeIn}`)), checkInClosesAt: fromDate(new Date(`${record.date}T${checkInCutoff}`)),
      closeAt: fromDate(new Date(`${record.date}T${timeOut}`)), checkOutClosesAt: fromDate(new Date(`${record.date}T${checkOutCutoff}`)) };
    this.assertSchedule(secondary, afternoon, now);
    if (!afternoon && EventAudiencePolicy.date(secondary.openAt) <= now) throw new Error('Add the afternoon session before its check-in opens.');
    if (afternoon && EventAudiencePolicy.date(afternoon.checkOutClosesAt) <= now) {
      if (JSON.stringify([...sections].sort()) !== JSON.stringify([...EventAudiencePolicy.selected(afternoon)].sort())) throw new Error('Closed afternoon-session groups cannot be changed.');
      for (const key of ['attendanceRoster', 'rosterCapturedAt', 'audienceSections', 'sectionAssignedAt', 'rosterVersion']) delete secondary[key];
      secondary.audience = afternoon.audience;
    } else Object.assign(secondary, EventAudiencePolicy.assignment(students, sections, afternoon, { now, timestamp }));
    return { primary, afternoon: secondary };
  }
}
