import { endPresenceSession, bestEffortCleanup } from '../core/PresenceSession.js';
import { ControllerScope } from '../core/ControllerScope.js';
import { StudentIdentityController } from './StudentIdentityController.js';
import { AuthActionController } from './AuthActionController.js';
import { clearPhoneReminders } from './PhoneAttendanceReminders.js';
import { stopAttendancePush } from './PushAttendanceNotifications.js';
import { dashboardRole, pageCopy, currentUser, currentUserRole, currentUserProfile, activeView, previousView, sessionState, ROLE_VIEWS, ROLE_ACCESS_LABELS, roleLabel, renderView, openView, setDashboardViewState, auth, db, signOut, setDoc, doc, serverTimestamp, showDashboardToast } from '../dashboard.js?v=20261011-optimized';
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
    this.selectionIndicator?.dispose();
    this.scope.dispose();
    this.logoutAction?.dispose(); this.logoutModal?.remove();
    this.historyInitialized = false;
  }
  initialize() {
    const dashboard = this;
    if (!dashboard.scope.initialize()) return;
    this.selectionIndicator = new NavigationIndicatorController({ document: this.document, window: this.window });
    this.selectionIndicator.initialize();
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
        <span class="modal-icon presence-modal-logo" aria-hidden="true"></span>
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
            if (dashboardRole === "student") await endPresenceSession({
              user: currentUser, state: sessionState, window: dashboard.window, storage: dashboard.sessionStorage,
              write: (collectionName, id, fields) => setDoc(doc(db, collectionName, id), {
                ...fields, online: false, status: 'logged-out', lastSeen: serverTimestamp(), offlineAt: serverTimestamp()
              }, { merge: true })
            });
            await bestEffortCleanup(() => Promise.allSettled([
              Promise.resolve().then(() => stopAttendancePush(auth.currentUser)),
              Promise.resolve().then(() => clearPhoneReminders())
            ]));
            if (sessionState.mediaStream) sessionState.mediaStream.getTracks().forEach(track => track.stop());
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
    dashboard.document.querySelectorAll("[data-view]").forEach(button => {
      const selected = button.dataset.view === viewName;
      button.classList.toggle("active", selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
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
      behavior: "instant"
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

// Decorative only: view selection and permission checks stay in the navigation controller.
export class NavigationIndicatorController {
  constructor({ document, window }) {
    Object.assign(this, { document, window });
    this.scope = new ControllerScope();
    this.entries = [];
  }

  initialize() {
    if (!this.scope.initialize()) return;
    for (const list of this.document.querySelectorAll('.nav-list')) {
      const indicator = this.document.createElement('span');
      indicator.className = 'nav-selection-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.hidden = true;
      list.prepend(indicator);
      const entry = { list, indicator, positioned: false };
      this.entries.push(entry);
      if (this.window.ResizeObserver) {
        entry.resize = new this.window.ResizeObserver(() => this.schedule());
        entry.resize.observe(list);
        list.querySelectorAll('.nav-button').forEach(button => entry.resize.observe(button));
      }
      if (this.window.MutationObserver) {
        entry.mutations = new this.window.MutationObserver(records => {
          if (records.some(record => record.type === 'childList' || record.target.matches?.('.nav-button'))) this.schedule();
        });
        entry.mutations.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
      }
    }
    this.scope.listen(this.window, 'resize', () => this.schedule());
    this.scope.listen(this.window, 'presence:viewchange', event => {
      this.selectedView = event.detail.viewName;
      this.revealSelection = true;
      this.animateIcon();
      this.schedule();
    });
    this.document.fonts?.ready.then(() => this.schedule());
    this.schedule();
  }

  schedule() {
    if (!this.scope.initialized || this.frame || !this.entries.length) return;
    this.frame = this.window.requestAnimationFrame(() => {
      this.frame = undefined;
      this.position();
    });
  }

  selectedButton(list) {
    return [...list.querySelectorAll('.nav-button[data-view]')].find(button =>
      !button.hidden && (this.selectedView ? button.dataset.view === this.selectedView : button.classList.contains('active')));
  }

  position() {
    const reduced = this.window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    for (const entry of this.entries) {
      const { list, indicator } = entry;
      const button = this.selectedButton(list);
      if (!button || !button.getClientRects().length) {
        indicator.hidden = true;
        list.classList.remove('has-nav-indicator');
        entry.positioned = false;
        continue;
      }
      const bounds = list.getBoundingClientRect(), target = button.getBoundingClientRect();
      const x = target.left - bounds.left + list.scrollLeft - list.clientLeft;
      const y = target.top - bounds.top + list.scrollTop - list.clientTop;
      indicator.style.transition = entry.positioned ? '' : 'none';
      indicator.style.width = `${target.width}px`;
      indicator.style.height = `${target.height}px`;
      indicator.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      indicator.style.borderRadius = this.window.getComputedStyle(button).borderRadius;
      indicator.hidden = false;
      list.classList.add('has-nav-indicator');
      entry.positioned = true;
      if (this.revealSelection && list.scrollTo) {
        const left = x < list.scrollLeft ? x : x + target.width > list.scrollLeft + list.clientWidth ? x + target.width - list.clientWidth : list.scrollLeft;
        const top = y < list.scrollTop ? y : y + target.height > list.scrollTop + list.clientHeight ? y + target.height - list.clientHeight : list.scrollTop;
        if (left !== list.scrollLeft || top !== list.scrollTop) list.scrollTo({ left, top, behavior: reduced ? 'instant' : 'smooth' });
      }
    }
    this.revealSelection = false;
  }

  animateIcon() {
    this.iconAnimation?.cancel();
    if (this.window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const button = this.entries.map(entry => this.selectedButton(entry.list)).find(Boolean);
    const icon = button?.querySelector('.nav-icon');
    this.iconAnimation = icon?.animate?.([
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(-2px) scale(1.08)', offset: .45 },
      { transform: 'translateY(0) scale(1)' }
    ], { duration: 180, easing: 'ease-out' });
  }

  dispose() {
    this.scope.dispose();
    this.window.cancelAnimationFrame(this.frame);
    this.iconAnimation?.cancel();
    for (const entry of this.entries) {
      entry.resize?.disconnect();
      entry.mutations?.disconnect();
      entry.indicator.remove();
      entry.list.classList.remove('has-nav-indicator');
    }
    this.entries = [];
  }
}
