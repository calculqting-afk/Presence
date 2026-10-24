import { doc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { EventAudiencePolicy } from './EventAudiencePolicy.js';
import { AttendanceViews } from './AttendanceViews.js';
import { requirePermission } from '../core/permissions.js?v=20261011-optimized';

export const CORRECTION_KINDS = Object.freeze({ 'missed-check-in': 'Missed check-in', 'missed-checkout': 'Missed checkout', 'incorrect-attendance': 'Incorrect attendance' });
export function requestReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 5 || reason.length > 1000) throw new Error('Enter a reason between 5 and 1000 characters.');
  return reason;
}
export function assertPendingRequest(request, studentUid, eventId) {
  if (!request || request.status !== 'pending' || request.studentUid !== studentUid || request.eventId !== eventId)
    throw new Error('This request is no longer pending for that student and session. Refresh the queue.');
}
export async function loadReviewerName(transaction, db, userUid, role) {
  const isSuperAdmin = role === 'super_admin';
  const snapshot = await transaction.get(doc(db, isSuperAdmin ? 'adminProfiles' : 'students', userUid));
  const profile = snapshot.exists() ? snapshot.data() : {};
  const name = isSuperAdmin ? profile.displayName : [profile.firstName, profile.middleName, profile.lastName].filter(part => typeof part === 'string' && part.length).join(' ');
  return typeof name === 'string' && name.length > 0 && name.length <= 256 ? name : isSuperAdmin ? 'Super Admin' : 'Administrator';
}
export function writeRequestDecision(transaction, db, id, request, { userUid, reviewerName, status, reason, correctionId = '' }) {
  const decision = { status, reviewedBy: userUid, reviewedByName: reviewerName, reviewedAt: serverTimestamp(), decisionReason: requestReason(reason), correctionId };
  transaction.set(doc(db, 'attendanceCorrectionRequests', id), { ...request, ...decision });
  transaction.set(doc(db, 'attendanceCorrectionRequests', id, 'history', 'decision'), {
    action: status, by: userUid, byName: reviewerName, at: serverTimestamp(), reason: decision.decisionReason, correctionId
  });
}
export class CorrectionRequestService {
  constructor({ db, user, role = 'student', transaction = runTransaction }) { Object.assign(this, { db, user, role, transaction }); }
  async create({ eventId, kind, reason }) {
    if (!CORRECTION_KINDS[kind]) throw new Error('Choose the attendance problem.');
    const explanation = requestReason(reason), studentUid = this.user.uid, id = `${studentUid}_${eventId}`;
    await this.transaction(this.db, async tx => {
      const reference = doc(this.db, 'attendanceCorrectionRequests', id);
      const [existing, profile, eventSnapshot] = await Promise.all([
        tx.get(reference), tx.get(doc(this.db, 'students', studentUid)), tx.get(doc(this.db, 'events', eventId))
      ]);
      if (existing.exists()) throw new Error('You already submitted a request for this session. View its decision below; contact an admin for further review.');
      const student = { ...profile.data(), uid: studentUid }, event = eventSnapshot.data();
      if (!profile.exists() || student.active !== true || !eventSnapshot.exists() || !EventAudiencePolicy.canAttend(student, event)) throw new Error('This session is not assigned to your active student account.');
      if (!(Date.now() > AttendanceViews.time(event, 'checkOutClosesAt'))) throw new Error('Requests are available after this session closes.');
      tx.set(reference, { studentUid, eventId, kind, reason: explanation, status: 'pending', submittedAt: serverTimestamp() });
      tx.set(doc(reference, 'history', 'submitted'), { action: 'submitted', by: studentUid, at: serverTimestamp(), reason: explanation, correctionId: '' });
    });
  }
  async decline(id, reason) {
    requirePermission(this.role, 'correctAttendance');
    const explanation = requestReason(reason);
    await this.transaction(this.db, async tx => {
      const snapshot = await tx.get(doc(this.db, 'attendanceCorrectionRequests', id)), request = snapshot.data();
      if (!snapshot.exists() || request.status !== 'pending') throw new Error('This request is no longer pending.');
      const reviewerName = await loadReviewerName(tx, this.db, this.user.uid, this.role);
      writeRequestDecision(tx, this.db, id, request, { userUid: this.user.uid, reviewerName, status: 'declined', reason: explanation });
    });
  }
}
