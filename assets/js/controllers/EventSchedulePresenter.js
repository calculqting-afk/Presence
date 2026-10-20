import { EventSessionPolicy } from './EventSessionPolicy.js';

// Shared presentation only: this class does not decide attendance eligibility.
export class EventSchedulePresenter {
  constructor({ formatTime, escapeHtml, addMinutes }) {
    Object.assign(this, { formatTime, escapeHtml, addMinutes });
  }
  render(event, events = []) {
    const time = value => this.escapeHtml(value ? this.formatTime(value) : 'Not set');
    const group = (title, opening, endingLabel, ending) => `<div class="event-schedule-group"><h4>${title}</h4><dl><div><dt>Opens</dt><dd>${time(opening)}</dd></div><div><dt>${endingLabel}</dt><dd>${time(ending)}</dd></div></dl></div>`;
    const sessions = EventSessionPolicy.related(event, events);
    const mode = EventSessionPolicy.modeLabel(sessions);
    return `<p class="event-session-mode">Attendance: ${this.escapeHtml(mode)}</p>${sessions.map(session => {
      const period = EventSessionPolicy.period(session) === 'afternoon' ? 'Afternoon' : 'Morning';
      return `<section class="event-session-schedule" aria-label="${period} schedule"><h4 class="event-session-title">${period}${sessions.length > 1 && session.id === event.id ? ' <span>Current session</span>' : ''}</h4><div class="event-schedule" aria-label="${period} attendance schedule">${group('Check-in', session.timeIn, 'Late after', session.checkInCutoff || session.timeOut)}${group('Check-out', session.timeOut, 'Closes', session.checkOutCutoff || (session.timeOut ? this.addMinutes(session.timeOut) : ''))}</div></section>`;
    }).join('')}<p class="event-schedule-location"><span>Location</span>${this.escapeHtml(event.location || 'Not set')}</p>`;
  }
}
