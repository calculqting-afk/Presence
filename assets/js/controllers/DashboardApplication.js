import { endPresenceSession } from '../core/PresenceSession.js';
import { ControllerScope } from '../core/ControllerScope.js';
import { PolicyAgreementController } from './PolicyAgreementController.js';
import { PolicyAgreementPolicy as Policy } from '../core/PolicyAgreementPolicy.js';
import { getDocFromServer } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { StudentIdentityController } from './StudentIdentityController.js';
import { waitForUser, verifyRole, auth, signOut, wireCommonNavigation, wireNotificationCenter, applyRoleNavigation, dashboardRole, currentUserProfile, currentUserRole, updateDashboardGreeting, sessionState, db, setDoc, doc, serverTimestamp, escapeHtml, openView, showDashboardToast, initializeDashboardHistory } from '../dashboard.js?v=20261011-optimized';
import { hasPermission } from '../core/permissions.js?v=20261011-optimized';
import { LazySurveyController } from './LazySurveyController.js';
import { DashboardPerformanceController } from './DashboardPerformanceController.js';
export class DashboardApplication {
  constructor({
    document = globalThis.document,
    window = globalThis.window,
    loadDashboard = role => role === 'student' ? import('../student/StudentDashboard.js?v=20261011-optimized') : import('../admin/AdminDashboard.js?v=20261011-optimized'),
    cleanupShared = () => {}
  } = {}) {
    Object.assign(this, {
      document,
      window,
      loadDashboard,
      cleanupShared
    });
    this.scope = new ControllerScope();
    this.identity = new StudentIdentityController({ document });
    this.metrics = new DashboardPerformanceController({ role: dashboardRole, performance: window.performance });
    this.loading = new DashboardLoadingController({ document, window });
  }
  initialize() {
    if (this.initialization) return this.initialization;
    this.loading.start();
    this.initialization = this.start().catch(error => {
      this.loading.fail();
      throw error;
    });
    return this.initialization;
  }
  async start() {
    if (!this.scope.initialize()) return;
    this.metrics.start('startup'); this.metrics.start('profile'); this.metrics.start('events-first-data');
    const isCurrent = () => this.scope.initialized;
    // Download code while authentication/profile verification is in flight.
    // Capture failures now; only surface them after access has been verified.
    const dashboardModule = Promise.resolve().then(() => this.loadDashboard(dashboardRole))
      .then(module => ({ module }), error => ({ error }));
    const currentUser = await waitForUser();
    if (!isCurrent()) return;
    if (currentUser && dashboardRole === 'student') this.identity.restore(currentUser.uid);
    const authorized = currentUser && (await verifyRole(currentUser));
    if (!isCurrent()) return;
    if (!authorized) {
      this.identity.clear();
      if (currentUser) {
        await endPresenceSession({ user: currentUser, state: sessionState, window: this.window,
          storage: this.window.sessionStorage,
          write: (collectionName, id, fields) => setDoc(doc(db, collectionName, id), {
            ...fields, online: false, status: 'logged-out', lastSeen: serverTimestamp(), offlineAt: serverTimestamp()
          }, { merge: true }) });
        await signOut(auth);
      }
      this.window.location.replace("../index.html");
      return;
    }
    if (dashboardRole === 'student') {
      this.identity.save(currentUser.uid, currentUserProfile);
      this.identity.render(currentUserProfile);
    }
    if (this.document.body.hasAttribute?.('data-policy-enabled')) {
      const reference = doc(db, ...Policy.path(currentUser.uid));
      this.agreement = new PolicyAgreementController({ document: this.document, window: this.window, uid: currentUser.uid,
        read: async () => { const snapshot = await getDocFromServer(reference); return snapshot.exists() ? snapshot.data() : null; },
        save: () => setDoc(reference, Policy.receipt(currentUser.uid, serverTimestamp())),
        signOut: async () => {
          this.identity.clear();
          await endPresenceSession({ user: currentUser, state: sessionState, window: this.window, storage: this.window.sessionStorage,
            write: (collectionName, id, fields) => setDoc(doc(db, collectionName, id), { ...fields, online: false, status: 'logged-out', lastSeen: serverTimestamp(), offlineAt: serverTimestamp() }, { merge: true }) });
          await signOut(auth);
          this.window.location.replace('../index.html');
        }
      });
      this.scope.addCleanup(() => this.agreement.dispose());
      if (!await this.agreement.require() || !isCurrent()) return;
    }
    wireCommonNavigation();
    wireNotificationCenter();
    applyRoleNavigation();
    const displayName = dashboardRole === "admin" ? [currentUserProfile.firstName, currentUserProfile.lastName].filter(Boolean).join(" ") || "Admin" : currentUserProfile.firstName || "Student";
    updateDashboardGreeting(displayName);
    this.metrics.finish('profile');
    const result = await dashboardModule;
    if (!isCurrent()) return;
    if (result.error) throw result.error;
    const module = result.module;
    const Dashboard = dashboardRole === "student" ? module.StudentDashboard : module.AdminDashboard;
    const dashboard = new Dashboard({
      document: this.document,
      window: this.window,
      metrics: this.metrics,
      loading: this.loading
    });
    this.dashboard = dashboard;
    sessionState.dashboard = this;
    this.scope.addCleanup(() => dashboard.dispose());
    dashboard.initialize();
    this.pullRefresh = new DashboardPullRefreshController({ document: this.document, window: this.window });
    this.pullRefresh.initialize();
    this.scope.addCleanup(() => this.pullRefresh.dispose());
    if (currentUserRole === 'student' || hasPermission(currentUserRole, 'manageSurveys')) {
      const surveys = new LazySurveyController({ document: this.document, window: this.window, openView, showToast: showDashboardToast,
        load: async () => {
          this.metrics.start('survey-module');
          const { createSurveyFeature } = await import('./SurveyFeature.js?v=20261011-optimized');
          this.metrics.finish('survey-module');
          return createSurveyFeature({ db, uid: currentUser.uid, profile: () => currentUserProfile,
            document: this.document, window: this.window, canManage: hasPermission(currentUserRole, 'manageSurveys'),
            escapeHtml, openView, showToast: showDashboardToast });
        }
      });
      surveys.initialize();
      this.scope.addCleanup(() => surveys.dispose());
      if (surveys.pendingEventId) {
        initializeDashboardHistory();
        this.loading.completeStartup(dashboard);
        this.metrics.finish('startup');
        openView('surveys');
        this.scope.listen(this.window, 'beforeunload', () => this.dispose(), {
          once: true
        });
        return;
      }
    }
    this.scope.listen(this.window, 'beforeunload', () => this.dispose(), {
      once: true
    });
    initializeDashboardHistory();
    this.loading.completeStartup(dashboard);
    this.metrics.finish('startup');
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loading.dispose();
    try {
      this.scope.dispose();
    } finally {
      this.cleanupShared();
    }
  }
}

// Shared Android gesture; normal scrolling and interactive controls keep their own gestures.
export class DashboardPullRefreshController {
  constructor({ document, window }) {
    Object.assign(this, { document, window });
    this.scope = new ControllerScope();
    this.dirtyForms = new Set();
  }

  initialize() {
    if (!/Android/i.test(this.window.navigator?.userAgent || '') && !this.window.PresenceNative?.isNative) return;
    if (!this.scope.initialize()) return;
    this.indicator = this.document.createElement('div');
    this.indicator.className = 'dashboard-pull-refresh';
    this.indicator.setAttribute('role', 'status');
    this.indicator.setAttribute('aria-live', 'polite');
    this.indicator.hidden = true;
    this.document.body.append(this.indicator);
    this.document.documentElement.classList.add('android-pull-refresh');
    this.scope.listen(this.document, 'input', event => {
      const form = event.target.closest?.('form');
      if (form && event.target.type !== 'search' && !/filter/i.test(`${form.id} ${form.className}`)) this.dirtyForms.add(form);
    });
    this.scope.listen(this.document, 'reset', event => this.dirtyForms.delete(event.target));
    this.scope.listen(this.document, 'touchstart', event => this.start(event), { passive: true });
    this.scope.listen(this.document, 'touchmove', event => this.move(event), { passive: false });
    this.scope.listen(this.document, 'touchend', () => this.release(), { passive: true });
    this.scope.listen(this.document, 'touchcancel', () => this.reset(), { passive: true });
  }

  blocked() {
    return this.refreshing || this.document.body.hasAttribute('data-dashboard-loading') ||
      [...this.document.querySelectorAll('[role="dialog"], dialog[open]')].some(node => node.getClientRects().length && this.window.getComputedStyle(node).visibility !== 'hidden') ||
      [...this.document.querySelectorAll('video')].some(video => video.srcObject) ||
      [...this.dirtyForms].some(form => form.isConnected && form.getClientRects().length);
  }

  start(event) {
    this.reset();
    if (event.touches.length !== 1 || this.blocked()) return;
    const target = event.target;
    if (target.closest?.('input, textarea, select, button, a, form, [contenteditable], video, canvas, .sidebar, .leaflet-container')) return;
    const scroll = this.document.scrollingElement || this.document.documentElement;
    if (scroll.scrollTop > 0) return;
    // A list, modal, or other nested scrolling area must never refresh the whole screen.
    for (let node = target; node && node !== this.document.body; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(this.window.getComputedStyle(node).overflowY)) return;
    }
    this.origin = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }

  move(event) {
    if (!this.origin || this.refreshing) return;
    if (event.touches.length !== 1 || this.blocked()) { this.reset(); return; }
    const dy = event.touches[0].clientY - this.origin.y;
    const dx = Math.abs(event.touches[0].clientX - this.origin.x);
    if (dy < 0 || dx > 24 && dx > dy) { this.reset(); return; }
    if (dy < 12) return;
    if (!event.cancelable) { this.reset(); return; }
    event.preventDefault();
    this.distance = Math.min(100, dy * .5);
    this.indicator.hidden = false;
    this.indicator.style.setProperty('--pull-distance', `${this.distance}px`);
    const ready = this.distance >= 72;
    this.indicator.classList.toggle('is-ready', ready);
    const label = ready ? 'Release to refresh' : 'Pull down to refresh';
    if (this.indicator.textContent !== label) this.indicator.textContent = label;
  }

  release() {
    if (!this.origin || this.refreshing) return;
    if (this.distance < 72 || this.blocked()) { this.reset(); return; }
    if (this.window.navigator?.onLine === false) {
      this.reset();
      showDashboardToast('You are offline', 'Reconnect to the internet, then pull down to refresh.');
      return;
    }
    this.refreshing = true;
    this.origin = null;
    this.indicator.textContent = 'Refreshing…';
    this.indicator.classList.add('is-refreshing');
    // Keep the current URL/history view; the normal startup flow reconciles fresh data.
    this.frame = this.window.requestAnimationFrame(() => {
      this.frame = this.window.requestAnimationFrame(() => this.window.location.reload());
    });
  }

  reset() {
    this.origin = null;
    this.distance = 0;
    if (!this.indicator || this.refreshing) return;
    this.indicator.hidden = true;
    this.indicator.classList.remove('is-ready');
  }

  dispose() {
    this.scope.dispose();
    this.window.cancelAnimationFrame(this.frame);
    this.indicator?.remove();
    this.document.documentElement?.classList.remove('android-pull-refresh');
    this.dirtyForms.clear();
  }
}

// Initial-page loading only. Later snapshots never replace visible dashboard data.
export class DashboardLoadingController {
  constructor({ document, window }) {
    this.document = document;
    this.window = window;
    this.enabled = document.body?.hasAttribute?.('data-dashboard-loading') === true;
    this.settledSources = new Set();
    this.finished = false;
    this.disposed = false;
  }

  start() {
    if (!this.enabled || this.timer) return;
    this.status = this.document.querySelector('[data-dashboard-loading-message]');
    this.retry = this.document.querySelector('[data-dashboard-loading-retry]');
    this.retryHandler = () => this.window.location.reload();
    this.retry?.addEventListener('click', this.retryHandler);
    this.timer = this.window.setTimeout(() => {
      if (this.finished || this.disposed) return;
      this.status.textContent = 'Still connecting. Check your internet connection or try again.';
      this.retry.hidden = false;
    }, 12000);
  }

  settle(source) {
    if (!this.enabled || this.finished || this.disposed) return;
    this.settledSources.add(source);
    this.finishWhenReady();
  }

  completeStartup(dashboard) {
    if (!this.enabled || this.finished || this.disposed) return;
    const primarySources = new Set(['profile', 'students', 'events', 'attendance']);
    this.expectedSources = [...(dashboard.subscriptions?.entries || [])]
      .filter(([key, entry]) => primarySources.has(key) && entry.unsubscribe)
      .map(([key]) => key);
    this.finishWhenReady();
  }

  finishWhenReady() {
    if (!this.expectedSources || this.expectedSources.some(key => !this.settledSources.has(key))) return;
    if (this.finished || this.disposed) return;
    this.finished = true;
    this.window.clearTimeout(this.timer);
    // Let scheduled card/row rendering finish before revealing the dashboard.
    this.frame = this.window.requestAnimationFrame(() => {
      this.frame = this.window.requestAnimationFrame(() => {
        if (this.disposed) return;
        this.document.body.removeAttribute('data-dashboard-loading');
        this.document.body.classList.add('dashboard-content-ready');
        this.document.querySelector('.content')?.removeAttribute('aria-busy');
        this.retry?.removeEventListener('click', this.retryHandler);
      });
    });
  }

  fail() {
    if (!this.enabled || this.disposed) return;
    this.window.clearTimeout(this.timer);
    this.document.querySelector('.dashboard-loading')?.classList.add('has-error');
    if (this.status) this.status.textContent = 'Unable to load Presence. Check your connection and try again.';
    if (this.retry) this.retry.hidden = false;
  }

  dispose() {
    this.disposed = true;
    this.window.clearTimeout(this.timer);
    this.window.cancelAnimationFrame(this.frame);
    this.retry?.removeEventListener('click', this.retryHandler);
  }
}
