import { ControllerScope } from '../core/ControllerScope.js';
import { AttendanceReportRepository } from './AttendanceReportRepository.js';
import { AttendanceReportService } from './AttendanceReportService.js';
import { AttendancePdfExporter } from './AttendancePdfExporter.js';
import { AttendanceReportFileService } from './AttendanceReportFileService.js';
import { AttendanceViews } from './AttendanceViews.js';

export class AttendanceReportController {
  constructor({ document, window, db, can, context, summary, checkoutCloseDate, notify,
    repository = new AttendanceReportRepository(db), service = new AttendanceReportService({ summary, checkoutCloseDate }),
    exporter = new AttendancePdfExporter(), files = new AttendanceReportFileService(), online = () => globalThis.navigator?.onLine !== false } = {}) {
    Object.assign(this, { document, window, can, context, notify, repository, service, exporter, files, online });
    this.scope = new ControllerScope(); this.page = 0; this.generation = 0;
  }
  initialize() {
    if (!this.scope.initialize()) return;
    this.button = this.document.querySelector('#openAttendanceReport');
    if (!this.button) return;
    this.button.hidden = !this.can();
    this.scope.listen(this.button, 'click', () => this.open());
    const filters = this.document.querySelector('#attendanceFilters');
    for (const type of ['input', 'change', 'submit']) this.scope.listen(filters, type, () => { this.page = 0; this.refreshContext(); });
    this.scope.listen(this.window, 'presence:viewchange', event => { if (event.detail.viewName !== 'attendance-line') this.close(); });
    this.scope.listen(this.window, 'offline', () => this.render());
    this.scope.listen(this.window, 'online', () => { if (this.active) { this.selectionKey = ''; this.refreshContext(); } });
  }
  createDialog() {
    if (this.dialog) return;
    const dialog = this.dialog = this.document.createElement('dialog');
    dialog.className = 'attendance-report-dialog';
    dialog.setAttribute('aria-labelledby', 'attendanceReportTitle');
    dialog.innerHTML = `<div class="report-toolbar"><div><p class="eyebrow">Live report preview</p><h2 id="attendanceReportTitle">Attendance report</h2></div><button class="outline-button" type="button" data-report-close>Close</button></div>
      <p class="report-status" role="status" aria-live="polite" data-report-status></p>
      <div class="report-actions"><button class="outline-button" type="button" data-report-retry>Retry verification</button><button class="primary-button" type="button" data-report-download disabled>Download PDF</button><button class="outline-button" type="button" data-report-share hidden disabled>Share PDF</button></div>
      <div class="report-paper"><div class="report-brand">PRESENCE</div><p>Southern Leyte State University - Bontoc Campus</p><h3 data-report-event></h3><p data-report-meta></p><p data-report-filters></p><p data-report-time></p>
      <div class="report-totals" data-report-totals></div><p class="report-note" data-report-note></p>
      <div class="report-table-scroll" tabindex="0" aria-label="Attendance report table"><table><thead><tr><th>#</th><th>Student ID</th><th>Name</th><th>Course</th><th>Section</th><th>Check-in (PH)</th><th>Check-out (PH)</th><th>Arrival</th><th>Completion</th></tr></thead><tbody data-report-rows></tbody></table></div>
      <p data-report-page></p><div class="report-pagination"><button class="outline-button" type="button" data-report-previous>Previous</button><button class="outline-button" type="button" data-report-next>Next</button></div>
      <p class="report-note">Confidential student data. Preview pages show 50 rows; the PDF includes ALL matching rows. Downloaded PDFs are fixed snapshots and do not update.</p></div>`;
    this.document.body.append(dialog);
    this.scope.listen(dialog.querySelector('[data-report-close]'), 'click', () => this.close());
    this.scope.listen(dialog, 'cancel', event => { event.preventDefault(); this.close(); });
    this.scope.listen(dialog, 'close', () => { if (!dialog.open) this.close(); });
    this.scope.listen(dialog.querySelector('[data-report-retry]'), 'click', () => { this.selectionKey = ''; this.refreshContext(); });
    this.scope.listen(dialog.querySelector('[data-report-download]'), 'click', () => this.export('save'));
    this.scope.listen(dialog.querySelector('[data-report-share]'), 'click', () => this.export('share'));
    this.scope.listen(dialog.querySelector('[data-report-previous]'), 'click', () => { this.page = Math.max(0, this.page - 1); this.render(); });
    this.scope.listen(dialog.querySelector('[data-report-next]'), 'click', () => { this.page++; this.render(); });
  }
  open() {
    if (!this.can() || !this.scope.initialized) return;
    if (this.exporting) { this.notify('PDF is busy', 'Finish the current save/share operation first.'); return; }
    const { filters, events } = this.context();
    if (!events.some(event => event.id === filters.event)) { this.notify('Choose an event', 'Select one event in Attendance Line before opening the report.'); return; }
    this.createDialog(); this.active = true; this.page = 0; this.selectionKey = '';
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.querySelector('[data-report-close]').focus();
    this.refreshContext();
    this.window.clearInterval(this.clock); this.clock = this.window.setInterval(() => this.refreshContext(), 5000);
  }
  refreshContext() {
    if (!this.active) return;
    if (!this.can()) { this.close(); return; }
    const { filters, events } = this.context(), selected = events.find(event => event.id === filters.event);
    if (!selected) { this.stopWatch(); this.error = 'Select an available event to continue.'; this.report = null; this.render(); return; }
    const sessions = AttendanceViews.selection(events, filters.event, filters.session);
    if (!sessions.length) { this.stopWatch(); this.report = null; this.error = 'This event has no selected session.'; this.render(); return; }
    const ids = this.service.eventIds(sessions[0], events), key = JSON.stringify(sessions.map(event => this.service.eventIds(event, events)));
    if (key !== this.selectionKey) this.begin(sessions[0], ids, key, sessions);
    else this.render();
  }
  begin(event, ids, key, sessions = [event]) {
    this.stopWatch(); this.selectionKey = key; this.error = ''; this.timedOut = false;
    this.event = null; this.events = []; this.records = []; this.eventVerified = false; this.recordsVerified = false; this.report = null; this.verifiedAt = null;
    const generation = this.generation;
    this.timeout = this.window.setTimeout(() => { if (this.active && generation === this.generation && !this.ready()) { this.timedOut = true; this.render(); } }, 20000);
    try {
      const receive = update => {
        if (!this.active || generation !== this.generation) return;
        if (update.kind === 'event') {
          this.event = update.event; this.eventVerified = update.verified;
          this.events = update.events || (update.event ? [update.event] : []);
          if (!update.exists) this.error = 'The selected event was removed or is unavailable.';
        } else {
          this.records = update.records; this.recordsVerified = update.verified;
          if (update.oversized) this.error = 'This event exceeds the 5,000-record limit. A complete export is blocked; contact the administrator.';
        }
        if (update.verified) this.verifiedAt = new Date();
        if (this.ready()) { this.window.clearTimeout(this.timeout); this.timedOut = false; }
        this.render();
      };
      const fail = () => {
        if (this.active && generation === this.generation) { this.error = 'Live verification failed. Check your permissions/connection and retry.'; this.recordsVerified = false; this.render(); }
      };
      this.unsubscribe = sessions.length > 1
        ? this.repository.watchSessions(sessions, session => this.service.eventIds(session, this.context().events), receive, fail)
        : this.repository.watch(event.id, ids, receive, fail);
    } catch (error) { this.error = error.message; }
    this.render();
  }
  ready() { return this.can() && this.online() && !this.error && this.eventVerified && this.recordsVerified && this.context().studentsReady; }
  render() {
    if (!this.active || !this.dialog) return;
    const find = selector => this.dialog.querySelector(selector), context = this.context();
    let issue = this.error || (!this.online() ? 'Offline - displayed data may be stale. PDF export is disabled.'
      : !context.studentsReady ? 'Verifying the complete student directory...'
      : !this.eventVerified || !this.recordsVerified ? (this.timedOut ? 'Server verification timed out. Retry before exporting.' : 'Connecting - verifying all event attendance records...') : '');
    if (this.event && ((context.filters.from && this.event.date < context.filters.from) || (context.filters.to && this.event.date > context.filters.to))) issue = 'The selected event is outside the current date filter. Adjust the filters before exporting.';
    if (!issue && this.ready()) {
      try { this.report = this.events.length > 1
        ? this.service.snapshotGroup({ events: this.events, students: context.students, records: this.records, filters: context.filters, verifiedAt: this.verifiedAt })
        : this.service.snapshot({ event: this.event, students: context.students, records: this.records, filters: context.filters, verifiedAt: this.verifiedAt }); }
      catch (error) { issue = error.message; this.report = null; }
    }
    this.valid = !issue && this.ready() && Boolean(this.report);
    const native = this.files.native?.();
    find('[data-report-status]').textContent = issue || `Live - ${this.records.length} attendance documents verified. Last server update: ${AttendanceReportService.time(this.verifiedAt)}. Changes appear automatically.`;
    find('[data-report-status]').dataset.state = this.valid ? 'live' : 'warning';
    find('[data-report-download]').disabled = !this.valid || this.exporting;
    find('[data-report-download]').textContent = this.exporting ? 'Preparing PDF...' : native?.isNative ? 'Save PDF' : 'Download PDF';
    find('[data-report-share]').hidden = !native?.isNative;
    find('[data-report-share]').disabled = !this.valid || this.exporting;
    const report = this.report;
    find('[data-report-event]').textContent = report?.event.name || this.event?.name || 'Verifying event...';
    find('[data-report-meta]').textContent = report ? `${report.event.date} | ${report.event.time} | ${report.event.location} | ${report.event.audience}` : '';
    find('[data-report-filters]').textContent = report ? `Course: ${report.filters.course || 'All courses'} | Section: ${report.filters.section} | Status: ${report.filters.status} | Search: ${report.filters.search || 'None'}` : '';
    find('[data-report-time]').textContent = report ? `Attendance times: Asia/Manila. Snapshot prepared: ${AttendanceReportService.time(new Date(report.generatedAt))}.` : '';
    find('[data-report-note]').textContent = report?.note || '';
    const totals = find('[data-report-totals]'); totals.replaceChildren();
    if (report) for (const [name, value] of Object.entries(report.totals)) {
      const item = this.document.createElement('span'); item.textContent = `${name}: ${value}`; totals.append(item);
    }
    const rows = report?.rows || [], body = find('[data-report-rows]'); body.replaceChildren();
    this.page = Math.min(this.page, Math.max(0, Math.ceil(rows.length / 50) - 1));
    rows.slice(this.page * 50, this.page * 50 + 50).forEach((row, index) => {
      const tr = this.document.createElement('tr');
      for (const value of [this.page * 50 + index + 1, row.studentId, row.sessionLabel ? `${row.name} — ${row.sessionLabel}` : row.name, row.course, row.section, row.checkIn, row.checkOut, row.arrival, row.completion + (row.corrected ? ' (manual)' : '')]) {
        const td = this.document.createElement('td'); td.textContent = String(value); tr.append(td);
      }
      body.append(tr);
    });
    find('[data-report-page]').textContent = rows.length ? `Preview ${this.page * 50 + 1}-${Math.min((this.page + 1) * 50, rows.length)} of ${rows.length} matching rows. PDF exports all ${rows.length}.` : 'No matching rows.';
    find('[data-report-previous]').disabled = this.page === 0;
    find('[data-report-next]').disabled = (this.page + 1) * 50 >= rows.length;
  }
  async export(mode) {
    if (this.exporting || !this.active) return;
    this.refreshContext();
    if (!this.valid) return;
    const report = this.report; // Freeze the verified report at the click, not after asynchronous PDF rendering.
    this.exporting = true; this.render();
    try {
      const bytes = await this.exporter.generate(report);
      if (!this.scope.initialized || !this.active || !this.can() || !this.online()) return;
      const name = `Presence-attendance-${report.event.date}-${report.event.id}-${report.filters.session || 'session'}`.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) + '.pdf';
      const result = await this.files.deliver(bytes, name, mode);
      if (this.active) this.notify(result.cancelled ? 'Save cancelled' : 'PDF ready', result.cancelled ? 'No PDF was saved.' : mode === 'share' ? 'Android share dialog opened. Choose a trusted recipient.' : 'The PDF save/download was started. It is a fixed snapshot.');
    } catch (error) { if (this.active) this.notify('Unable to export PDF', error.message || 'Please retry.'); }
    finally { this.exporting = false; this.render(); }
  }
  stopWatch() { this.generation++; this.window.clearTimeout(this.timeout); this.unsubscribe?.(); this.unsubscribe = null; this.selectionKey = ''; }
  close() {
    this.active = false; this.window.clearInterval(this.clock); this.stopWatch(); this.report = null; this.records = [];
    this.dialog?.querySelector('[data-report-rows]')?.replaceChildren();
    if (this.dialog?.open) this.dialog.close();
  }
  dispose() { this.close(); this.scope.dispose(); this.dialog?.remove(); this.dialog = null; }
}
