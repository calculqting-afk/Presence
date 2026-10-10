import { SurveyLinkService } from './SurveyLinkService.js';

// Only survey deep links auto-resume an existing authenticated session.
export class SurveyEntryController {
  constructor({ auth, subscribe, resolveRole, window: ownerWindow = globalThis.window, isLoginBusy = () => false }) {
    Object.assign(this, { auth, subscribe, resolveRole, window: ownerWindow, isLoginBusy });
    this.links = new SurveyLinkService({ href: ownerWindow.location.href });
    this.generation = 0;
  }
  initialize() {
    if (this.unsubscribe || !this.links.eventId()) return;
    this.unsubscribe = this.subscribe(this.auth, user => this.resume(user).catch(() => {}));
  }
  async resume(user) {
    const generation = ++this.generation;
    if (!user || this.isLoginBusy()) return;
    const role = await this.resolveRole(user);
    if (generation !== this.generation || !role || this.isLoginBusy()) return;
    const page = role === 'admin' ? 'admin-dashboard.html' : 'student-dashboard.html';
    this.window.location.replace(`pages/${page}?survey=${encodeURIComponent(this.links.eventId())}`);
  }
  dispose() { this.generation++; this.unsubscribe?.(); this.unsubscribe = null; }
}
