import { ControllerScope } from '../core/ControllerScope.js';
import { StudentAttendanceSummaryService } from './StudentAttendanceSummaryService.js';

export class StudentAttendanceSummaryController {
  constructor({ document = globalThis.document, window = globalThis.window, getState, requestCorrection, service = new StudentAttendanceSummaryService(), now = () => Date.now() }) {
    Object.assign(this, { document, window, getState, requestCorrection, service, now }); this.scope = new ControllerScope(); this.page = 0;
  }
  initialize() {
    this.root = this.document.querySelector('#studentAttendanceSummary');
    if (!this.root || !this.scope.initialize()) return;
    this.form = this.root.querySelector('form');
    this.month = this.root.querySelector('[data-summary-month]');
    this.event = this.root.querySelector('[data-summary-event]');
    this.session = this.root.querySelector('[data-summary-session]');
    this.month.value = new Date(this.now() + 8 * 3600000).toISOString().slice(0, 7);
    this.scope.listen(this.form, 'submit', event => { event.preventDefault(); this.page = 0; this.render(); });
    this.scope.listen(this.form, 'change', () => { this.page = 0; this.render(); });
    this.scope.listen(this.root.querySelector('[data-summary-clear]'), 'click', () => { this.month.value = ''; this.event.value = ''; this.session.value = 'both'; this.page = 0; this.render(); });
    this.tabs = [...this.document.querySelectorAll('[data-attendance-tab]')];
    for (const tab of this.tabs) this.scope.listen(tab, 'click', () => this.selectTab(tab.dataset.attendanceTab));
    this.scope.listen(this.root, 'click', event => {
      const correction = event.target.closest('[data-summary-correction]');
      if (correction) {
        const row = this.result?.rows.find(row => row.eventId === correction.dataset.summaryCorrection);
        if (row?.canRequest) void this.requestCorrection?.(row.eventId, row.requestKind);
      }
      if (event.target.closest('[data-summary-previous]')) { this.page = Math.max(0, this.page - 1); this.render(); }
      if (event.target.closest('[data-summary-next]')) { this.page++; this.render(); }
    });
    this.scope.listen(this.window, 'focus', () => this.render());
    this.scope.listen(this.window, 'offline', () => this.render());
    this.scope.listen(this.window, 'online', () => this.render());
    this.timer = this.window.setInterval(() => { if (this.getState().view === 'attendances' && !this.document.hidden) this.render(); }, 30000);
    this.scope.addCleanup(() => this.window.clearInterval(this.timer));
    this.selectTab('records'); this.render();
  }
  selectTab(name) {
    if (!['records', 'summary'].includes(name)) return;
    for (const tab of this.tabs) {
      const selected = tab.dataset.attendanceTab === name;
      tab.setAttribute('aria-pressed', String(selected)); tab.classList.toggle('active', selected);
    }
    const records = this.document.querySelector('#studentAttendanceRecordsPanel');
    if (records) records.hidden = name !== 'records';
    const corrections = this.document.querySelector('#studentCorrectionRequests');
    if (corrections) corrections.hidden = name !== 'summary';
    this.root.hidden = name !== 'summary';
    if (name === 'summary') this.render();
  }
  render() {
    if (!this.scope.initialized || !this.root) return;
    const state = this.getState();
    this.result = this.service.project(state, { month: this.month.value, event: this.event.value, session: this.session.value }, this.now());
    const options = JSON.stringify(this.result.options);
    if (options !== this.optionsKey) {
      this.optionsKey = options; const previous = this.event.value;
      this.event.replaceChildren();
      for (const item of [{ id: '', label: 'All events' }, ...this.result.options]) {
        const option = this.document.createElement('option'); option.value = item.id; option.textContent = item.label; this.event.append(option);
      }
      this.event.value = this.result.options.some(item => item.id === previous) ? previous : '';
      if (this.event.value !== previous) this.result = this.service.project(state, { month: this.month.value, event: this.event.value, session: this.session.value }, this.now());
    }
    for (const key of ['present', 'late', 'absent', 'incomplete']) this.root.querySelector(`[data-summary-count="${key}"]`).textContent = this.result.counts[key];
    const { counts, verified, rows, cards } = this.result;
    this.root.querySelector('[data-summary-status]').textContent = `${verified ? 'Synced summary.' : 'Waiting for server verification. Absences and missed checkouts are not confirmed from cached data.'} ${counts.awaiting} awaiting checkout · ${counts.pending} not yet checked in/upcoming · ${counts.review} need review.`;
    const list = this.root.querySelector('[data-summary-list]'); list.replaceChildren();
    this.page = Math.min(this.page, Math.max(0, Math.ceil(cards.length / 12) - 1));
    const time = value => value === null ? 'Not recorded' : new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
    for (const group of cards.slice(this.page * 12, this.page * 12 + 12)) {
      const card = this.document.createElement('article'); card.className = 'student-summary-row';
      const heading = this.document.createElement('h4'); heading.textContent = group.title; card.append(heading);
      const date = this.document.createElement('p'); date.textContent = group.date || 'Date unavailable'; card.append(date);
      const sessions = this.document.createElement('div'); sessions.className = 'student-summary-sessions';
      for (const row of group.sessions) {
        const session = this.document.createElement('section'); session.className = 'student-summary-session'; session.dataset.summarySession = row.eventId;
        const name = this.document.createElement('h5'); name.textContent = row.session; session.append(name);
        const description = this.document.createElement('p'); description.textContent = `${row.label}${row.arrival ? ` · ${row.arrival}` : ''}${row.corrected ? ' · Manually corrected' : ''}`; session.append(description);
        const times = this.document.createElement('p'); times.className = 'student-summary-times'; times.textContent = `Check-in: ${time(row.checkIn)} · Check-out: ${time(row.checkOut)} (PH)`; session.append(times);
        if (row.canRequest) {
          const button = this.document.createElement('button'); button.type = 'button'; button.className = 'outline-button'; button.dataset.summaryCorrection = row.eventId; button.textContent = `Request ${row.session.toLowerCase()} correction`; session.append(button);
        }
        sessions.append(session);
      }
      card.append(sessions);
      list.append(card);
    }
    if (!rows.length) { const empty = this.document.createElement('p'); empty.textContent = 'No assigned sessions or attendance records match these filters.'; list.append(empty); }
    this.root.querySelector('[data-summary-page]').textContent = `${cards.length ? this.page * 12 + 1 : 0}–${Math.min((this.page + 1) * 12, cards.length)} of ${cards.length} events · ${rows.length} sessions`;
    this.root.querySelector('[data-summary-previous]').disabled = this.page === 0;
    this.root.querySelector('[data-summary-next]').disabled = (this.page + 1) * 12 >= cards.length;
  }
  dispose() { this.scope.dispose(); }
}
