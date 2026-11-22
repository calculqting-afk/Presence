// A classic script intentionally runs before styles paint; no Firebase dependency.
class ThemeController {
  constructor({ document: pageDocument = document, window: pageWindow = window,
    getStorage = () => localStorage } = {}) {
    this.document = pageDocument;
    this.window = pageWindow;
    this.getStorage = getStorage;
    // Retain the original key so existing login preferences carry to dashboards.
    this.storageKey = 'presence.loginTheme';
    this.root = this.document.documentElement;
    this.theme = 'light';
    this.initialized = false;
    this.button = null;
    this.onReady = this.bindToggle.bind(this);
    this.onToggle = this.toggleTheme.bind(this);
    this.onStorage = this.handleStorageChange.bind(this);
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.applyTheme(this.loadPreference());
    this.window.addEventListener('storage', this.onStorage);
    if (this.document.readyState === 'loading') {
      this.document.addEventListener('DOMContentLoaded', this.onReady, { once: true });
    } else {
      this.bindToggle();
    }
  }

  loadPreference() {
    try { return this.getStorage().getItem(this.storageKey); }
    catch { return 'light'; }
  }

  savePreference() {
    try { this.getStorage().setItem(this.storageKey, this.theme); }
    catch { /* Storage-blocked browsing still supports switching. */ }
  }

  bindToggle() {
    if (!this.initialized || this.button) return;
    this.button = this.document.querySelector('#themeToggle');
    this.applyTheme(this.theme);
    this.button?.addEventListener('click', this.onToggle);
  }

  applyTheme(value) {
    this.theme = value === 'dark' ? 'dark' : 'light';
    this.root.dataset.theme = this.theme;
    this.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', this.theme === 'dark' ? '#0b1426' : '#f5f9ff');
    if (!this.button) return;
    const nextTheme = this.theme === 'dark' ? 'light' : 'dark';
    const label = `Switch to ${nextTheme} mode`;
    this.button.setAttribute('aria-label', label);
    this.button.setAttribute('title', label);
    this.button.setAttribute('aria-pressed', String(this.theme === 'dark'));
    const text = this.document.querySelector('#themeToggleLabel');
    if (text) text.textContent = nextTheme === 'light' ? 'Light' : 'Dark';
  }

  toggleTheme() {
    if (!this.initialized) return;
    this.applyTheme(this.theme === 'dark' ? 'light' : 'dark');
    this.savePreference();
  }

  handleStorageChange(event) {
    if (!this.initialized || (event.key !== this.storageKey && event.key !== null)) return;
    // Ignore changes from unrelated storage areas, such as sessionStorage.
    try { if (event.storageArea && event.storageArea !== this.getStorage()) return; }
    catch { return; }
    this.applyTheme(event.newValue);
  }

  dispose() {
    this.document.removeEventListener('DOMContentLoaded', this.onReady);
    this.window.removeEventListener('storage', this.onStorage);
    this.button?.removeEventListener('click', this.onToggle);
    this.button = null;
    this.initialized = false;
  }
}
