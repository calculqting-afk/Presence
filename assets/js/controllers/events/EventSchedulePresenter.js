import { EventSessionPolicy } from './EventSessionPolicy.js';
import { AttendanceViews } from '../attendance/AttendanceViews.js';
import { duringTime } from '../../core/attendance/DuringAttendancePolicy.js';

// Shared presentation only: this class does not decide attendance eligibility.
export class EventSchedulePresenter {
  constructor({ formatTime, escapeHtml, addMinutes, now = () => Date.now() }) {
    Object.assign(this, { formatTime, escapeHtml, addMinutes, now });
  }
  render(event, events = []) {
    const time = value => this.escapeHtml(value ? this.formatTime(value) : 'Not set');
    const group = (title, opening, endingLabel, ending) => `<div class="event-schedule-group"><h4>${title}</h4><dl><div><dt>Opens</dt><dd>${time(opening)}</dd></div><div><dt>${endingLabel}</dt><dd>${time(ending)}</dd></div></dl></div>`;
    const sessions = EventSessionPolicy.related(event, events);
    const mode = EventSessionPolicy.modeLabel(sessions);
    const current = AttendanceViews.state(sessions, this.now()).current;
    return `<p class="event-session-mode">Attendance: ${this.escapeHtml(mode)}</p>${sessions.map(session => {
      const period = EventSessionPolicy.period(session) === 'afternoon' ? 'Afternoon' : 'Morning';
      const checkpoint = session.duringAttendance;
      const localTime = value => new Date(duringTime(value) + 8 * 3600000).toISOString().slice(11, 16);
      const during = checkpoint?.enabled && Number.isFinite(duringTime(checkpoint.opensAt)) && Number.isFinite(duringTime(checkpoint.closesAt))
        ? group(`During · ${this.escapeHtml(checkpoint.label || 'Presence checkpoint')}`, localTime(checkpoint.opensAt), 'Closes', localTime(checkpoint.closesAt)) : '';
      return `<section class="event-session-schedule" aria-label="${period} schedule"><h4 class="event-session-title">${period}${current?.id === session.id ? ' <span>Current session</span>' : ''}</h4><div class="event-schedule" aria-label="${period} attendance schedule">${group('Check-in', session.timeIn, 'Late after', session.checkInCutoff || session.timeOut)}${during}${group('Check-out', session.timeOut, 'Closes', session.checkOutCutoff || (session.timeOut ? this.addMinutes(session.timeOut) : ''))}</div></section>`;
    }).join('')}<p class="event-schedule-location"><span>Location</span>${this.escapeHtml(event.location || 'Not set')}</p>`;
  }
}
