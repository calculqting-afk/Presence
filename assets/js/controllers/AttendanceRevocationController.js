import { attendanceMilliseconds } from '../core/AttendanceTimePolicy.js';
import { ControllerScope } from '../core/ControllerScope.js';
import { requirePermission, hasPermission } from '../core/permissions.js';
import { activityRecord, activitySnapshot } from './ActivityRecordPolicy.js';
import { doc, collection, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

export function revocationReason(reason, confirmation) {
  const text = String(reason || '').trim();
  if (text.length < 5 || text.length > 1000) throw Error('Enter a revocation reason of 5–1000 characters.');
  if (confirmation !== 'REVOKE') throw Error('Type REVOKE to confirm.');
  return text;
}
function recordVersion(value) {
  if (typeof value?.getTime === 'function') return value.toISOString();
  if (Array.isArray(value)) return value.map(recordVersion);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined && typeof value[key] !== 'function').map(key => [key, recordVersion(value[key])]));
  return value;
}
export class AttendanceRevocationController {
  constructor({ db, user, role, getStudents, notify, onRevoked = () => {}, document = globalThis.document, transaction = runTransaction }) {
    Object.assign(this, { db, user, role, getStudents, notify, onRevoked, document, transaction });
    this.scope = new ControllerScope();
  }
  field(id) { return this.document.querySelector('#' + id); }
  initialize() {
    if (!this.scope.initialize()) return;
    this.modal = this.field('attendanceRevocationModal');
    this.scope.listen(this.field('attendanceRevocationForm'), 'submit', event => { event.preventDefault(); void this.submit(); });
    this.document.querySelectorAll('[data-close-revocation]').forEach(button => this.scope.listen(button, 'click', () => this.close()));
    this.scope.listen(this.modal, 'click', event => { if (event.target === this.modal) this.close(); });
    this.scope.listen(this.document, 'keydown', event => { if (this.modal.hidden) return;
      if (event.key === 'Escape') this.close();
      if (event.key === 'Tab') {
        const controls = [...this.modal.querySelectorAll('button,input,textarea')].filter(node => !node.disabled);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && this.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && this.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      } });
  }
  open(record, trigger) {
    if (!hasPermission(this.role, 'correctAttendance') || this.busy || !record || record.displayOnly) return;
    this.record = record; this.trigger = trigger;
    this.field('attendanceRevocationForm').reset();
    const student = this.getStudents().find(item => item.uid === record.studentUid);
    this.field('revocationStudent').textContent = [student?.firstName, student?.lastName].filter(Boolean).join(' ') || record.studentId || 'Student';
    this.field('revocationEvent').textContent = `${record.eventName || 'Attendance event'} · ${record.eventDate || 'Date unavailable'}`;
    const time = value => {
      const milliseconds = attendanceMilliseconds(value);
      return Number.isFinite(milliseconds) ? new Date(milliseconds).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium' }) : 'Not recorded';
    };
    this.field('revocationTimes').textContent = 'Recorded check-in: ' + time(record.checkedInAt || record.attendedAt) + ' · Checkout: ' + time(record.checkedOutAt) + ' (Philippine time)';
    this.field('revocationStatus').textContent = '';
    this.field('confirmAttendanceRevocation').disabled = false;
    this.modal.hidden = false; this.field('revocationReason').focus();
  }
  async revoke(record, reason, confirmation) {
    requirePermission(this.role, 'correctAttendance');
    const explanation = revocationReason(reason, confirmation);
    if (!record || record.displayOnly || record.id !== `${record.studentUid}_${record.eventId}`) throw Error('Select a saved attendance record.');
    const archive = doc(this.db, 'attendanceRevocations', record.id);
    const operation = doc(collection(archive, 'history')).id;
    await this.transaction(this.db, async tx => {
      const reference = doc(this.db, 'attendance', record.id), snapshot = await tx.get(reference);
      if (!snapshot.exists()) throw Error('This record is no longer active. Refresh the attendance list.');
      const before = snapshot.data();
      if (before.studentUid !== record.studentUid || before.eventId !== record.eventId ||
          JSON.stringify(recordVersion(before)) !== JSON.stringify(recordVersion(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'id'))))) {
        throw Error('Attendance changed since you opened this record. Close this dialog, refresh and review it again.');
      }
      const data = { attendanceId: record.id, studentUid: before.studentUid, eventId: before.eventId,
        original: before, status: 'revoked', operation, revokedBy: this.user.uid, revokedAt: serverTimestamp(), reason: explanation };
      tx.set(archive, data);
      tx.set(doc(archive, 'history', operation), data);
      const student = this.getStudents().find(item => item.uid === before.studentUid);
      tx.set(doc(this.db, 'activityLogs', 'revocation_' + operation), activityRecord({ action: 'attendance-revoked', actorUid: this.user.uid,
        subjectUid: before.studentUid, subjectId: before.studentId || '', subjectName: [student?.firstName, student?.lastName].filter(Boolean).join(' '),
        eventId: before.eventId, eventName: before.eventName || '', reason: explanation,
        before: activitySnapshot('attendance', before), after: null, createdAt: serverTimestamp() }));
      tx.delete(reference);
    });
  }
  async submit() {
    if (this.busy) return;
    this.busy = true; this.field('confirmAttendanceRevocation').disabled = true;
    this.field('revocationStatus').textContent = 'Revoking attendance…';
    try {
      const id = this.record.id;
      await this.revoke(this.record, this.field('revocationReason').value, this.field('revocationConfirmation').value);
      this.busy = false; this.close();
      try { this.onRevoked(id); } catch { /* The acknowledged revocation remains valid; server listeners reconcile the view. */ }
      this.notify('Attendance revoked', 'The active record was removed. Its original values and revocation reason are archived. Existing fines were unchanged.');
    } catch (error) { this.field('revocationStatus').textContent = error.message; }
    finally { this.busy = false; this.field('confirmAttendanceRevocation').disabled = false; }
  }
  close() { if (this.busy) return; this.modal.hidden = true; this.field('attendanceRevocationForm').reset(); this.record = null; this.trigger?.focus(); }
  dispose() { this.scope.dispose(); this.record = null; }
}
