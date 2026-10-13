import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

export class AccountApprovalController {
  constructor({ document = globalThis.document, db, user, canApprove, notify = () => {} } = {}) {
    this.document = document; this.db = db; this.user = user; this.canApprove = canApprove; this.notify = notify;
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
    this.unsubscribe = onSnapshot(query(collection(this.db, 'registrationRequests'), orderBy('requestedAt', 'desc')), snapshot => {
      this.requests = snapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.status === 'pending'); this.render();
    }, () => { this.list.innerHTML = '<div class="empty-state">Unable to load registration requests.</div>'; });
  }
  dispose() { this.unsubscribe?.(); this.unsubscribe = null; this.initialized = false; }
  render() {
    this.count.textContent = `${this.requests.length} pending`;
    if (!this.requests.length) { this.list.innerHTML = '<div class="empty-state"><h3>No pending account approvals</h3><p>New student registration requests will appear here.</p></div>'; return; }
    this.list.innerHTML = this.requests.map(item => `<article class="approval-card"><div><h3>${this.escape(item.firstName)} ${this.escape(item.lastName)}</h3><p><strong>${this.escape(item.accountId)}</strong> · ${this.escape(item.course)} · Section ${this.escape(item.section)}</p><p>Birthday: ${this.escape(item.birthday)} · Awaiting approval</p></div>${this.canApprove() ? `<div class="button-row"><button class="outline-button" data-registration-decision="decline" data-request-id="${item.id}" type="button">Decline</button><button class="primary-button" data-registration-decision="approve" data-request-id="${item.id}" type="button">Approve</button></div>` : '<span class="badge gray">View only</span>'}</article>`).join('');
  }
  escape(value = '') { const node = this.document.createElement('span'); node.textContent = String(value); return node.innerHTML; }
  handleListClick(event) { const button = event.target.closest('[data-registration-decision]'); if (!button || !this.canApprove()) return; this.pending = { requestId: button.dataset.requestId, decision: button.dataset.registrationDecision }; const approved = this.pending.decision === 'approve'; this.modalTitle.textContent = approved ? 'Approve student account?' : 'Decline student account?'; this.modalMessage.textContent = approved ? 'The student can sign in immediately with the Student ID and password they registered.' : 'The disabled account will be removed. The student may submit a new registration request.'; this.confirm.textContent = approved ? 'Approve account' : 'Decline account'; this.confirm.className = approved ? 'primary-button' : 'danger-button'; this.modal.hidden = false; }
  closeModal() { this.modal.hidden = true; this.pending = null; }
  async confirmDecision() {
    if (!this.pending) return;
    const action = this.pending; this.confirm.disabled = true; const label = this.confirm.textContent; this.confirm.textContent = 'Saving…';
    try {
      await updateDoc(doc(this.db, 'registrationRequests', action.requestId), {
        status: action.decision === 'approve' ? 'approved' : 'declined',
        reviewedAt: serverTimestamp(), reviewedBy: this.user.uid, updatedAt: serverTimestamp()
      });
      this.closeModal(); this.notify(action.decision === 'approve' ? 'Account approved' : 'Request declined', action.decision === 'approve' ? 'The student can now sign in.' : 'Their request was declined and dashboard access remains blocked.');
    }
    catch (error) { this.notify('Unable to update request', String(error.message || 'Please try again.').replace(/^.*?:\s*/, '')); }
    finally { this.confirm.disabled = false; this.confirm.textContent = label; }
  }
}
