import { hasPermission, requirePermission } from '../core/permissions.js?v=20261010-surveys';
import { runTransaction, doc, collection, Timestamp, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

export function correctionValues({ checkIn, checkOut, arrival, reason }) {
  const start = new Date(checkIn), end = checkOut ? new Date(checkOut) : null;
  const explanation = String(reason || '').trim();
  if (!checkIn || !Number.isFinite(start.getTime())) throw new Error('Enter a valid check-in time.');
  if (end && (!Number.isFinite(end.getTime()) || end < start)) throw new Error('Check-out must be at or after check-in.');
  if (start > new Date() || (end && end > new Date())) throw new Error('Attendance times cannot be in the future.');
  if (!['present', 'late'].includes(arrival)) throw new Error('Select Present or Late.');
  if (explanation.length < 5 || explanation.length > 1000) throw new Error('Provide a reason between 5 and 1000 characters.');
  return { start, end, arrival, reason: explanation };
}

export class AttendanceCorrectionController {
  constructor({ db, user, role, getStudents, getEvents, escapeHtml, notify, transaction = runTransaction }) {
    Object.assign(this, { db, user, role, getStudents, getEvents, escapeHtml, notify, transaction });
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.modal = document.querySelector('#attendanceCorrectionModal');
    this.form = document.querySelector('#attendanceCorrectionForm');
    this.button = document.querySelector('#addAttendanceCorrection');
    this.button.hidden = !hasPermission(this.role, 'correctAttendance');
    this.onOpen = () => this.open();
    this.onSubmit = event => { event.preventDefault(); this.submit(); };
    this.onClose = event => { if (event.target === this.modal || event.target.closest('[data-close-correction]')) this.modal.hidden = true; };
    this.button.addEventListener('click', this.onOpen);
    this.form.addEventListener('submit', this.onSubmit);
    this.modal.addEventListener('click', this.onClose);
    this.onEscape = event => { if (event.key === 'Escape' && !this.modal.hidden) this.modal.hidden = true; };
    document.addEventListener('keydown', this.onEscape);
  }

  open(record) {
    if (!hasPermission(this.role, 'correctAttendance')) return;
    this.record = record;
    const student = document.querySelector('#correctionStudent'), event = document.querySelector('#correctionEvent');
    student.innerHTML = this.getStudents().map(item => `<option value="${this.escapeHtml(item.uid)}">${this.escapeHtml(item.accountId + ' · ' + item.firstName + ' ' + item.lastName)}</option>`).join('');
    event.innerHTML = this.getEvents().map(item => `<option value="${this.escapeHtml(item.id)}">${this.escapeHtml(item.name + ' · ' + item.date)}</option>`).join('');
    student.disabled = event.disabled = Boolean(record);
    if (record) { student.value = record.studentUid; event.value = record.eventId; }
    const localTime = value => {
      const date = value?.toDate?.();
      return date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    };
    document.querySelector('#correctionCheckIn').value = localTime(record?.checkedInAt);
    document.querySelector('#correctionCheckOut').value = localTime(record?.checkedOutAt);
    document.querySelector('#correctionArrival').value = record?.arrivalStatus || 'present';
    document.querySelector('#correctionReason').value = '';
    this.modal.hidden = false;
    document.querySelector('#correctionReason').focus();
  }

  async save({ studentUid, eventId, checkIn, checkOut, arrival, reason }) {
    requirePermission(this.role, 'correctAttendance');
    const values = correctionValues({ checkIn, checkOut, arrival, reason });
    const student = this.getStudents().find(item => item.uid === studentUid);
    const event = this.getEvents().find(item => item.id === eventId);
    if (!student || !event || student.active === false) throw new Error('Select an active student and an existing event.');
    const eligible = event.attendanceRoster ? Object.hasOwn(event.attendanceRoster, studentUid)
      : event.audience === 'All students' || event.audience === `Section ${student.section}`;
    if (!eligible) throw new Error('This event is not assigned to that student in its participant roster.');
    const reference = doc(this.db, 'attendance', `${studentUid}_${eventId}`);
    const audit = doc(collection(reference, 'corrections'));
    await this.transaction(this.db, async transaction => {
      const snapshot = await transaction.get(reference);
      const before = snapshot.exists() ? snapshot.data() : null;
      const after = {
        ...(before || {}), studentUid, studentId: student.accountId, eventId,
        eventName: event.name, eventType: event.type, eventDescription: event.description || '',
        eventDate: event.date, timeIn: event.timeIn, timeOut: event.timeOut,
        location: event.location, audience: event.audience,
        attendedAt: Timestamp.fromDate(values.start), checkedInAt: Timestamp.fromDate(values.start),
        arrivalStatus: values.arrival, status: values.end ? 'completed' : 'checked-in',
        recordSource: 'admin-corrected', correctionId: audit.id, correctedBy: this.user.uid,
        correctedAt: serverTimestamp(), correctionReason: values.reason
      };
      if (values.end) after.checkedOutAt = Timestamp.fromDate(values.end);
      else { delete after.checkedOutAt; delete after.checkOutLocation; }
      transaction.set(reference, after);
      transaction.set(audit, { before, after, by: this.user.uid, at: serverTimestamp(), reason: values.reason });
    });
  }

  async submit() {
    const button = document.querySelector('#saveAttendanceCorrection');
    button.disabled = true;
    try {
      await this.save({ studentUid: document.querySelector('#correctionStudent').value, eventId: document.querySelector('#correctionEvent').value,
        checkIn: document.querySelector('#correctionCheckIn').value, checkOut: document.querySelector('#correctionCheckOut').value,
        arrival: document.querySelector('#correctionArrival').value, reason: document.querySelector('#correctionReason').value });
      this.modal.hidden = true;
      this.notify('Attendance corrected', 'The reason, administrator and previous record were saved together.');
    } catch (error) { this.notify('Correction not saved', error.message); }
    finally { button.disabled = false; }
  }

  dispose() {
    if (!this.initialized) return;
    this.button.removeEventListener('click', this.onOpen);
    this.form.removeEventListener('submit', this.onSubmit);
    this.modal.removeEventListener('click', this.onClose);
    document.removeEventListener('keydown', this.onEscape);
    this.initialized = false;
  }
}
