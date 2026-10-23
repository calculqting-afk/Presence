import { EventSessionPolicy } from './EventSessionPolicy.js';

// Presentation grouping only. Every action still uses the real session event ID.
export class AttendanceViews {
  static time(event, field) {
    const value = event?.[field];
    const time = value?.toMillis?.() ?? value?.toDate?.()?.getTime?.() ?? (typeof value?.getTime === 'function' ? value.getTime() : typeof value?.seconds === 'number' ? value.seconds * 1000 : NaN);
    if (Number.isFinite(time)) return time;
    if (field === 'checkOutClosesAt' && !event?.checkOutCutoff) {
      const close = this.time(event, 'closeAt');
      return Number.isFinite(close) ? close + 15 * 60 * 1000 : NaN;
    }
    const clock = field === 'openAt' ? event?.timeIn : field === 'closeAt' ? event?.timeOut : event?.checkOutCutoff;
    return event?.date && clock ? +new Date(`${event.date}T${clock}:00+08:00`) : NaN;
  }
  static groups(events) {
    const groups = new Map();
    for (const event of events) {
      const key = `${event.sessionGroupId || event.id}:${event.date || ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    }
    return [...groups.values()].map(group => group.sort((a,b) => this.time(a,'openAt') - this.time(b,'openAt') || a.id.localeCompare(b.id)));
  }
  static related(event, events) { return this.groups(events.some(item => item.id === event.id) ? events : [...events,event]).find(group => group.some(item => item.id === event.id)) || [event]; }
  static title(event) { return event.sessionBaseName || (event.sessionGroupId ? event.name?.replace(/ — (Morning|Afternoon)$/, '') : event.name) || 'Attendance event'; }
  static label(event) { return EventSessionPolicy.period(event) === 'afternoon' ? 'Afternoon' : 'Morning'; }
  static state(sessions, now = Date.now()) {
    const current = sessions.find(event => now >= this.time(event,'openAt') && now <= this.time(event,'checkOutClosesAt'));
    const upcoming = sessions.find(event => now < this.time(event,'openAt'));
    return { current, upcoming, selected: current || upcoming || sessions.at(-1), closed: sessions.every(event => now > this.time(event,'checkOutClosesAt')) };
  }
  static selection(events, eventId, period = 'both') {
    const event = events.find(item => item.id === eventId);
    if (!event) return [];
    const sessions = this.related(event, events);
    return ['morning','afternoon'].includes(period) ? sessions.filter(item => EventSessionPolicy.period(item) === period) : sessions;
  }
}
