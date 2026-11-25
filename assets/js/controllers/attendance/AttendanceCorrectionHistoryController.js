import { collection, query, orderBy, limit, startAfter, getDocsFromServer } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { hasPermission } from '../../core/security/permissions.js';
import { ControllerScope } from '../../core/shared/ControllerScope.js';
import { attendanceMilliseconds } from '../../core/attendance/AttendanceTimePolicy.js';

const labels = { present: 'Present', late: 'Late', absent: 'Absent', 'checked-in': 'Checked in', completed: 'Completed', 'checkout-only': 'Checkout only' };
const date = value => {
  const time = attendanceMilliseconds(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium' }) : 'Not recorded';
};

export function correctionHistoryRows(audit) {
  const arrival = record => !record ? 'Not recorded' : record.status === 'absent' ? 'Absent' : labels[record.arrivalStatus] || 'Not recorded';
  return [
    ['Arrival', arrival(audit.before), arrival(audit.after)],
    ['Check-in', date(audit.before?.checkedInAt || audit.before?.attendedAt), date(audit.after?.checkedInAt || audit.after?.attendedAt)],
    ['Checkout', date(audit.before?.checkedOutAt), date(audit.after?.checkedOutAt)],
    ['Completion', labels[audit.before?.status] || 'Not recorded', labels[audit.after?.status] || 'Not recorded']
  ];
}

export class AttendanceCorrectionHistoryRepository {
  constructor(db, fetch = getDocsFromServer) { Object.assign(this, { db, fetch }); }
  async page({ attendanceId, cursor = null, size = 20 }) {
    if (!/^[A-Za-z0-9_-]{1,257}$/.test(attendanceId || '') || size !== 20) throw Error('Choose a saved attendance record.');
    const constraints = [orderBy('at', 'desc')];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(size));
    const snapshot = await this.fetch(query(collection(this.db, 'attendance', attendanceId, 'corrections'), ...constraints));
    return { records: snapshot.docs.map(item => ({ ...item.data(), id: item.id })), cursor: snapshot.docs.at(-1) || cursor, more: snapshot.docs.length === size };
  }
}

// Read-only and on demand: no background listener or attendance writes.
export class AttendanceCorrectionHistoryController {
  constructor({ repository, getRole, getStudents, getActorName, escapeHtml, document = globalThis.document, window = globalThis.window }) {
    Object.assign(this, { repository, getRole, getStudents, getActorName, escapeHtml, document, window });
    this.scope = new ControllerScope(); this.generation = 0; this.records = [];
  }
  field(id) { return this.document.querySelector('#' + id); }
  initialize() {
    if (!this.scope.initialize()) return;
    this.modal = this.field('attendanceCorrectionHistoryModal');
    this.scope.listen(this.modal, 'click', event => {
      if (event.target === this.modal || event.target.closest('[data-close-correction-history]')) this.close();
    });
    this.scope.listen(this.field('correctionHistoryMore'), 'click', () => { void this.load(); });
    this.scope.listen(this.document, 'keydown', event => {
      if (this.modal.hidden) return;
      if (event.key === 'Escape') this.close();
      if (event.key === 'Tab') {
        const buttons = [...this.modal.querySelectorAll('button')].filter(button => !button.disabled && !button.closest('[hidden]'));
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && this.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && this.document.activeElement === last) { event.preventDefault(); first?.focus(); }
        else if (this.document.activeElement === this.field('correctionHistoryTitle')) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      }
    });
    this.scope.listen(this.window, 'presence:viewchange', () => this.close(false));
    this.scope.listen(this.window, 'presence:device-signing-out', () => this.close(false));
    this.scope.listen(this.window, 'presence:password-session-start', () => this.close(false));
  }
  async open(record, trigger) {
    if (!hasPermission(this.getRole(), 'viewAttendance') || record?.displayOnly
      || !/^[A-Za-z0-9_-]{1,128}$/.test(record?.studentUid || '') || !/^[A-Za-z0-9_-]{1,128}$/.test(record?.eventId || '')
      || record.id !== `${record.studentUid}_${record.eventId}`) return;
    this.generation++; this.record = record; this.trigger = trigger || this.document.activeElement;
    this.records = []; this.cursor = null; this.more = true; this.failed = false; this.busy = false;
    const student = this.getStudents().find(item => item.uid === record.studentUid);
    this.field('correctionHistoryStudent').textContent = [student?.firstName, student?.middleName, student?.lastName].filter(Boolean).join(' ') || record.studentId || 'Student';
    this.field('correctionHistoryEvent').textContent = [record.studentId || student?.accountId, record.eventName, record.eventDate].filter(Boolean).join(' · ');
    this.modal.hidden = false; this.draw(); this.field('correctionHistoryTitle').focus();
    await this.load();
  }
  async load() {
    if (this.busy || !this.more || !this.record || this.modal.hidden || !hasPermission(this.getRole(), 'viewAttendance')) return;
    const generation = this.generation;
    this.busy = true; this.failed = false; this.draw();
    try {
      const result = await this.repository.page({ attendanceId: this.record.id, cursor: this.cursor, size: 20 });
      if (generation !== this.generation || this.modal.hidden) return;
      const ids = new Set(this.records.map(item => item.id));
      this.records.push(...result.records.filter(item => !ids.has(item.id)));
      this.cursor = result.cursor; this.more = result.more;
    } catch (error) {
      if (generation !== this.generation) return;
      this.failed = true;
      this.error = error.code === 'permission-denied' ? 'History access was denied. Sign in again to verify your access.' : 'Couldn’t load history. Check your connection and retry.';
    } finally {
      if (generation === this.generation) { this.busy = false; this.draw(); }
    }
  }
  draw() {
    const escape = this.escapeHtml;
    this.field('correctionHistoryEntries').innerHTML = this.records.map(audit => {
      const rows = correctionHistoryRows(audit);
      const transition = rows[0][1] !== rows[0][2] ? `${rows[0][1]} → ${rows[0][2]}` : 'Attendance corrected';
      const name = this.getActorName?.(audit.by);
      const actor = typeof name === 'string' && name.trim() ? name.trim() : 'Administrator';
      return `<article class="correction-history-entry"><p class="muted">${escape(date(audit.at))} · PH</p><h3>${escape(transition)}</h3><div class="correction-comparison"><table><caption>Original and corrected attendance</caption><thead><tr><th scope="col">Attendance</th><th scope="col">Original</th><th scope="col">Corrected</th></tr></thead><tbody>${rows.map(([label, before, after]) => `<tr><th scope="row">${escape(label)}</th><td>${escape(before)}</td><td>${escape(after)}</td></tr>`).join('')}</tbody></table></div><p>Changed by: <strong>${escape(actor)}</strong></p>${actor === 'Administrator' && audit.by ? `<p class="muted correction-history-account">Account: ${escape(audit.by)}</p>` : ''}<p class="correction-history-reason"><strong>Reason</strong><br>${escape(audit.reason || 'Not recorded')}</p></article>`;
    }).join('');
    const status = this.field('correctionHistoryStatus');
    status.textContent = this.busy ? 'Loading correction history…' : this.failed ? this.error : this.records.length ? `${this.records.length} correction${this.records.length === 1 ? '' : 's'} loaded · Newest first` : 'No correction history found.';
    const more = this.field('correctionHistoryMore');
    more.hidden = !this.more; more.disabled = this.busy;
    more.textContent = this.busy ? 'Loading…' : this.failed ? 'Retry' : 'Load older corrections';
  }
  close(restoreFocus = true) {
    this.generation++; this.busy = false; this.record = null; this.records = []; this.cursor = null;
    if (this.modal) this.modal.hidden = true;
    const entries = this.field('correctionHistoryEntries');
    if (entries) entries.innerHTML = '';
    if (restoreFocus) this.trigger?.focus?.();
    this.trigger = null;
  }
  dispose() { this.close(false); this.scope.dispose(); }
}
