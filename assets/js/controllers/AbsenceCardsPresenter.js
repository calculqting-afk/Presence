import { AttendanceViews } from './AttendanceViews.js';
import { EventAudiencePolicy } from './EventAudiencePolicy.js';

// Display grouping only: absence decisions and counts stay session-specific.
export class AbsenceCardsPresenter {
  static audience(event) {
    if (Array.isArray(event.audienceSections)) return EventAudiencePolicy.label(event);
    if (event.audience === 'Selected sections') {
      const sections = [...new Set(Object.values(event.attendanceRoster || {}))].filter(Boolean).sort();
      return sections.length ? `Sections ${sections.join(', ')}` : 'Sections not specified';
    }
    return event.audience || 'All students';
  }
  static render(absences, { escapeHtml: e, formatDate, formatWindow }) {
    const groups = AttendanceViews.groups(absences).sort((a, b) => (b[0].date || '').localeCompare(a[0].date || ''));
    const markup = groups.map(sessions => {
      const event = sessions[0];
      const details = sessions.map(session => `<section class="absence-session"><div class="absence-session-heading"><h4>${e(AttendanceViews.label(session))}</h4><span class="badge orange">Absent</span></div><div class="fine-detail-grid"><div><span>Time</span><strong>${e(formatWindow(session))}</strong></div><div><span>Location</span><strong>${e(session.location || 'Not specified')}</strong></div><div class="fine-detail-full"><span>Audience</span><strong>${e(this.audience(session))}</strong></div></div></section>`).join('');
      return `<article class="community-service-record absence-event-card"><div class="community-service-record-top"><strong>${e(AttendanceViews.title(event))}</strong><span class="badge orange">${sessions.length} missed session${sessions.length === 1 ? '' : 's'}</span></div><div class="fine-detail-grid"><div class="fine-detail-full"><span>Date</span><strong>${e(formatDate(event.date))}</strong></div></div>${details}</article>`;
    }).join('') || '<div class="community-service-empty">No recorded absences for this student.</div>';
    return { markup, eventCount: groups.length };
  }
}
