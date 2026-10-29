import { DashboardApplication } from './DashboardApplication.js?v=20261011-optimized';
import { DashboardNavigationController } from './DashboardNavigationController.js';
import { DashboardSessionService } from './DashboardSessionService.js';
import { DashboardToastController } from './DashboardToastController.js';
import { DashboardGreetingController } from './DashboardGreetingController.js';
import { NotificationService } from './NotificationService.js';
import { NotificationCenterController } from './NotificationCenterController.js';
import { FaceRegistrationService } from './FaceRegistrationService.js?v=20261011-reset-recovery';
import * as firebase from '../core/DashboardDependencies.js';
import { FACE_UPLOAD_WEB_APP_URL, canReceiveNotification, getDashboardGreeting } from '../core/DashboardPresentation.js';

/** Composition root for shared controllers. Role-specific behavior stays in its feature owner. */
export class DashboardRuntime {
  constructor({ state, role, document = globalThis.document, window = globalThis.window,
    dependencies = firebase, notificationService, greetingController, toastController,
    faceRegistrationService, sessionService, notificationCenter, navigation, application } = {}) {
    Object.assign(this, { state, role, document, window });
    const { auth, db, onAuthStateChanged, addDoc, collection, serverTimestamp,
      getDoc, getDocFromServer, doc } = dependencies;
    this.notificationService = notificationService || new NotificationService({
      getSession: () => ({ user: state.user, role: state.role }), canReceive: canReceiveNotification,
      save: record => addDoc(collection(db, 'notifications'), record), serverTimestamp });
    this.greetingController = greetingController || new DashboardGreetingController({ document, getGreeting: getDashboardGreeting });
    this.toastController = toastController || new DashboardToastController({ document });
    this.faceRegistrationService = faceRegistrationService || new FaceRegistrationService({
      endpoint: FACE_UPLOAD_WEB_APP_URL, getUser: () => state.user,
      loadRegistration: uid => getDocFromServer(doc(db, 'faceRegistrations', uid)),
      loadResetResult: requestId => getDocFromServer(doc(db, 'faceResetRequests', requestId)) });
    this.sessionService = sessionService || new DashboardSessionService({ auth, subscribe: onAuthStateChanged,
      loadStudent: uid => getDocFromServer(doc(db, 'students', uid)),
      dashboardRole: role, onState: session => { if (!this.disposed) state.setSession(session); } });
    this.notificationCenter = notificationCenter || new NotificationCenterController({ document, window });
    this.navigation = navigation || new DashboardNavigationController({ document, window });
    this.application = application || new DashboardApplication({ document, window, cleanupShared: () => this.disposeShared() });
  }

  initialize() {
    if (this.disposed) return Promise.resolve();
    if (this.initialization) return this.initialization;
    this.onUnload = () => this.dispose();
    this.window.addEventListener('beforeunload', this.onUnload, { once: true });
    this.initialization = Promise.resolve().then(() => {
      if (!this.disposed) return this.application.initialize();
    }).catch(error => { if (!this.disposed) this.showToast('Unable to load Presence', error.message); });
    return this.initialization;
  }
  async waitForUser() {
    const user = await this.sessionService.waitForUser();
    if (!this.disposed) this.state.setSession({ user });
    return user;
  }
  verifyRole(user) { return this.sessionService.verifyRole(user); }
  setView(state) { this.state.setView(state); }
  showToast(title, message, options) { this.toastController.show(title, message, options); }
  createNotification(notification) { return this.notificationService.create(notification); }
  uploadFacePhoto(image, student = {}) { return this.faceRegistrationService.upload(image, student); }
  resetFacePhoto(uid, options) { return this.faceRegistrationService.reset(uid, options); }
  waitForFaceRegistration(uid, shouldExist, timeout = 20000) { return this.faceRegistrationService.waitForRegistration(uid, shouldExist, timeout); }
  wireNotifications() { return this.notificationCenter.initialize(); }
  renderView(name) { return this.navigation.renderView(name); }
  openView(name) { return this.navigation.openView(name); }
  applyRoleNavigation() { return this.navigation.applyRoleNavigation(); }
  initializeHistory() { return this.navigation.initializeDashboardHistory(); }
  wireNavigation() { return this.navigation.initialize(); }
  updateGreeting(name = 'Student') { return this.greetingController.render(name); }
  disposeShared() {
    if (this.disposed) return;
    this.disposed = true;
    this.window.removeEventListener('beforeunload', this.onUnload);
    // Every shared owner gets its cleanup even if one cleanup fails.
    let failure;
    for (const controller of [this.notificationCenter, this.navigation, this.sessionService, this.toastController]) {
      try { controller.dispose(); } catch (error) { failure ||= error; }
    }
    if (failure) throw failure;
  }
  dispose() {
    if (this.disposed) return;
    try { this.application.dispose(); } finally { this.disposeShared(); }
  }
}
