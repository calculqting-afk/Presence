import { attendanceDay, attendanceMilliseconds } from '../core/AttendanceTimePolicy.js';
import { hasPermission, requirePermission } from '../core/permissions.js?v=20261011-optimized';
import { runTransaction, doc, collection, Timestamp, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { assertPendingRequest, loadReviewerName, writeRequestDecision } from './CorrectionRequestService.js';
import {activityRecord,activitySnapshot} from './ActivityRecordPolicy.js';

export function correctionValues({ checkIn, checkOut, arrival, reason, eventDate }) {
  const parse = value => new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) ? value + '+08:00' : value);
  const start = parse(checkIn), end = checkOut ? parse(checkOut) : null;
  const explanation = String(reason || '').trim();
  if (!checkIn || !Number.isFinite(start.getTime())) throw new Error('Enter a valid check-in time.');
  if (end && (!Number.isFinite(end.getTime()) || end <= start)) throw new Error('Checkout must be later than check-in.');
  if (eventDate && (attendanceDay(start) !== eventDate || end && attendanceDay(end) !== eventDate)) throw new Error('Attendance times must use the selected event date (' + eventDate + ', Philippine time).');
  if (start > new Date() || (end && end > new Date())) throw new Error('Attendance times cannot be in the future.');
  if (!['present', 'late'].includes(arrival)) throw new Error('Select Present or Late.');
  if (explanation.length < 5 || explanation.length > 1000) throw new Error('Provide a reason between 5 and 1000 characters.');
  return { start, end, arrival, reason: explanation };
}

export function renderCorrectionRequestContext(context, record) {
  if (!context) return;
  context.hidden = !record?.correctionRequestId;
  context.querySelector('[data-correction-request-reason]').textContent = context.hidden ? '' : String(record.correctionRequestReason || 'No reason provided.');
}

export class AttendanceCorrectionController {
  constructor({ db, user, role, getStudents, getEvents, eligibility, escapeHtml, notify, transaction = runTransaction }) {
    Object.assign(this, { db, user, role, getStudents, getEvents, eligibility, escapeHtml, notify, transaction });
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.modal = document.querySelector('#attendanceCorrectionModal');
    this.form = document.querySelector('#attendanceCorrectionForm');
    this.button = document.querySelector('#addAttendanceCorrection');
    this.button.hidden = !hasPermission(this.role, 'correctAttendance');
    this.onOpen = () => this.open();
    this.onChange = () => this.refreshValidation();
    this.form.addEventListener('input', this.onChange);
    this.form.addEventListener('change', this.onChange);
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
    this.requestId = record?.correctionRequestId || null;
    const context = document.querySelector('#correctionRequestContext');
    renderCorrectionRequestContext(context, record);
    const student = document.querySelector('#correctionStudent'), event = document.querySelector('#correctionEvent');
    student.innerHTML = this.getStudents().map(item => `<option value="${this.escapeHtml(item.uid)}">${this.escapeHtml(item.accountId + ' · ' + item.firstName + ' ' + item.lastName)}</option>`).join('');
    event.innerHTML = this.getEvents().map(item => `<option value="${this.escapeHtml(item.id)}">${this.escapeHtml(item.name + ' · ' + item.date)}</option>`).join('');
    student.disabled = event.disabled = Boolean(record);
    if (record) { student.value = record.studentUid; event.value = record.eventId; }
    const localTime = value => {
      const time = attendanceMilliseconds(value);
      const date = Number.isFinite(time) ? new Date(time + 8 * 3600000) : null;
      return date ? date.toISOString().slice(0, 19) : '';
    };
    document.querySelector('#correctionCheckIn').value = localTime(record?.checkedInAt);
    document.querySelector('#correctionCheckOut').value = localTime(record?.checkedOutAt);
    document.querySelector('#correctionArrival').value = record?.arrivalStatus || 'present';
    document.querySelector('#correctionReason').value = '';
    this.refreshValidation();
    this.modal.hidden = false;
    document.querySelector('#correctionReason').focus();
  }

  async save({ studentUid, eventId, checkIn, checkOut, arrival, reason, requestId = null }) {
    requirePermission(this.role, 'correctAttendance');
    const student = this.getStudents().find(item => item.uid === studentUid);
    const event = this.getEvents().find(item => item.id === eventId);
    if (!student || !event || student.active === false) throw new Error('Select an active student and an existing event.');
    const values = correctionValues({ checkIn, checkOut, arrival, reason, eventDate: event.date });
    const eligible = this.eligibility ? this.eligibility(student, event) !== 'excluded'
      : event.attendanceRoster ? Object.hasOwn(event.attendanceRoster, studentUid)
        : event.audience === 'All students' || event.audience === `Section ${student.section}`;
    if (!eligible) throw new Error('This event is not assigned to that student in its participant roster.');
    const reference = doc(this.db, 'attendance', `${studentUid}_${eventId}`);
    const audit = doc(collection(reference, 'corrections'));
    await this.transaction(this.db, async transaction => {
      const snapshot = await transaction.get(reference);
      const before = snapshot.exists() ? snapshot.data() : null;
      let request, reviewerName;
      if (requestId) {
        const pending = await transaction.get(doc(this.db, 'attendanceCorrectionRequests', requestId));
        request = pending.exists() ? pending.data() : null;
        assertPendingRequest(request, studentUid, eventId);
        reviewerName = await loadReviewerName(transaction, this.db, this.user.uid, this.role);
      }
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
      transaction.set(doc(this.db,'activityLogs','attendance_'+audit.id),activityRecord({action:'attendance-corrected',actorUid:this.user.uid,
        subjectUid:studentUid,subjectId:student.accountId,subjectName:[student.firstName,student.middleName,student.lastName].filter(Boolean).join(' '),eventId,eventName:event.name,
        reason:values.reason,before:activitySnapshot('attendance',before),after:activitySnapshot('attendance',after),createdAt:serverTimestamp()}));
      if (requestId) writeRequestDecision(transaction, this.db, requestId, request, {
        userUid: this.user.uid, reviewerName, status: 'approved', reason: values.reason, correctionId: audit.id
      });
    });
  }

  refreshValidation() {
    const selected = this.getEvents().find(item => item.id === document.querySelector('#correctionEvent').value);
    const checkIn = document.querySelector('#correctionCheckIn'), checkOut = document.querySelector('#correctionCheckOut');
    for (const input of [checkIn, checkOut]) {
      input.min = selected?.date ? selected.date + 'T00:00:00' : '';
      input.max = selected?.date ? selected.date + 'T23:59:59' : '';
    }
    const schedule = document.querySelector('#correctionSchedule');
    schedule.textContent = selected ? selected.name + '\n' + selected.date + ' · Philippine time\nCheck-in: ' + (selected.timeIn || 'Not set') + '–' + (selected.checkInCutoff || 'Not set') + '\nCheck-out: ' + (selected.timeOut || 'Not set') + '–' + (selected.checkOutCutoff || 'Not set') : 'Choose an event to see its schedule.';
    const display = value => {
      const time = attendanceMilliseconds(value);
      return Number.isFinite(time) ? new Date(time).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium' }) : 'Not recorded';
    };
    const before = document.querySelector('#correctionBefore');
    before.textContent = this.record ? 'Before: ' + display(this.record.checkedInAt || this.record.attendedAt) + ' → ' + display(this.record.checkedOutAt) : '';
    before.hidden = !this.record;
    const error = document.querySelector('#correctionTimeError'), after = document.querySelector('#correctionAfter');
    try {
      if (!selected) throw Error('Choose an event.');
      const values = correctionValues({ checkIn: checkIn.value, checkOut: checkOut.value, arrival: document.querySelector('#correctionArrival').value, reason: 'Preview correction', eventDate: selected.date });
      const elapsed = values.end ? values.end - values.start : null;
      after.textContent = 'After: ' + display(values.start) + ' → ' + display(values.end) + ' · ' + values.arrival + ' · Duration: ' + (elapsed === null ? 'Awaiting checkout' : elapsed < 60000 ? 'Less than 1 minute' : Math.floor(elapsed / 60000) + ' minutes');
      error.textContent = ''; document.querySelector('#saveAttendanceCorrection').disabled = Boolean(this.saving);
    } catch (issue) {
      error.textContent = issue.message; after.textContent = ''; document.querySelector('#saveAttendanceCorrection').disabled = true;
    }
  }

  async submit() {
    const button = document.querySelector('#saveAttendanceCorrection');
    this.saving = true;
    button.disabled = true;
    try {
      await this.save({ studentUid: document.querySelector('#correctionStudent').value, eventId: document.querySelector('#correctionEvent').value,
        checkIn: document.querySelector('#correctionCheckIn').value, checkOut: document.querySelector('#correctionCheckOut').value,
        arrival: document.querySelector('#correctionArrival').value, reason: document.querySelector('#correctionReason').value, requestId: this.requestId });
      this.modal.hidden = true;
      this.notify('Attendance corrected', 'The reason, administrator and previous record were saved together.');
    } catch (error) { this.notify('Correction not saved', error.message); }
    finally { this.saving = false; this.refreshValidation(); }
  }

  dispose() {
    if (!this.initialized) return;
    this.button.removeEventListener('click', this.onOpen);
    this.form.removeEventListener('submit', this.onSubmit);
    this.form.removeEventListener('input', this.onChange);
    this.form.removeEventListener('change', this.onChange);
    this.modal.removeEventListener('click', this.onClose);
    document.removeEventListener('keydown', this.onEscape);
    this.initialized = false;
  }
}
