import { SurveyPolicy } from './SurveyPolicy.js';
import { SurveyLinkService } from './SurveyLinkService.js';
import { ButtonLoadingController } from './ButtonLoadingController.js';
import { SurveyResponseList } from './SurveyResponseList.js';
import { SurveyConfirmationController } from './SurveyConfirmationController.js?v=20261011-survey-archive';

export class SurveyController {
  constructor({ repository, locationService, profile, canManage, escapeHtml, openView, showToast, qr = () => globalThis.qrcode, document: ownerDocument = globalThis.document, window: ownerWindow = globalThis.window, policy = new SurveyPolicy(), deletionService }) {
    Object.assign(this, { repository, locationService, profile, canManage, escapeHtml, openView, showToast, qr, document: ownerDocument, window: ownerWindow, policy });
    this.links = new SurveyLinkService({ href: ownerWindow.location.href });
    this.events = []; this.rows = []; this.generation = 0; this.busy = false; this.initialized = false;
    this.pendingEventId = this.links.eventId();
    this.loading = new ButtonLoadingController({ document: ownerDocument });
    this.responseList = new SurveyResponseList();
    this.confirmation = new SurveyConfirmationController({ document: ownerDocument });
    this.deletionService = deletionService; this.archivePanel = false;
  }
  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.document.querySelector('.content').insertAdjacentHTML('beforeend', `<section class="view-section" data-section="surveys" hidden><div class="section-heading"><div><p class="eyebrow">EVENT SURVEYS</p><h2>${this.canManage ? 'Survey management' : 'My surveys'}</h2><p>${this.canManage ? 'Create surveys and review responses.' : 'Answer agendas and resume saved progress.'}</p></div></div><div class="survey-layout"><aside class="panel survey-picker"><div class="survey-picker-heading"><h3>Events</h3><button type="button" class="outline-button" data-survey-refresh>Refresh</button></div>${this.canManage ? '<div class="survey-panel-tabs"><button type="button" class="outline-button" data-survey-panel="active">Surveys</button><button type="button" class="outline-button" data-survey-panel="archive">Archive</button></div>' : ''}<div data-survey-list></div></aside><div class="panel survey-workspace" data-survey-workspace><p>Select an event survey.</p></div></div></section>`);
    this.section = this.document.querySelector('[data-section="surveys"]');
    this.workspace = this.section.querySelector('[data-survey-workspace]');
    this.onClick = event => this.handleClick(event);
    this.onSubmit = event => this.handleSubmit(event);
    this.onInput = event => { this.handleDraft(event); this.handleResponseFilter(event); };
    this.onView = event => {
      this.visible = event.detail.viewName === 'surveys';
      this.generation++;
      this.confirmation.finish(false);
      if (this.visible) this.refresh().catch(error => this.error(error));
    };
    this.document.addEventListener('click', this.onClick);
    this.section.addEventListener('submit', this.onSubmit);
    this.section.addEventListener('input', this.onInput);
    this.section.addEventListener('change', this.onInput);
    this.window.addEventListener('presence:viewchange', this.onView);
  }
  dispose() {
    this.generation++;
    this.document.removeEventListener('click', this.onClick);
    this.section?.removeEventListener('submit', this.onSubmit);
    this.section?.removeEventListener('input', this.onInput);
    this.section?.removeEventListener('change', this.onInput);
    this.window.removeEventListener('presence:viewchange', this.onView);
    this.section?.remove(); this.loading.dispose(); this.confirmation.dispose(); this.initialized = false;
  }
  error(error) { this.showToast(error.surveyIssue ? 'Location check unsuccessful' : 'Survey unavailable', error.code === 'permission-denied' ? 'Publish the latest survey Firestore Rules and verify your event access.' : error.message || 'Please retry.'); }
  async refresh() {
    const generation = ++this.generation;
    this.section.querySelector('[data-survey-list]').textContent = 'Loading events…';
    const recent = await this.repository.events();
    const archives = this.canManage ? await this.repository.archivedEvents() : [];
    const events = [...new Map([...recent, ...archives].map(event => [event.id, event])).values()];
    if (generation !== this.generation || !this.visible) return;
    this.events = events.filter(event => this.canManage || (event.hasSurvey && !event.surveyArchived && this.policy.eligible(this.profile(), event)));
    // Direct links can reference an event older than the bounded list.
    if (this.pendingEventId && !this.events.some(event => event.id === this.pendingEventId)) {
      const event = await this.repository.event(this.pendingEventId);
      if (generation !== this.generation || !this.visible) return;
      if (event && (this.canManage || (event.hasSurvey && !event.surveyArchived && this.policy.eligible(this.profile(), event)))) this.events.unshift(event);
    }
    this.renderList();
    const id = this.pendingEventId || this.selectedEvent?.id;
    if (this.pendingEventId && this.canManage) this.archivePanel = Boolean(this.events.find(event => event.id === this.pendingEventId)?.surveyArchived);
    this.renderList();
    this.pendingEventId = null;
    if (id) await this.select(id);
  }
  renderList() {
    const e = this.escapeHtml;
    const events = this.events.filter(event => !this.canManage || Boolean(event.surveyArchived) === this.archivePanel);
    this.section.querySelectorAll('[data-survey-panel]').forEach(button => button.setAttribute('aria-pressed', String((button.dataset.surveyPanel === 'archive') === this.archivePanel)));
    this.section.querySelector('[data-survey-list]').innerHTML = events.length ? events.map(event => `<button type="button" class="survey-event-option" aria-pressed="${this.selectedEvent?.id === event.id}" data-survey-select="${e(event.id)}"><strong>${e(event.name)}</strong><span>${e(event.date || '')} · ${event.hasSurvey ? (this.canManage ? 'Manage survey' : 'Open / resume') : 'Configure survey'}</span></button>`).join('') : '<p class="empty-state">No surveys in this panel.</p>';
  }
  async select(id) {
    const event = this.events.find(item => item.id === id);
    if (!event) { this.workspace.innerHTML = '<p>This event survey is unavailable or you are not an eligible participant.</p>'; return; }
    const generation = ++this.generation;
    this.selectedEvent = event; this.renderList(); this.workspace.textContent = 'Loading survey…';
    const result = await this.repository.load(id);
    if (generation !== this.generation || !this.visible) return;
    Object.assign(this, result); this.rows = []; this.cursor = null; this.responseList = new SurveyResponseList();
    if (!this.canManage && (this.config?.archived || this.config?.deleting)) { this.workspace.innerHTML = '<p>This survey has been archived and is no longer accepting responses.</p>'; return; }
    this.lastIssue = null;
    this.canManage ? await this.renderAdmin() : this.renderStudent();
  }
  formatTime(value, compact = false) {
    const time = this.policy.time(value);
    return Number.isFinite(time) ? new Date(time).toLocaleString(undefined, compact ? { dateStyle: 'medium', timeStyle: 'short' } : undefined) : 'Pending server confirmation';
  }
  localInput(value) {
    const date = new Date(this.policy.time(value));
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  questionEditor(question = { text: '', type: 'choice', choices: ['Yes', 'No'] }) {
    const e = this.escapeHtml;
    return `<fieldset class="survey-question-editor"><legend>Agenda question</legend><label>Question<input data-question-text maxlength="500" required value="${e(question.text)}"></label><label>Answer type<select data-question-type><option value="choice"${question.type === 'choice' ? ' selected' : ''}>Multiple choice</option><option value="text"${question.type === 'text' ? ' selected' : ''}>Short text</option></select></label><label>Choices (one per line; ignored for short text)<textarea data-question-choices maxlength="1300">${e(question.choices.join('\n'))}</textarea></label><button class="outline-button" type="button" data-remove-question>Remove question</button></fieldset>`;
  }
  instructionsMarkup() {
    const steps = this.canManage
      ? ['Select an event with an enabled attendance area.', 'Set the answering window and location mode; add 1–20 questions.', 'Publish, then share the QR link. Published questions and windows stay locked.', 'Refresh responses to review answers and location exceptions. Approval cannot extend the deadline.']
      : ['Choose an event, answer each agenda, then select Save and continue.', 'Allow precise location when prompted. Use the HTTPS site on a phone for venue testing.', 'Submitted answers save to your account. Return here or scan the same QR to resume; drafts stay on this browser.', 'If location fails, retry or request review. Approval cannot extend the deadline.'];
    return `<details class="survey-instructions"><summary>How it works</summary><ol>${steps.map(step => `<li>${step}</li>`).join('')}</ol><p>Location and submission times are recorded. No continuous tracking. Browser location is supporting evidence, not proof of presence. Surveys do not change attendance or fines.</p></details>`;
  }
  windowMarkup(config) {
    const e = this.escapeHtml;
    return `<dl class="survey-window"><div><dt>Opens</dt><dd>${e(this.formatTime(config.opensAt, true))}</dd></div><div><dt>Closes</dt><dd>${e(this.formatTime(config.closesAt, true))}</dd></div></dl>`;
  }
  async renderAdmin() {
    const e = this.escapeHtml;
    if (!this.config) {
      this.workspace.innerHTML = `<h3>${e(this.selectedEvent.name)}</h3>${this.instructionsMarkup()}<form data-survey-editor><div class="form-grid"><label class="field">Opens<input name="opensAt" type="datetime-local" required value="${this.localInput(this.selectedEvent.openAt)}"></label><label class="field">Closes<input name="closesAt" type="datetime-local" required value="${this.localInput(this.selectedEvent.checkOutClosesAt || this.selectedEvent.closeAt)}"></label><label class="field full">Location checks<select name="locationMode"><option value="start-only">First answer only</option><option value="start-finish">First and final answers</option></select></label></div><p class="survey-compact-note">Uses the event attendance area · Questions lock after publishing.</p><div data-survey-questions>${this.questionEditor()}</div><div class="form-actions"><button class="outline-button" type="button" data-add-question>Add agenda</button><button class="primary-button" type="submit">Publish survey</button></div></form>`;
      return;
    }
    this.workspace.innerHTML = `<h3>${e(this.selectedEvent.name)}</h3>${this.windowMarkup(this.config)}<p class="survey-meta">${this.config.locationMode === 'start-only' ? 'Location: first answer' : 'Location: first + final'} · ${this.config.deleting ? 'Deletion incomplete' : this.config.archived ? 'Archived' : this.config.enabled ? 'Enabled' : 'Paused'}</p>${this.instructionsMarkup()}<div class="survey-admin-tools">${!this.config.archived ? `<button class="outline-button" type="button" data-survey-toggle>${this.config.enabled ? 'Pause survey' : 'Reopen survey'}</button><button class="outline-button" type="button" data-survey-archive>Archive survey</button>` : `${!this.config.deleting ? '<button class="outline-button" type="button" data-survey-restore>Restore survey</button>' : ''}<button class="small-button danger" type="button" data-survey-delete>${this.config.deleting ? 'Resume deletion' : 'Delete permanently'}</button>`}<button class="outline-button" type="button" data-survey-qr>Show QR / link</button><button class="outline-button" type="button" data-survey-responses>Refresh responses</button></div><div data-survey-qr-panel hidden></div><details><summary>Published questions</summary><ol>${this.config.questions.map(question => `<li>${e(question.text)}</li>`).join('')}</ol></details><h4 class="survey-results-heading">Responses</h4>${this.responseToolbarMarkup()}<div data-survey-responses-list aria-live="polite"></div><button class="outline-button" type="button" data-survey-more hidden>Load more responses</button>`;
    await this.loadResponses(false);
  }
  async loadResponses(more) {
    const generation = this.generation;
    const result = await this.repository.responses(this.selectedEvent.id, more ? this.cursor : null);
    if (generation !== this.generation || !this.visible) return;
    this.rows = more ? [...this.rows, ...result.rows] : result.rows; this.cursor = result.cursor;
    this.moreResponses = result.more;
    this.renderResponses();
  }
  renderResponses() {
    const filtered = this.responseList.apply(this.rows, this.selectedEvent);
    const e = this.escapeHtml;
    this.workspace.querySelector('[data-survey-responses-list]').innerHTML = filtered.length ? filtered.map(row => `<article class="survey-response"><h4>${e(row.studentName || row.studentUid)}</h4><small>ID: ${e(row.studentId || row.studentUid)} · Section: ${e(this.responseList.section(row, this.selectedEvent))}</small><p>${e(row.status)} · ${row.answerCount}/${this.config.questions.length} saved · ${e(this.formatTime(row.updatedAt))}</p><p>Start: ${e(row.startEvidence?.result || 'Not recorded')} · Finish: ${e(row.finishEvidence?.result || 'Not recorded')}</p><details><summary>Answers and submission times</summary><ol>${this.config.questions.map(question => `<li><strong>${e(question.text)}</strong><p>${e(row.answers?.[question.id]?.value || 'Not answered')}</p><small>${row.answers?.[question.id] ? e(this.formatTime(row.answers[question.id].answeredAt)) : ''}</small></li>`).join('')}</ol></details>${row.reviewReason ? `<p>Review (${e(row.reviewStage)}): ${e(row.reviewReason)}</p><p>Issue: ${e(row.reviewIssue)} · ${e(row.reviewDecision || 'Pending')} ${e(row.reviewNote || '')}</p>` : ''}${row.status === 'needs-review' ? `<form data-survey-review="${e(row.studentUid)}"><label>Decision<select name="decision"><option value="approved">Approve location exception</option><option value="declined">Decline exception</option></select></label><label>Required reason<textarea name="note" maxlength="1000" required></textarea></label><button type="submit" class="primary-button">Record review</button></form>` : ''}</article>`).join('') : '<p class="empty-state">No matching loaded responses.</p>';
    this.workspace.querySelector('[data-survey-more]').hidden = !this.moreResponses;
    const section = this.workspace.querySelector('[data-response-filter="section"]');
    section.innerHTML = '<option value="all">All sections</option>' + this.responseList.sections(this.rows, this.selectedEvent).map(value => `<option value="${e(value)}">${e(value)}</option>`).join('');
    section.value = this.responseList.filters.section;
    for (const [key, value] of Object.entries(this.responseList.filters)) this.workspace.querySelector(`[data-response-filter="${key}"]`).value = value;
    this.workspace.querySelector('[data-response-count]').textContent = `${filtered.length} matches · ${this.rows.length} loaded${this.moreResponses ? ' · Load more to search older responses' : ''}`;
  }
  draftKey(question) { return `presence.surveyDraft.${this.repository.uid}.${this.selectedEvent.id}.${this.config.revision}.${question.id}`; }
  responseToolbarMarkup() {
    return `<div class="survey-response-toolbar"><label>Find student<input type="search" data-response-filter="search" placeholder="Name, Student ID or section"></label><label>Section<select data-response-filter="section"><option value="all">All sections</option></select></label><label>Status<select data-response-filter="status"><option value="all">All statuses</option><option value="completed">Completed</option><option value="in-progress">In progress</option><option value="needs-review">Needs review</option></select></label><label>Sort by<select data-response-filter="sort"><option value="newest">Latest response</option><option value="name">Student name A–Z</option><option value="id">Student ID</option><option value="section">Section, then name</option></select></label></div><p class="survey-compact-note" data-response-count role="status"></p>`;
  }
  handleResponseFilter(event) {
    const key = event.target.dataset?.responseFilter;
    if (!this.canManage || !Object.hasOwn(this.responseList.filters, key)) return;
    this.responseList.filters[key] = event.target.value;
    this.renderResponses();
  }
  async runAction(button, label, action) {
    if (this.busy) return;
    this.busy = true; this.loading.start('survey-action', button, label);
    try { await action(); } finally { this.loading.reset('survey-action'); this.busy = false; }
  }
  async toggleSurvey(button) {
    if (!this.canManage) throw new Error('Your role cannot manage surveys.');
    const generation = this.generation, id = this.selectedEvent.id, enabled = !this.config.enabled;
    if (!(await this.confirmation.open(enabled)) || generation !== this.generation || !this.visible) return;
    await this.runAction(button, enabled ? 'Reopening…' : 'Pausing…', async () => {
      await this.repository.setEnabled(id, enabled);
      this.showToast(enabled ? 'Survey reopened' : 'Survey paused', 'Saved responses are retained. The original answering window still applies.');
      if (generation === this.generation && this.visible) {
        this.config.enabled = enabled;
        await this.renderAdmin();
      }
    });
  }
  async manageArchive(button, action) {
    if (!this.canManage) throw new Error('Your role cannot manage surveys.');
    const generation = this.generation, id = this.selectedEvent.id, name = this.selectedEvent.name;
    const remove = action === 'delete', archive = action === 'archive';
    if (remove && !this.config.archived) throw new Error('Archive the survey before permanent deletion.');
    const options = remove
      ? { title: 'Permanently delete survey?', message: `Delete “${name}”, all submitted answers, saved progress and review history? This cannot be undone. Attendance and fines will not be changed.`, label: 'Delete permanently', countdown: 5 }
      : { title: archive ? 'Archive survey?' : 'Restore survey?', message: archive ? 'Hide this survey from students and stop submissions. Responses and review history will be retained.' : 'Return this survey to the active panel in a paused state. The original deadline stays unchanged.', label: archive ? 'Archive survey' : 'Restore survey' };
    if (!(await this.confirmation.open(false, options)) || generation !== this.generation || !this.visible) return;
    await this.runAction(button, remove ? 'Deleting…' : archive ? 'Archiving…' : 'Restoring…', async () => {
      if (remove) {
        try { await this.deletionService.remove(id, count => this.loading.update('survey-action', `Deleting… ${count} records`)); }
        catch (error) { throw new Error(`Deletion may be incomplete. Keep this survey archived and use Resume deletion after refreshing. ${error.message}`); }
      } else await this.repository.setArchived(id, archive);
      this.showToast(remove ? 'Survey permanently deleted' : archive ? 'Survey archived' : 'Survey restored', remove ? 'Survey answers and review history were removed. Attendance and fines were not changed.' : 'Responses are retained. Restored surveys remain paused.');
      if (generation !== this.generation || !this.visible) return;
      const event = this.events.find(item => item.id === id);
      event.surveyArchived = !remove && archive; if (remove) event.hasSurvey = false;
      this.selectedEvent = null; this.config = null; this.rows = [];
      this.workspace.innerHTML = '<p>Select a survey.</p>'; this.renderList();
    });
  }
  renderStudent() {
    const e = this.escapeHtml, config = this.config, attempt = this.attempt;
    if (!config) { this.workspace.innerHTML = '<p>The organizer has not published this survey.</p>'; return; }
    const question = this.policy.nextQuestion(config, attempt);
    let open = true; try { this.policy.assertOpen(config); } catch { open = false; }
    let draft = ''; if (question) { try { draft = this.window.localStorage.getItem(this.draftKey(question)) || ''; } catch {} }
    const stage = this.policy.locationStage(config, attempt);
    const pendingReview = attempt?.status === 'needs-review';
    this.workspace.innerHTML = `<h3>${e(this.selectedEvent.name)}</h3><p class="survey-meta">${attempt?.status === 'completed' ? 'Survey completed' : `Agenda ${(attempt?.answerCount || 0) + 1} of ${config.questions.length}`} · ${attempt?.answerCount || 0} answers saved</p>${this.windowMarkup(config)}<p class="survey-disclosure">Location: ${config.locationMode === 'start-only' ? 'first answer' : 'first + final answers'} · Submission times recorded.</p>${this.instructionsMarkup()}${attempt?.reviewReason ? `<p role="status">Review: ${e(attempt.reviewDecision || 'Pending')} · ${e(attempt.reviewNote || attempt.reviewReason)}</p>` : ''}${question && open ? `<form data-survey-answer><h4>${e(question.text)}</h4>${question.type === 'choice' ? `<fieldset class="survey-choices"><legend>Choose an answer</legend>${question.choices.map((choice, index) => `<label><input type="radio" name="answer" required value="${e(choice)}"${draft === choice ? ' checked' : ''}>${e(choice)}</label>`).join('')}</fieldset>` : `<label>Your answer<textarea name="answer" maxlength="1000" required>${e(draft)}</textarea></label>`}${stage ? `<p class="survey-compact-note">${this.policy.reviewApproved(attempt, stage) ? 'Location exception approved.' : 'Location will be checked when you save.'}</p>` : ''}<button class="primary-button" type="submit"${pendingReview ? ' disabled' : ''}>${(attempt?.answerCount || 0) === config.questions.length - 1 ? 'Submit final answer' : 'Save and continue'}</button></form>` : `<p class="empty-state">${question ? 'Survey is paused, not open yet, or closed. Saved answers are retained.' : 'All submitted answers are saved. Thank you.'}</p>`}<div class="survey-student-tools"><button class="outline-button" type="button" data-survey-reload>Refresh progress</button></div>${question && !pendingReview ? `<details><summary>Need help?</summary><form data-survey-request-review><label>Reason<textarea name="reason" maxlength="1000" required placeholder="No phone, poor GPS, connection problem, or another issue"></textarea></label><button type="submit" class="outline-button">Request review</button></form></details>` : ''}<details><summary>View submitted answers</summary><ol>${config.questions.filter(item => attempt?.answers?.[item.id]).map(item => `<li><strong>${e(item.text)}</strong><p>${e(attempt.answers[item.id].value)}</p><small>${e(this.formatTime(attempt.answers[item.id].answeredAt))}</small></li>`).join('')}</ol></details><p data-survey-message role="status" hidden></p>`;
  }
  handleDraft(event) {
    if (!event.target.closest('[data-survey-answer]') || !this.config) return;
    const question = this.policy.nextQuestion(this.config, this.attempt);
    try { this.window.localStorage.setItem(this.draftKey(question), event.target.value); } catch {}
  }
  async showQR() {
    const panel = this.workspace.querySelector('[data-survey-qr-panel]'), url = this.links.url(this.selectedEvent.id);
    panel.hidden = false; panel.innerHTML = `<label>Survey link<input readonly value="${this.escapeHtml(url)}"></label><div data-survey-code></div><button type="button" class="outline-button" data-copy-survey-link>Copy link</button>`;
    try {
      const factory = this.qr();
      if (typeof factory !== 'function') throw new Error('QR library unavailable. Use the link above.');
      const code = factory(0, 'M'); code.addData(url); code.make();
      panel.querySelector('[data-survey-code]').innerHTML = code.createSvgTag({ scalable: true, margin: 4 });
      panel.querySelector('svg')?.setAttribute('aria-label', 'Scan to open this event survey');
      panel.querySelector('svg')?.setAttribute('role', 'img');
    } catch (error) { this.error(error); }
  }
  async handleClick(event) {
    const target = event.target.closest('[data-survey-event], [data-survey-select], [data-survey-refresh], [data-survey-reload], [data-add-question], [data-remove-question], [data-survey-toggle], [data-survey-qr], [data-copy-survey-link], [data-survey-responses], [data-survey-more], [data-survey-panel], [data-survey-archive], [data-survey-restore], [data-survey-delete]');
    if (!target || this.busy) return;
    try {
      if (target.hasAttribute('data-survey-event')) { this.pendingEventId = target.dataset.surveyEvent; if (this.visible) await this.refresh(); else this.openView('surveys'); }
      else if (target.hasAttribute('data-survey-select')) await this.select(target.dataset.surveySelect);
      else if (target.hasAttribute('data-survey-refresh')) await this.runAction(target, 'Refreshing…', () => this.refresh());
      else if (target.hasAttribute('data-survey-reload')) await this.runAction(target, 'Refreshing…', () => this.select(this.selectedEvent.id));
      else if (target.hasAttribute('data-add-question')) { if (this.workspace.querySelectorAll('.survey-question-editor').length >= 20) throw new Error('Maximum 20 agendas per survey.'); this.workspace.querySelector('[data-survey-questions]').insertAdjacentHTML('beforeend', this.questionEditor()); }
      else if (target.hasAttribute('data-remove-question')) target.closest('fieldset').remove();
      else if (target.hasAttribute('data-survey-panel')) {
        this.archivePanel = target.dataset.surveyPanel === 'archive'; this.generation++; this.selectedEvent = null; this.config = null;
        this.workspace.innerHTML = '<p>Select a survey.</p>'; this.renderList();
      }
      else if (target.hasAttribute('data-survey-archive')) await this.manageArchive(target, 'archive');
      else if (target.hasAttribute('data-survey-restore')) await this.manageArchive(target, 'restore');
      else if (target.hasAttribute('data-survey-delete')) await this.manageArchive(target, 'delete');
      else if (target.hasAttribute('data-survey-toggle')) await this.toggleSurvey(target);
      else if (target.hasAttribute('data-survey-qr')) await this.runAction(target, 'Generating…', () => this.showQR());
      else if (target.hasAttribute('data-copy-survey-link')) await this.runAction(target, 'Copying…', async () => { await this.window.navigator.clipboard.writeText(this.links.url(this.selectedEvent.id)); this.showToast('Survey link copied', 'Share only with event participants.'); });
      else if (target.hasAttribute('data-survey-responses')) await this.runAction(target, 'Refreshing…', () => this.loadResponses(false));
      else if (target.hasAttribute('data-survey-more')) await this.runAction(target, 'Loading…', () => this.loadResponses(true));
    } catch (error) { this.error(error); }
  }
  async handleSubmit(event) {
    const form = event.target;
    if (!form.matches('[data-survey-editor], [data-survey-answer], [data-survey-request-review], [data-survey-review]')) return;
    event.preventDefault(); if (this.busy) return;
    const button = form.querySelector('button[type="submit"]'), eventId = this.selectedEvent.id, generation = this.generation;
    this.busy = true; this.loading.start('survey', button, 'Saving…');
    let mutationAccepted = false;
    try {
      if (form.matches('[data-survey-editor]')) {
        if (!this.canManage) throw new Error('Your role cannot publish surveys.');
        const boundary = await this.repository.boundary(eventId);
        if (!boundary?.enabled) throw new Error('Configure and enable this event’s attendance area before publishing a survey.');
        const questions = [...form.querySelectorAll('.survey-question-editor')].map((editor, index) => ({ id: `q${index}`, text: editor.querySelector('[data-question-text]').value.trim(), type: editor.querySelector('[data-question-type]').value,
          choices: editor.querySelector('[data-question-type]').value === 'choice' ? editor.querySelector('[data-question-choices]').value.split('\n').map(value => value.trim()).filter(Boolean) : [] }));
        await this.repository.saveConfig(eventId, { enabled: true, locationMode: form.elements.locationMode.value, opensAt: new Date(form.elements.opensAt.value), closesAt: new Date(form.elements.closesAt.value), questions });
        mutationAccepted = true;
        this.selectedEvent.hasSurvey = true; this.renderList();
        this.showToast('Survey published', 'Generate its QR link or let students open Surveys. Publish the updated Firestore Rules before testing.');
      } else if (form.matches('[data-survey-answer]')) {
        this.policy.assertOpen(this.config);
        const question = this.policy.nextQuestion(this.config, this.attempt), value = this.policy.validateAnswer(question, form.elements.answer.value);
        const stage = this.policy.locationStage(this.config, this.attempt);
        let evidence;
        if (stage && !this.policy.reviewApproved(this.attempt, stage)) {
          this.loading.update('survey', 'Checking location…');
          evidence = await this.locationService.check(eventId, {
            isCancelled: () => generation !== this.generation || !this.visible,
            onProgress: label => { if (generation === this.generation && this.visible) this.loading.update('survey', label); }
          });
        }
        if (generation !== this.generation || !this.visible) throw new Error('Survey view changed. No answer was submitted; reopen it to continue.');
        this.loading.update('survey', 'Saving answer…');
        await this.repository.submit(eventId, this.config, question, value, evidence);
        mutationAccepted = true;
        try { this.window.localStorage.removeItem(this.draftKey(question)); } catch {}
        this.showToast('Answer saved', 'Your submitted progress can be resumed on another device.');
      } else if (form.matches('[data-survey-request-review]')) {
        await this.repository.requestReview(eventId, form.elements.reason.value, this.lastIssue || 'unavailable');
        mutationAccepted = true;
        this.showToast('Review requested', 'An organizer can review your exception. No absence or fine was created.');
      } else {
        if (!this.canManage) throw new Error('Your role cannot review surveys.');
        await this.repository.review(eventId, form.dataset.surveyReview, form.elements.decision.value, form.elements.note.value);
        mutationAccepted = true;
        this.showToast('Review recorded', 'The decision and reason are saved with your identity and server time.');
      }
      if (generation === this.generation && this.visible) {
        const result = await this.repository.load(eventId); Object.assign(this, result);
        this.canManage ? await this.renderAdmin() : this.renderStudent();
      }
    } catch (error) {
      this.lastIssue = error.surveyIssue;
      if (mutationAccepted) {
        this.loading.finish('survey', 'Saved · refresh');
        this.showToast('Saved — refresh progress', 'The change was accepted, but saved progress could not be reloaded. Refresh instead of submitting again.');
      } else this.error(error);
      if (error.surveyIssue) { const message = this.workspace.querySelector('[data-survey-message]'); if (message) { message.hidden = false; message.textContent = error.message; } }
    } finally { this.loading.reset('survey'); this.busy = false; }
  }
}
