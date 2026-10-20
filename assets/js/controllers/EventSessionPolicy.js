import { EventAudiencePolicy } from './EventAudiencePolicy.js';

// Sessions use distinct event IDs, so the existing uid_event attendance key,
// timing rules, reports and corrections remain isolated for each session.
export class EventSessionPolicy {
  static scheduleFields = ['date', 'timeIn', 'checkInCutoff', 'timeOut', 'checkOutCutoff', 'openAt', 'checkInClosesAt', 'closeAt', 'checkOutClosesAt', 'lateAfterAt', 'checkInClose'];
  static normalizeAliases(record, previous) {
    if ('lateAfterAt' in record || previous?.lateAfterAt) record.lateAfterAt = record.checkInClosesAt;
    if ('checkInClose' in record || previous?.checkInClose) record.checkInClose = record.checkInCutoff;
    return record;
  }
  static afternoonId(id) { return `${id}_afternoon`; }
  static period(event) { return event.sessionPeriod || (event.timeIn >= '12:00' ? 'afternoon' : 'morning'); }
  static related(event, events = []) {
    if (!event.sessionGroupId) return [event];
    return [...new Map([event, ...events.filter(item => item.sessionGroupId === event.sessionGroupId)].map(item => [item.id, item])).values()]
      .sort((a, b) => (this.period(a) === 'morning' ? 0 : 1) - (this.period(b) === 'morning' ? 0 : 1));
  }
  static modeLabel(sessions) {
    const periods = new Set(sessions.map(event => this.period(event)));
    return periods.size > 1 ? 'Both — Morning and Afternoon' : periods.has('afternoon') ? 'Afternoon only' : 'Morning only';
  }
  static opened(event, now = new Date()) { const date = EventAudiencePolicy.date(event?.openAt); return Boolean(date && date <= now); }
  static assertSchedule(record, previous, now = new Date()) {
    if (!previous) return;
    if (this.opened(previous, now) && record.date !== previous.date) throw new Error('Keep the event date unchanged after attendance opens. You can still edit its time windows.');
    const end = EventAudiencePolicy.date(previous.checkOutClosesAt);
    if (end && end <= now && this.scheduleChanged(record, previous)) throw new Error('Closed-session schedules cannot be changed. Create a new event instead.');
  }
  static scheduleChanged(record, previous) {
    return Boolean(previous) && this.scheduleFields.some(key => {
      const before = EventAudiencePolicy.date(previous[key]) || previous[key];
      const after = EventAudiencePolicy.date(record[key]) || record[key];
      return String(before) !== String(after);
    });
  }
  static needsScheduleConfirmation(record, previous, now = new Date()) {
    return this.opened(previous, now) && this.scheduleChanged(record, previous);
  }
  static prepare({ id, record, previous, afternoon, enabled, mode = enabled ? 'both' : previous?.sessionPeriod || 'morning', times, students, sections, timestamp, fromDate, now = new Date() }) {
    record = this.normalizeAliases({...record}, previous);
    if (!['morning','afternoon','both'].includes(mode)) throw new Error('Choose Morning only, Afternoon only, or Both.');
    enabled = mode === 'both';
    if (afternoon && !enabled) throw new Error('A published afternoon session cannot be disabled here. Its attendance and history must be preserved.');
    this.assertSchedule(record, previous, now);
    const period = mode === 'afternoon' ? 'afternoon' : 'morning';
    if (previous?.sessionPeriod && previous.sessionPeriod !== period && this.opened(previous, now)) throw new Error('This session has opened. Its morning/afternoon attendance mode is locked.');
    if ((period === 'afternoon' && record.timeIn < '12:00') || (period === 'morning' && record.timeIn >= '12:00')) throw new Error('Morning check-in must be before noon; afternoon check-in must be at or after noon.');
    const baseName = record.name;
    const metadata = !previous || previous.sessionPeriod || enabled || mode === 'afternoon';
    const maximum = metadata ? 145 : 160;
    if (!baseName || baseName.length > maximum) throw new Error(`Use an event name of 1–${maximum} characters.`);
    const primary = { ...record };
    if (metadata) Object.assign(primary, {
      sessionPeriod: period, sessionGroupId: id, sessionBaseName: baseName, name: `${baseName} — ${period === 'morning' ? 'Morning' : 'Afternoon'}`
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
    this.normalizeAliases(secondary, afternoon);
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
