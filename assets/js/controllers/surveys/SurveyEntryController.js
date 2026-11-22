import { SurveyLinkService } from './SurveyLinkService.js';

// Resume Firebase-authenticated sessions on login, preserving optional survey links.
export class SurveyEntryController {
  constructor({ auth, subscribe, resolveRole, window: ownerWindow = globalThis.window, isLoginBusy = () => false }) {
    Object.assign(this, { auth, subscribe, resolveRole, window: ownerWindow, isLoginBusy });
    this.links = new SurveyLinkService({ href: ownerWindow.location.href });
    this.generation = 0;
  }
  initialize() {
    if (this.disposed || this.initialized) return;
    this.initialized = true;
    this.unsubscribe = this.subscribe(this.auth, user => this.resume(user).catch(() => {}));
  }
  async resume(user) {
    const generation = ++this.generation;
    if (!user || this.disposed || this.redirected || this.isLoginBusy()) return;
    const role = await this.resolveRole(user);
    if (generation !== this.generation || this.disposed || this.redirected || !['admin','student'].includes(role) || this.isLoginBusy()) return;
    const page = role === 'admin' ? 'admin-dashboard.html' : 'student-dashboard.html';
    const surveyId = this.links.eventId();
    this.redirected = true;
    this.window.location.replace(`pages/${page}${surveyId ? `?survey=${encodeURIComponent(surveyId)}` : ''}`);
  }
  dispose() { this.disposed = true; this.generation++; this.unsubscribe?.(); this.unsubscribe = null; }
}
