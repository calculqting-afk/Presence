export class DashboardToastController {
  constructor({
    document = globalThis.document,
    schedule = callback => setTimeout(callback, 4200),
    cancel = timer => clearTimeout(timer)
  } = {}) {
    Object.assign(this, {
      document,
      schedule,
      cancel
    });
    this.timer = null;
  }
  show(title, message, { attendanceSuccess = false } = {}) {
    this.dispose();
    const toast = this.document.querySelector('#dashboardToast');
    const mark = toast.querySelector('.toast-mark');
    if (mark && attendanceSuccess) {
      const asset = name => new URL(`../../emoji/${name}`, import.meta.url).href;
      mark.classList.add('is-attendance-success');
      mark.setAttribute('aria-hidden', 'true');
      mark.innerHTML = `<picture><source media="(prefers-reduced-motion: reduce)" srcset="${asset('presence-check-in.png')}"><source type="image/webp" srcset="${asset('presence-check-in-smooth.webp')}"><img src="${asset('presence-check-in-128.gif')}" alt="" width="64" height="64"></picture>`;
      this.mark = mark;
    }
    this.document.querySelector('#dashboardToastTitle').textContent = title;
    this.document.querySelector('#dashboardToastMessage').textContent = message;
    toast.classList.add('show');
    this.timer = this.schedule(() => {
      toast.classList.remove('show');
      this.clearMark();
      this.timer = null;
    });
  }
  dispose() {
    if (this.timer != null) this.cancel(this.timer);
    this.timer = null;
    this.clearMark();
  }
  clearMark() {
    if (!this.mark) return;
    this.mark.classList.remove('is-attendance-success');
    this.mark.textContent = '✓';
    this.mark = null;
  }
}

// Carries only a short-lived, fixed success message across a same-tab redirect.
export class SessionToastFeedback {
  static key = 'presence.authFeedback';
  static messages = {
    login: ['Logged in successfully', 'Welcome to Presence. Your account is ready.'],
    sessionEnded: ['Session ended', 'Your session moved to another device or requires a new sign-in.'],
    logout: ['Logged out successfully', 'You have been signed out of Presence.']
  };
  static save(storage, kind, uid = '', now = Date.now()) {
    if (!this.messages[kind]) return;
    try { storage?.setItem(this.key, JSON.stringify({ kind, uid, at: now })); } catch {}
  }
  static take(storage, kind, uid = '', now = Date.now()) {
    try {
      const raw = storage?.getItem(this.key);
      if (!raw) return null;
      storage.removeItem(this.key);
      const value = JSON.parse(raw);
      if (value.kind !== kind || value.uid !== uid || !Number.isFinite(value.at) || now < value.at || now - value.at > 60000) return null;
      return this.messages[kind] || null;
    } catch { return null; }
  }
}
