import { ControllerScope } from '../core/ControllerScope.js';
import { StudentIdentityController } from './StudentIdentityController.js';
import { waitForUser, verifyRole, auth, signOut, wireCommonNavigation, wireNotificationCenter, applyRoleNavigation, dashboardRole, currentUserProfile, currentUserRole, updateDashboardGreeting, sessionState, db, escapeHtml, openView, showDashboardToast, initializeDashboardHistory } from '../dashboard.js?v=20261011-optimized';
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
  }
  initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = this.start();
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
      if (currentUser) await signOut(auth);
      this.window.location.replace("../index.html");
      return;
    }
    if (dashboardRole === 'student') {
      this.identity.save(currentUser.uid, currentUserProfile);
      this.identity.render(currentUserProfile);
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
      metrics: this.metrics
    });
    this.dashboard = dashboard;
    sessionState.dashboard = this;
    this.scope.addCleanup(() => dashboard.dispose());
    dashboard.initialize();
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
    this.metrics.finish('startup');
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.scope.dispose();
    } finally {
      this.cleanupShared();
    }
  }
}
