// Classic script: runs before first paint and never waits for Firebase or fonts.
class LaunchIntroController {
  constructor({ document: pageDocument = document, window: pageWindow = window,
    getStorage = () => sessionStorage } = {}) {
    this.document = pageDocument;
    this.window = pageWindow;
    this.getStorage = getStorage;
    this.storageKey = 'presence.launchIntro.seen';
    this.finish = this.finish.bind(this);
    this.onMotionChange = event => { if (event.matches) this.finish(); };
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.motion = this.window.matchMedia('(prefers-reduced-motion: reduce)');
      const storage = this.getStorage();
      if (storage.getItem(this.storageKey)) return;
      storage.setItem(this.storageKey, '1');
      // QR/deep links should continue directly into their existing login flow.
      if (this.motion.matches || new URLSearchParams(this.window.location.search).has('survey')) return;
    } catch {
      // Fail open when storage or browser APIs are unavailable.
      return;
    }
    this.document.documentElement.setAttribute('data-launch-intro', '');
    this.window.addEventListener('pagehide', this.finish, { once: true });
    this.window.addEventListener('keydown', this.finish, { once: true });
    this.window.addEventListener('pointerdown', this.finish, { once: true });
    this.motion.addEventListener?.('change', this.onMotionChange);
    // The deadline includes page loading, not an extra delay after login is ready.
    this.timer = this.window.setTimeout(this.finish, 4000);
  }

  finish() {
    this.window.clearTimeout(this.timer);
    this.document.documentElement.removeAttribute('data-launch-intro');
    this.window.removeEventListener('pagehide', this.finish);
    this.window.removeEventListener('keydown', this.finish);
    this.window.removeEventListener('pointerdown', this.finish);
    this.motion?.removeEventListener?.('change', this.onMotionChange);
  }

  dispose() { this.finish(); }
}

if (typeof window !== 'undefined') window.PresenceLaunchIntroController = LaunchIntroController;
