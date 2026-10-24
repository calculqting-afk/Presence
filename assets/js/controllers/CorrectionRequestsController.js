import { collection, doc, query, where, onSnapshot, getDocFromServer } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { CorrectionRequestService, CORRECTION_KINDS } from './CorrectionRequestService.js';
import { AttendanceViews } from './AttendanceViews.js';
import { EventAudiencePolicy } from './EventAudiencePolicy.js';
import { ButtonLoadingController } from './ButtonLoadingController.js';
import { CorrectionRequestFilters } from './CorrectionRequestFilters.js';

export class CorrectionRequestsController {
  constructor({ root, badge, db, user, role = 'student', getEvents, getStudent, getStudents = () => [], onApprove, escapeHtml, notify }) {
    Object.assign(this, { root, badge, db, user, role, getEvents, getStudent, getStudents, onApprove, escapeHtml, notify });
    this.admin = role !== 'student'; this.requests = []; this.declineDrafts = new Map();
    this.service = new CorrectionRequestService({ db, user, role });
    this.loading = new ButtonLoadingController({ document: root?.ownerDocument });
  }
  initialize() {
    if (this.initialized || !this.root) return;
    this.initialized = true;
    const e = this.escapeHtml;
    this.root.innerHTML = `<h3>${this.admin ? 'Review correction requests' : 'Request an attendance correction'}</h3><p>Requests do not change attendance until an admin saves a verified correction. Existing fines are reviewed separately.</p>${this.admin
      ? `<div class="correction-request-filters"><label class="field request-search-field">Student<input type="search" data-request-search placeholder="Search name, student ID or email"></label><label class="field">Section<select data-request-section><option value="">All sections</option></select></label><label class="field">Status<select data-request-filter><option value="pending">Pending</option><option value="all">All requests</option><option value="approved">Approved</option><option value="declined">Declined</option></select></label><button class="outline-button" type="button" data-clear-request-filters>Clear</button></div>`
      : `<form data-request-form class="correction-request-form"><label class="field">Event and session<select name="eventId" required data-request-event></select></label><label class="field">Problem<select name="kind">${Object.entries(CORRECTION_KINDS).map(([value, label]) => `<option value="${value}">${e(label)}</option>`).join('')}</select></label><label class="field full">Reason<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label><p class="full">Choose a closed session assigned to you. One request is kept per session, including its final decision. Contact an admin if further review is needed.</p><button class="primary-button" type="submit">Submit request</button></form>`}<p data-request-sync role="status">Loading requests…</p><div data-request-list></div>`;
    this.onSubmit = event => { event.preventDefault(); void this.submit(event); };
    this.onClick = event => { void this.click(event); };
    this.onFilter = () => this.render();
    this.onInput = event => { if (event.target.matches?.('[data-request-search]')) this.render(); };
    this.onChange = event => { if (event.target.matches?.('[data-request-section]')) this.render(); };
    this.root.addEventListener('submit', this.onSubmit);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('change', this.onChange);
    this.root.querySelector('[data-request-filter]')?.addEventListener('change', this.onFilter);
    const reference = this.admin ? collection(this.db, 'attendanceCorrectionRequests') : query(collection(this.db, 'attendanceCorrectionRequests'), where('studentUid', '==', this.user.uid));
    this.unsubscribe = onSnapshot(reference, { includeMetadataChanges: true }, snapshot => {
      if (!this.initialized || snapshot.metadata?.hasPendingWrites) return;
      this.available = true;
      this.requests = snapshot.docs.map(item => ({ ...item.data(), id: item.id })).sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
      this.root.querySelector('[data-request-sync]').textContent = snapshot.metadata?.fromCache ? 'Cached requests — reconnect to verify the latest decisions.' : 'Requests synced.';
      this.render();
    }, () => {
      if (!this.initialized) return;
      this.available = false;
      this.root.querySelector('[data-request-sync]').textContent = 'Requests unavailable. Publish the latest Firestore rules and reload, or check your connection.';
      this.root.querySelector('[data-request-list]').textContent = 'Could not verify requests.';
      this.updateBadge(0);
    });
    this.refreshEvents();
  }
  refreshEvents() {
    if (!this.initialized || this.admin) return;
    const select = this.root.querySelector('[data-request-event]'), previous = select.value, e = this.escapeHtml;
    const events = this.getEvents().filter(event => Date.now() > AttendanceViews.time(event, 'checkOutClosesAt') && EventAudiencePolicy.canAttend(this.getStudent(), event) && !this.requests.some(item => item.eventId === event.id));
    select.innerHTML = '<option value="">Choose an event/session…</option>' + events.map(event => `<option value="${e(event.id)}">${e(`${AttendanceViews.title(event)} — ${AttendanceViews.label(event)} · ${event.date}`)}</option>`).join('');
    if (events.some(event => event.id === previous)) select.value = previous;
  }
  updateBadge(count) {
    if (!this.badge) return;
    this.badge.hidden = count === 0; this.badge.textContent = count > 99 ? '99+' : String(count);
    this.badge.closest('button')?.setAttribute('aria-label', `Correction Requests${count ? `, ${count} pending` : ''}`);
  }
  render() {
    if (!this.initialized || !this.available) return;
    if (this.busy) { this.renderPending = true; return; }
    this.refreshFilters();
    for (const form of this.root.querySelectorAll?.('[data-decline-request]') || []) this.declineDrafts.set(form.dataset.declineRequest, form.elements.reason.value);
    const e = this.escapeHtml, filters = {
      status: this.root.querySelector('[data-request-filter]')?.value || 'all',
      search: this.root.querySelector('[data-request-search]')?.value || '',
      section: this.root.querySelector('[data-request-section]')?.value || ''
    };
    this.updateBadge(this.requests.filter(item => item.status === 'pending').length);
    this.root.querySelector('[data-request-list]').innerHTML = this.requests.filter(item => CorrectionRequestFilters.matches(item, this.getStudents().find(student => student.uid === item.studentUid), filters)).map(item => {
      const event = this.getEvents().find(event => event.id === item.eventId);
      const student = this.getStudents().find(student => student.uid === item.studentUid);
      const time = value => value?.toDate?.()?.toLocaleString() || 'Time unavailable';
      const person = student ? [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ') : item.studentUid;
      const year = CorrectionRequestFilters.year(student?.section);
      const decision = item.status !== 'pending' ? `<div class="correction-request-decision"><strong>Decision</strong><p class="correction-request-reason">${e(item.decisionReason)}</p><small>Reviewed by ${e(item.reviewedByName || 'Administrator')} · ${e(time(item.reviewedAt))}</small></div>` : this.admin
        ? `<aside class="correction-request-review"><button class="primary-button" type="button" data-review-request="${e(item.id)}">Review and correct</button><details class="correction-request-decline"><summary>Decline request</summary><form data-decline-request="${e(item.id)}" class="correction-decline-form"><label class="field">Required decline reason<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label><button class="outline-button" type="submit">Confirm decline</button></form></details></aside>`
        : '<p class="correction-request-waiting">Awaiting admin review. Your saved attendance is unchanged.</p>';
      return `<article class="community-service-record correction-request-card"><div class="community-service-record-top"><strong>${e(event ? `${AttendanceViews.title(event)} — ${AttendanceViews.label(event)} · ${event.date}` : `Event ${item.eventId}`)}</strong><span class="badge ${item.status === 'approved' ? 'green' : item.status === 'pending' ? 'blue' : 'orange'}">${e(item.status)}</span></div>${this.admin ? `<div class="correction-request-person"><strong>${e(person)}</strong><span>${e(student?.accountId || item.studentUid)} · ${e(student?.section ? `Section ${student.section}` : 'Section unavailable')}${year ? ` · Year ${e(year)}` : ''}</span></div>` : ''}<div class="correction-request-body${this.admin && item.status === 'pending' ? ' has-review' : ''}"><div class="correction-request-content"><strong>${e(CORRECTION_KINDS[item.kind] || item.kind)}</strong><p class="correction-request-reason">${e(item.reason)}</p><small>Submitted: ${e(time(item.submittedAt))}</small></div>${decision}</div></article>`;
    }).join('') || '<p>No matching correction requests.</p>';
    for (const form of this.root.querySelectorAll?.('[data-decline-request]') || []) form.elements.reason.value = this.declineDrafts.get(form.dataset.declineRequest) || '';
    this.refreshEvents();
  }
  refreshFilters() {
    if (!this.admin) return;
    const select = this.root.querySelector('[data-request-section]');
    if (!select) return;
    const sections = [...new Set(this.getStudents().map(student => student.section).filter(Boolean))].sort();
    if (select.value && !sections.includes(select.value)) sections.push(select.value);
    const signature = sections.join('|');
    if (signature === this.sectionSignature) return;
    this.sectionSignature = signature;
    const previous = select.value;
    select.innerHTML = '<option value="">All sections</option>' + sections.map(section => `<option value="${this.escapeHtml(section)}">Section ${this.escapeHtml(section)}</option>`).join('');
    select.value = previous;
  }
  async submit(event) {
    const form = event.target, button = form.querySelector('[type="submit"]');
    if (this.busy || !button) return;
    this.busy = true;
    this.loading.start('request-save', button, this.admin ? 'Saving decision…' : 'Submitting request…');
    try {
      if (form.matches('[data-request-form]')) {
        await this.service.create({ eventId: form.elements.eventId.value, kind: form.elements.kind.value, reason: form.elements.reason.value });
        if (this.initialized) form.reset();
        this.notify('Request submitted', 'Your attendance is unchanged until an administrator saves a verified correction.');
      } else if (form.dataset.declineRequest && this.admin) {
        await this.service.decline(form.dataset.declineRequest, form.elements.reason.value);
        this.notify('Request declined', 'The decision was saved. Attendance and fines are unchanged.');
      }
    } catch (error) { this.notify('Request not saved', error.message); }
    finally {
      this.busy = false; this.loading.reset('request-save');
      if (this.renderPending && this.initialized) { this.renderPending = false; this.render(); }
    }
  }
  async click(event) {
    if (event.target.closest('[data-clear-request-filters]')) {
      for (const selector of ['[data-request-search]', '[data-request-section]']) { const field = this.root.querySelector(selector); if (field) field.value = ''; }
      const status = this.root.querySelector('[data-request-filter]'); if (status) status.value = 'pending';
      this.render(); return;
    }
    const button = event.target.closest('[data-review-request]');
    if (!button || !this.admin || this.busy) return;
    const item = this.requests.find(item => item.id === button.dataset.reviewRequest);
    if (!item || item.status !== 'pending') return;
    this.busy = true; this.loading.start('request-review', button, 'Loading attendance…');
    try {
      const snapshot = await getDocFromServer(doc(this.db, 'attendance', `${item.studentUid}_${item.eventId}`));
      if (!this.initialized) return;
      this.onApprove({ ...(snapshot.exists() ? snapshot.data() : {}), studentUid: item.studentUid, eventId: item.eventId, correctionRequestId: item.id, correctionRequestReason: item.reason });
    } catch (error) { this.notify('Review unavailable', error.message); }
    finally { this.busy = false; this.loading.reset('request-review'); if (this.renderPending && this.initialized) { this.renderPending = false; this.render(); } }
  }
  dispose() {
    this.initialized = false; this.unsubscribe?.(); this.updateBadge(0);
    this.loading.dispose();
    this.root?.removeEventListener('submit', this.onSubmit); this.root?.removeEventListener('click', this.onClick);
    this.root?.removeEventListener('input', this.onInput); this.root?.removeEventListener('change', this.onChange);
    this.root?.querySelector('[data-request-filter]')?.removeEventListener('change', this.onFilter);
  }
}
