import { attendanceDay, attendanceMilliseconds } from '../../core/attendance/AttendanceTimePolicy.js';
import { hasPermission, requirePermission } from '../../core/security/permissions.js?v=20261122-feature-folders';
import { runTransaction, getDocFromServer, doc, collection, Timestamp, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { assertPendingRequest, loadReviewerName, writeRequestDecision } from './CorrectionRequestService.js';
import {activityRecord,activitySnapshot} from '../admin/ActivityRecordPolicy.js';

export function correctionValues({ checkIn, checkOut, arrival, reason, eventDate, event }) {
  const explanation = String(reason || '').trim();
  if (explanation.length < 5 || explanation.length > 1000) throw new Error('Enter a reason (5–1000 characters).');
  if (arrival === 'absent') return { start: null, end: null, arrival, reason: explanation };
  const parse = value => new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) ? value + '+08:00' : value);
  const start = parse(checkIn), end = checkOut ? parse(checkOut) : null;
  if (!checkIn || !Number.isFinite(start.getTime())) throw new Error('Enter a valid check-in time.');
  if (end && (!Number.isFinite(end.getTime()) || end <= start)) throw new Error('Checkout must be later than check-in.');
  if (eventDate && (attendanceDay(start) !== eventDate || end && attendanceDay(end) !== eventDate)) throw new Error('Use the selected event date: ' + eventDate + ' (PH).');
  if (start > new Date() || (end && end > new Date())) throw new Error('Attendance times cannot be in the future.');
  if (!['present', 'late'].includes(arrival)) throw new Error('Select Present or Late.');
  const cutoff = attendanceMilliseconds(event?.lateAfterAt || event?.checkInClosesAt);
  const fallback = event?.date && (event.checkInCutoff || event.timeOut)
    ? Date.parse(`${event.date}T${event.checkInCutoff || event.timeOut}:00+08:00`) : NaN;
  const boundary = Number.isFinite(cutoff) ? cutoff : fallback;
  return { start, end, arrival: Number.isFinite(boundary) ? start.getTime() < boundary ? 'present' : 'late' : arrival, reason: explanation };
}

// Compare only stored data, normalizing Firestore timestamps for transaction retries.
export function correctionVersion(record) {
  const normalize = value => {
    if (value?.toMillis) return value.toMillis();
    if (typeof value?.getTime === 'function') return value.getTime();
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, normalize(value[key])]));
    return value;
  };
  return JSON.stringify(normalize(record));
}

export function renderCorrectionRequestContext(context, record) {
  if (!context) return;
  context.hidden = !record?.correctionRequestId;
  context.querySelector('[data-correction-request-reason]').textContent = context.hidden ? '' : String(record.correctionRequestReason || 'No reason provided.');
}

export class AttendanceCorrectionController {
  constructor({ db, user, role, getStudents, getEvents, eligibility, escapeHtml, notify, getActorName = () => user?.displayName || 'Administrator', transaction = runTransaction }) {
    Object.assign(this, { db, user, role, getStudents, getEvents, eligibility, escapeHtml, notify, getActorName, transaction });
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.modal = document.querySelector('#attendanceCorrectionModal');
    this.form = document.querySelector('#attendanceCorrectionForm');
    this.button = document.querySelector('#addAttendanceCorrection');
    this.button.hidden = !hasPermission(this.role, 'correctAttendance');
    this.onOpen = () => this.open();
    this.onChange = event => {
      if (event?.target?.id === 'correctionAbsentConfirm' || this.saving) return;
      if (!event?.target || ['correctionCheckIn', 'correctionStudent', 'correctionEvent'].includes(event.target.id)) this.desiredArrival = null;
      this.edit(); this.refreshValidation();
    };
    this.form.addEventListener('input', this.onChange);
    this.form.addEventListener('change', this.onChange);
    this.onSubmit = event => { event.preventDefault(); this.submit(); };
    this.onClose = event => {
      const choice = event.target.closest('[data-correction-status]');
      if (choice && !this.saving) {
        this.edit(); this.desiredArrival = choice.dataset.correctionStatus;
        document.querySelector('#correctionArrival').value = this.desiredArrival;
        this.refreshValidation();
        if (this.desiredArrival !== 'absent') document.querySelector('#correctionCheckIn').focus();
      }
      if (event.target.closest('#correctionBack') && !this.saving) this.edit();
      if (event.target === this.modal || event.target.closest('[data-close-correction]')) this.close();
    };
    this.button.addEventListener('click', this.onOpen);
    this.form.addEventListener('submit', this.onSubmit);
    this.modal.addEventListener('click', this.onClose);
    this.onEscape = event => {
      if (this.modal.hidden) return;
      if (event.key === 'Escape') this.close();
      if (event.key === 'Tab') {
        const controls = [...this.modal.querySelectorAll('button,input,select,textarea')].filter(node => !node.disabled && !node.closest('[hidden]'));
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', this.onEscape);
  }

  open(record) {
    if (!hasPermission(this.role, 'correctAttendance') || this.saving) return;
    this.trigger = document.activeElement;
    this.desiredArrival = null;
    this.edit();
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
    document.querySelector('#correctionCheckIn').value = localTime(record?.checkedInAt || record?.attendedAt);
    document.querySelector('#correctionCheckOut').value = localTime(record?.checkedOutAt);
    document.querySelector('#correctionArrival').value = record?.status === 'absent' ? 'absent' : record?.arrivalStatus === 'late' ? 'late' : 'present';
    document.querySelector('#correctionReason').value = '';
    this.refreshValidation();
    this.modal.hidden = false;
    document.querySelector('#correctionTitle').focus();
  }

  async save({ studentUid, eventId, checkIn, checkOut, arrival, reason, requestId = null, expectedVersion }) {
    requirePermission(this.role, 'correctAttendance');
    const student = this.getStudents().find(item => item.uid === studentUid);
    const event = this.getEvents().find(item => item.id === eventId);
    if (!student || !event || student.active === false) throw new Error('Select an active student and an existing event.');
    const eligible = this.eligibility ? this.eligibility(student, event) !== 'excluded'
      : event.attendanceRoster ? Object.hasOwn(event.attendanceRoster, studentUid)
        : event.audience === 'All students' || event.audience === `Section ${student.section}`;
    if (!eligible) throw new Error('This event is not assigned to that student in its participant roster.');
    if (arrival === 'absent' && requestId) throw new Error('Decline the student request instead of approving it as absent.');
    const values = correctionValues({ checkIn, checkOut, arrival, reason, eventDate: event.date, event });
    const reference = doc(this.db, 'attendance', `${studentUid}_${eventId}`);
    const audit = doc(collection(reference, 'corrections'));
    await this.transaction(this.db, async transaction => {
      const snapshot = await transaction.get(reference);
      const before = snapshot.exists() ? snapshot.data() : null;
      if (expectedVersion !== undefined && correctionVersion(before) !== expectedVersion) throw new Error('Attendance changed since your review. Go back and review it again.');
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
        arrivalStatus: values.arrival, status: values.arrival === 'absent' ? 'absent' : values.end ? 'completed' : 'checked-in',
        recordSource: 'admin-corrected', correctionId: audit.id, correctedBy: this.user.uid,
        correctedAt: serverTimestamp(), correctionReason: values.reason
      };
      if (values.start) { after.attendedAt = Timestamp.fromDate(values.start); after.checkedInAt = Timestamp.fromDate(values.start); }
      else for (const key of ['attendedAt', 'checkedInAt', 'checkInLocation', 'checkedOutAt', 'checkOutLocation']) delete after[key];
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
    const minimum = selected?.date ? selected.date + 'T00:00:00' : '';
    const maximum = selected?.date ? selected.date + 'T23:59:59' : '';
    for (const input of [checkIn, checkOut]) {
      // Reassigning these during an input event resets Chromium's segment typing.
      if (input.min !== minimum) input.min = minimum;
      if (input.max !== maximum) input.max = maximum;
    }
    const absent = document.querySelector('#correctionArrival').value === 'absent';
    for (const input of [checkIn, checkOut]) if (input.disabled !== absent) input.disabled = absent;
    if (checkIn.required !== !absent) checkIn.required = !absent;
    document.querySelector('#correctionTimes').hidden = absent;
    document.querySelector('#correctionAbsentNote').hidden = !absent;
    document.querySelector('#correctionCurrentStatus').textContent = this.record
      ? (this.record.status === 'absent' || this.record.displayOnly ? 'Absent' : this.record.arrivalStatus === 'late' ? 'Late' : 'Present') : 'Review will load the current record';
    const schedule = document.querySelector('#correctionSchedule');
    const clock = value => {
      const parts = /^(\d{2}):(\d{2})$/.exec(value || '');
      return parts ? `${Number(parts[1]) % 12 || 12}:${parts[2]} ${Number(parts[1]) < 12 ? 'AM' : 'PM'}` : 'Not set';
    };
    const cutoffTime = attendanceMilliseconds(selected?.lateAfterAt || selected?.checkInClosesAt);
    const cutoff = Number.isFinite(cutoffTime) ? new Date(cutoffTime).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true }) : clock(selected?.checkInCutoff || selected?.timeOut);
    schedule.textContent = selected ? selected.date + ' · Philippine time\nLate from ' + cutoff + ' · Checkout ' + clock(selected.timeOut) + '–' + clock(selected.checkOutCutoff) : 'Choose an event session.';
    const error = document.querySelector('#correctionTimeError'), after = document.querySelector('#correctionAfter');
    try {
      if (!selected) throw Error('Choose an event.');
      const values = correctionValues({ checkIn: checkIn.value, checkOut: checkOut.value, arrival: document.querySelector('#correctionArrival').value, reason: 'Preview correction', eventDate: selected.date, event: selected });
      const elapsed = values.end ? values.end - values.start : null;
      if (this.desiredArrival && values.arrival !== this.desiredArrival) throw Error(this.desiredArrival === 'late' ? `For Late, set check-in to ${cutoff} or later.` : `For Present, set check-in before ${cutoff}.`);
      document.querySelector('#correctionArrival').value = values.arrival;
      after.textContent = values.arrival === 'absent' ? '' : (values.arrival === 'late' ? 'Late' : 'Present') + ' · ' + (elapsed === null ? 'Awaiting checkout' : 'Duration: ' + (elapsed < 60000 ? 'Less than 1 minute' : Math.floor(elapsed / 60000) + ' minutes'));
      error.textContent = ''; document.querySelector('#saveAttendanceCorrection').disabled = Boolean(this.saving);
    } catch (issue) {
      error.textContent = issue.message; after.textContent = ''; document.querySelector('#saveAttendanceCorrection').disabled = true;
    }
    this.modal?.querySelectorAll?.('[data-correction-status]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.correctionStatus === document.querySelector('#correctionArrival').value)));
  }

  edit() {
    this.review = null;
    document.querySelector('#correctionEditor').hidden = false;
    document.querySelector('#correctionReview').hidden = true;
    document.querySelector('#correctionBack').hidden = true;
    document.querySelector('#saveAttendanceCorrection').textContent = 'Review changes';
    document.querySelector('#correctionSubmitError').textContent = '';
    document.querySelector('#correctionAbsentConfirm').checked = false;
    document.querySelector('#correctionTitle').textContent = 'Change attendance';
  }

  close() {
    if (this.saving) return;
    this.modal.hidden = true;
    this.review = null;
    this.trigger?.focus?.();
  }

  showReview(before, input, values) {
    const display = value => {
      const time = attendanceMilliseconds(value);
      return Number.isFinite(time) ? new Date(time).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium' }) : 'Not recorded';
    };
    const status = record => !record ? 'No saved attendance' : record.status === 'absent' ? 'Absent' : record.arrivalStatus === 'late' ? 'Late' : 'Present';
    const rows = [['Arrival', status(before), values.arrival === 'absent' ? 'Absent' : values.arrival === 'late' ? 'Late' : 'Present'],
      ['Check-in', display(before?.checkedInAt || before?.attendedAt), display(values.start)], ['Checkout', display(before?.checkedOutAt), display(values.end)]];
    document.querySelector('#correctionComparison').innerHTML = rows.map(([label, current, proposed]) => `<tr><th scope="row">${this.escapeHtml(label)}</th><td>${this.escapeHtml(current)}</td><td>${this.escapeHtml(proposed)}</td></tr>`).join('');
    const student = this.getStudents().find(item => item.uid === input.studentUid), event = this.getEvents().find(item => item.id === input.eventId);
    document.querySelector('#correctionReviewSubject').textContent = [student?.firstName, student?.lastName, student?.accountId, event?.name].filter(Boolean).join(' · ');
    document.querySelector('#correctionReviewReason').textContent = values.reason;
    const actorName = this.getActorName();
    document.querySelector('#correctionReviewActor').textContent = typeof actorName === 'string' && actorName.trim() ? actorName.trim() : 'Administrator';
    document.querySelector('#correctionAbsentWarning').hidden = values.arrival !== 'absent';
    document.querySelector('#correctionReviewNote').textContent = values.arrival === 'absent'
      ? 'Original attendance stays in history. Existing fines stay unchanged.'
      : 'Times are in Philippine time. Changes are saved to history.';
    this.review = { ...input, arrival: values.arrival, expectedVersion: correctionVersion(before), eventVersion: correctionVersion(event) };
    document.querySelector('#correctionEditor').hidden = true;
    document.querySelector('#correctionReview').hidden = false;
    document.querySelector('#correctionBack').hidden = false;
    document.querySelector('#correctionTitle').textContent = 'Review changes';
    document.querySelector('#saveAttendanceCorrection').textContent = 'Save correction';
    document.querySelector('#correctionBack').focus();
  }

  async submit() {
    if (this.saving) return;
    const button = document.querySelector('#saveAttendanceCorrection');
    this.saving = true;
    button.disabled = true;
    button.textContent = this.review ? 'Saving correction…' : 'Loading attendance…';
    this.form?.setAttribute('aria-busy', 'true');
    document.querySelector('#correctionSubmitError').textContent = '';
    try {
      if (!this.review) {
        const input = { studentUid: document.querySelector('#correctionStudent').value, eventId: document.querySelector('#correctionEvent').value,
          checkIn: document.querySelector('#correctionCheckIn').value, checkOut: document.querySelector('#correctionCheckOut').value,
          arrival: document.querySelector('#correctionArrival').value, reason: document.querySelector('#correctionReason').value, requestId: this.requestId };
        const event = this.getEvents().find(item => item.id === input.eventId);
        if (!event) throw Error('Choose an event.');
        if (input.arrival === 'absent' && input.requestId) throw Error('Decline the student request instead of approving it as absent.');
        const values = correctionValues({ ...input, eventDate: event.date, event });
        const snapshot = await getDocFromServer(doc(this.db, 'attendance', `${input.studentUid}_${input.eventId}`));
        this.showReview(snapshot.exists() ? snapshot.data() : null, input, values);
      } else {
        if (this.review.arrival === 'absent' && !document.querySelector('#correctionAbsentConfirm').checked) throw Error('Confirm that this student should be marked Absent.');
        if (this.review.eventVersion !== correctionVersion(this.getEvents().find(item => item.id === this.review.eventId))) throw Error('The event schedule changed. Go back and review it again.');
        await this.save(this.review);
        this.modal.hidden = true; this.review = null;
        this.trigger?.focus?.();
        this.notify('Attendance corrected', 'The reason, administrator, save time and previous record were saved together.');
      }
    } catch (error) { document.querySelector('#correctionSubmitError').textContent = error.message; }
    finally {
      this.saving = false;
      this.form?.removeAttribute('aria-busy');
      button.textContent = this.review ? 'Save correction' : 'Review changes';
      if (this.review) button.disabled = false; else this.refreshValidation();
    }
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
