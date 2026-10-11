import { ControllerScope } from '../core/ControllerScope.js';
import { StudentIdentityController } from './StudentIdentityController.js';
import { AuthActionController } from './AuthActionController.js';
import { dashboardRole, pageCopy, currentUser, currentUserRole, currentUserProfile, activeView, previousView, sessionState, ROLE_VIEWS, ROLE_ACCESS_LABELS, roleLabel, renderView, openView, setDashboardViewState, auth, db, signOut, setDoc, doc, serverTimestamp, showDashboardToast } from '../dashboard.js?v=20261011-fast-login';
export class DashboardNavigationController {
  constructor({
    document = globalThis.document,
    window = globalThis.window,
    sessionStorage = globalThis.sessionStorage,
    history = globalThis.history
  } = {}) {
    this.document = document;
    this.window = window;
    this.sessionStorage = sessionStorage;
    this.history = history;
    this.scope = new ControllerScope();
    this.closeLogoutModal = this.closeLogoutModal.bind(this);
  }
  dispose() {
    this.scope.dispose();
    this.logoutAction?.dispose(); this.logoutModal?.remove();
    this.historyInitialized = false;
  }
  initialize() {
    const dashboard = this;
    if (!dashboard.scope.initialize()) return;
    dashboard.document.querySelectorAll("[data-view]").forEach(button => dashboard.scope.listen(button, "click", () => openView(button.dataset.view)));
    dashboard.document.querySelectorAll("[data-go-view]").forEach(button => dashboard.scope.listen(button, "click", () => openView(button.dataset.goView)));
    dashboard.document.querySelectorAll("[data-go-back]").forEach(button => dashboard.scope.listen(button, "click", () => openView(previousView)));
    dashboard.document.querySelectorAll("[data-dashboard-home]").forEach(brand => dashboard.scope.listen(brand, "click", event => {
      event.preventDefault();
      dashboard.document.querySelectorAll(".dashboard-modal-backdrop:not([hidden])").forEach(modal => {
        modal.hidden = true;
      });
      dashboard.document.querySelector("#notificationPanel")?.setAttribute("hidden", "");
      dashboard.document.querySelector("#notificationBell")?.setAttribute("aria-expanded", "false");
      openView("dashboard");
    }));
    dashboard.document.body.insertAdjacentHTML("beforeend", `
    <div class="dashboard-modal-backdrop" id="logoutModal" hidden>
      <section class="dashboard-modal logout-modal" role="dialog" aria-modal="true" aria-labelledby="logoutModalTitle">
        <button class="modal-close" type="button" data-close-logout aria-label="Close">×</button>
        <span class="modal-icon">↙</span>
        <h2 id="logoutModalTitle">Log out of Presence?</h2>
        <p>You will return to the sign-in page and need your credentials to access your account again.</p>
        <div class="modal-actions">
          <button class="outline-button" type="button" data-close-logout>Cancel</button>
          <button class="primary-button" id="confirmLogout" type="button">Log out</button>
        </div>
      </section>
    </div>`);
    dashboard.logoutModal = dashboard.document.querySelector("#logoutModal");
    dashboard.logoutAction = new AuthActionController();
    dashboard.scope.listen(dashboard.window, 'pagehide', () => dashboard.logoutAction.dispose(), {
      once: true
    });
    dashboard.document.querySelectorAll("[data-logout]").forEach(button => dashboard.scope.listen(button, "click", () => {
      dashboard.logoutModal.hidden = false;
      dashboard.document.querySelector("#confirmLogout").focus();
    }));
    dashboard.document.querySelectorAll("[data-close-logout]").forEach(button => dashboard.scope.listen(button, "click", dashboard.closeLogoutModal));
    dashboard.scope.listen(dashboard.logoutModal, "click", event => {
      if (event.target === dashboard.logoutModal) dashboard.closeLogoutModal();
    });
    dashboard.scope.listen(dashboard.document, "keydown", event => {
      if (event.key === "Escape" && !dashboard.logoutModal.hidden) dashboard.closeLogoutModal();
    });
    dashboard.scope.listen(dashboard.document.querySelector("#confirmLogout"), "click", async () => {
      await dashboard.logoutAction.run({
        buttons: [dashboard.document.querySelector('#confirmLogout'), ...dashboard.document.querySelectorAll('[data-logout]')],
        label: 'Logging out…',
        successLabel: 'Logged out',
        action: async () => {
          try {
            if (sessionState.mediaStream) sessionState.mediaStream.getTracks().forEach(track => track.stop());
            dashboard.window.clearInterval(sessionState.presenceHeartbeatTimer);
            if (dashboardRole === "student" && currentUser && sessionState.presenceSessionId) {
              sessionState.studentLoggedOut = true;
              await Promise.allSettled([setDoc(doc(db, "presenceSessions", sessionState.presenceSessionId), {
                studentUid: currentUser.uid,
                sessionId: sessionState.presenceSessionId,
                online: false,
                status: "logged-out",
                lastSeen: serverTimestamp(),
                offlineAt: serverTimestamp()
              }, {
                merge: true
              }), setDoc(doc(db, "presence", currentUser.uid), {
                online: false,
                status: "logged-out",
                lastSeen: serverTimestamp(),
                offlineAt: serverTimestamp()
              }, {
                merge: true
              })]);
            }
            await signOut(auth);
            try {
              dashboard.sessionStorage.removeItem("presenceSession");
              new StudentIdentityController({ storage: dashboard.sessionStorage }).clear();
              dashboard.sessionStorage.removeItem("presenceDeviceSession");
            } catch {}
            sessionState.dashboard?.dispose();
            dashboard.window.location.replace("../index.html");
          } catch (error) {
            console.error("LOGOUT FAILED:", error);
            showDashboardToast("Unable to log out", "Firebase could not end this session. Please try again.");
            return false;
          }
        }
      });
    });
    dashboard.dateText = new Intl.DateTimeFormat("en", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(new Date());
    dashboard.document.querySelectorAll("[data-current-date]").forEach(element => {
      element.textContent = dashboard.dateText;
    });
  }
  renderView(viewName) {
    const dashboard = this;
    if (!pageCopy[dashboardRole][viewName] || !ROLE_VIEWS[currentUserRole]?.includes(viewName)) return;
    this.activeView = viewName;
    setDashboardViewState({
      activeView: viewName
    });
    dashboard.document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === viewName));
    dashboard.document.querySelectorAll("[data-section]").forEach(section => {
      section.hidden = section.dataset.section !== viewName;
    });
    const copy = pageCopy[dashboardRole][viewName];
    if (copy) [dashboard.document.querySelector("#pageTitle").textContent, dashboard.document.querySelector("#pageSubtitle").textContent] = copy;
    if (viewName === 'modify-students' && currentUserRole === 'student_manager') {
      dashboard.document.querySelector('#pageSubtitle').textContent = 'Manage student details and face registration';
    }
    dashboard.window.dispatchEvent(new CustomEvent("presence:viewchange", {
      detail: {
        viewName
      }
    }));
    dashboard.window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }
  openView(viewName) {
    const dashboard = this;
    if (!pageCopy[dashboardRole][viewName] || !ROLE_VIEWS[currentUserRole]?.includes(viewName) || viewName === activeView) return;
    this.previousView = activeView || "dashboard";
    setDashboardViewState({
      previousView: this.previousView
    });
    renderView(viewName);
    dashboard.history.pushState({
      presenceDashboard: true,
      view: viewName
    }, "", dashboard.window.location.href);
  }
  applyRoleNavigation() {
    const dashboard = this;
    if (dashboardRole !== "admin") return;
    const allowedViews = new Set(ROLE_VIEWS[currentUserRole] || []);
    dashboard.document.querySelectorAll("[data-view]").forEach(button => {
      button.hidden = !allowedViews.has(button.dataset.view);
    });
    dashboard.document.querySelectorAll("[data-go-view]").forEach(button => {
      button.hidden = !allowedViews.has(button.dataset.goView);
    });
    dashboard.document.querySelectorAll("[data-go-back]").forEach(button => {
      button.hidden = !allowedViews.has(previousView);
    });
    dashboard.document.querySelector("[data-go-view=profile]")?.toggleAttribute("hidden", currentUserRole !== "super_admin");
    dashboard.document.querySelectorAll("[data-role-console]").forEach(element => {
      element.textContent = `${roleLabel(currentUserRole)} console`;
    });
    dashboard.document.querySelectorAll("[data-admin-role]").forEach(element => {
      element.textContent = ROLE_ACCESS_LABELS[currentUserRole] || "Student";
    });
    const displayName = [currentUserProfile.firstName, currentUserProfile.lastName].filter(Boolean).join(" ");
    if (displayName) dashboard.document.querySelectorAll("[data-admin-name]").forEach(element => {
      element.textContent = displayName;
    });
    dashboard.document.querySelectorAll("[data-super-admin-only]").forEach(element => {
      element.hidden = currentUserRole !== "super_admin";
    });
  }
  initializeDashboardHistory() {
    const dashboard = this;
    if (dashboard.historyInitialized) return;
    dashboard.historyInitialized = true;
    const requestedView = dashboard.history.state?.presenceDashboard && pageCopy[dashboardRole][dashboard.history.state.view] ? dashboard.history.state.view : "dashboard";
    const initialView = ROLE_VIEWS[currentUserRole]?.includes(requestedView) ? requestedView : "dashboard";
    dashboard.history.replaceState({
      presenceDashboard: true,
      view: initialView,
      root: true
    }, "", dashboard.window.location.href);
    dashboard.history.pushState({
      presenceDashboard: true,
      view: initialView
    }, "", dashboard.window.location.href);
    renderView(initialView);
    dashboard.scope.listen(dashboard.window, "popstate", event => {
      const state = event.state;
      if (!state?.presenceDashboard || state.root) {
        dashboard.history.go(1);
        return;
      }
      renderView(ROLE_VIEWS[currentUserRole]?.includes(state.view) ? state.view : "dashboard");
    });
  }
  closeLogoutModal() {
    const dashboard = this;
    if (!dashboard.logoutAction.busy) dashboard.logoutModal.hidden = true;
  }
}
