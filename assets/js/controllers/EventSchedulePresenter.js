// Shared presentation only: this class does not decide attendance eligibility.
export class EventSchedulePresenter {
  constructor({ formatTime, escapeHtml, addMinutes }) {
    Object.assign(this, { formatTime, escapeHtml, addMinutes });
  }
  render(event) {
    const time = value => this.escapeHtml(value ? this.formatTime(value) : 'Not set');
    const group = (title, opening, endingLabel, ending) => `<div class="event-schedule-group"><h4>${title}</h4><dl><div><dt>Opens</dt><dd>${time(opening)}</dd></div><div><dt>${endingLabel}</dt><dd>${time(ending)}</dd></div></dl></div>`;
    return `<div class="event-schedule" aria-label="Attendance schedule">${group('Check-in', event.timeIn, 'Late after', event.checkInCutoff || event.timeOut)}${group('Check-out', event.timeOut, 'Closes', event.checkOutCutoff || (event.timeOut ? this.addMinutes(event.timeOut) : ''))}</div><p class="event-schedule-location"><span>Location</span>${this.escapeHtml(event.location || 'Not set')}</p>`;
  }
}
