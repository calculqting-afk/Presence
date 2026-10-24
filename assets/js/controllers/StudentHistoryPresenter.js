import { AttendanceViews } from './AttendanceViews.js';
import { AbsenceCardsPresenter } from './AbsenceCardsPresenter.js';

// Group display only; statuses, visibility, and dismissals still belong to each session.
export class StudentHistoryPresenter {
  static render(records, { escapeHtml: e, formatDate, formatWindow }) {
    if (!records.length) return '<div class="empty-state">No finished event history yet.</div>';
    const byId = new Map(records.map(record => [record.event.id, record]));
    const groups = AttendanceViews.groups(records.map(record => record.event)).sort((a, b) => (b[0].date || '').localeCompare(a[0].date || ''));
    return groups.map(sessions => {
      const first = sessions[0], statuses = new Set(sessions.map(event => byId.get(event.id).status));
      const status = statuses.size === 1 ? [...statuses][0] : 'Mixed attendance';
      const color = status === 'Attended' ? 'green' : status === 'Mixed attendance' ? 'blue' : 'orange';
      const details = sessions.map(event => {
        const sessionStatus = byId.get(event.id).status, label = AttendanceViews.label(event);
        return `<section class="history-session"><div class="history-session-heading"><h4>${e(label)}</h4><span class="badge ${sessionStatus === 'Attended' ? 'green' : 'orange'}">${e(sessionStatus)}</span></div><div class="event-detail-boxes"><div><span>Time</span><strong>${e(formatWindow(event))}</strong></div><div><span>Location</span><strong>${e(event.location || 'Not specified')}</strong></div><div class="history-detail-full"><span>Audience</span><strong>${e(AbsenceCardsPresenter.audience(event))}</strong></div></div><div class="history-card-actions"><button class="small-button danger" type="button" data-dismiss-history="${e(event.id)}" aria-label="Remove ${e(label)} session from history">Remove ${e(label)} from history</button></div></section>`;
      }).join('');
      return `<article class="history-event-card grouped-history-card"><div class="history-card-top"><span class="event-type-badge">${e(first.type || 'School Event')}</span><span class="badge ${color}">${e(status)}</span></div><h3>${e(AttendanceViews.title(first))}</h3><p>${e(first.description || first.notes || 'No description provided.')}</p><div class="event-detail-boxes"><div class="history-detail-full"><span>Date</span><strong>${e(formatDate(first.date))}</strong></div></div>${details}</article>`;
    }).join('');
  }
}
