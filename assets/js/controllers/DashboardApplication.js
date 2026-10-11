import { ControllerScope } from '../core/ControllerScope.js';
import { waitForUser, verifyRole, auth, signOut, wireCommonNavigation, wireNotificationCenter, applyRoleNavigation, dashboardRole, currentUserProfile, currentUserRole, updateDashboardGreeting, sessionState, db, escapeHtml, openView, showDashboardToast, initializeDashboardHistory } from '../dashboard.js?v=20261011-student-startup';
import { hasPermission } from '../core/permissions.js?v=20261011-student-startup';
import { SurveyController } from './SurveyController.js?v=20261011-student-startup';
import { SurveyRepository } from './SurveyRepository.js?v=20261011-survey-archive';
import { SurveyDeletionService } from './SurveyDeletionService.js';
import { SurveyLocationService } from './SurveyLocationService.js?v=20261010-location-retry';
export class DashboardApplication {
  constructor({
    document = globalThis.document,
    window = globalThis.window,
    loadDashboard = role => role === 'student' ? import('../student/StudentDashboard.js?v=20261011-student-startup') : import('../admin/AdminDashboard.js?v=20261011-student-startup'),
    cleanupShared = () => {}
  } = {}) {
    Object.assign(this, {
      document,
      window,
      loadDashboard,
      cleanupShared
    });
    this.scope = new ControllerScope();
  }
  initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = this.start();
    return this.initialization;
  }
  async start() {
    if (!this.scope.initialize()) return;
    const isCurrent = () => this.scope.initialized;
    // Download code while authentication/profile verification is in flight.
    // Capture failures now; only surface them after access has been verified.
    const dashboardModule = Promise.resolve().then(() => this.loadDashboard(dashboardRole))
      .then(module => ({ module }), error => ({ error }));
    const currentUser = await waitForUser();
    if (!isCurrent()) return;
    const authorized = currentUser && (await verifyRole(currentUser));
    if (!isCurrent()) return;
    if (!authorized) {
      if (currentUser) await signOut(auth);
      this.window.location.replace("../index.html");
      return;
    }
    wireCommonNavigation();
    wireNotificationCenter();
    applyRoleNavigation();
    const displayName = dashboardRole === "admin" ? [currentUserProfile.firstName, currentUserProfile.lastName].filter(Boolean).join(" ") || "Admin" : currentUserProfile.firstName || "Student";
    updateDashboardGreeting(displayName);
    const result = await dashboardModule;
    if (!isCurrent()) return;
    if (result.error) throw result.error;
    const module = result.module;
    const Dashboard = dashboardRole === "student" ? module.StudentDashboard : module.AdminDashboard;
    const dashboard = new Dashboard({
      document: this.document,
      window: this.window
    });
    this.dashboard = dashboard;
    sessionState.dashboard = this;
    this.scope.addCleanup(() => dashboard.dispose());
    dashboard.initialize();
    if (currentUserRole === 'student' || hasPermission(currentUserRole, 'manageSurveys')) {
      const repository = new SurveyRepository({
        db,
        uid: currentUser.uid,
        profile: () => currentUserProfile
      });
      const surveys = new SurveyController({
        repository,
        locationService: new SurveyLocationService({
          loadBoundary: eventId => repository.boundary(eventId)
        }),
        profile: () => ({
          ...currentUserProfile,
          uid: currentUser.uid
        }),
        canManage: hasPermission(currentUserRole, 'manageSurveys'),
        escapeHtml,
        openView,
        showToast: showDashboardToast,
        deletionService: new SurveyDeletionService({
          repository
        })
      });
      surveys.initialize();
      this.scope.addCleanup(() => surveys.dispose());
      if (surveys.pendingEventId) {
        initializeDashboardHistory();
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
