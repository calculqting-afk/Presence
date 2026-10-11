import { ControllerScope } from '../core/ControllerScope.js';
import { db, currentUser, currentUserRole, dashboardRole, escapeHtml, formatNotificationTime, query, collection, where, onSnapshot, setDoc, doc, serverTimestamp, writeBatch, showDashboardToast, openView, canReceiveNotification } from '../dashboard.js?v=20261011-fast-login';
export class NotificationCenterController {
  constructor({
    document = globalThis.document,
    window = globalThis.window,
    sessionStorage = globalThis.sessionStorage
  } = {}) {
    this.document = document;
    this.window = window;
    this.sessionStorage = sessionStorage;
    this.scope = new ControllerScope();
    this.close = this.close.bind(this);
    this.render = this.render.bind(this);
    this.subscribeToNotifications = this.subscribeToNotifications.bind(this);
  }
  dispose() {
    this.subscriptionGeneration = (this.subscriptionGeneration || 0) + 1;
    this.window.clearTimeout(this.retryNotificationsTimer);
    this.unsubscribeNotifications?.(); this.unsubscribeNotifications = null;
    this.scope.dispose();
    this.panel?.remove();
  }
  initialize() {
    const dashboard = this;
    if (!dashboard.scope.initialize()) return;
    dashboard.bell = dashboard.document.querySelector("#notificationBell");
    dashboard.count = dashboard.document.querySelector("#notificationCount");
    dashboard.isAdminDashboard = dashboardRole === "admin";
    dashboard.document.body.insertAdjacentHTML("beforeend", `<section class="notification-panel" id="notificationPanel" hidden aria-label="Notifications"><div class="notification-panel-head"><div><h2>Notifications</h2><p>Stay up to date with Presence.</p></div><button class="modal-close" id="closeNotifications" type="button" aria-label="Close notifications">×</button></div><div class="notification-tools"><div class="notification-filters"><button class="notification-filter active" type="button" data-notification-filter="all">All</button><button class="notification-filter" type="button" data-notification-filter="unread">Unread</button><button class="notification-filter" type="button" data-notification-filter="attendance">Attendance</button><button class="notification-filter" type="button" data-notification-filter="service">Service</button><button class="notification-filter" type="button" data-notification-filter="face">Face</button><button class="notification-filter" type="button" data-notification-filter="system">System</button></div>${dashboard.isAdminDashboard ? '<input class="notification-search" id="notificationSearch" type="search" placeholder="Search student, ID, or section">' : ""}</div><div class="notification-actions"><button class="link-button" type="button" id="markNotificationsRead">Mark all as read</button><button class="link-button" type="button" id="clearReadNotifications">Clear read</button></div><div class="notification-list" id="notificationList"><div class="empty-state">No notifications yet.</div></div></section>`);
    dashboard.panel = dashboard.document.querySelector("#notificationPanel");
    dashboard.list = dashboard.document.querySelector("#notificationList");
    dashboard.search = dashboard.document.querySelector("#notificationSearch");
    dashboard.notificationRecords = [];
    dashboard.activeFilter = "all";
    dashboard.unsubscribeNotifications = undefined;
    dashboard.retryNotificationsTimer = undefined;
    dashboard.scope.listen(dashboard.bell, "click", () => {
      dashboard.panel.hidden = !dashboard.panel.hidden;
      dashboard.bell.setAttribute("aria-expanded", String(!dashboard.panel.hidden));
      if (!dashboard.panel.hidden) dashboard.list.querySelector("button")?.focus();
    });
    dashboard.scope.listen(dashboard.document.querySelector("#closeNotifications"), "click", dashboard.close);
    dashboard.document.querySelectorAll("[data-notification-filter]").forEach(button => dashboard.scope.listen(button, "click", () => {
      dashboard.activeFilter = button.dataset.notificationFilter;
      dashboard.document.querySelectorAll("[data-notification-filter]").forEach(filter => filter.classList.toggle("active", filter === button));
      dashboard.render();
    }));
    dashboard.search?.addEventListener("input", dashboard.render);
    dashboard.scope.listen(dashboard.list, "click", async event => {
      const item = event.target.closest("[data-open-notification]");
      if (!item) return;
      const record = dashboard.notificationRecords.find(notification => notification.id === item.dataset.openNotification);
      if (!record) return;
      if (!record.read) {
        const previous = {
          ...record
        };
        record.read = true;
        record.readAt = new Date();
        dashboard.render();
        try {
          await setDoc(doc(db, "notifications", record.id), {
            read: true,
            readAt: serverTimestamp()
          }, {
            merge: true
          });
        } catch (error) {
          Object.assign(record, previous);
          dashboard.render();
          showDashboardToast("Unable to mark notification read", error.code === "permission-denied" ? "Your account is not allowed to update this notification." : error.message || "Please try again.");
          return;
        }
      }
      dashboard.close();
      openView(record.targetView || "dashboard");
    });
    dashboard.scope.listen(dashboard.document.querySelector("#markNotificationsRead"), "click", async () => {
      const unread = dashboard.notificationRecords.filter(item => !item.read);
      if (!unread.length) return;
      const button = dashboard.document.querySelector("#markNotificationsRead");
      const previous = unread.map(item => ({
        item,
        read: item.read,
        readAt: item.readAt
      }));
      unread.forEach(item => {
        item.read = true;
        item.readAt = new Date();
      });
      button.disabled = true;
      dashboard.render();
      try {
        for (let index = 0; index < unread.length; index += 400) {
          const batch = writeBatch(db);
          unread.slice(index, index + 400).forEach(item => batch.set(doc(db, "notifications", item.id), {
            read: true,
            readAt: serverTimestamp()
          }, {
            merge: true
          }));
          await batch.commit();
        }
      } catch (error) {
        previous.forEach(({
          item,
          read,
          readAt
        }) => {
          item.read = read;
          item.readAt = readAt;
        });
        dashboard.render();
        showDashboardToast("Unable to mark notifications read", error.code === "permission-denied" ? "Your account is not allowed to update these notifications." : error.message || "Please try again.");
      } finally {
        button.disabled = false;
      }
    });
    dashboard.scope.listen(dashboard.document.querySelector("#clearReadNotifications"), "click", async () => {
      const read = dashboard.notificationRecords.filter(item => item.read);
      if (!read.length) return;
      const button = dashboard.document.querySelector("#clearReadNotifications");
      const previous = dashboard.notificationRecords;
      dashboard.notificationRecords = dashboard.notificationRecords.filter(item => !item.read);
      button.disabled = true;
      dashboard.render();
      try {
        for (let index = 0; index < read.length; index += 400) {
          const batch = writeBatch(db);
          read.slice(index, index + 400).forEach(item => batch.delete(doc(db, "notifications", item.id)));
          await batch.commit();
        }
      } catch (error) {
        dashboard.notificationRecords = previous;
        dashboard.render();
        showDashboardToast("Unable to clear notifications", error.code === "permission-denied" ? "Your account is not allowed to delete these notifications." : error.message || "Please try again.");
      } finally {
        button.disabled = false;
      }
    });
    dashboard.scope.listen(dashboard.document, "keydown", event => {
      if (event.key === "Escape" && !dashboard.panel.hidden) dashboard.close();
    });
    dashboard.scope.listen(dashboard.window, "online", dashboard.subscribeToNotifications);
    dashboard.scope.listen(dashboard.document, "visibilitychange", () => {
      if (dashboard.document.visibilityState === "visible") dashboard.subscribeToNotifications();
    });
    dashboard.scope.listen(dashboard.window, "beforeunload", () => {
      dashboard.window.clearTimeout(dashboard.retryNotificationsTimer);
      dashboard.unsubscribeNotifications?.();
    }, {
      once: true
    });
    dashboard.subscribeToNotifications();
  }
  close() {
    const dashboard = this;
    dashboard.panel.hidden = true;
    dashboard.bell.setAttribute("aria-expanded", "false");
  }
  render() {
    const dashboard = this;
    const queryText = dashboard.search?.value.trim().toLowerCase() || "";
    const visible = dashboard.notificationRecords.filter(item => {
      const matchesFilter = dashboard.activeFilter === "all" || (dashboard.activeFilter === "unread" ? !item.read : item.category === dashboard.activeFilter);
      const searchable = `${item.studentName} ${item.studentId} ${item.section} ${item.title} ${item.message}`.toLowerCase();
      return matchesFilter && (!queryText || searchable.includes(queryText));
    });
    dashboard.list.innerHTML = visible.length ? visible.map(item => `<button class="notification-item${item.read ? "" : " unread"}" type="button" data-open-notification="${escapeHtml(item.id)}"><span class="notification-icon ${escapeHtml(item.category || "system")}" aria-hidden="true">${item.category === "service" ? "!" : item.category === "attendance" ? "✓" : item.category === "face" ? "◎" : "◇"}</span><span class="notification-copy"><strong>${escapeHtml(item.title || "Presence update")}</strong><small>${escapeHtml(item.message || "")}</small>${item.studentName ? `<em>${escapeHtml(item.studentName)}${item.section ? ` · ${escapeHtml(item.section)}` : ""}</em>` : ""}<time>${escapeHtml(formatNotificationTime(item.createdAt))}</time></span>${item.read ? "" : '<i class="notification-unread-dot" aria-label="Unread"></i>'}</button>`).join("") : '<div class="empty-state">No notifications match this filter.</div>';
    const unread = dashboard.notificationRecords.filter(item => !item.read).length;
    dashboard.count.hidden = !unread;
    dashboard.count.textContent = unread > 99 ? "99+" : unread;
  }
  subscribeToNotifications() {
    const dashboard = this;
    if (!dashboard.scope.initialized) return;
    const generation = dashboard.subscriptionGeneration = (dashboard.subscriptionGeneration || 0) + 1;
    dashboard.window.clearTimeout(dashboard.retryNotificationsTimer);
    dashboard.unsubscribeNotifications?.();
    const notificationQuery = query(collection(db, "notifications"), where("recipientUid", "==", currentUser.uid));
    dashboard.unsubscribeNotifications = onSnapshot(notificationQuery, snapshot => {
      if (!dashboard.scope.initialized || generation !== dashboard.subscriptionGeneration) return;
      dashboard.notificationRecords = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      })).filter(item => canReceiveNotification(currentUserRole, item.category)).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      dashboard.render();
    }, error => {
      if (!dashboard.scope.initialized || generation !== dashboard.subscriptionGeneration) return;
      // A listener error is terminal. Keep cached records and retry transient failures.
      console.error("Notification listener failed", {
        code: error.code,
        message: error.message
      });
      // A rules or auth-token change can resolve a permission error without a
      // page reload, so every terminal listener error is retried silently.
      dashboard.retryNotificationsTimer = dashboard.window.setTimeout(dashboard.subscribeToNotifications, 5000);
    });
  }
}
