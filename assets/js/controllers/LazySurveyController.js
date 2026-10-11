import { SurveyLinkService } from './SurveyLinkService.js';

// A small navigation bridge; survey implementation is downloaded on first use.
export class LazySurveyController {
  constructor({ document = globalThis.document, window = globalThis.window, load, openView, showToast }) {
    Object.assign(this, { document, window, load, openView, showToast });
    this.pendingEventId = new SurveyLinkService({ href: window.location.href }).eventId();
  }
  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.document.querySelector('.content').insertAdjacentHTML('beforeend', '<section class="view-section" data-section="surveys" hidden><div class="panel" role="status">Loading surveys…</div></section>');
    this.placeholder = this.document.querySelector('[data-section="surveys"]');
    this.onView = event => {
      this.visible = event.detail.viewName === 'surveys';
      if (this.visible && !this.controller) void this.ensureLoaded();
    };
    this.onClick = event => {
      const button = event.target.closest('[data-survey-event]');
      if (!button || this.controller) return;
      this.pendingEventId = button.dataset.surveyEvent;
      this.openView('surveys');
      if (this.visible) void this.ensureLoaded();
    };
    this.window.addEventListener('presence:viewchange', this.onView);
    this.document.addEventListener('click', this.onClick);
  }
  ensureLoaded() {
    if (this.loading) return this.loading;
    this.loading = Promise.resolve().then(() => this.load()).then(controller => {
      if (!this.initialized) { controller.dispose(); return; }
      this.placeholder.remove();
      this.controller = controller;
      controller.pendingEventId = this.pendingEventId;
      controller.initialize();
      controller.section.hidden = !this.visible;
      controller.onView({ detail: { viewName: this.visible ? 'surveys' : 'dashboard' } });
    }).catch(error => {
      if (this.initialized) {
        this.placeholder.textContent = 'Surveys could not load. Reopen this panel to retry.';
        this.showToast('Unable to load surveys', error.message);
      }
      this.loading = null;
    });
    return this.loading;
  }
  dispose() {
    this.initialized = false;
    this.window.removeEventListener('presence:viewchange', this.onView);
    this.document.removeEventListener('click', this.onClick);
    this.controller?.dispose();
    this.placeholder?.remove();
  }
}
