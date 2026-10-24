import { DashboardState } from './DashboardState.js';
import { DashboardRuntime } from '../controllers/DashboardRuntime.js';
export * from './DashboardPresentation.js';
export * from './DashboardDependencies.js';
export { FineModalController } from '../controllers/FineModalController.js';

// Compatibility bindings stay live for existing feature imports; DashboardState owns writes.
export let currentUser, activeView;
export let previousView = 'dashboard';
export let currentUserRole = 'student';
export let currentUserProfile = {};
export const dashboardRole = document.body.dataset.dashboard;
export const sessionState = new DashboardState({ onChange: state => {
  currentUser = state.user;
  currentUserRole = state.role;
  currentUserProfile = state.profile;
  activeView = state.activeView;
  previousView = state.previousView;
} });
export const dashboardRuntime = new DashboardRuntime({ state: sessionState, role: dashboardRole });

// Thin compatibility adapters only; behavior and subscriptions belong to the runtime.
export const setDashboardViewState = state => dashboardRuntime.setView(state);
export const showDashboardToast = (title, message, options) => dashboardRuntime.showToast(title, message, options);
export const createNotification = notification => dashboardRuntime.createNotification(notification);
export const uploadFacePhotoToDrive = (image, student) => dashboardRuntime.uploadFacePhoto(image, student);
export const resetFacePhotoInDrive = (uid, options) => dashboardRuntime.resetFacePhoto(uid, options);
export const waitForFaceRegistration = (uid, exists, timeout) => dashboardRuntime.waitForFaceRegistration(uid, exists, timeout);
export const wireNotificationCenter = () => dashboardRuntime.wireNotifications();
export const renderView = name => dashboardRuntime.renderView(name);
export const openView = name => dashboardRuntime.openView(name);
export const applyRoleNavigation = () => dashboardRuntime.applyRoleNavigation();
export const initializeDashboardHistory = () => dashboardRuntime.initializeHistory();
export const updateDashboardGreeting = name => dashboardRuntime.updateGreeting(name);
export const waitForUser = () => dashboardRuntime.waitForUser();
export const verifyRole = user => dashboardRuntime.verifyRole(user);
export const wireCommonNavigation = () => dashboardRuntime.wireNavigation();
