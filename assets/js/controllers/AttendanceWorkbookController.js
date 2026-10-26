import { AttendanceViews } from './AttendanceViews.js';
import { CoursePolicy } from '../core/CoursePolicy.js';

// The selector never trusts paginated Attendance Line rows. Every selected real
// session is independently verified through the existing report repository.
export class AttendanceWorkbookController {
  constructor({ document, window = globalThis.window, context, repository, service, exporter, files, can, online, notify }) {
    Object.assign(this, { document, window, context, repository, service, exporter, files, can, online, notify });
    this.version = 0;
  }
  node(tag, text, parent) {
    const element = this.document.createElement(tag);
    if (text) element.textContent = text;
    parent?.append(element); return element;
  }
  button(text, parent, action) {
    const button = this.node('button', text, parent); button.type = 'button'; button.className = 'outline-button';
    button.addEventListener('click', action); return button;
  }
  open() {
    if (!this.can() || this.busy) return;
    this.close();
    const context = this.context();
    const dialog = this.dialog = this.node('dialog', '', this.document.body);
    dialog.className = 'attendance-report-dialog attendance-workbook-dialog';
    dialog.setAttribute('aria-label', 'Choose Excel attendance sessions');
    const toolbar = this.node('div', '', dialog); toolbar.className = 'report-toolbar';
    this.node('h2', 'Export attendance workbook', toolbar);
    this.button('Close', toolbar, () => this.close());
    this.node('p', 'One Excel file, one worksheet per selected day and session. Includes attended, late and absent students. PDF filters remain unchanged.', dialog);
    const filters = this.node('div', '', dialog); filters.className = 'workbook-filters';
    this.course = this.select('Course', [...new Set(context.students.map(student => CoursePolicy.normalize(student.course)).filter(Boolean))].sort(), context.filters.course, filters);
    this.section = this.select('Section', [...new Set(context.students.map(student => student.section).filter(Boolean))].sort(), context.filters.section, filters);
    const actions = this.node('div', '', dialog); actions.className = 'report-actions';
    this.button('Select all', actions, () => { this.checks.forEach(item => { item.input.checked = true; }); this.invalidate(); });
    this.button('Clear selection', actions, () => { this.checks.forEach(item => { item.input.checked = false; }); this.invalidate(); });
    const list = this.node('div', '', dialog); list.className = 'workbook-session-list'; this.checks = [];
    const initial = new Set(AttendanceViews.selection(context.events, context.filters.event, context.filters.session).map(event => event.id));
    const groups = AttendanceViews.groups(context.events).sort((a, b) => String(a[0].date).localeCompare(String(b[0].date)) || a[0].id.localeCompare(b[0].id));
    for (const sessions of groups) {
      const group = this.node('fieldset', '', list);
      this.node('legend', `${sessions[0].date || 'Date not set'} · ${AttendanceViews.title(sessions[0])}`, group);
      for (const event of sessions) {
        const label = this.node('label', '', group), input = this.node('input', '', label);
        input.type = 'checkbox'; input.checked = initial.has(event.id);
        this.node('span', `${AttendanceViews.label(event)} · ${event.timeIn || 'Time not set'} – ${event.timeOut || ''}`, label);
        input.addEventListener('change', () => this.invalidate()); this.checks.push({ event, input });
      }
    }
    const footer = this.node('div', '', dialog); footer.className = 'report-actions';
    this.previewButton = this.button('Preview selected sessions', footer, () => this.preview());
    this.saveButton = this.button('Download Excel', footer, () => this.save()); this.saveButton.disabled = true;
    this.status = this.node('p', '', dialog); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.previewList = this.node('ul', '', dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.course.addEventListener('change', () => this.invalidate()); this.section.addEventListener('change', () => this.invalidate());
    this.onOffline = () => this.invalidate(); this.window?.addEventListener('offline', this.onOffline);
    this.invalidate(); dialog.showModal(); this.previewButton.focus();
  }
  select(title, values, selected, parent) {
    const label = this.node('label', title, parent), select = this.node('select', '', label);
    for (const value of ['', ...values]) { const option = this.node('option', value || `All ${title.toLowerCase()}s`, select); option.value = value; }
    select.value = selected || ''; return select;
  }
  invalidate() {
    this.version++; this.stop?.(); this.stop = null; clearTimeout(this.timeout);
    this.reports = null; this.saveButton.disabled = true; this.previewList.replaceChildren();
    this.status.textContent = `${this.checks.filter(item => item.input.checked).length} session(s) selected. Preview to verify all student rows. Search and attendance-status filters are excluded so all attendance outcomes are included.`;
  }
  preview() {
    if (this.busy || !this.can()) return;
    this.invalidate();
    const sessions = this.checks.filter(item => item.input.checked).map(item => item.event);
    if (!sessions.length || sessions.length > 30) { this.status.textContent = 'Choose 1–30 sessions.'; return; }
    if (!this.online() || !this.context().studentsReady) { this.status.textContent = 'Connect and wait for the full student directory to be verified, then preview again.'; return; }
    const version = this.version, events = this.context().events;
    const filters = { course: this.course.value, section: this.section.value, sort: 'last-name-asc' };
    let verifiedEvents, verifiedRecords;
    const fail = message => {
      if (version !== this.version || !this.dialog) return;
      this.reports = null; this.saveButton.disabled = true; this.status.textContent = message;
      clearTimeout(this.timeout); this.stop?.(); this.stop = null; this.version++;
    };
    this.status.textContent = 'Verifying selected sessions and all attendance records…';
    this.timeout = setTimeout(() => fail('Verification timed out. Check your connection and preview again.'), 20000);
    try {
      this.stop = this.repository.watchSessions(sessions, event => this.service.eventIds(event, events), update => {
        if (version !== this.version || !this.dialog) return;
        if (!this.can() || !this.online() || !this.context().studentsReady) { fail('Verification unavailable. Reconnect and preview again.'); return; }
        if (update.oversized || (update.kind === 'event' && !update.exists)) { fail('A selected event is unavailable or exceeds the 5,000-record limit. Narrow your selection.'); return; }
        if (update.kind === 'event') verifiedEvents = update.verified ? update.events : null;
        else verifiedRecords = update.verified ? update.records : null;
        this.reports = null; this.saveButton.disabled = true;
        if (!verifiedEvents || !verifiedRecords) { this.status.textContent = 'Waiting for server verification…'; return; }
        try {
          const verifiedAt = new Date();
          const reports = verifiedEvents.map(event => this.service.snapshot({ event, records: verifiedRecords.filter(record => record.reportSessionId === event.id), students: this.context().students, filters, verifiedAt }));
          const count = reports.reduce((sum, report) => sum + report.rows.length, 0);
          if (count > 5000) throw new Error('More than 5,000 student rows. Select fewer sessions or a course/section.');
          this.reports = reports; clearTimeout(this.timeout); this.previewList.replaceChildren();
          for (const report of reports) this.node('li', `${report.event.date} · ${report.event.name} · ${report.filters.session}: ${report.rows.length} students — ${report.totals.present} attended, ${report.totals.late} late, ${report.totals.absent} absent, ${report.totals.pending} pending, ${report.totals.review} need review`, this.previewList);
          this.status.textContent = `Verified: ${reports.length} worksheets, ${count} student rows. Late is included in attended. Missing profile details stay blank. Times are Philippine time. This is a fixed export, not a live spreadsheet.`;
          this.saveButton.disabled = this.busy;
        } catch (error) { fail(error.message); }
      }, () => fail('Server verification failed. Check permissions/connection and preview again.'));
    } catch (error) { fail(error.message); }
  }
  async save() {
    if (this.busy || !this.reports || !this.dialog || !this.can() || !this.online() || !this.context().studentsReady) return;
    const reports = this.reports, version = this.version;
    this.busy = true; this.saveButton.disabled = true; this.saveButton.textContent = 'Preparing Excel…';
    try {
      const bytes = await this.exporter.generateSessions(reports);
      if (!this.dialog || version !== this.version || !this.can() || !this.online() || !this.context().studentsReady) return;
      const dates = reports.map(report => report.event.date).sort();
      const result = await this.files.deliver(bytes, `Presence-attendance-${dates[0]}-to-${dates.at(-1)}.xlsx`);
      this.notify(result.cancelled ? 'Save cancelled' : 'Excel ready', result.cancelled ? 'No workbook was saved.' : `${reports.length} session worksheets in one workbook. Save/download started.`);
    } catch (error) { this.notify('Unable to export Excel', error.message || 'Please retry.'); }
    finally { this.busy = false; if (this.dialog) { this.saveButton.textContent = 'Download Excel'; this.saveButton.disabled = !this.reports; } }
  }
  close() {
    if (this.onOffline) this.window?.removeEventListener('offline', this.onOffline);
    this.version++; this.stop?.(); this.stop = null; clearTimeout(this.timeout); this.reports = null;
    if (this.dialog) { this.dialog.close(); this.dialog.remove(); this.dialog = null; }
  }
}
