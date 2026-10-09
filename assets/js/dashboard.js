import { SUPER_ADMIN_EMAIL, auth, db, studentIdToEmail, studentProvisioningAuth } from "../../config/firebase-config.js?v=20261005-operational-reset";
import { createUserWithEmailAndPassword, deleteUser, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, updateProfile } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const dashboardRole = document.body.dataset.dashboard;
const FACE_UPLOAD_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzXA8Gi7akcpT3MS87kOKC-7MCpejazTeK0zLtu-pUNugXL4YBeUan5vVLXhqKTHzsQ_Q/exec";
const pageCopy = {
  student: {
    dashboard: ["Dashboard", "Your attendance at a glance"],
    events: ["Announcements & Events", "Clear descriptions and attendance schedules"],
    attendances: ["My Attendances", "Your check-in and check-out records"],
    history: ["Event History", "Completed events and attendance records"],
    fines: ["Fines", "Your assigned community-service requirements"],
    face: ["Face Registration", "Set up secure attendance check-ins"],
    profile: ["Profile", "Review and update your information"]
  },
  admin: {
    dashboard: ["Dashboard", "School attendance overview"],
    "add-student": ["Add Students", "Register a new student account"],
    "modify-students": ["Modify Students", "Edit or remove registered students"],
    create: ["Create Announcement/Event", "Add a description and automatic attendance window"],
    "modify-events": ["Modify Events", "Edit schedules or remove events"],
    "past-events": ["Past Events", "Edit or remove completed attendance events"],
    "attendance-line": ["Attendance Line", "Live student check-in and check-out activity"],
    "assign-fine": ["Assign Fine", "Create or update community-service requirements"],
    "assigned-fines": ["Assigned Fines", "Search and manage student fine records"],
    geofence: ["Geofence Locations", "Set attendance areas for each event"],
    profile: ["Profile", "Update your administrator information"]
  }
};

export const sessionState = { mediaStream: null, presenceHeartbeatTimer: null, presenceSessionId: null, studentLoggedOut: false, dashboard: null };
let currentUser;
let toastTimer;
let activeView;
let previousView = "dashboard";
let currentUserRole = "student";
let currentUserProfile = {};
const ROLE_VIEWS = {
  super_admin: ["dashboard", "add-student", "modify-students", "create", "modify-events", "past-events", "attendance-line", "assign-fine", "assigned-fines", "geofence", "profile"],
  head_admin: ["dashboard", "add-student", "modify-students", "create", "modify-events", "past-events", "attendance-line", "assign-fine", "assigned-fines", "geofence"],
  attendance_admin: ["dashboard", "create", "modify-events", "past-events", "attendance-line", "assign-fine", "assigned-fines", "geofence"],
  student_manager: ["dashboard", "add-student", "modify-students"],
  student: ["dashboard", "events", "attendances", "history", "fines", "face", "profile"]
};
const ROLE_ACCESS_LABELS = { super_admin: "Full access", head_admin: "Operational admin", attendance_admin: "Attendance access", student_manager: "Student management" };
const NOTIFICATION_CATEGORIES_BY_ROLE = {
  student: new Set(["attendance", "face"]),
  super_admin: new Set(["attendance", "service", "face", "system"]),
  head_admin: new Set(["attendance", "service", "face", "system"]),
  attendance_admin: new Set(["attendance", "system"]),
  student_manager: new Set(["face", "system"])
};

function canReceiveNotification(role, category) {
  return NOTIFICATION_CATEGORIES_BY_ROLE[role]?.has(category || "system") || false;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

const ROLE_LABELS = { super_admin: "Super Admin", head_admin: "Head Admin", attendance_admin: "Attendance Admin", student_manager: "Student Manager", student: "Student" };
const ASSIGNABLE_ROLE_LABELS = { head_admin: "Head Admin", attendance_admin: "Attendance Admin", student_manager: "Student Manager", student: "Student" };
function firebaseErrorCode(error) {
  return String(error?.code || "").replace(/^(?:firestore|functions)\//, "");
}
function roleLabel(role) {
  return ROLE_LABELS[role] || ROLE_LABELS.student;
}

function roleChangeErrorMessage(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  if (code === "permission-denied") return "Only the Super Admin can assign roles. Sign out and sign in again, then retry.";
  if (code === "unauthenticated") return "Your session has expired. Sign in again and retry.";
  return error?.message || "The role could not be updated.";
}

function formatBirthday(value) {
  if (!value) return "Not provided";
  const birthday = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birthday.getTime())) return "Not provided";
  return birthday.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

class FineModalController {
  constructor({ modal, content, title, description, closeSelector }) {
    this.modal = modal;
    this.content = content;
    this.title = title;
    this.description = description;
    this.closeSelector = closeSelector;
    this.trigger = null;
    document.querySelectorAll(closeSelector).forEach((button) => button.addEventListener("click", () => this.close()));
    modal.addEventListener("click", (event) => { if (event.target === modal) this.close(); });
  }

  open({ title, description, markup, trigger }) {
    this.trigger = trigger;
    this.title.textContent = title;
    this.description.textContent = description;
    this.content.innerHTML = markup;
    this.modal.hidden = false;
    this.modal.querySelector(this.closeSelector)?.focus();
  }

  close() {
    this.modal.hidden = true;
    this.trigger?.focus();
  }
}

// Spark-plan client-side policy. Firestore Rules repeat the same time-window
// checks so the recorded arrival label cannot be changed after check-in.
function showDashboardToast(titleText, messageText) {
  const toast = document.querySelector("#dashboardToast");
  clearTimeout(toastTimer);
  document.querySelector("#dashboardToastTitle").textContent = titleText;
  document.querySelector("#dashboardToastMessage").textContent = messageText;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

async function createNotification(notification) {
  const effectiveRecipientRole = notification.recipientRole || (notification.recipientUid === currentUser?.uid ? currentUserRole : "");
  if (effectiveRecipientRole && !canReceiveNotification(effectiveRecipientRole, notification.category)) return null;
  return addDoc(collection(db, "notifications"), {
    recipientUid: notification.recipientUid || "",
    recipientRole: notification.recipientRole || "",
    category: notification.category || "system",
    title: notification.title,
    message: notification.message,
    targetView: notification.targetView || "dashboard",
    studentName: notification.studentName || "",
    studentId: notification.studentId || "",
    section: notification.section || "",
    ...(notification.eventId ? { eventId: notification.eventId } : {}),
    read: false,
    createdAt: serverTimestamp()
  });
}

function formatNotificationTime(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "Just now";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function uploadFacePhotoToDrive(imageDataUrl, student = {}) {
  if (!FACE_UPLOAD_WEB_APP_URL) throw new Error("Face-photo storage is not configured.");
  const idToken = await currentUser.getIdToken();
  const payload = {
    idToken,
    imageDataUrl,
    studentName: [student.firstName, student.lastName].filter(Boolean).join(" "),
    studentId: student.accountId || "",
    section: student.section || ""
  };
  // Apps Script web apps do not expose cross-origin response headers. This simple,
  // opaque POST still delivers the authenticated photo to the private Drive script.
  await fetch(FACE_UPLOAD_WEB_APP_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
}

async function resetFacePhotoInDrive(studentUid) {
  if (!FACE_UPLOAD_WEB_APP_URL) throw new Error("Face-photo storage is not configured.");
  const idToken = await currentUser.getIdToken();
  await fetch(FACE_UPLOAD_WEB_APP_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "reset", idToken, studentUid })
  });
}

async function waitForFaceRegistration(studentUid, shouldExist, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await getDocFromServer(doc(db, "faceRegistrations", studentUid));
    if (snapshot.exists() === shouldExist) return snapshot;
    await new Promise((resolve) => window.setTimeout(resolve, 800));
  }
  return null;
}

function wireNotificationCenter() {
  const bell = document.querySelector("#notificationBell");
  const count = document.querySelector("#notificationCount");
  const isAdminDashboard = dashboardRole === "admin";
  document.body.insertAdjacentHTML("beforeend", `<section class="notification-panel" id="notificationPanel" hidden aria-label="Notifications"><div class="notification-panel-head"><div><h2>Notifications</h2><p>Stay up to date with Presence.</p></div><button class="modal-close" id="closeNotifications" type="button" aria-label="Close notifications">×</button></div><div class="notification-tools"><div class="notification-filters"><button class="notification-filter active" type="button" data-notification-filter="all">All</button><button class="notification-filter" type="button" data-notification-filter="unread">Unread</button><button class="notification-filter" type="button" data-notification-filter="attendance">Attendance</button><button class="notification-filter" type="button" data-notification-filter="service">Service</button><button class="notification-filter" type="button" data-notification-filter="face">Face</button><button class="notification-filter" type="button" data-notification-filter="system">System</button></div>${isAdminDashboard ? '<input class="notification-search" id="notificationSearch" type="search" placeholder="Search student, ID, or section">' : ""}</div><div class="notification-actions"><button class="link-button" type="button" id="markNotificationsRead">Mark all as read</button><button class="link-button" type="button" id="clearReadNotifications">Clear read</button></div><div class="notification-list" id="notificationList"><div class="empty-state">No notifications yet.</div></div></section>`);
  const panel = document.querySelector("#notificationPanel");
  const list = document.querySelector("#notificationList");
  const search = document.querySelector("#notificationSearch");
  let notificationRecords = [];
  let activeFilter = "all";
  let unsubscribeNotifications;
  let retryNotificationsTimer;

  const close = () => { panel.hidden = true; bell.setAttribute("aria-expanded", "false"); };
  const render = () => {
    const queryText = search?.value.trim().toLowerCase() || "";
    const visible = notificationRecords.filter((item) => {
      const matchesFilter = activeFilter === "all" || (activeFilter === "unread" ? !item.read : item.category === activeFilter);
      const searchable = `${item.studentName} ${item.studentId} ${item.section} ${item.title} ${item.message}`.toLowerCase();
      return matchesFilter && (!queryText || searchable.includes(queryText));
    });
    list.innerHTML = visible.length ? visible.map((item) => `<button class="notification-item${item.read ? "" : " unread"}" type="button" data-open-notification="${escapeHtml(item.id)}"><span class="notification-icon ${escapeHtml(item.category || "system")}" aria-hidden="true">${item.category === "service" ? "!" : item.category === "attendance" ? "✓" : item.category === "face" ? "◎" : "◇"}</span><span class="notification-copy"><strong>${escapeHtml(item.title || "Presence update")}</strong><small>${escapeHtml(item.message || "")}</small>${item.studentName ? `<em>${escapeHtml(item.studentName)}${item.section ? ` · ${escapeHtml(item.section)}` : ""}</em>` : ""}<time>${escapeHtml(formatNotificationTime(item.createdAt))}</time></span>${item.read ? "" : '<i class="notification-unread-dot" aria-label="Unread"></i>'}</button>`).join("") : '<div class="empty-state">No notifications match this filter.</div>';
    const unread = notificationRecords.filter((item) => !item.read).length;
    count.hidden = !unread;
    count.textContent = unread > 99 ? "99+" : unread;
  };
  bell.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    bell.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) list.querySelector("button")?.focus();
  });
  document.querySelector("#closeNotifications").addEventListener("click", close);
  document.querySelectorAll("[data-notification-filter]").forEach((button) => button.addEventListener("click", () => {
    activeFilter = button.dataset.notificationFilter;
    document.querySelectorAll("[data-notification-filter]").forEach((filter) => filter.classList.toggle("active", filter === button));
    render();
  }));
  search?.addEventListener("input", render);
  list.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-open-notification]");
    if (!item) return;
    const record = notificationRecords.find((notification) => notification.id === item.dataset.openNotification);
    if (!record) return;
    if (!record.read) {
      const previous = { ...record };
      record.read = true;
      record.readAt = new Date();
      render();
      try {
        await setDoc(doc(db, "notifications", record.id), { read: true, readAt: serverTimestamp() }, { merge: true });
      } catch (error) {
        Object.assign(record, previous);
        render();
        showDashboardToast("Unable to mark notification read", error.code === "permission-denied" ? "Your account is not allowed to update this notification." : (error.message || "Please try again."));
        return;
      }
    }
    close();
    openView(record.targetView || "dashboard");
  });
  document.querySelector("#markNotificationsRead").addEventListener("click", async () => {
    const unread = notificationRecords.filter((item) => !item.read);
    if (!unread.length) return;
    const button = document.querySelector("#markNotificationsRead");
    const previous = unread.map((item) => ({ item, read: item.read, readAt: item.readAt }));
    unread.forEach((item) => { item.read = true; item.readAt = new Date(); });
    button.disabled = true;
    render();
    try {
      for (let index = 0; index < unread.length; index += 400) {
        const batch = writeBatch(db);
        unread.slice(index, index + 400).forEach((item) => batch.set(doc(db, "notifications", item.id), { read: true, readAt: serverTimestamp() }, { merge: true }));
        await batch.commit();
      }
    } catch (error) {
      previous.forEach(({ item, read, readAt }) => { item.read = read; item.readAt = readAt; });
      render();
      showDashboardToast("Unable to mark notifications read", error.code === "permission-denied" ? "Your account is not allowed to update these notifications." : (error.message || "Please try again."));
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector("#clearReadNotifications").addEventListener("click", async () => {
    const read = notificationRecords.filter((item) => item.read);
    if (!read.length) return;
    const button = document.querySelector("#clearReadNotifications");
    const previous = notificationRecords;
    notificationRecords = notificationRecords.filter((item) => !item.read);
    button.disabled = true;
    render();
    try {
      for (let index = 0; index < read.length; index += 400) {
        const batch = writeBatch(db);
        read.slice(index, index + 400).forEach((item) => batch.delete(doc(db, "notifications", item.id)));
        await batch.commit();
      }
    } catch (error) {
      notificationRecords = previous;
      render();
      showDashboardToast("Unable to clear notifications", error.code === "permission-denied" ? "Your account is not allowed to delete these notifications." : (error.message || "Please try again."));
    } finally {
      button.disabled = false;
    }
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) close(); });
  const subscribeToNotifications = () => {
    window.clearTimeout(retryNotificationsTimer);
    unsubscribeNotifications?.();
    const notificationQuery = query(collection(db, "notifications"), where("recipientUid", "==", currentUser.uid));
    unsubscribeNotifications = onSnapshot(notificationQuery, (snapshot) => {
      notificationRecords = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => canReceiveNotification(currentUserRole, item.category))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      render();
    }, (error) => {
      // A listener error is terminal. Keep cached records and retry transient failures.
      console.error("Notification listener failed", { code: error.code, message: error.message });
      // A rules or auth-token change can resolve a permission error without a
      // page reload, so every terminal listener error is retried silently.
      retryNotificationsTimer = window.setTimeout(subscribeToNotifications, 5000);
    });
  };
  window.addEventListener("online", subscribeToNotifications);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") subscribeToNotifications();
  });
  window.addEventListener("beforeunload", () => {
    window.clearTimeout(retryNotificationsTimer);
    unsubscribeNotifications?.();
  }, { once: true });
  subscribeToNotifications();
}

function renderView(viewName) {
  if (!pageCopy[dashboardRole][viewName]) return;
  activeView = viewName;
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  document.querySelectorAll("[data-section]").forEach((section) => { section.hidden = section.dataset.section !== viewName; });
  const copy = pageCopy[dashboardRole][viewName];
  if (copy) [document.querySelector("#pageTitle").textContent, document.querySelector("#pageSubtitle").textContent] = copy;
  window.dispatchEvent(new CustomEvent("presence:viewchange", { detail: { viewName } }));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openView(viewName) {
  if (!pageCopy[dashboardRole][viewName] || !ROLE_VIEWS[currentUserRole]?.includes(viewName) || viewName === activeView) return;
  previousView = activeView || "dashboard";
  renderView(viewName);
  history.pushState({ presenceDashboard: true, view: viewName }, "", window.location.href);
}

function applyRoleNavigation() {
  if (dashboardRole !== "admin") return;
  const allowedViews = new Set(ROLE_VIEWS[currentUserRole] || []);
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.hidden = !allowedViews.has(button.dataset.view);
  });
  document.querySelectorAll("[data-go-view]").forEach((button) => {
    button.hidden = !allowedViews.has(button.dataset.goView);
  });
  document.querySelectorAll("[data-go-back]").forEach((button) => {
    button.hidden = !allowedViews.has(previousView);
  });
  document.querySelector("[data-go-view=profile]")?.toggleAttribute("hidden", currentUserRole !== "super_admin");
  document.querySelectorAll("[data-role-console]").forEach((element) => { element.textContent = `${roleLabel(currentUserRole)} console`; });
  document.querySelectorAll("[data-admin-role]").forEach((element) => { element.textContent = ROLE_ACCESS_LABELS[currentUserRole] || "Student"; });
  const displayName = [currentUserProfile.firstName, currentUserProfile.lastName].filter(Boolean).join(" ");
  if (displayName) document.querySelectorAll("[data-admin-name]").forEach((element) => { element.textContent = displayName; });
  document.querySelectorAll("[data-super-admin-only]").forEach((element) => { element.hidden = currentUserRole !== "super_admin"; });
}

function initializeDashboardHistory() {
  const requestedView = history.state?.presenceDashboard && pageCopy[dashboardRole][history.state.view]
    ? history.state.view
    : "dashboard";
  const initialView = ROLE_VIEWS[currentUserRole]?.includes(requestedView) ? requestedView : "dashboard";
  history.replaceState({ presenceDashboard: true, view: initialView, root: true }, "", window.location.href);
  history.pushState({ presenceDashboard: true, view: initialView }, "", window.location.href);
  renderView(initialView);

  window.addEventListener("popstate", (event) => {
    const state = event.state;
    if (!state?.presenceDashboard || state.root) {
      history.go(1);
      return;
    }
    renderView(ROLE_VIEWS[currentUserRole]?.includes(state.view) ? state.view : "dashboard");
  });
}

function formatEventDate(value) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", weekday: "long" }).format(new Date(`${value}T00:00:00`));
}
function formatEventTime(value) {
  return new Date(`2000-01-01T${value}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function timePlusMinutes(value, minutes = 15) {
  if (!/^\d{2}:\d{2}$/.test(value)) return "";
  const [hours, minute] = value.split(":").map(Number);
  const total = hours * 60 + minute + minutes;
  if (total >= 24 * 60) return "";
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function formatTimeWindow(event) {
  return `${formatEventTime(event.timeIn)} – ${formatEventTime(event.timeOut)}`;
}
function eventOpenDate(event) {
  return event.openAt?.toDate?.() || new Date(`${event.date}T${event.timeIn}`);
}
function eventCloseDate(event) {
  return event.closeAt?.toDate?.() || new Date(`${event.date}T${event.timeOut}`);
}
function eventCheckInCloseDate(event) {
  return event.checkInClosesAt?.toDate?.() || (event.checkInCutoff ? new Date(`${event.date}T${event.checkInCutoff}`) : eventCloseDate(event));
}
function eventCheckoutCloseDate(event) {
  return event.checkOutClosesAt?.toDate?.() || (event.checkOutCutoff ? new Date(`${event.date}T${event.checkOutCutoff}`) : new Date(eventCloseDate(event).getTime() + 15 * 60 * 1000));
}
function isCheckoutAvailable(event, now = new Date()) {
  return now >= eventCloseDate(event) && now <= eventCheckoutCloseDate(event);
}
function isEventFinished(event, now = new Date()) {
  return now > eventCheckoutCloseDate(event);
}
function formatAttendanceTimestamp(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
}
function attendanceDuration(checkIn, checkOut) {
  const started = checkIn?.toDate?.() || (checkIn ? new Date(checkIn) : null);
  const ended = checkOut?.toDate?.() || (checkOut ? new Date(checkOut) : null);
  if (!started || !ended || Number.isNaN(started.getTime()) || Number.isNaN(ended.getTime())) return "In progress";
  return formatServiceMinutes(Math.max(0, Math.round((ended - started) / 60000)));
}
function getEventStatus(event, now = new Date()) {
  if (now < eventOpenDate(event)) return "upcoming";
  if (now > eventCheckInCloseDate(event)) return "closed";
  return "open";
}
function arrivalStatusBadge(arrivalStatus) {
  return arrivalStatus === "late"
    ? '<span class="badge orange">Late</span>'
    : '<span class="badge green">Present</span>';
}
function eventStatusBadge(status) {
  const label = status === "open" ? "Attendance open" : status === "closed" ? "Closed" : "Not started";
  const color = status === "open" ? "green" : status === "closed" ? "gray" : "blue";
  return `<span class="badge ${color}">${label}</span>`;
}
function getInitials(firstName = "Student", lastName = "") {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "ST";
}

function formatServiceMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(value / 60);
  const remainingMinutes = value % 60;
  if (!hours) return `${remainingMinutes} min${remainingMinutes === 1 ? "" : "s"}`;
  if (!remainingMinutes) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} and ${remainingMinutes} min${remainingMinutes === 1 ? "" : "s"}`;
}

function formatFineDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "Recently";
}

function formatFineEventDate(value) {
  const date = value ? new Date(`${value}T00:00:00`) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "Not specified";
}

function formatFineTimestamp(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Recently";
}

function getFineHistory(fine) {
  if (Array.isArray(fine.assignmentHistory) && fine.assignmentHistory.length) return fine.assignmentHistory;
  return [{ action: "Assigned", addedMinutes: fine.serviceMinutes, newMinutes: fine.serviceMinutes, reason: fine.reason, recordedAt: fine.assignedAt }];
}

function fineDetailsMarkup(fine, includeAdminActions = false) {
  const history = getFineHistory(fine);
  const rows = history.slice().reverse().map((entry) => {
    const before = Number(entry.previousMinutes);
    const after = Number(entry.newMinutes) || Number(fine.serviceMinutes);
    const change = entry.action === "Added" ? `Added ${formatServiceMinutes(entry.addedMinutes)}` : entry.action === "Updated" ? `${formatServiceMinutes(before)} → ${formatServiceMinutes(after)}` : `Assigned ${formatServiceMinutes(after)}`;
    return `<li><strong>${escapeHtml(entry.action || "Assigned")}</strong><span>${escapeHtml(change)} · ${escapeHtml(formatFineTimestamp(entry.recordedAt))}</span>${entry.reason ? `<small>${escapeHtml(entry.reason)}</small>` : ""}</li>`;
  }).join("");
  return `<details class="fine-details"><summary>View attendance and assignment details</summary><div class="fine-details-content"><div class="fine-detail-grid"><div><span>Missed attendance</span><strong>${escapeHtml(fine.eventName || "Attendance absence")}</strong></div><div><span>Event date</span><strong>${escapeHtml(formatFineEventDate(fine.eventDate))}</strong></div></div><h4>Assignment history</h4><ol class="fine-history-list">${rows}</ol>${includeAdminActions ? `<div class="history-card-actions"><button class="outline-button" type="button" data-edit-fine="${escapeHtml(fine.id)}">Modify details</button><button class="small-button danger" type="button" data-delete-fine="${escapeHtml(fine.id)}">Remove</button></div>` : ""}</div></details>`;
}

function studentFineInfoMarkup(fine, events) {
  const event = events.find((item) => item.id === fine.eventId);
  const time = fine.eventTimeIn && fine.eventTimeOut
    ? `${formatEventTime(fine.eventTimeIn)} – ${formatEventTime(fine.eventTimeOut)}`
    : event?.timeIn && event?.timeOut ? formatTimeWindow(event) : "Not specified";
  const location = fine.eventLocation || event?.location || "Not specified";
  return `<div class="fine-detail-grid"><div><span>Missed attendance</span><strong>${escapeHtml(fine.eventName || "Attendance absence")}</strong></div><div><span>Event date</span><strong>${escapeHtml(formatFineEventDate(fine.eventDate || event?.date))}</strong></div><div><span>Time</span><strong>${escapeHtml(time)}</strong></div><div><span>Location</span><strong>${escapeHtml(location)}</strong></div><div class="fine-detail-full"><span>Reason</span><strong>${escapeHtml(fine.reason || "No reason provided.")}</strong></div></div>`;
}

function studentFineDetailsMarkup(groupFines, events) {
  const detailId = `student-fine-details-${groupFines.map((fine) => fine.id).join("-")}`;
  const entries = groupFines.map((fine, index) => `<li class="fine-attendance-entry"><span class="fine-attendance-number">${index + 1}</span>${studentFineInfoMarkup(fine, events)}</li>`).join("");
  const extensions = groupFines.flatMap((fine) => getFineHistory(fine)
    .filter((entry) => entry.action === "Added")
    .map((entry) => `<li><strong>Added ${escapeHtml(formatServiceMinutes(entry.addedMinutes))}</strong><span>${escapeHtml(formatFineTimestamp(entry.recordedAt))}</span><small>${escapeHtml(entry.reason || "No additional reason provided.")}</small></li>`)).join("");
  const extensionHistory = extensions ? `<h4>Additional community service</h4><ol class="fine-history-list">${extensions}</ol>` : "";
  return `<details class="fine-details" data-student-fine-details="${escapeHtml(detailId)}"><summary aria-controls="${escapeHtml(detailId)}">Details</summary><div class="fine-details-content" id="${escapeHtml(detailId)}"><ol class="fine-history-list fine-attendance-details">${entries}</ol>${extensionHistory}</div></details>`;
}

function getDashboardGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return { label: "Good morning", message: "Start the day prepared and stay on top of attendance." };
  if (hour < 18) return { label: "Good afternoon", message: "Keep your attendance tasks moving smoothly this afternoon." };
  return { label: "Good evening", message: "Review today’s attendance and prepare for what comes next." };
}

function updateDashboardGreeting(name = "Student") {
  const greeting = getDashboardGreeting();
  document.querySelectorAll("[data-dashboard-greeting]").forEach((element) => { element.textContent = greeting.label; });
  document.querySelectorAll("[data-dashboard-greeting-title]").forEach((element) => { element.textContent = `${greeting.label}, ${name}.`; });
  document.querySelectorAll("[data-dashboard-greeting-message]").forEach((element) => { element.textContent = greeting.message; });
}

function createDeviceSessionToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function waitForUser() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

async function verifyRole(user) {
  if (!user) return false;
  const isSuperAdmin = user.email?.toLowerCase() === SUPER_ADMIN_EMAIL;
  const profile = isSuperAdmin ? null : await getDoc(doc(db, "students", user.uid));
  currentUserProfile = profile?.data() || {};
  const storedRole = profile?.data()?.role || "student";
  const role = isSuperAdmin ? "super_admin" : (storedRole === "viewer" ? "student" : storedRole);
  currentUserRole = role;
  if (dashboardRole === "admin") {
    return ["super_admin", "head_admin", "attendance_admin", "student_manager"].includes(role);
  }
  if (role !== "student") return false;
  return profile.exists() && currentUserProfile.active === true;
}

function wireCommonNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => openView(button.dataset.view)));
  document.querySelectorAll("[data-go-view]").forEach((button) => button.addEventListener("click", () => openView(button.dataset.goView)));
  document.querySelectorAll("[data-go-back]").forEach((button) => button.addEventListener("click", () => openView(previousView)));
  document.querySelectorAll("[data-dashboard-home]").forEach((brand) => brand.addEventListener("click", (event) => {
    event.preventDefault();
    document.querySelectorAll(".dashboard-modal-backdrop:not([hidden])").forEach((modal) => { modal.hidden = true; });
    document.querySelector("#notificationPanel")?.setAttribute("hidden", "");
    document.querySelector("#notificationBell")?.setAttribute("aria-expanded", "false");
    openView("dashboard");
  }));
  document.body.insertAdjacentHTML("beforeend", `
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
  const logoutModal = document.querySelector("#logoutModal");
  const closeLogoutModal = () => { logoutModal.hidden = true; };
  document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", () => {
    logoutModal.hidden = false;
    document.querySelector("#confirmLogout").focus();
  }));
  document.querySelectorAll("[data-close-logout]").forEach((button) => button.addEventListener("click", closeLogoutModal));
  logoutModal.addEventListener("click", (event) => { if (event.target === logoutModal) closeLogoutModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !logoutModal.hidden) closeLogoutModal(); });
  document.querySelector("#confirmLogout").addEventListener("click", async () => {
    if (sessionState.mediaStream) sessionState.mediaStream.getTracks().forEach((track) => track.stop());
    window.clearInterval(sessionState.presenceHeartbeatTimer);
    if (dashboardRole === "student" && currentUser && sessionState.presenceSessionId) {
      sessionState.studentLoggedOut = true;
      await Promise.allSettled([
        setDoc(doc(db, "presenceSessions", sessionState.presenceSessionId), { studentUid: currentUser.uid, sessionId: sessionState.presenceSessionId, online: false, status: "logged-out", lastSeen: serverTimestamp(), offlineAt: serverTimestamp() }, { merge: true }),
        setDoc(doc(db, "presence", currentUser.uid), { online: false, status: "logged-out", lastSeen: serverTimestamp(), offlineAt: serverTimestamp() }, { merge: true })
      ]);
    }
    try {
      sessionStorage.removeItem("presenceSession");
      sessionStorage.removeItem("presenceDeviceSession");
    } catch {}
    try {
      await signOut(auth);
      sessionState.dashboard?.dispose();
      window.location.replace("../index.html");
    } catch (error) {
      console.error("LOGOUT FAILED:", error);
      showDashboardToast("Unable to log out", "Firebase could not end this session. Please try again.");
    }
  });
  const dateText = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date());
  document.querySelectorAll("[data-current-date]").forEach((element) => { element.textContent = dateText; });
}

async function initialize() {
  currentUser = await waitForUser();
  if (!currentUser || !(await verifyRole(currentUser))) {
    if (currentUser) await signOut(auth);
    window.location.replace("../index.html");
    return;
  }
  wireCommonNavigation();
  wireNotificationCenter();
  applyRoleNavigation();
  const displayName = dashboardRole === "admin"
    ? [currentUserProfile.firstName, currentUserProfile.lastName].filter(Boolean).join(" ") || "Admin"
    : "Student";
  updateDashboardGreeting(displayName);
  const module = dashboardRole === "student"
    ? await import("./student/StudentDashboard.js")
    : await import("./admin/AdminDashboard.js");
  const Dashboard = dashboardRole === "student" ? module.StudentDashboard : module.AdminDashboard;
  const dashboard = new Dashboard();
  sessionState.dashboard = dashboard;
  dashboard.initialize();
  window.addEventListener('beforeunload', () => dashboard.dispose(), { once: true });
  initializeDashboardHistory();
}

initialize().catch((error) => {
  showDashboardToast("Unable to load Presence", error.message);
});

export { dashboardRole, FACE_UPLOAD_WEB_APP_URL, pageCopy, currentUser, toastTimer, activeView, previousView, currentUserRole, currentUserProfile, ROLE_VIEWS, ROLE_ACCESS_LABELS, NOTIFICATION_CATEGORIES_BY_ROLE, canReceiveNotification, escapeHtml, ROLE_LABELS, ASSIGNABLE_ROLE_LABELS, firebaseErrorCode, roleLabel, roleChangeErrorMessage, formatBirthday, FineModalController, showDashboardToast, createNotification, formatNotificationTime, uploadFacePhotoToDrive, resetFacePhotoInDrive, waitForFaceRegistration, wireNotificationCenter, renderView, openView, applyRoleNavigation, initializeDashboardHistory, formatEventDate, formatEventTime, timePlusMinutes, formatTimeWindow, eventOpenDate, eventCloseDate, eventCheckInCloseDate, eventCheckoutCloseDate, isCheckoutAvailable, isEventFinished, formatAttendanceTimestamp, attendanceDuration, getEventStatus, arrivalStatusBadge, eventStatusBadge, getInitials, formatServiceMinutes, formatFineDate, formatFineEventDate, formatFineTimestamp, getFineHistory, fineDetailsMarkup, studentFineInfoMarkup, studentFineDetailsMarkup, getDashboardGreeting, updateDashboardGreeting, createDeviceSessionToken, waitForUser, verifyRole, wireCommonNavigation, SUPER_ADMIN_EMAIL, auth, db, studentIdToEmail, studentProvisioningAuth, createUserWithEmailAndPassword, deleteUser, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, updateProfile, Timestamp, addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocFromServer, getDocs, getDocsFromServer, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, writeBatch };
