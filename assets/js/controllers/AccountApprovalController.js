import { collection, doc, onSnapshot, query, where, serverTimestamp, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { CoursePolicy } from '../core/CoursePolicy.js';
import { GenderPolicy } from '../core/GenderPolicy.js';

export class AccountApprovalController {
  constructor({ document = globalThis.document, db, user, canApprove, studentIdToEmail, onApprovedStudent = () => {}, notify = () => {} } = {}) {
    this.document = document; this.db = db; this.user = user; this.canApprove = canApprove;
    this.studentIdToEmail = studentIdToEmail; this.onApprovedStudent = onApprovedStudent; this.notify = notify;
    this.unsubscribe = null; this.initialized = false; this.requests = [];
  }
  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.list = this.document.querySelector('#accountApprovalList');
    this.count = this.document.querySelector('#accountApprovalCount');
    this.modal = this.document.querySelector('#accountApprovalModal');
    this.modalTitle = this.document.querySelector('#accountApprovalModalTitle');
    this.modalMessage = this.document.querySelector('#accountApprovalModalMessage');
    this.confirm = this.document.querySelector('#confirmAccountApproval');
    this.list?.addEventListener('click', event => this.handleListClick(event));
    this.modal?.addEventListener('click', event => { if (event.target === this.modal || event.target.closest('[data-close-account-approval]')) this.closeModal(); });
    this.confirm?.addEventListener('click', () => this.confirmDecision());
    this.unsubscribe = onSnapshot(query(collection(this.db, 'registrationRequests'), where('status', '==', 'pending')), snapshot => {
      if (!this.initialized) return;
      this.requests = snapshot.docs.map(item => CoursePolicy.profile({ id: item.id, ...item.data() })).filter(item => item.status === 'pending')
        .sort((a, b) => (b.requestedAt?.seconds || 0) - (a.requestedAt?.seconds || 0));
      this.render();
    }, () => {
      if (!this.initialized) return;
      this.renderNavigationCount(0);
      this.count.textContent = 'Unavailable';
      this.list.innerHTML = '<div class="empty-state">Unable to load registration requests.</div>';
    });
  }
  dispose() { this.initialized = false; this.unsubscribe?.(); this.unsubscribe = null; this.renderNavigationCount(0); }
  renderNavigationCount(count) {
    const badge = this.document.querySelector('#accountApprovalNavCount');
    const button = this.document.querySelector('[data-view="account-approvals"]');
    if (badge) {
      badge.hidden = count === 0;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.title = `${count} pending registration${count === 1 ? '' : 's'}`;
    }
    if (button) button.setAttribute('aria-label', count ? `Account Approvals, ${count} pending registration${count === 1 ? '' : 's'}` : 'Account Approvals');
  }
  render() {
    this.count.textContent = `${this.requests.length} pending`;
    this.renderNavigationCount(this.requests.length);
    if (!this.requests.length) { this.list.innerHTML = '<div class="empty-state"><h3>No pending account approvals</h3><p>New student registration requests will appear here.</p></div>'; return; }
    this.list.innerHTML = this.requests.map(item => `<article class="approval-card"><div><h3>${this.escape(item.firstName)} ${this.escape(item.lastName)}</h3><p><strong>${this.escape(item.accountId)}</strong> · ${this.escape(item.course)} · Section ${this.escape(item.section)}</p><p>Birthday: ${this.escape(item.birthday)} · Gender: ${GenderPolicy.label(item.gender)} · Awaiting approval</p></div>${this.canApprove() ? `<div class="button-row"><button class="outline-button" data-registration-decision="decline" data-request-id="${item.id}" type="button">Decline</button><button class="primary-button" data-registration-decision="approve" data-request-id="${item.id}" type="button">Approve</button></div>` : '<span class="badge gray">View only</span>'}</article>`).join('');
  }
  escape(value = '') { const node = this.document.createElement('span'); node.textContent = String(value); return node.innerHTML; }
  handleListClick(event) { const button = event.target.closest('[data-registration-decision]'); if (!button || !this.canApprove()) return; this.pending = { requestId: button.dataset.requestId, decision: button.dataset.registrationDecision }; const approved = this.pending.decision === 'approve'; this.modalTitle.textContent = approved ? 'Approve student account?' : 'Decline student account?'; this.modalMessage.textContent = approved ? 'This will activate the student profile and add it to Registered students immediately.' : 'The request will be declined. The student can correct their details and resubmit.'; this.confirm.textContent = approved ? 'Approve account' : 'Decline account'; this.confirm.className = approved ? 'primary-button' : 'danger-button'; this.modal.hidden = false; }
  closeModal() { this.modal.hidden = true; this.pending = null; }
  approvedStudent(request) {
    const accountIdKey = request.accountIdKey || String(request.accountId || '').trim().toLowerCase();
    return {
      uid: request.uid, accountId: request.accountId, accountIdKey,
      authEmail: this.studentIdToEmail(request.accountId), birthday: request.birthday,
      firstName: request.firstName, middleName: '', lastName: request.lastName, gender: GenderPolicy.normalize(request.gender),
      course: CoursePolicy.normalize(request.course), section: request.section, active: true, role: 'student',
      mustChangePassword: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
  }
  async confirmDecision() {
    if (!this.pending) return;
    const action = this.pending; this.confirm.disabled = true; const label = this.confirm.textContent; this.confirm.textContent = 'Saving…';
    try {
      const request = this.requests.find(item => item.id === action.requestId);
      if (!request) throw new Error('This registration request is no longer pending. Refresh and try again.');
      if (action.decision === 'approve') {
        const student = this.approvedStudent(request);
        const batch = writeBatch(this.db);
        batch.set(doc(this.db, 'students', student.uid), student);
        batch.set(doc(this.db, 'studentIds', student.accountIdKey), {
          studentId: student.accountId, uid: student.uid, createdAt: serverTimestamp()
        });
        batch.update(doc(this.db, 'registrationRequests', action.requestId), {
          status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: this.user.uid, updatedAt: serverTimestamp()
        });
        await batch.commit();
        this.onApprovedStudent(student);
      } else {
        await updateDoc(doc(this.db, 'registrationRequests', action.requestId), {
          status: 'declined', reviewedAt: serverTimestamp(), reviewedBy: this.user.uid, updatedAt: serverTimestamp()
        });
      }
      this.closeModal(); this.notify(action.decision === 'approve' ? 'Account approved' : 'Request declined', action.decision === 'approve' ? 'The student is now counted in Registered students and can sign in.' : 'Their request was declined and dashboard access remains blocked.');
    }
    catch (error) { this.notify('Unable to update request', String(error.message || 'Please try again.').replace(/^.*?:\s*/, '')); }
    finally { this.confirm.disabled = false; this.confirm.textContent = label; }
  }
}
