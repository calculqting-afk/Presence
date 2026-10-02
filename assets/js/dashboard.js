import { ADMIN_EMAIL, auth, db, studentIdToEmail, studentProvisioningAuth } from "../../config/firebase-config.js";
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

let currentUser;
let toastTimer;
let mediaStream;
let presenceHeartbeatTimer;
let presenceSessionId;
let studentLoggedOut = false;
let activeView;
let previousView = "dashboard";
let currentUserRole = "student";
let currentUserProfile = {};
const ROLE_VIEWS = {
  head_admin: ["dashboard", "add-student", "modify-students", "create", "modify-events", "past-events", "attendance-line", "assign-fine", "assigned-fines", "geofence", "profile"],
  attendance_admin: ["dashboard", "create", "modify-events", "past-events", "attendance-line", "assign-fine", "assigned-fines", "geofence"],
  student_manager: ["dashboard", "add-student", "modify-students"],
  viewer: ["dashboard", "modify-students", "modify-events", "past-events", "attendance-line", "assigned-fines", "geofence"],
  student: ["dashboard", "events", "attendances", "history", "fines", "face", "profile"]
};
const ROLE_ACCESS_LABELS = { head_admin: "Full access", attendance_admin: "Attendance access", student_manager: "Student management", viewer: "Read-only access" };

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

const ROLE_LABELS = { head_admin: "Head Admin", attendance_admin: "Attendance Admin", student_manager: "Student Manager", viewer: "Viewer", student: "Student" };
function roleLabel(role) {
  return ROLE_LABELS[role] || ROLE_LABELS.student;
}

function roleChangeErrorMessage(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  if (code === "permission-denied") return "Only a Head Admin can assign roles. Sign out and sign in again, then retry.";
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
    this.modal.querySelector("[data-close-community-service], [data-close-admin-fines]")?.focus();
  }

  close() {
    this.modal.hidden = true;
    this.trigger?.focus();
  }
}

function showDashboardToast(titleText, messageText) {
  const toast = document.querySelector("#dashboardToast");
  clearTimeout(toastTimer);
  document.querySelector("#dashboardToastTitle").textContent = titleText;
  document.querySelector("#dashboardToastMessage").textContent = messageText;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

async function createNotification(notification) {
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
    if (!record.read) await setDoc(doc(db, "notifications", record.id), { read: true, readAt: serverTimestamp() }, { merge: true });
    close();
    openView(record.targetView || "dashboard");
  });
  document.querySelector("#markNotificationsRead").addEventListener("click", async () => {
    const unread = notificationRecords.filter((item) => !item.read);
    if (!unread.length) return;
    const batch = writeBatch(db);
    unread.forEach((item) => batch.set(doc(db, "notifications", item.id), { read: true, readAt: serverTimestamp() }, { merge: true }));
    await batch.commit();
  });
  document.querySelector("#clearReadNotifications").addEventListener("click", async () => {
    const read = notificationRecords.filter((item) => item.read);
    if (!read.length) return;
    const batch = writeBatch(db);
    read.forEach((item) => batch.delete(doc(db, "notifications", item.id)));
    await batch.commit();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) close(); });
  const notificationQuery = dashboardRole === "admin"
    ? query(collection(db, "notifications"), where("recipientRole", "==", "admin"))
    : query(collection(db, "notifications"), where("recipientUid", "==", currentUser.uid));
  onSnapshot(notificationQuery, (snapshot) => {
    notificationRecords = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    render();
  });
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
  document.querySelector("[data-go-view=profile]")?.toggleAttribute("hidden", currentUserRole !== "head_admin");
  document.querySelectorAll("[data-role-console]").forEach((element) => { element.textContent = `${roleLabel(currentUserRole)} console`; });
  document.querySelectorAll("[data-admin-role]").forEach((element) => { element.textContent = ROLE_ACCESS_LABELS[currentUserRole] || "Student"; });
  const displayName = [currentUserProfile.firstName, currentUserProfile.lastName].filter(Boolean).join(" ");
  if (displayName) document.querySelectorAll("[data-admin-name]").forEach((element) => { element.textContent = displayName; });
  document.querySelectorAll("[data-head-admin-only]").forEach((element) => { element.hidden = currentUserRole !== "head_admin"; });
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
  const isBootstrapHeadAdmin = user.email?.toLowerCase() === ADMIN_EMAIL;
  const profile = isBootstrapHeadAdmin ? null : await getDoc(doc(db, "students", user.uid));
  currentUserProfile = profile?.data() || {};
  const role = isBootstrapHeadAdmin ? "head_admin" : profile?.data()?.role || "student";
  currentUserRole = role;
  if (dashboardRole === "admin") {
    return ["head_admin", "attendance_admin", "student_manager", "viewer"].includes(role);
  }
  if (role !== "student") return false;
  const record = await getDoc(doc(db, "students", user.uid));
  return record.exists() && record.data().active === true;
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
    if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
    window.clearInterval(presenceHeartbeatTimer);
    if (dashboardRole === "student" && currentUser && presenceSessionId) {
      studentLoggedOut = true;
      await Promise.allSettled([
        setDoc(doc(db, "presenceSessions", presenceSessionId), { studentUid: currentUser.uid, sessionId: presenceSessionId, online: false, status: "logged-out", lastSeen: serverTimestamp(), offlineAt: serverTimestamp() }, { merge: true }),
        setDoc(doc(db, "presence", currentUser.uid), { online: false, status: "logged-out", lastSeen: serverTimestamp(), offlineAt: serverTimestamp() }, { merge: true })
      ]);
    }
    try {
      sessionStorage.removeItem("presenceSession");
      sessionStorage.removeItem("presenceDeviceSession");
    } catch {}
    try {
      await signOut(auth);
      window.location.replace("../index.html");
    } catch (error) {
      console.error("LOGOUT FAILED:", error);
      showDashboardToast("Unable to log out", "Firebase could not end this session. Please try again.");
    }
  });
  const dateText = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date());
  document.querySelectorAll("[data-current-date]").forEach((element) => { element.textContent = dateText; });
}

function initializeStudent() {
  let events = [];
  let attendance = [];
  let fines = [];
  let dismissedIds = new Set();
  let studentProfile;
  let pendingProfilePhoto = "";
  let presenceWriteErrorShown = false;
  let eventRenderFrame;
  let eventStatusTimer;
  studentLoggedOut = false;
  const studentProfileModal = document.querySelector("#studentProfileModal");
  let storedPresenceSession = "";
  try { storedPresenceSession = sessionStorage.getItem("presenceDeviceSession") || ""; } catch {}
  presenceSessionId = storedPresenceSession || `${currentUser.uid}_${createDeviceSessionToken()}`;
  try { sessionStorage.setItem("presenceDeviceSession", presenceSessionId); } catch {}

  const updatePresence = async (status = "online", silent = false) => {
    const online = status === "online";
    const statusPayload = {
      online,
      status,
      lastSeen: serverTimestamp(),
      offlineAt: online ? deleteField() : serverTimestamp()
    };
    try {
      await setDoc(doc(db, "presenceSessions", presenceSessionId), {
        studentUid: currentUser.uid,
        sessionId: presenceSessionId,
        ...statusPayload
      }, { merge: true });
    } catch (error) {
      console.error("PRESENCE UPDATE FAILED:", error);
      try {
        await setDoc(doc(db, "presence", currentUser.uid), statusPayload, { merge: true });
      } catch (fallbackError) {
        console.error("PRESENCE FALLBACK FAILED:", fallbackError);
        if (!silent && !presenceWriteErrorShown) {
          presenceWriteErrorShown = true;
          showDashboardToast("Live status unavailable", fallbackError.code === "permission-denied" ? "Publish the latest database rules, then reload this device." : "This device could not sync its online status.");
        }
      }
    }
  };
  updatePresence("online");
  presenceHeartbeatTimer = window.setInterval(() => updatePresence("online"), 60000);
  window.addEventListener("focus", () => updatePresence("online"));
  window.addEventListener("pagehide", () => {
    if (!studentLoggedOut) updatePresence("offline", true);
  });

  function updatePhotoPreview(photoDataUrl = "") {
    const image = document.querySelector("#profilePhotoPreviewImage");
    const initials = document.querySelector("#profilePhotoPreviewInitials");
    if (photoDataUrl) {
      image.src = photoDataUrl;
      image.hidden = false;
      initials.hidden = true;
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      initials.hidden = false;
      initials.textContent = getInitials(document.querySelector("#profileFirstName").value, document.querySelector("#profileLastName").value);
    }
  }

  async function prepareProfilePhoto(file) {
    if (!file.type.match(/^image\/(jpeg|png|webp)$/)) throw new Error("Choose a JPG, PNG, or WebP image.");
    if (file.size > 8 * 1024 * 1024) throw new Error("Choose an image smaller than 8 MB.");
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read this image."));
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = source;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - side) / 2;
    const sourceY = (image.naturalHeight - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 320, 320);
    context.drawImage(image, sourceX, sourceY, side, side, 0, 0, 320, 320);
    const compressed = canvas.toDataURL("image/jpeg", .82);
    if (compressed.length > 350000) throw new Error("The processed image is still too large. Try another photo.");
    return compressed;
  }

  function closeStudentProfileModal() {
    studentProfileModal.hidden = true;
  }

  function renderEvents() {
    const attendanceIds = new Set(attendance.map((record) => record.eventId));
    const activeEvents = events.filter((event) => getEventStatus(event) !== "closed");
    const eventGrid = document.querySelector("#studentEventGrid");
    const timeline = document.querySelector("#studentEventTimeline");
    if (!activeEvents.length) {
      eventGrid.innerHTML = '<div class="empty-state panel event-empty">No open or upcoming events.</div>';
      timeline.innerHTML = '<div class="empty-state">No open or upcoming events.</div>';
    } else {
      eventGrid.innerHTML = activeEvents.map((event) => {
        const status = getEventStatus(event);
        const attended = attendanceIds.has(event.id);
        const disabled = attended || status !== "open";
        const buttonText = attended ? "✓ Attendance saved" : status === "open" ? "Check in" : status === "closed" ? "Check-in closed" : "Not open yet";
        const description = event.description || event.notes || `Attendance event for ${event.audience}.`;
        const checkInCutoff = event.checkInCutoff || event.timeOut;
        const checkOutCutoff = event.checkOutCutoff || "";
        return `<article class="event-card"><div class="event-accent"></div><div class="event-body"><div class="event-card-kicker"><span class="event-type-badge">${escapeHtml(event.type || "School Event")}</span><span class="event-date">${escapeHtml(formatEventDate(event.date))}</span></div><h3>${escapeHtml(event.name)}</h3><div class="event-description"><strong>Description</strong>${escapeHtml(description)}</div><div class="event-meta"><span class="event-check-time"><b>IN</b>${escapeHtml(formatEventTime(event.timeIn))} – ${escapeHtml(formatEventTime(checkInCutoff))}</span><span class="event-check-time"><b>OUT</b>${escapeHtml(formatEventTime(event.timeOut))}${checkOutCutoff ? ` – ${escapeHtml(formatEventTime(checkOutCutoff))}` : ""}</span><span class="event-location">${escapeHtml(event.location)}</span></div><div class="event-card-actions">${attended ? '<span class="badge green">Attended</span>' : eventStatusBadge(status)}<button class="${attended ? "outline-button" : "primary-button"}" type="button" data-attend-event="${escapeHtml(event.id)}" ${disabled ? "disabled" : ""}>${buttonText}</button></div></div></article>`;
      }).join("");
      timeline.innerHTML = `<div class="timeline">${activeEvents.slice(0, 4).map((event) => `<div class="timeline-item"><span class="timeline-time">${escapeHtml(formatEventTime(event.timeIn))}</span><div class="timeline-main"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(formatEventDate(event.date))} · ${escapeHtml(formatTimeWindow(event))}</small></div>${attendanceIds.has(event.id) ? '<span class="badge green">Attended</span>' : eventStatusBadge(getEventStatus(event))}</div>`).join("")}</div>`;
    }
    renderAttendanceSummary();
  }

  function scheduleEventRender() {
    if (eventRenderFrame) return;
    eventRenderFrame = window.requestAnimationFrame(() => {
      eventRenderFrame = undefined;
      renderEvents();
    });
  }

  function scheduleEventStatusRefresh() {
    window.clearTimeout(eventStatusTimer);
    const now = Date.now();
    const nextStatusChange = Math.min(...events.flatMap((event) => [eventOpenDate(event).getTime(), eventCheckInCloseDate(event).getTime(), eventCloseDate(event).getTime(), eventCheckoutCloseDate(event).getTime()]).filter((time) => time > now));
    if (!Number.isFinite(nextStatusChange)) return;
    eventStatusTimer = window.setTimeout(() => {
      renderEvents();
      renderMyAttendances();
      scheduleEventStatusRefresh();
    }, Math.max(0, nextStatusChange - now) + 50);
  }

  function renderAttendanceSummary() {
    const attendedIds = new Set(attendance.map((record) => record.eventId));
    const closedEvents = events.filter((event) => getEventStatus(event) === "closed");
    const absences = closedEvents.filter((event) => !attendedIds.has(event.id));
    const presentDays = new Set(attendance.map((record) => record.eventDate)).size;
    document.querySelector("#eventsAttendedCount").textContent = attendance.length;
    document.querySelector("#absenceCount").textContent = absences.length;
    document.querySelector("#daysPresentCount").textContent = presentDays;
    document.querySelector("#eventsAttendedMeta").textContent = attendance.length ? `${attendance.length} attendance record${attendance.length === 1 ? "" : "s"}` : "No attendance recorded yet";
    document.querySelector("#absenceMeta").textContent = absences.length ? `${absences.length} closed event${absences.length === 1 ? "" : "s"} missed` : "No missed events";
    document.querySelector("#absenceSummaryCard").setAttribute("aria-label", absences.length ? `View details for ${absences.length} absence${absences.length === 1 ? "" : "s"}` : "View absence details");
    document.querySelector("#daysPresentMeta").textContent = presentDays ? `${presentDays} unique event day${presentDays === 1 ? "" : "s"}` : "Based on attended events";
    const records = closedEvents.filter((event) => !dismissedIds.has(event.id)).map((event) => ({ event, status: attendedIds.has(event.id) ? "Attended" : "Absent" }));
    const history = document.querySelector("#studentEventHistory");
    if (!records.length) {
      history.innerHTML = '<div class="empty-state">No finished event history yet.</div>';
      return;
    }
    history.innerHTML = records.reverse().map(({ event, status }) => {
      const description = event.description || event.notes || "No description provided.";
      return `<article class="history-event-card"><div class="history-card-top"><span class="event-type-badge">${escapeHtml(event.type || "School Event")}</span><span class="badge ${status === "Attended" ? "green" : "orange"}">${status}</span></div><h3>${escapeHtml(event.name)}</h3><p>${escapeHtml(description)}</p><div class="event-detail-boxes"><div><span>Date</span><strong>${escapeHtml(formatEventDate(event.date))}</strong></div><div><span>Time</span><strong>${escapeHtml(formatTimeWindow(event))}</strong></div><div><span>Location</span><strong>${escapeHtml(event.location)}</strong></div><div><span>Audience</span><strong>${escapeHtml(event.audience || "All students")}</strong></div></div><div class="history-card-actions"><button class="small-button danger" type="button" data-dismiss-history="${escapeHtml(event.id)}">Remove from history</button></div></article>`;
    }).join("");
  }

  function renderMyAttendances() {
    const container = document.querySelector("#studentAttendanceList");
    const records = attendance.slice().sort((first, second) => {
      const firstTime = first.checkedInAt?.seconds || first.attendedAt?.seconds || 0;
      const secondTime = second.checkedInAt?.seconds || second.attendedAt?.seconds || 0;
      return secondTime - firstTime;
    });
    if (!records.length) {
      container.innerHTML = '<div class="empty-state panel">No attendance records yet.</div>';
      return;
    }
    container.innerHTML = records.map((record) => {
      const event = events.find((item) => item.id === record.eventId) || record;
      const checkedInAt = record.checkedInAt || record.attendedAt;
      const completed = Boolean(record.checkedOutAt);
      const readyToCheckOut = !completed && record.status === "checked-in" && isCheckoutAvailable(event);
      const status = completed ? "Completed" : readyToCheckOut ? "Ready to check out" : new Date() < eventCloseDate(event) ? "Checked in" : "Checkout window closed";
      const color = completed ? "green" : readyToCheckOut ? "orange" : status === "Checked in" ? "blue" : "gray";
      const checkInWindow = event.timeIn ? `${formatEventTime(event.timeIn)} – ${formatEventTime(event.checkInCutoff || event.timeOut)}` : "Not recorded";
      const checkOutWindow = event.timeOut ? `${formatEventTime(event.timeOut)} – ${formatEventTime(event.checkOutCutoff || timePlusMinutes(event.timeOut))}` : "Not recorded";
      return `<article class="history-event-card attendance-record-card"><div class="history-card-top"><span class="event-type-badge">${escapeHtml(record.eventType || "School Event")}</span><span class="badge ${color}">${escapeHtml(status)}</span></div><h3>${escapeHtml(record.eventName || "Attendance event")}</h3><p>${escapeHtml(record.location || "Location not recorded")}</p><div class="event-detail-boxes"><div><span>Checked in</span><strong>${escapeHtml(formatAttendanceTimestamp(checkedInAt))}</strong></div><div><span>Checked out</span><strong>${escapeHtml(formatAttendanceTimestamp(record.checkedOutAt))}</strong></div><div><span>Check-in window</span><strong>${escapeHtml(checkInWindow)}</strong></div><div><span>Checkout window</span><strong>${escapeHtml(checkOutWindow)}</strong></div><div><span>Duration</span><strong>${escapeHtml(attendanceDuration(checkedInAt, record.checkedOutAt))}</strong></div></div>${readyToCheckOut ? `<div class="history-card-actions"><button class="primary-button" type="button" data-check-out-attendance="${escapeHtml(record.id)}">Check out</button></div>` : ""}</article>`;
    }).join("");
  }

  function renderFines() {
    const container = document.querySelector("#studentFineList");
    const fineWarning = document.querySelector("#studentFineWarning");
    const hasPendingFine = fines.some((fine) => fine.status !== "Completed");
    fineWarning.hidden = !hasPendingFine;
    fineWarning.closest(".nav-button").classList.toggle("has-pending-fines", hasPendingFine);
    if (!fines.length) {
      container.innerHTML = '<div class="empty-state panel">You have no assigned fines.</div>';
      return;
    }
    const groupedFines = Array.from(fines.reduce((groups, fine) => {
      const reasonKey = String(fine.eventName || "Attendance absence").trim().toLowerCase();
      const group = groups.get(reasonKey) || [];
      group.push(fine);
      groups.set(reasonKey, group);
      return groups;
    }, new Map()).values());
    container.innerHTML = groupedFines.map((group) => {
      const firstFine = group[0];
      const totalMinutes = group.reduce((total, fine) => total + (Number(fine.serviceMinutes) || 0), 0);
      const status = group.every((fine) => fine.status === "Completed") ? "Completed" : "Pending";
      const latestAssigned = group.reduce((latest, fine) => {
        const latestTime = latest?.assignedAt?.toDate?.()?.getTime?.() || 0;
        const fineTime = fine.assignedAt?.toDate?.()?.getTime?.() || 0;
        return fineTime > latestTime ? fine : latest;
      }, firstFine);
      const serviceLabel = status === "Completed" ? "Completed" : `${formatServiceMinutes(totalMinutes)} remaining`;
      const fineIds = group.map((fine) => fine.id).join(",");
      const needsReview = status !== "Completed";
      const warningBadge = needsReview ? '<span class="community-service-warning" role="status"><span aria-hidden="true">!!</span> Needs review</span>' : "";
      return `<button class="history-event-card community-service-card${needsReview ? " needs-settlement" : ""}" type="button" data-open-community-service="${escapeHtml(fineIds)}" aria-label="View attendance-fine details for ${escapeHtml(firstFine.eventName || "attendance absence")}${needsReview ? ", needs review" : ""}"><div class="history-card-top"><span class="event-type-badge">Attendance fine</span><span class="community-service-card-statuses">${warningBadge}<span class="badge orange">${escapeHtml(serviceLabel)}</span></span></div><h3>${escapeHtml(firstFine.eventName || "Attendance absence")}</h3><p>${group.length === 1 ? escapeHtml(firstFine.reason || "No reason provided.") : `${group.length} attendance records combined`}</p><div class="event-detail-boxes"><div><span>Status</span><strong>${escapeHtml(status)}</strong></div><div><span>Assigned</span><strong>${escapeHtml(formatFineDate(latestAssigned.assignedAt))}</strong></div></div><span class="community-service-card-action">View attendance-fine record <span aria-hidden="true">→</span></span></button>`;
    }).join("");
  }

  function renderProfile() {
    const container = document.querySelector("#studentProfileContent");
    const badge = document.querySelector("#profileStatusBadge");
    if (!studentProfile) return;
    const fullName = [studentProfile.firstName, studentProfile.middleName, studentProfile.lastName].filter(Boolean).join(" ");
    const initials = getInitials(studentProfile.firstName, studentProfile.lastName);
    badge.textContent = "Profile active";
    badge.className = "badge green";
    document.querySelectorAll("[data-student-name]").forEach((element) => { element.textContent = fullName; });
    document.querySelectorAll("[data-student-meta]").forEach((element) => { element.textContent = `${studentProfile.course || "Course pending"} · Section ${studentProfile.section}`; });
    document.querySelectorAll("[data-student-initials]").forEach((element) => { element.textContent = initials; element.hidden = Boolean(studentProfile.photoDataUrl); });
    document.querySelectorAll("[data-student-photo]").forEach((element) => {
      if (studentProfile.photoDataUrl) element.src = studentProfile.photoDataUrl;
      else element.removeAttribute("src");
      element.hidden = !studentProfile.photoDataUrl;
    });
    document.querySelectorAll("[data-student-first-name]").forEach((element) => { element.textContent = studentProfile.firstName; });
    updateDashboardGreeting(studentProfile.firstName || "Student");
    const profileVisual = studentProfile.photoDataUrl ? `<img src="${escapeHtml(studentProfile.photoDataUrl)}" alt="${escapeHtml(fullName)} profile photo">` : escapeHtml(initials);
    const fineCount = fines.length;
    container.innerHTML = `<div class="profile-grid"><article class="panel student-profile-card"><header class="student-profile-header"><div class="student-profile-identity"><div class="profile-avatar">${profileVisual}</div><div><h3>${escapeHtml(fullName)}</h3><p>Student ID · ${escapeHtml(studentProfile.accountId)}</p><span>Course Registered · <strong>${escapeHtml(studentProfile.course || "Not assigned")}</strong></span></div></div><button class="primary-button" type="button" id="editStudentProfile">Edit profile</button></header><div class="student-profile-details"><div class="profile-fact"><span>Birthday</span><strong>${escapeHtml(formatBirthday(studentProfile.birthday))}</strong></div><div class="profile-fact"><span>Course</span><strong>${escapeHtml(studentProfile.course || "Not assigned")}</strong></div><div class="profile-fact"><span>Section</span><strong>${escapeHtml(studentProfile.section)}</strong></div><div class="profile-fact"><span>Account</span><strong>Active</strong></div><div class="profile-fact"><span>Student ID</span><strong>${escapeHtml(studentProfile.accountId)}</strong></div><div class="profile-fact"><span>Phone</span><strong>${escapeHtml(studentProfile.phone || "Not provided")}</strong></div><div class="profile-fact profile-fact-wide"><span>Email</span><strong>${escapeHtml(studentProfile.email || "Not provided")}</strong></div></div><footer class="student-profile-actions"><button class="outline-button" type="button" id="checkStudentFines">Check attendance fines${fineCount ? ` (${fineCount})` : ""}</button></footer></article></div>`;
  }

  document.querySelector("#studentProfileContent").addEventListener("click", (event) => {
    if (!event.target.closest("#editStudentProfile") || !studentProfile) return;
    document.querySelector("#profileAccountId").value = studentProfile.accountId || "";
    document.querySelector("#profileFirstName").value = studentProfile.firstName || "";
    document.querySelector("#profileMiddleName").value = studentProfile.middleName || "";
    document.querySelector("#profileLastName").value = studentProfile.lastName || "";
    document.querySelector("#profileBirthday").value = studentProfile.birthday || "";
    document.querySelector("#profileCourse").value = studentProfile.course || "BSInfo Tech";
    document.querySelector("#profileSection").value = studentProfile.section || "1A";
    document.querySelector("#profileEmail").value = studentProfile.email || "";
    document.querySelector("#profilePhone").value = studentProfile.phone || "";
    document.querySelector("#profilePhoto").value = "";
    pendingProfilePhoto = studentProfile.photoDataUrl || "";
    updatePhotoPreview(pendingProfilePhoto);
    studentProfileModal.hidden = false;
    document.querySelector("#profileFirstName").focus();
  });

  document.querySelector("#studentProfileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const newAccountId = document.querySelector("#profileAccountId").value.trim();
    if (!/^[A-Za-z0-9._-]+$/.test(newAccountId)) {
      showDashboardToast("Invalid Student ID", "Use only letters, numbers, periods, underscores, or dashes.");
      return;
    }
    const newKey = newAccountId.toLowerCase();
    const oldAccountId = studentProfile.accountId;
    const oldKey = (studentProfile.accountIdKey || oldAccountId || "").toLowerCase();

    try {
      if (oldKey !== newKey) {
        const idSnap = await getDoc(doc(db, "studentIds", newKey));
        if (idSnap.exists() && idSnap.data().uid !== currentUser.uid) {
          showDashboardToast("Student ID taken", "This Student ID is already registered by another student.");
          return;
        }
      }

      const updateData = {
        accountId: newAccountId,
        accountIdKey: newKey,
        firstName: document.querySelector("#profileFirstName").value.trim(),
        middleName: document.querySelector("#profileMiddleName").value.trim(),
        lastName: document.querySelector("#profileLastName").value.trim(),
        birthday: document.querySelector("#profileBirthday").value,
        course: document.querySelector("#profileCourse").value,
        section: document.querySelector("#profileSection").value,
        email: document.querySelector("#profileEmail").value.trim(),
        phone: document.querySelector("#profilePhone").value.trim(),
        photoDataUrl: pendingProfilePhoto,
        updatedAt: serverTimestamp()
      };

      if (oldKey !== newKey) {
        const batch = writeBatch(db);
        batch.set(doc(db, "students", currentUser.uid), updateData, { merge: true });
        if (oldKey) batch.delete(doc(db, "studentIds", oldKey));
        batch.set(doc(db, "studentIds", newKey), {
          studentId: newAccountId,
          uid: currentUser.uid,
          createdAt: serverTimestamp()
        });
        await batch.commit();
      } else {
        await setDoc(doc(db, "students", currentUser.uid), updateData, { merge: true });
      }

      closeStudentProfileModal();
      showDashboardToast("Profile updated", "Your changes are now live.");
    } catch (error) {
      showDashboardToast("Unable to update profile", error.code === "permission-denied" ? "Publish the latest database rules first." : error.message);
    }
  });
  document.querySelector("#profilePhoto").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      pendingProfilePhoto = await prepareProfilePhoto(file);
      updatePhotoPreview(pendingProfilePhoto);
    } catch (error) {
      event.target.value = "";
      showDashboardToast("Unable to use photo", error.message);
    }
  });
  document.querySelector("#removeProfilePhoto").addEventListener("click", () => {
    pendingProfilePhoto = "";
    document.querySelector("#profilePhoto").value = "";
    updatePhotoPreview();
  });
  document.querySelector("#profileFirstName").addEventListener("input", () => { if (!pendingProfilePhoto) updatePhotoPreview(); });
  document.querySelector("#profileLastName").addEventListener("input", () => { if (!pendingProfilePhoto) updatePhotoPreview(); });
  document.querySelectorAll("[data-close-student-profile]").forEach((button) => button.addEventListener("click", closeStudentProfileModal));
  studentProfileModal.addEventListener("click", (event) => { if (event.target === studentProfileModal) closeStudentProfileModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !studentProfileModal.hidden) closeStudentProfileModal(); });

  const communityServiceModal = document.querySelector("#studentCommunityServiceModal");
  const communityServiceModalContent = document.querySelector("#studentCommunityServiceModalContent");
  const communityServiceModalController = new FineModalController({ modal: communityServiceModal, content: communityServiceModalContent, title: document.querySelector("#studentCommunityServiceModalTitle"), description: document.querySelector("#studentCommunityServiceModalDescription"), closeSelector: "[data-close-community-service]" });

  function serviceRecordMarkup(fine) {
    const serviceStatus = fine.status === "Completed" ? "Completed" : "Pending";
    const history = getFineHistory(fine).slice().reverse().map((entry) => {
      const action = entry.action === "Added" ? `Additional service: ${formatServiceMinutes(entry.addedMinutes)}` : entry.action === "Updated" ? "Service requirement updated" : `Assigned: ${formatServiceMinutes(entry.newMinutes || fine.serviceMinutes)}`;
      return `<li><strong>${escapeHtml(action)}</strong><span>${escapeHtml(formatFineTimestamp(entry.recordedAt))}</span>${entry.reason ? `<small>Reason: ${escapeHtml(entry.reason)}</small>` : ""}</li>`;
    }).join("");
    return `<article class="community-service-record"><div class="community-service-record-top"><strong>${escapeHtml(fine.eventName || "Attendance absence")}</strong><span class="badge ${serviceStatus === "Completed" ? "green" : "orange"}">${escapeHtml(serviceStatus)}</span></div><div class="fine-detail-grid"><div><span>Service required</span><strong>${escapeHtml(formatServiceMinutes(fine.serviceMinutes))}</strong></div><div><span>Assigned</span><strong>${escapeHtml(formatFineDate(fine.assignedAt))}</strong></div><div class="fine-detail-full"><span>Reason</span><strong>${escapeHtml(fine.reason || "No reason provided.")}</strong></div></div>${history ? `<h4>Service history</h4><ol class="fine-history-list">${history}</ol>` : ""}</article>`;
  }

  function openCommunityServiceModal(fineIds, trigger) {
    const selectedFines = fineIds.split(",").map((id) => fines.find((fine) => fine.id === id)).filter(Boolean);
    if (!selectedFines.length) return;
    const currentService = selectedFines.filter((fine) => fine.status !== "Completed");
    const pastService = selectedFines.filter((fine) => fine.status === "Completed");
    communityServiceModalController.open({ title: "Attendance fine details", description: "Review the attendance-fine records for this event.", markup: `<section class="community-service-section"><div class="community-service-section-heading"><h3>Current records</h3><p>Records that still need attention.</p></div>${currentService.length ? currentService.map(serviceRecordMarkup).join("") : '<div class="community-service-empty">No current attendance-fine records for this event.</div>'}</section><section class="community-service-section"><div class="community-service-section-heading"><h3>Reviewed records</h3><p>Completed attendance-fine records and their notes.</p></div>${pastService.length ? pastService.map(serviceRecordMarkup).join("") : '<div class="community-service-empty">No reviewed attendance-fine records for this event yet.</div>'}</section>`, trigger });
  }

  function openAllStudentFinesModal(trigger) {
    const currentRecords = fines.filter((fine) => fine.status !== "Completed");
    const reviewedRecords = fines.filter((fine) => fine.status === "Completed");
    communityServiceModalController.open({ title: "Your attendance fines", description: "Review all attendance-fine records assigned to your profile.", markup: `<section class="community-service-section"><div class="community-service-section-heading"><h3>Current records</h3><p>Attendance-fine records that still need attention.</p></div>${currentRecords.length ? currentRecords.map(serviceRecordMarkup).join("") : '<div class="community-service-empty">No current attendance fines recorded.</div>'}</section><section class="community-service-section"><div class="community-service-section-heading"><h3>Reviewed records</h3><p>Attendance-fine records marked as completed.</p></div>${reviewedRecords.length ? reviewedRecords.map(serviceRecordMarkup).join("") : '<div class="community-service-empty">No reviewed attendance fines recorded.</div>'}</section>`, trigger });
  }

  function closeCommunityServiceModal() {
    communityServiceModalController.close();
  }

  document.querySelector("#studentFineList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-community-service]");
    if (button) openCommunityServiceModal(button.dataset.openCommunityService, button);
  });
  document.querySelector("#studentProfileContent").addEventListener("click", (event) => {
    const button = event.target.closest("#checkStudentFines");
    if (button) openAllStudentFinesModal(button);
  });
  document.querySelector("#absenceSummaryCard").addEventListener("click", () => {
    const hasPendingFine = fines.some((fine) => fine.status !== "Completed");
    openView(hasPendingFine ? "fines" : "history");
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !communityServiceModal.hidden) closeCommunityServiceModal(); });

  document.body.insertAdjacentHTML("beforeend", `<div class="dashboard-modal-backdrop" id="geofenceErrorModal" hidden><section class="dashboard-modal" role="alertdialog" aria-modal="true" aria-labelledby="geofenceErrorTitle" aria-describedby="geofenceErrorMessage"><button class="modal-close" type="button" data-close-geofence-error aria-label="Close">×</button><span class="modal-icon danger">!</span><h2 id="geofenceErrorTitle">Attendance unavailable</h2><p id="geofenceErrorMessage"></p><div class="modal-actions"><button class="primary-button" type="button" data-close-geofence-error>Okay</button></div></section></div>`);
  const geofenceErrorModal = document.querySelector("#geofenceErrorModal");
  const closeGeofenceError = () => { geofenceErrorModal.hidden = true; };
  document.querySelectorAll("[data-close-geofence-error]").forEach((element) => element.addEventListener("click", closeGeofenceError));
  geofenceErrorModal.addEventListener("click", (event) => { if (event.target === geofenceErrorModal) closeGeofenceError(); });
  function showGeofenceError(title, message) {
    document.querySelector("#geofenceErrorTitle").textContent = title;
    document.querySelector("#geofenceErrorMessage").textContent = message;
    geofenceErrorModal.hidden = false;
  }

  function getCurrentCheckInLocation() {
    if (!navigator.geolocation) {
      const locationError = new Error("This browser does not support location services.");
      locationError.geofenceIssue = "location";
      return Promise.reject(locationError);
    }
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, (error) => {
      const messages = { 1: "Location permission is required for this attendance area.", 2: "Your location could not be determined. Try moving outdoors and try again.", 3: "Location request timed out. Please try again." };
      const locationError = new Error(messages[error.code] || "Unable to get your location.");
      locationError.geofenceIssue = "location";
      locationError.locationErrorCode = error.code;
      reject(locationError);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));
  }
  function distanceInMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
    const radians = (value) => value * Math.PI / 180;
    const earthRadius = 6371000;
    const deltaLatitude = radians(latitudeB - latitudeA);
    const deltaLongitude = radians(longitudeB - longitudeA);
    const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(deltaLongitude / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  document.querySelector("#studentEventGrid").addEventListener("click", async (clickEvent) => {
    const button = clickEvent.target.closest("[data-attend-event]");
    if (!button) return;
    const selectedEvent = events.find((event) => event.id === button.dataset.attendEvent);
    let faceRegistration;
    try {
      faceRegistration = await getDocFromServer(doc(db, "faceRegistrations", currentUser.uid));
    } catch {
      showGeofenceError("Facial recognition could not be verified", "Presence must verify your facial recognition before attendance can be recorded. Check your connection and try again.");
      return;
    }
    faceRegistrationLoaded = true;
    faceAlreadyRegistered = faceRegistration.data()?.registered === true;
    if (!faceAlreadyRegistered) {
      showGeofenceError("Facial recognition required", "You have not completed facial recognition yet. You must register your face first before you can take attendance. The Face Registration page is now open.");
      openView("face");
      return;
    }
    if (!selectedEvent || getEventStatus(selectedEvent) !== "open") return showDashboardToast("Attendance unavailable", "Attendance is allowed only from Time In until the check-in cutoff.");
    button.disabled = true;
    try {
      let checkInLocation;
      if (selectedEvent.geofence?.enabled) {
        const area = selectedEvent.geofence;
        if (!Number.isFinite(area.latitude) || !Number.isFinite(area.longitude) || !Number.isFinite(area.radiusMeters)) {
          const configurationError = new Error("This event's attendance area is incomplete. Please contact your administrator.");
          configurationError.geofenceIssue = "configuration";
          throw configurationError;
        }
        showDashboardToast("Checking your location", "Allow location access to confirm you are in the attendance area.");
        const position = await getCurrentCheckInLocation();
        const { latitude, longitude, accuracy } = position.coords;
        const distance = distanceInMeters(latitude, longitude, area.latitude, area.longitude);
        if (distance > area.radiusMeters) {
          const rangeError = new Error(`You are about ${Math.round(distance)} m from the allowed attendance area.`);
          rangeError.geofenceIssue = "outside";
          rangeError.distanceMeters = Math.round(distance);
          rangeError.radiusMeters = Math.round(area.radiusMeters);
          throw rangeError;
        }
        checkInLocation = { latitude, longitude, accuracy: Math.round(accuracy), distanceMeters: Math.round(distance) };
      }
      await setDoc(doc(db, "attendance", `${currentUser.uid}_${selectedEvent.id}`), {
        studentUid: currentUser.uid,
        studentId: studentProfile.accountId,
        eventId: selectedEvent.id,
        eventName: selectedEvent.name,
        eventType: selectedEvent.type || "School Event",
        eventDescription: selectedEvent.description || selectedEvent.notes || "",
        eventDate: selectedEvent.date,
        timeIn: selectedEvent.timeIn,
        timeOut: selectedEvent.timeOut,
        location: selectedEvent.location,
        audience: selectedEvent.audience || "All students",
        ...(checkInLocation ? { checkInLocation } : {}),
        attendedAt: serverTimestamp(),
        checkedInAt: serverTimestamp(),
        status: "checked-in"
      });
      showDashboardToast("Attendance recorded", "Your attendance was saved successfully.");
    } catch (error) {
      if (error.geofenceIssue === "outside") {
        showGeofenceError("You are outside the attendance area", `You are approximately ${error.distanceMeters} meters from the event location. You must be within ${error.radiusMeters} meters to check in, so attendance cannot be recorded yet.`);
      } else if (error.geofenceIssue === "location") {
        showGeofenceError("Allow location for Presence", "Your device location may be on, but this browser has not allowed this site to use it. Click the site controls icon to the left of the address bar, set Location to Allow, then reload this page and try again.");
      } else if (error.geofenceIssue === "configuration") {
        showGeofenceError("Attendance area needs setup", error.message);
      } else {
        showDashboardToast("Attendance rejected", error.code === "permission-denied" ? "The attendance window is not open, or your account cannot check in to this event." : error.message);
      }
      button.disabled = false;
    }
  });

  document.querySelector("#studentEventHistory").addEventListener("click", async (clickEvent) => {
    const button = clickEvent.target.closest("[data-dismiss-history]");
    if (!button) return;
    await setDoc(doc(db, "dismissedHistory", `${currentUser.uid}_${button.dataset.dismissHistory}`), { studentUid: currentUser.uid, eventId: button.dataset.dismissHistory, dismissedAt: serverTimestamp() });
    showDashboardToast("History entry removed", "The finished event is hidden from your history.");
  });

  document.querySelector("#studentAttendanceList").addEventListener("click", async (clickEvent) => {
    const button = clickEvent.target.closest("[data-check-out-attendance]");
    if (!button) return;
    const record = attendance.find((item) => item.id === button.dataset.checkOutAttendance);
    const event = events.find((item) => item.id === record?.eventId);
    if (!record || !event || !isCheckoutAvailable(event)) {
      showDashboardToast("Checkout unavailable", "Checkout is available from Time Out until the event's checkout cutoff.");
      return;
    }
    button.disabled = true;
    try {
      let checkOutLocation;
      if (event.geofence?.enabled) {
        if (!Number.isFinite(event.geofence.latitude) || !Number.isFinite(event.geofence.longitude) || !Number.isFinite(event.geofence.radiusMeters)) {
          throw new Error("This event's attendance area is incomplete. Please contact your administrator.");
        }
        const position = await getCurrentCheckInLocation();
        const distance = distanceInMeters(position.coords.latitude, position.coords.longitude, event.geofence.latitude, event.geofence.longitude);
        if (distance > event.geofence.radiusMeters) throw new Error(`You are about ${Math.round(distance)} m from the allowed attendance area.`);
        checkOutLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: Math.round(position.coords.accuracy), distanceMeters: Math.round(distance) };
      }
      await setDoc(doc(db, "attendance", record.id), { checkedOutAt: serverTimestamp(), status: "completed", ...(checkOutLocation ? { checkOutLocation } : {}) }, { merge: true });
      showDashboardToast("Checkout recorded", "Your attendance record now includes your checkout time.");
    } catch (error) {
      showDashboardToast("Unable to check out", error.message || "Try again while you are in the attendance area.");
      button.disabled = false;
    }
  });

  const startCameraButton = document.querySelector("#startCamera");
  const captureFaceButton = document.querySelector("#captureFace");
  const retakeFaceButton = document.querySelector("#retakeFace");
  const cameraPreview = document.querySelector("#cameraPreview");
  const faceCapturePreview = document.querySelector("#faceCapturePreview");
  const cameraPlaceholder = document.querySelector("#cameraPlaceholder");
  const faceCameraBox = document.querySelector("#faceCameraBox");
  const faceRegistrationGuide = document.querySelector("#faceRegistrationGuide");
  const faceGuidancePanel = document.querySelector("#faceGuidancePanel");
  const faceGuidanceStep = document.querySelector("#faceGuidanceStep");
  const faceGuidanceTitle = document.querySelector("#faceGuidanceTitle");
  const faceGuidanceMessage = document.querySelector("#faceGuidanceMessage");
  const faceConsentLabel = document.querySelector("#faceConsentLabel");
  const faceRegistrationConsent = document.querySelector("#faceRegistrationConsent");
  let faceGuidanceTimers = [];
  let facePhotoCaptured = false;
  let faceAlreadyRegistered = false;
  let faceRegistrationLoaded = false;

  function lockFaceRegistration() {
    faceAlreadyRegistered = true;
    clearFaceGuidanceTimers();
    if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
    cameraPreview.hidden = true;
    faceCapturePreview.hidden = true;
    cameraPlaceholder.hidden = false;
    faceRegistrationGuide.hidden = true;
    faceConsentLabel.hidden = true;
    retakeFaceButton.hidden = true;
    faceGuidancePanel.hidden = false;
    setFaceGuidance("complete", "✓", "Face registration already complete", "To replace your photo, ask your administrator to reset your face registration.");
    startCameraButton.disabled = true;
    startCameraButton.textContent = "Face registered";
    captureFaceButton.disabled = true;
    captureFaceButton.textContent = "Face registered";
  }

  function unlockFaceRegistration() {
    faceAlreadyRegistered = false;
    facePhotoCaptured = false;
    clearFaceGuidanceTimers();
    cameraPreview.hidden = true;
    faceCapturePreview.hidden = true;
    cameraPlaceholder.hidden = false;
    faceRegistrationGuide.hidden = true;
    faceGuidancePanel.hidden = true;
    faceConsentLabel.hidden = false;
    faceRegistrationConsent.checked = false;
    retakeFaceButton.hidden = true;
    startCameraButton.disabled = false;
    startCameraButton.textContent = "Start camera";
    captureFaceButton.disabled = true;
    captureFaceButton.textContent = "Capture photo";
    faceCameraBox.dataset.guidance = "idle";
  }

  function setFaceGuidance(state, step, title, message) {
    faceCameraBox.dataset.guidance = state;
    faceGuidanceStep.textContent = step;
    faceGuidanceTitle.textContent = title;
    faceGuidanceMessage.textContent = message;
  }

  function clearFaceGuidanceTimers() {
    faceGuidanceTimers.forEach((timer) => window.clearTimeout(timer));
    faceGuidanceTimers = [];
  }

  function updateFaceCaptureAvailability() {
    const isReady = faceCameraBox.dataset.guidance === "ready";
    captureFaceButton.disabled = !isReady || !faceRegistrationConsent.checked;
  }

  function beginFaceGuidance() {
    clearFaceGuidanceTimers();
    facePhotoCaptured = false;
    faceCapturePreview.hidden = true;
    faceRegistrationGuide.hidden = false;
    faceGuidancePanel.hidden = false;
    faceConsentLabel.hidden = false;
    retakeFaceButton.hidden = true;
    captureFaceButton.textContent = "Capture photo";
    setFaceGuidance("positioning", "1", "Fit your face in the outline", "Center your full face, look directly at the camera, and use even lighting.");
    faceGuidanceTimers.push(window.setTimeout(() => {
      setFaceGuidance("steady", "2", "Hold still…", "Keep your face inside the outline while we prepare your registration photo.");
    }, 1600));
    faceGuidanceTimers.push(window.setTimeout(() => {
      setFaceGuidance("ready", "3", "Steady — ready to capture", "Your face is positioned. Confirm consent, then capture your photo.");
      updateFaceCaptureAvailability();
    }, 3600));
  }

  function retakeFacePhoto() {
    facePhotoCaptured = false;
    faceCapturePreview.hidden = true;
    cameraPreview.hidden = false;
    faceRegistrationGuide.hidden = false;
    retakeFaceButton.hidden = true;
    captureFaceButton.textContent = "Capture photo";
    setFaceGuidance("ready", "3", "Steady — ready to capture", "Check your position, then capture a new photo.");
    updateFaceCaptureAvailability();
  }

  function captureFacePhoto() {
    const canvas = document.createElement("canvas");
    const sourceWidth = cameraPreview.videoWidth || 640;
    const sourceHeight = cameraPreview.videoHeight || 480;
    const scale = Math.min(1, 640 / sourceWidth);
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    canvas.getContext("2d").drawImage(cameraPreview, 0, 0, canvas.width, canvas.height);
    faceCapturePreview.src = canvas.toDataURL("image/jpeg", .78);
    facePhotoCaptured = true;
    cameraPreview.hidden = true;
    faceCapturePreview.hidden = false;
    faceRegistrationGuide.hidden = true;
    retakeFaceButton.hidden = false;
    captureFaceButton.textContent = "Register face";
    captureFaceButton.disabled = false;
    setFaceGuidance("review", "4", "Review your photo", "If your face is clear and centered, register it. Otherwise, choose Retake.");
  }
  startCameraButton.addEventListener("click", async () => {
    if (faceAlreadyRegistered) return;
    if (!faceRegistrationConsent.checked) {
      showDashboardToast("Consent required", "Please check the consent checkbox before starting the camera.");
      faceRegistrationConsent.focus();
      return;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      cameraPreview.srcObject = mediaStream;
      cameraPreview.hidden = false;
      cameraPlaceholder.hidden = true;
      await cameraPreview.play();
      captureFaceButton.disabled = true;
      startCameraButton.disabled = true;
      startCameraButton.textContent = "Camera ready";
      beginFaceGuidance();
    } catch {
      clearFaceGuidanceTimers();
      faceRegistrationGuide.hidden = true;
      faceGuidancePanel.hidden = true;
      faceCameraBox.dataset.guidance = "idle";
      showDashboardToast("Camera permission needed", "Allow camera access to continue face registration.");
    }
  });
  faceRegistrationConsent.addEventListener("change", updateFaceCaptureAvailability);
  retakeFaceButton.addEventListener("click", retakeFacePhoto);
  captureFaceButton.addEventListener("click", async () => {
    if (!facePhotoCaptured) {
      if (!faceRegistrationConsent.checked) return;
      captureFacePhoto();
      return;
    }
    captureFaceButton.disabled = true;
    captureFaceButton.textContent = "Saving securely…";
    try {
      await uploadFacePhotoToDrive(faceCapturePreview.src, studentProfile);
    } catch (error) {
      captureFaceButton.disabled = false;
      captureFaceButton.textContent = "Register face";
      showDashboardToast("Photo upload unavailable", "Check your connection, then try registering again.");
      return;
    }
    const registration = await waitForFaceRegistration(currentUser.uid, true);
    if (!registration) {
      captureFaceButton.disabled = false;
      captureFaceButton.textContent = "Register face";
      showDashboardToast("Registration not confirmed", "The Drive upload did not finish. Please try again or contact your administrator.");
      return;
    }
    document.querySelector("#faceStatus").textContent = "Registered";
    document.querySelector("#faceStatus").className = "badge green";
    lockFaceRegistration();
    createNotification({ recipientUid: currentUser.uid, category: "face", title: "Face registration confirmed", message: "Your face registration is ready for future attendance check-ins.", targetView: "face" }).catch(() => {});
    createNotification({ recipientRole: "admin", category: "face", title: "Face registration completed", message: `${[studentProfile?.firstName, studentProfile?.lastName].filter(Boolean).join(" ") || "A student"} completed face registration.`, targetView: "modify-students", studentName: [studentProfile?.firstName, studentProfile?.lastName].filter(Boolean).join(" "), studentId: studentProfile?.accountId || "", section: studentProfile?.section || "" }).catch(() => {});
    showDashboardToast("Face registered", "Registration status was saved successfully.");
  });

  onSnapshot(doc(db, "students", currentUser.uid), async (snapshot) => {
    if (!snapshot.exists()) {
      sessionStorage.removeItem("presenceSession");
      await signOut(auth);
      window.location.replace("../index.html");
      return;
    }
    studentProfile = snapshot.data();
    renderProfile();
  });
  onSnapshot(query(collection(db, "events"), orderBy("openAt", "asc")), (snapshot) => { events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); scheduleEventRender(); renderMyAttendances(); scheduleEventStatusRefresh(); });
  onSnapshot(query(collection(db, "attendance"), where("studentUid", "==", currentUser.uid)), (snapshot) => { attendance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); scheduleEventRender(); renderMyAttendances(); });
  onSnapshot(query(collection(db, "dismissedHistory"), where("studentUid", "==", currentUser.uid)), (snapshot) => { dismissedIds = new Set(snapshot.docs.map((item) => item.data().eventId)); scheduleEventRender(); });
  onSnapshot(query(collection(db, "fines"), where("studentUid", "==", currentUser.uid)), (snapshot) => { fines = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderFines(); renderProfile(); });
  onSnapshot(doc(db, "faceRegistrations", currentUser.uid), (snapshot) => {
    faceRegistrationLoaded = true;
    if (snapshot.data()?.registered) {
      document.querySelector("#faceStatus").textContent = "Registered";
      document.querySelector("#faceStatus").className = "badge green";
      lockFaceRegistration();
    } else {
      unlockFaceRegistration();
    }
  });
}

function initializeAdmin() {
  let events = [];
  let students = [];
  let attendance = [];
  let fines = [];
  let selectedFineStudentUid = "";
  let faceRegistrationsByUid = new Map();
  let presenceByUid = new Map();
  let legacyPresenceByUid = new Map();
  const eventForm = document.querySelector("#eventForm");
  function setDefaultCutoff(timeInputId, cutoffInputId) {
    const time = document.querySelector(timeInputId).value;
    const cutoff = document.querySelector(cutoffInputId);
    if (!cutoff.value) cutoff.value = timePlusMinutes(time);
  }
  document.querySelector("#eventTimeIn").addEventListener("change", () => setDefaultCutoff("#eventTimeIn", "#eventCheckInCutoff"));
  document.querySelector("#eventTimeOut").addEventListener("change", () => setDefaultCutoff("#eventTimeOut", "#eventCheckOutCutoff"));
  const studentForm = document.querySelector("#studentForm");
  const eventTableBody = document.querySelector("#eventTableBody");
  const pastEventList = document.querySelector("#pastEventList");
  const pastEventRemovalModal = document.querySelector("#pastEventRemovalModal");
  let selectedPastEventForRemoval;
  const studentTableBody = document.querySelector("#studentTableBody");
  const studentMobileCards = document.querySelector("#studentMobileCards");
  const studentSearch = document.querySelector("#studentSearch");
  const studentCourseFilter = document.querySelector("#studentCourseFilter");
  const studentSectionFilter = document.querySelector("#studentSectionFilter");
  const studentFaceFilter = document.querySelector("#studentFaceFilter");
  const studentAccountFilter = document.querySelector("#studentAccountFilter");
  const studentAttendanceFilter = document.querySelector("#studentAttendanceFilter");
  const studentFineFilter = document.querySelector("#studentFineFilter");
  const studentSort = document.querySelector("#studentSort");
  const studentPagination = document.querySelector("#studentPagination");
  const studentPageInfo = document.querySelector("#studentPageInfo");
  const previousStudentPage = document.querySelector("#previousStudentPage");
  const nextStudentPage = document.querySelector("#nextStudentPage");
  const fineForm = document.querySelector("#fineForm");
  const fineStudent = document.querySelector("#fineStudent");
  const fineStudentSearch = document.querySelector("#fineStudentSearch");
  fineStudentSearch.insertAdjacentHTML("afterend", '<div class="fine-student-search-results" id="fineStudentSearchResults" role="listbox" hidden></div>');
  const fineStudentSearchResults = document.querySelector("#fineStudentSearchResults");
  const adminFineModalController = new FineModalController({ modal: document.querySelector("#adminFineModal"), content: document.querySelector("#adminFineModalContent"), title: document.querySelector("#adminFineModalTitle"), description: document.querySelector("#adminFineModalDescription"), closeSelector: "[data-close-admin-fines]" });
  const fineEvent = document.querySelector("#fineEvent");
  const addCommunityService = document.querySelector("#addCommunityService");
  const fineExtensionControls = document.querySelector("#fineExtensionControls");
  const fineExtensionHours = document.querySelector("#fineExtensionHours");
  const fineExtensionMinutes = document.querySelector("#fineExtensionMinutes");
  const fineExtensionReason = document.querySelector("#fineExtensionReason");
  const fineServiceDurationHelp = document.querySelector("#fineServiceDurationHelp");
  const adminFineList = document.querySelector("#adminFineList");
  const fineSearch = document.querySelector("#fineSearch");
  const fineStatusFilter = document.querySelector("#fineStatusFilter");
  const fineDateFilter = document.querySelector("#fineDateFilter");
  const fineSort = document.querySelector("#fineSort");
  const passwordModal = document.querySelector("#passwordModal");
  const removeStudentModal = document.querySelector("#removeStudentModal");
  const resetFaceModal = document.querySelector("#resetFaceModal");
  const roleChangeModal = document.querySelector("#roleChangeModal");
  const roleChangeMessage = document.querySelector("#roleChangeMessage");
  const confirmRoleChange = document.querySelector("#confirmRoleChange");
  const adminStudentDetail = document.querySelector("#adminStudentDetail");
  let selectedPasswordStudent;
  let selectedRemovalStudent;
  let selectedFaceResetStudent;
  let selectedManagedStudentUid;
  let pendingRoleChange;
  let removalCountdownTimer;
  let pendingAdminProfilePhoto = "";
  let addingCommunityService = false;
  const studentPageSize = 10;
  let studentPage = 1;
  let studentRenderFrame;
  let adminEventStatusTimer;
  let studentFilterSignature = "";
  const studentDirectoryMediaQuery = window.matchMedia("(max-width: 580px)");

  function closeRoleChangeModal() {
    if (pendingRoleChange?.selector) pendingRoleChange.selector.value = pendingRoleChange.previousRole;
    pendingRoleChange = undefined;
    roleChangeModal.hidden = true;
  }

  function openRoleChangeModal(student, role, selector) {
    const previousRole = student.role || "student";
    pendingRoleChange = { student, role, previousRole, selector };
    roleChangeMessage.textContent = `Change ${student.accountId}'s role from ${roleLabel(previousRole)} to ${roleLabel(role)}? They will need to sign out and sign back in before the new access takes effect.`;
    roleChangeModal.hidden = false;
    confirmRoleChange.focus();
  }

  document.querySelectorAll("[data-close-role-change]").forEach((button) => button.addEventListener("click", closeRoleChangeModal));
  roleChangeModal.addEventListener("click", (event) => { if (event.target === roleChangeModal) closeRoleChangeModal(); });

  function scheduleStudentsRender() {
    if (activeView !== "modify-students") return;
    if (studentRenderFrame) return;
    studentRenderFrame = window.requestAnimationFrame(() => {
      studentRenderFrame = undefined;
      renderStudents();
    });
  }

  function scheduleAdminEventStatusRefresh() {
    window.clearTimeout(adminEventStatusTimer);
    const now = Date.now();
    const nextStatusChange = Math.min(...events.flatMap((event) => [eventOpenDate(event).getTime(), eventCheckInCloseDate(event).getTime(), eventCloseDate(event).getTime(), eventCheckoutCloseDate(event).getTime()]).filter((time) => time > now));
    if (!Number.isFinite(nextStatusChange)) return;
    adminEventStatusTimer = window.setTimeout(() => {
      if (["dashboard", "modify-events"].includes(activeView)) renderAdminEvents();
      if (activeView === "past-events") renderPastEvents();
      scheduleAdminEventStatusRefresh();
    }, Math.max(0, nextStatusChange - now) + 50);
  }

  const eventSyncNotice = document.querySelector(".notice");
  if (eventSyncNotice) eventSyncNotice.textContent = "Events are saved online and sync automatically to student dashboards, including after refresh.";
  studentTableBody.closest("table").querySelectorAll("th")[1].textContent = "Course / Section";
  studentTableBody.closest("table").querySelectorAll("th")[2].textContent = "Face / live status";
  document.querySelector('label[for="eventNotes"]').textContent = "Description";
  document.querySelector("#eventNotes").placeholder = "Write a clear announcement or event description";
  document.querySelector("#eventLocation").closest(".field").insertAdjacentHTML("beforebegin", '<div class="field"><label for="eventType">Event type</label><select id="eventType" required><option value="Assembly">Assembly</option><option value="Meeting">Meeting</option><option value="Seminar">Seminar</option><option value="Workshop">Workshop</option><option value="School Activity">School Activity</option><option value="Ceremony">Ceremony</option><option value="Sports">Sports</option><option value="Other">Other</option></select></div>');
  document.querySelector("#eventNotes").closest(".field").insertAdjacentHTML("beforebegin", `<fieldset class="geofence-editor field full"><legend>Attendance area</legend><label class="geofence-toggle"><input id="eventGeofenceEnabled" type="checkbox"> <span>Require location to check in</span></label><p>Choose the center of the allowed attendance area and set its radius.</p><div class="map-search-row"><input id="eventGeofenceSearch" type="search" placeholder="Search an address or place"><button id="eventGeofenceSearchButton" class="outline-button" type="button">Search</button></div><div id="eventGeofenceMap" class="geofence-map" aria-label="Event attendance area map"></div><div class="geofence-fields"><div class="field"><label for="eventGeofenceRadius">Allowed radius (meters)</label><input id="eventGeofenceRadius" type="number" min="25" max="5000" step="5" value="100"></div><div class="field"><label for="eventGeofenceAddress">Selected address</label><input id="eventGeofenceAddress" type="text" readonly placeholder="Click the map or search for a place"></div><div class="field"><label for="eventGeofenceLatitude">Latitude</label><input id="eventGeofenceLatitude" type="number" step="any" readonly></div><div class="field"><label for="eventGeofenceLongitude">Longitude</label><input id="eventGeofenceLongitude" type="number" step="any" readonly></div></div><small class="geofence-help">Click anywhere on the map to set the pin. A student must allow location access and be inside this circle to check in.</small></fieldset>`);
  document.querySelector(".content").insertAdjacentHTML("beforeend", `<section class="view-section" data-section="geofence" hidden><div class="section-head"><div><p class="eyebrow">Attendance setup</p><h2>Geofence Locations</h2><p>Select an event and update the area where students may check in.</p></div></div><article class="panel geofence-manager-panel"><div class="field"><label for="geofenceEventSelect">Event</label><select id="geofenceEventSelect"><option value="">Select an event</option></select></div><div id="geofenceManagerContent" hidden><div class="geofence-manager-head"><div><strong id="geofenceManagerEventName"></strong><small id="geofenceManagerEventDetails"></small></div><label class="geofence-toggle"><input id="managerGeofenceEnabled" type="checkbox"> <span>Require location to check in</span></label></div><div class="map-search-row"><input id="managerGeofenceSearch" type="search" placeholder="Search an address or place"><button id="managerGeofenceSearchButton" class="outline-button" type="button">Search</button></div><div id="managerGeofenceMap" class="geofence-map" aria-label="Selected event attendance area map"></div><div class="geofence-fields"><div class="field"><label for="managerGeofenceRadius">Allowed radius (meters)</label><input id="managerGeofenceRadius" type="number" min="25" max="5000" step="5" value="100"></div><div class="field"><label for="managerGeofenceAddress">Selected address</label><input id="managerGeofenceAddress" type="text" readonly></div><div class="field"><label for="managerGeofenceLatitude">Latitude</label><input id="managerGeofenceLatitude" type="number" step="any" readonly></div><div class="field"><label for="managerGeofenceLongitude">Longitude</label><input id="managerGeofenceLongitude" type="number" step="any" readonly></div></div><div class="form-actions"><button id="geofenceEditEvent" class="outline-button" type="button">Edit full event</button><button id="saveManagerGeofence" class="primary-button" type="button">Save attendance area</button></div></div><div id="geofenceManagerEmpty" class="empty-state">Select an event to view or change its attendance area.</div></article></section>`);
  document.querySelector("#adminProfileEmail").value = currentUser.email || ADMIN_EMAIL;

  function makeGeofenceEditor(prefix) {
    const enabled = document.querySelector(`#${prefix}GeofenceEnabled`);
    const search = document.querySelector(`#${prefix}GeofenceSearch`);
    const searchButton = document.querySelector(`#${prefix}GeofenceSearchButton`);
    const radius = document.querySelector(`#${prefix}GeofenceRadius`);
    const address = document.querySelector(`#${prefix}GeofenceAddress`);
    const latitude = document.querySelector(`#${prefix}GeofenceLatitude`);
    const longitude = document.querySelector(`#${prefix}GeofenceLongitude`);
    const mapElement = document.querySelector(`#${prefix}GeofenceMap`);
    let map;
    let marker;
    let circle;
    const hasMap = () => typeof window.L !== "undefined";
    const currentRadius = () => Math.max(25, Math.min(5000, Number(radius.value) || 100));
    const refreshCircle = () => {
      if (!map || !marker) return;
      if (circle) circle.setRadius(currentRadius());
      else circle = window.L.circle(marker.getLatLng(), { radius: currentRadius(), color: "#1f6feb", fillColor: "#1f6feb", fillOpacity: .14 }).addTo(map);
    };
    const ensureMap = () => {
      if (map || !hasMap()) return map;
      map = window.L.map(mapElement, { scrollWheelZoom: false }).setView([14.5995, 120.9842], 5);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
      map.on("click", ({ latlng }) => place(latlng.lat, latlng.lng));
      return map;
    };
    const place = (lat, lng, label = "") => {
      const activeMap = ensureMap();
      latitude.value = Number(lat).toFixed(6);
      longitude.value = Number(lng).toFixed(6);
      if (label) address.value = label;
      if (!activeMap) return;
      const point = [Number(lat), Number(lng)];
      if (marker) marker.setLatLng(point); else marker = window.L.marker(point, { draggable: true }).addTo(activeMap);
      marker.on("dragend", () => place(marker.getLatLng().lat, marker.getLatLng().lng));
      if (circle) circle.setLatLng(point);
      refreshCircle();
      activeMap.setView(point, Math.max(activeMap.getZoom(), 17));
    };
    const searchPlace = async () => {
      const queryText = search.value.trim();
      if (!queryText) return;
      searchButton.disabled = true;
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(queryText)}`, { headers: { Accept: "application/json" } });
        const [result] = await response.json();
        if (!result) throw new Error("No matching place found.");
        place(result.lat, result.lon, result.display_name);
      } catch (error) {
        showDashboardToast("Location search unavailable", error.message || "Try clicking the map to set the area.");
      } finally { searchButton.disabled = false; }
    };
    radius.addEventListener("input", refreshCircle);
    searchButton.addEventListener("click", searchPlace);
    search.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); searchPlace(); } });
    return {
      ensureMap,
      invalidate() { ensureMap()?.invalidateSize(); },
      clear() { enabled.checked = false; radius.value = 100; address.value = ""; latitude.value = ""; longitude.value = ""; if (marker && map) map.removeLayer(marker); if (circle && map) map.removeLayer(circle); marker = undefined; circle = undefined; },
      set(geofence = {}) { this.clear(); enabled.checked = Boolean(geofence.enabled); radius.value = geofence.radiusMeters || 100; address.value = geofence.address || ""; if (Number.isFinite(geofence.latitude) && Number.isFinite(geofence.longitude)) place(geofence.latitude, geofence.longitude, geofence.address || ""); },
      value() { return { enabled: enabled.checked, latitude: Number(latitude.value), longitude: Number(longitude.value), radiusMeters: currentRadius(), address: address.value.trim() }; }
    };
  }

  const eventGeofenceEditor = makeGeofenceEditor("event");
  const managerGeofenceEditor = makeGeofenceEditor("manager");
  const geofenceEventSelect = document.querySelector("#geofenceEventSelect");
  const geofenceManagerContent = document.querySelector("#geofenceManagerContent");
  const geofenceManagerEmpty = document.querySelector("#geofenceManagerEmpty");
  function renderGeofenceEventOptions(selectedId = geofenceEventSelect.value) {
    geofenceEventSelect.innerHTML = `<option value="">Select an event</option>${events.map((event) => `<option value="${escapeHtml(event.id)}">${escapeHtml(event.name)} · ${escapeHtml(event.date || "No date")}</option>`).join("")}`;
    geofenceEventSelect.value = events.some((event) => event.id === selectedId) ? selectedId : "";
  }
  function loadGeofenceManager(eventId = geofenceEventSelect.value) {
    const selectedEvent = events.find((event) => event.id === eventId);
    geofenceManagerContent.hidden = !selectedEvent;
    geofenceManagerEmpty.hidden = Boolean(selectedEvent);
    if (!selectedEvent) return;
    geofenceEventSelect.value = selectedEvent.id;
    document.querySelector("#geofenceManagerEventName").textContent = selectedEvent.name;
    document.querySelector("#geofenceManagerEventDetails").textContent = `${selectedEvent.date || "No date"} · ${selectedEvent.location || "Location not set"}`;
    managerGeofenceEditor.set(selectedEvent.geofence || {});
    window.setTimeout(() => managerGeofenceEditor.invalidate(), 0);
  }
  geofenceEventSelect.addEventListener("change", () => loadGeofenceManager());
  document.querySelector("#saveManagerGeofence").addEventListener("click", async () => {
    const selectedEvent = events.find((event) => event.id === geofenceEventSelect.value);
    if (!selectedEvent) return;
    const geofence = managerGeofenceEditor.value();
    if (geofence.enabled && (!Number.isFinite(geofence.latitude) || !Number.isFinite(geofence.longitude))) return showDashboardToast("Choose an attendance area", "Click the map or search for the event location before saving.");
    try { await setDoc(doc(db, "events", selectedEvent.id), { geofence, updatedAt: serverTimestamp() }, { merge: true }); showDashboardToast("Attendance area saved", `${selectedEvent.name} now uses the updated location rule.`); } catch (error) { showDashboardToast("Unable to save area", error.message); }
  });
  document.querySelector("#geofenceEditEvent").addEventListener("click", () => { const id = geofenceEventSelect.value; if (id) editEvent(id); });
  window.addEventListener("presence:viewchange", ({ detail }) => { if (detail.viewName === "create") window.setTimeout(() => eventGeofenceEditor.invalidate(), 0); if (detail.viewName === "geofence") window.setTimeout(() => managerGeofenceEditor.invalidate(), 0); });

  async function prepareAdminProfilePhoto(file) {
    if (!file.type.match(/^image\/(jpeg|png|webp)$/)) throw new Error("Choose a JPG, PNG, or WebP image.");
    if (file.size > 8 * 1024 * 1024) throw new Error("Choose an image smaller than 8 MB.");
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read this image."));
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = source;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 320, 320);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 320, 320);
    const compressed = canvas.toDataURL("image/jpeg", .82);
    if (compressed.length > 350000) throw new Error("The processed image is still too large. Try another photo.");
    return compressed;
  }

  function updateAdminPhotoPreview(photoDataUrl = "") {
    const image = document.querySelector("#adminProfilePhotoPreviewImage");
    const initials = document.querySelector("#adminProfilePhotoPreviewInitials");
    if (photoDataUrl) {
      image.src = photoDataUrl;
      image.hidden = false;
      initials.hidden = true;
      return;
    }
    image.removeAttribute("src");
    image.hidden = true;
    initials.hidden = false;
    initials.textContent = (document.querySelector("#adminDisplayName").value || "School Admin").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "AD";
  }

  function renderAdminProfile(profile = {}) {
    const displayName = profile.displayName || "School Admin";
    const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "AD";
    document.querySelector("#adminDisplayName").value = displayName;
    document.querySelector("#adminProfileBirthday").value = profile.birthday || "";
    document.querySelector("#adminProfilePhone").value = profile.phone || "";
    document.querySelectorAll("[data-admin-name]").forEach((element) => { element.textContent = displayName; });
    document.querySelectorAll("[data-admin-initials]").forEach((element) => { element.textContent = initials; element.hidden = Boolean(profile.photoDataUrl); });
    document.querySelectorAll("[data-admin-photo]").forEach((element) => {
      if (profile.photoDataUrl) element.src = profile.photoDataUrl;
      else element.removeAttribute("src");
      element.hidden = !profile.photoDataUrl;
    });
    pendingAdminProfilePhoto = profile.photoDataUrl || "";
    updateAdminPhotoPreview(pendingAdminProfilePhoto);
    updateDashboardGreeting(displayName);
  }

  document.querySelector("#adminProfileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await setDoc(doc(db, "adminProfiles", currentUser.uid), {
        displayName: document.querySelector("#adminDisplayName").value.trim(),
        birthday: document.querySelector("#adminProfileBirthday").value,
        phone: document.querySelector("#adminProfilePhone").value.trim(),
        photoDataUrl: pendingAdminProfilePhoto,
        email: currentUser.email,
        updatedAt: serverTimestamp()
      }, { merge: true });
      showDashboardToast("Profile updated", "Your changes are now live.");
    } catch (error) {
      showDashboardToast("Unable to update profile", error.code === "permission-denied" ? "Publish the latest database rules first." : error.message);
    }
  });

  document.querySelector("#adminProfilePhoto").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      pendingAdminProfilePhoto = await prepareAdminProfilePhoto(file);
      updateAdminPhotoPreview(pendingAdminProfilePhoto);
    } catch (error) {
      event.target.value = "";
      showDashboardToast("Unable to use photo", error.message);
    }
  });
  document.querySelector("#removeAdminProfilePhoto").addEventListener("click", () => {
    pendingAdminProfilePhoto = "";
    document.querySelector("#adminProfilePhoto").value = "";
    updateAdminPhotoPreview();
  });
  document.querySelector("#adminDisplayName").addEventListener("input", () => { if (!pendingAdminProfilePhoto) updateAdminPhotoPreview(); });

  const dataCleanupModal = document.querySelector("#dataCleanupModal");
  const clearEventData = document.querySelector("#clearEventData");
  const clearFineData = document.querySelector("#clearFineData");
  const dataCleanupConfirm = document.querySelector("#dataCleanupConfirm");
  const confirmDataCleanup = document.querySelector("#confirmDataCleanup");

  function updateDataCleanupState() {
    const selected = clearEventData.checked || clearFineData.checked;
    confirmDataCleanup.disabled = !selected || dataCleanupConfirm.value.trim() !== "CLEAR";
  }

  function renderDataCleanupCounts() {
    document.querySelector("#dataCleanupCounts").innerHTML = `<div><strong>${events.length}</strong><span>Events</span></div><div><strong>${attendance.length}</strong><span>Attendance records</span></div><div><strong>${fines.length}</strong><span>Assigned fines</span></div>`;
  }

  function closeDataCleanupModal() {
    dataCleanupModal.hidden = true;
    clearEventData.checked = false;
    clearFineData.checked = false;
    dataCleanupConfirm.value = "";
    updateDataCleanupState();
  }

  document.querySelector("#openDataCleanup").addEventListener("click", () => {
    renderDataCleanupCounts();
    dataCleanupModal.hidden = false;
    clearEventData.focus();
  });
  [clearEventData, clearFineData].forEach((input) => input.addEventListener("change", updateDataCleanupState));
  dataCleanupConfirm.addEventListener("input", updateDataCleanupState);
  document.querySelectorAll("[data-close-data-cleanup]").forEach((button) => button.addEventListener("click", closeDataCleanupModal));
  dataCleanupModal.addEventListener("click", (event) => { if (event.target === dataCleanupModal) closeDataCleanupModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !dataCleanupModal.hidden) closeDataCleanupModal(); });
  confirmDataCleanup.addEventListener("click", async () => {
    if (confirmDataCleanup.disabled) return;
    confirmDataCleanup.disabled = true;
    confirmDataCleanup.textContent = "Clearing data…";
    try {
      await currentUser.getIdToken(true);
      const clearEvents = clearEventData.checked;
      const clearFines = clearFineData.checked;
      const snapshots = await Promise.all([
        clearEvents ? getDocs(collection(db, "events")) : Promise.resolve(null),
        clearEvents ? getDocs(collection(db, "attendance")) : Promise.resolve(null),
        clearEvents ? getDocs(collection(db, "dismissedHistory")) : Promise.resolve(null),
        clearFines ? getDocs(collection(db, "fines")) : Promise.resolve(null)
      ]);
      const [eventSnapshot, attendanceSnapshot, dismissedSnapshot, fineSnapshot] = snapshots;
      await Promise.all([
        eventSnapshot ? writeInBatches(eventSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve(),
        attendanceSnapshot ? writeInBatches(attendanceSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve(),
        dismissedSnapshot ? writeInBatches(dismissedSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve(),
        fineSnapshot ? writeInBatches(fineSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve()
      ]);
      const counts = { events: eventSnapshot?.size || 0, attendance: attendanceSnapshot?.size || 0, fines: fineSnapshot?.size || 0 };
      closeDataCleanupModal();
      showDashboardToast("Selected data cleared", `${counts.events || 0} event${counts.events === 1 ? "" : "s"}, ${counts.attendance || 0} attendance record${counts.attendance === 1 ? "" : "s"}, and ${counts.fines || 0} fine${counts.fines === 1 ? "" : "s"} were removed.`);
    } catch (error) {
      showDashboardToast("Unable to clear data", error.code === "permission-denied" ? "Your account is not allowed to clear these records." : error.message || "Try again after refreshing the dashboard.");
      updateDataCleanupState();
    } finally {
      confirmDataCleanup.textContent = "Clear selected data";
    }
  });

  function renderAdminAttendance() {
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const presentIds = new Set(attendance.filter((record) => record.eventDate === localDate).map((record) => record.studentUid));
    const present = presentIds.size;
    const pending = Math.max(students.length - present, 0);
    const rate = students.length ? Math.round((present / students.length) * 100) : 0;
    document.querySelector("#registeredCount").textContent = students.length;
    document.querySelector("#presentTodayCount").textContent = present;
    document.querySelector("#presentTodayMeta").textContent = students.length ? `${rate}% of registered students` : "No attendance records yet";
    document.querySelector("#notCheckedInCount").textContent = pending;
    document.querySelector("#notCheckedInMeta").textContent = students.length ? "Registered students without a check-in today" : "No students registered";
    document.querySelector("#adminAttendancePercent").textContent = `${rate}%`;
    document.querySelector("#adminAttendanceDetail").textContent = `${present} present`;
    document.querySelector("#adminAttendanceRing").style.background = `conic-gradient(#1f6feb 0 ${rate}%, #e8eef7 ${rate}% 100%)`;
  }

  function attendanceLineMarkup(records) {
    if (!records.length) return '<div class="empty-state">No attendance activity yet.</div>';
    return records.map((record) => {
      const student = students.find((item) => item.uid === record.studentUid);
      const studentName = student ? [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") : record.studentId || "Student";
      const avatar = student?.photoDataUrl ? `<img src="${escapeHtml(student.photoDataUrl)}" alt="">` : escapeHtml(getInitials(student?.firstName || studentName, student?.lastName || ""));
      const checkedInAt = record.checkedInAt || record.attendedAt;
      const completed = Boolean(record.checkedOutAt);
      return `<article class="attendance-line-item"><div class="attendance-line-person"><span class="mini-avatar">${avatar}</span><div><strong>${escapeHtml(studentName)}</strong><small>${escapeHtml(student?.accountId || record.studentId || "Student ID unavailable")}${student?.section ? ` · ${escapeHtml(student.section)}` : ""}</small></div></div><div class="attendance-line-event"><strong>${escapeHtml(record.eventName || "Attendance event")}</strong><small>${escapeHtml(record.eventDate || "Date unavailable")}</small></div><div class="attendance-line-times"><div><span>IN</span><strong>${escapeHtml(formatAttendanceTimestamp(checkedInAt))}</strong></div><div><span>OUT</span><strong>${escapeHtml(formatAttendanceTimestamp(record.checkedOutAt))}</strong></div><div><span>Duration</span><strong>${escapeHtml(attendanceDuration(checkedInAt, record.checkedOutAt))}</strong></div></div><span class="badge ${completed ? "green" : "blue"}">${completed ? "Completed" : "Checked in"}</span></article>`;
    }).join("");
  }

  function renderAttendanceLine() {
    const filter = document.querySelector("#adminAttendanceEventFilter");
    const selectedEvent = filter.value || "all";
    const eventOptions = events.map((event) => `<option value="${escapeHtml(event.id)}">${escapeHtml(event.name)}${event.date ? ` · ${escapeHtml(event.date)}` : ""}</option>`).join("");
    filter.innerHTML = `<option value="all">All events</option>${eventOptions}`;
    filter.value = events.some((event) => event.id === selectedEvent) ? selectedEvent : "all";
    const records = attendance
      .filter((record) => filter.value === "all" || record.eventId === filter.value)
      .sort((first, second) => (second.checkedInAt?.seconds || second.attendedAt?.seconds || 0) - (first.checkedInAt?.seconds || first.attendedAt?.seconds || 0));
    document.querySelector("#adminAttendanceLine").innerHTML = attendanceLineMarkup(records);
    document.querySelector("#adminDashboardAttendanceLine").innerHTML = attendanceLineMarkup(records.slice(0, 5));
  }

  document.querySelector("#adminAttendanceEventFilter").addEventListener("change", renderAttendanceLine);

  function renderAdminEvents() {
    document.querySelector("#eventCount").textContent = events.length;
    const timeline = document.querySelector("#adminEventTimeline");
    if (!events.length) {
      timeline.innerHTML = '<div class="empty-state">No events have been created yet.</div>';
      eventTableBody.innerHTML = '<div class="empty-state panel">No events have been created yet.</div>';
      return;
    }
    timeline.innerHTML = events.slice(0, 5).map((event) => `<div class="timeline-item"><span class="timeline-time">${escapeHtml(formatEventTime(event.timeIn))}</span><div class="timeline-main"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(formatEventDate(event.date))} · ${escapeHtml(formatTimeWindow(event))}</small></div>${eventStatusBadge(getEventStatus(event))}</div>`).join("");
    const currentEvents = events.filter((event) => !isEventFinished(event));
    eventTableBody.innerHTML = currentEvents.length ? currentEvents.map((event) => eventCardMarkup(event, false)).join("") : '<div class="empty-state panel">No current or upcoming events. Open Past Events to manage completed events.</div>';
  }

  function eventCardMarkup(event, past) {
    return `<article class="admin-event-card"><div class="admin-event-card-top"><span class="event-type-badge">${escapeHtml(event.type || "School Event")}</span>${eventStatusBadge(getEventStatus(event))}</div><h3>${escapeHtml(event.name)}</h3><p>${escapeHtml(event.description || event.notes || "No description provided.")}</p><div class="event-detail-boxes"><div><span>Date</span><strong>${escapeHtml(formatEventDate(event.date))}</strong></div><div><span>Time</span><strong>${escapeHtml(formatTimeWindow(event))}</strong></div><div><span>Location</span><strong>${escapeHtml(event.location)}</strong></div><div><span>Attendance area</span><strong>${event.geofence?.enabled ? `${escapeHtml(String(event.geofence.radiusMeters || 100))} m required` : "Not required"}</strong></div></div><div class="admin-event-card-actions">${past ? "" : `<button class="outline-button" type="button" data-manage-geofence="${event.id}">Attendance area</button>`}<button class="outline-button" type="button" data-edit-event="${event.id}">Edit event</button><button class="small-button danger modal-danger-button" type="button" data-delete-event="${event.id}">Remove</button></div></article>`;
  }

  function renderPastEvents() {
    const pastEvents = events.filter((event) => isEventFinished(event)).sort((first, second) => eventCloseDate(second) - eventCloseDate(first));
    pastEventList.innerHTML = pastEvents.length ? pastEvents.map((event) => eventCardMarkup(event, true)).join("") : '<div class="empty-state panel">No past events yet.</div>';
  }

  function renderFineOptions() {
    const selectedStudent = fineStudent.value;
    const selectedEvent = fineEvent.value;
    const search = fineStudentSearch.value.trim().toLowerCase();
    const matchingStudents = students.filter((student) => {
      const searchable = [student.firstName, student.middleName, student.lastName, student.accountId].filter(Boolean).join(" ").toLowerCase();
      return !search || searchable.includes(search) || student.uid === selectedStudent;
    });
    if (search) {
      fineStudentSearchResults.hidden = false;
      fineStudentSearchResults.innerHTML = matchingStudents.length
        ? matchingStudents.map((student) => {
          const fullName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
          return `<button class="fine-student-search-result" type="button" role="option" data-select-fine-student="${escapeHtml(student.uid)}"><strong>${escapeHtml(fullName)}</strong><small>Student ID · ${escapeHtml(student.accountId)}</small></button>`;
        }).join("")
        : '<p class="fine-student-search-empty">No student matches that name or Student ID.</p>';
    } else {
      fineStudentSearchResults.hidden = true;
      fineStudentSearchResults.innerHTML = "";
    }
    const emptyOption = matchingStudents.length ? "" : '<option value="" disabled selected>No students found</option>';
    fineStudent.innerHTML = `<option value="" disabled ${selectedStudent ? "" : "selected"}>Select a student</option>${emptyOption}${matchingStudents.map((student) => `<option value="${escapeHtml(student.uid)}">${escapeHtml([student.lastName, student.firstName, student.middleName].filter(Boolean).join(", "))} · ${escapeHtml(student.accountId)}</option>`).join("")}`;
    const eventPrompt = events.length ? "Select a missed event" : "No events available";
    fineEvent.innerHTML = `<option value="" disabled ${selectedEvent ? "" : "selected"}>${eventPrompt}</option>${events.map((event) => `<option value="${escapeHtml(event.id)}">${escapeHtml(event.name)}${event.date ? ` · ${escapeHtml(event.date)}` : ""}</option>`).join("")}`;
    fineStudent.value = selectedStudent;
    fineEvent.value = selectedEvent;
  }

  function renderAdminFines() {
    const search = fineSearch.value.trim().toLowerCase();
    const statusFilter = fineStatusFilter.value;
    const dateFilter = fineDateFilter.value;
    const sort = fineSort.value;
    const filteredFines = fines
      .filter((fine) => statusFilter === "all" || (fine.status || "Pending") === statusFilter)
      .filter((fine) => !search || [fine.studentName, fine.studentId, fine.eventName, fine.reason, fine.status, ...getFineHistory(fine).flatMap((entry) => [entry.action, entry.reason, entry.recordedAt, entry.previousMinutes, entry.newMinutes])].join(" ").toLowerCase().includes(search))
      .filter((fine) => !dateFilter || [fine.eventDate, fine.assignedAt?.toDate?.().toISOString().slice(0, 10), ...getFineHistory(fine).map((entry) => String(entry.recordedAt || "").slice(0, 10))].includes(dateFilter))
      .sort((first, second) => {
        if (sort === "oldest") return (first.assignedAt?.seconds || 0) - (second.assignedAt?.seconds || 0);
        if (sort === "student") return String(first.studentName || "").localeCompare(String(second.studentName || ""));
        if (sort === "duration") return Number(second.serviceMinutes || 0) - Number(first.serviceMinutes || 0);
        return (second.assignedAt?.seconds || 0) - (first.assignedAt?.seconds || 0);
      });
    document.querySelector("#fineResultCount").textContent = `${filteredFines.length} fine${filteredFines.length === 1 ? "" : "s"} shown`;
    if (!filteredFines.length) {
      adminFineList.innerHTML = `<div class="empty-state">${fines.length ? "No fines match the current search or filter." : "No fines have been assigned."}</div>`;
      return;
    }
    adminFineList.innerHTML = filteredFines.map((fine) => {
      const sameReasonCount = fines.filter((item) => item.studentUid === fine.studentUid && String(item.eventName || "Attendance absence").trim().toLowerCase() === String(fine.eventName || "Attendance absence").trim().toLowerCase()).length;
      const actions = `<div class="history-card-actions"><button class="outline-button" type="button" data-edit-fine="${escapeHtml(fine.id)}">Modify</button><button class="small-button danger" type="button" data-delete-fine="${escapeHtml(fine.id)}">Remove</button></div>`;
      const detailArea = sameReasonCount > 1 ? fineDetailsMarkup(fine, true) : actions;
      return `<article class="fine-record-card"><div class="history-card-top"><span class="event-type-badge">${escapeHtml(fine.studentId || "Student")}</span><span class="badge orange">${escapeHtml(formatServiceMinutes(fine.serviceMinutes))}</span></div><h3>${escapeHtml(fine.studentName || "Student")}</h3><div class="fine-record-event"><span>Missed attendance</span><strong>${escapeHtml(fine.eventName || "Attendance absence")}</strong></div><p>${escapeHtml(fine.reason || "No reason provided.")}</p><div class="fine-record-meta"><div><span>Status</span><strong class="${fine.status === "Completed" ? "is-completed" : ""}">${escapeHtml(fine.status || "Pending")}</strong></div><div><span>Assigned</span><strong>${escapeHtml(formatFineDate(fine.assignedAt))}</strong></div></div>${detailArea}</article>`;
    }).join("");
  }

  function resetFineForm() {
    fineForm.reset();
    document.querySelector("#fineServiceHours").value = "0";
    document.querySelector("#fineServiceMinutes").value = "30";
    fineStudentSearch.value = "";
    renderFineOptions();
    document.querySelector("#editingFineId").value = "";
    document.querySelector("#fineFormTitle").textContent = "Assign a fine";
    document.querySelector("#fineSubmitButton").textContent = "Assign fine";
    addCommunityService.hidden = true;
    fineExtensionControls.hidden = true;
    fineExtensionHours.value = "0";
    fineExtensionMinutes.value = "30";
    fineExtensionReason.value = "";
    fineServiceDurationHelp.textContent = "";
    addingCommunityService = false;
    fineForm.classList.remove("is-extending-service");
    addCommunityService.textContent = "Extend community service";
  }

  function editFine(fine) {
    if (!fine) return;
    openView("assign-fine");
    document.querySelector("#editingFineId").value = fine.id;
    fineStudent.value = fine.studentUid || "";
    if (fine.eventId && !events.some((event) => event.id === fine.eventId)) fineEvent.add(new Option(fine.eventName || "Previously selected event", fine.eventId));
    fineEvent.value = fine.eventId || "";
    const serviceMinutes = Math.min(600, Math.max(1, Number(fine.serviceMinutes) || 30));
    document.querySelector("#fineServiceHours").value = String(Math.floor(serviceMinutes / 60));
    document.querySelector("#fineServiceMinutes").value = String(serviceMinutes % 60);
    document.querySelector("#fineStatus").value = fine.status || "Pending";
    document.querySelector("#fineReason").value = fine.reason || "";
    document.querySelector("#fineFormTitle").textContent = `Modify fine for ${fine.studentId || "student"}`;
    document.querySelector("#fineSubmitButton").textContent = "Save fine changes";
    addCommunityService.hidden = false;
    fineExtensionControls.hidden = true;
    fineServiceDurationHelp.textContent = "Edit the total requirement, or add extra service time below.";
    addingCommunityService = false;
    fineForm.classList.remove("is-extending-service");
    addCommunityService.textContent = "Extend community service";
    fineForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  fineForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const student = students.find((item) => item.uid === fineStudent.value);
    if (!student) {
      showDashboardToast("Select a student", "Choose the student who missed attendance.");
      return;
    }
    const attendanceEvent = events.find((item) => item.id === fineEvent.value);
    const editingFineId = document.querySelector("#editingFineId").value;
    const editingFine = fines.find((fine) => fine.id === editingFineId);
    if (!attendanceEvent && !editingFineId) {
      showDashboardToast("Select a missed event", "Create or select an event before assigning this fine.");
      return;
    }
    const enteredServiceMinutes = addingCommunityService
      ? Math.min(600, Math.max(1, Number(fineExtensionHours.value) * 60 + Number(fineExtensionMinutes.value)))
      : Math.min(600, Math.max(1, Number(document.querySelector("#fineServiceHours").value) * 60 + Number(document.querySelector("#fineServiceMinutes").value)));
    const serviceMinutes = editingFineId && addingCommunityService
      ? Math.min(600, (Number(editingFine?.serviceMinutes) || 0) + enteredServiceMinutes)
      : enteredServiceMinutes;
    if (!addingCommunityService) setFineServiceDuration(enteredServiceMinutes);
    const fineData = {
      studentUid: student.uid,
      studentId: student.accountId,
      studentName: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
      eventId: attendanceEvent?.id || (editingFine?.eventId === fineEvent.value ? editingFine.eventId : ""),
      eventName: attendanceEvent?.name || (editingFine?.eventId === fineEvent.value ? editingFine.eventName : ""),
      eventDate: attendanceEvent?.date || (editingFine?.eventId === fineEvent.value ? editingFine.eventDate : ""),
      eventTimeIn: attendanceEvent?.timeIn || (editingFine?.eventId === fineEvent.value ? editingFine.eventTimeIn || "" : ""),
      eventTimeOut: attendanceEvent?.timeOut || (editingFine?.eventId === fineEvent.value ? editingFine.eventTimeOut || "" : ""),
      eventLocation: attendanceEvent?.location || (editingFine?.eventId === fineEvent.value ? editingFine.eventLocation || "" : ""),
      serviceMinutes,
      reason: document.querySelector("#fineReason").value.trim(),
      status: document.querySelector("#fineStatus").value
    };
    try {
      if (editingFineId) {
        const previousMinutes = Number(editingFine?.serviceMinutes) || 0;
        const historyEntry = addingCommunityService
          ? { action: "Added", previousMinutes, addedMinutes: enteredServiceMinutes, newMinutes: serviceMinutes, reason: fineExtensionReason.value.trim(), recordedAt: new Date().toISOString() }
          : { action: "Updated", previousMinutes, newMinutes: serviceMinutes, reason: fineData.reason, recordedAt: new Date().toISOString() };
        await setDoc(doc(db, "fines", editingFineId), {
          ...fineData,
          assignmentHistory: [...getFineHistory(editingFine), historyEntry],
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.uid
        }, { merge: true });
        createNotification({ recipientUid: student.uid, category: "service", title: addingCommunityService ? "Community service updated" : "Community service requirement updated", message: addingCommunityService ? `${formatServiceMinutes(enteredServiceMinutes)} was added to your ${fineData.eventName || "community service"} requirement.` : `Your service requirement for ${fineData.eventName || "an attendance absence"} was updated.`, targetView: "fines", studentName: fineData.studentName, studentId: student.accountId, section: student.section }).catch(() => {});
        createNotification({ recipientRole: "admin", category: "service", title: "Community service updated", message: `${student.accountId}'s service requirement was updated.`, targetView: "assigned-fines", studentName: fineData.studentName, studentId: student.accountId, section: student.section }).catch(() => {});
        showDashboardToast(addingCommunityService ? "Community service added" : "Fine updated", addingCommunityService ? `${formatServiceMinutes(enteredServiceMinutes)} was added to this fine.` : `${student.accountId}'s fine was updated.`);
      } else {
        await addDoc(collection(db, "fines"), {
          ...fineData,
          assignmentHistory: [{ action: "Assigned", addedMinutes: serviceMinutes, newMinutes: serviceMinutes, reason: fineData.reason, recordedAt: new Date().toISOString() }],
          assignedAt: serverTimestamp(),
          assignedBy: currentUser.uid
        });
        createNotification({ recipientUid: student.uid, category: "service", title: "Community service assigned", message: `You were assigned ${formatServiceMinutes(serviceMinutes)} of community service for ${fineData.eventName || "an attendance absence"}.`, targetView: "fines", studentName: fineData.studentName, studentId: student.accountId, section: student.section }).catch(() => {});
        createNotification({ recipientRole: "admin", category: "service", title: "Community service assigned", message: `${student.accountId} was assigned a community-service requirement.`, targetView: "assigned-fines", studentName: fineData.studentName, studentId: student.accountId, section: student.section }).catch(() => {});
        showDashboardToast("Fine assigned", `${student.accountId} was assigned a new community-service requirement.`);
      }
      resetFineForm();
      openView("assigned-fines");
    } catch (error) {
      showDashboardToast("Unable to assign fine", error.code === "permission-denied" ? "Publish the latest database rules, then try again." : error.message);
    }
  });

  function setFineServiceDuration(totalMinutes) {
    const normalizedMinutes = Math.min(600, Math.max(1, totalMinutes));
    document.querySelector("#fineServiceHours").value = String(Math.floor(normalizedMinutes / 60));
    document.querySelector("#fineServiceMinutes").value = String(normalizedMinutes % 60);
  }

  function setFineExtensionDuration(totalMinutes) {
    const normalizedMinutes = Math.min(600, Math.max(1, totalMinutes));
    fineExtensionHours.value = String(Math.floor(normalizedMinutes / 60));
    fineExtensionMinutes.value = String(normalizedMinutes % 60);
  }

  function setCommunityServiceExtension(open) {
    addingCommunityService = open;
    fineExtensionControls.hidden = !open;
    fineForm.classList.toggle("is-extending-service", open);
    addCommunityService.textContent = open ? "Cancel extension" : "Extend community service";
    if (open) {
      setFineExtensionDuration(30);
      fineExtensionReason.value = "";
    }
  }

  addCommunityService.addEventListener("click", () => {
    if (!document.querySelector("#editingFineId").value) return;
    setCommunityServiceExtension(!addingCommunityService);
    fineServiceDurationHelp.textContent = "";
  });

  document.querySelectorAll("[data-adjust-fine-minutes]").forEach((button) => {
    button.addEventListener("click", () => {
      const totalMinutes = Number(document.querySelector("#fineServiceHours").value) * 60 + Number(document.querySelector("#fineServiceMinutes").value);
      setFineServiceDuration(totalMinutes + Number(button.dataset.adjustFineMinutes));
    });
  });

  document.querySelectorAll("#fineServiceHours, #fineServiceMinutes").forEach((input) => {
    input.addEventListener("change", () => setFineServiceDuration(Number(document.querySelector("#fineServiceHours").value) * 60 + Number(document.querySelector("#fineServiceMinutes").value)));
  });

  document.querySelectorAll("[data-adjust-extension-minutes]").forEach((button) => {
    button.addEventListener("click", () => setFineExtensionDuration(Number(fineExtensionHours.value) * 60 + Number(fineExtensionMinutes.value) + Number(button.dataset.adjustExtensionMinutes)));
  });

  [fineExtensionHours, fineExtensionMinutes].forEach((input) => {
    input.addEventListener("change", () => setFineExtensionDuration(Number(fineExtensionHours.value) * 60 + Number(fineExtensionMinutes.value)));
  });

  document.querySelectorAll('[data-view="assign-fine"], [data-go-view="assign-fine"]').forEach((button) => {
    button.addEventListener("click", resetFineForm);
  });

  adminFineList.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-fine]");
    const button = event.target.closest("[data-delete-fine]");
    if (editButton) {
      editFine(fines.find((fine) => fine.id === editButton.dataset.editFine));
      return;
    }
    if (!button) return;
    try {
      await deleteDoc(doc(db, "fines", button.dataset.deleteFine));
      showDashboardToast("Fine removed", "The community-service requirement was removed.");
    } catch (error) {
      showDashboardToast("Unable to remove fine", error.message);
    }
  });

  document.querySelector("#cancelFineEdit").addEventListener("click", () => window.setTimeout(resetFineForm));
  fineStudentSearch.addEventListener("input", renderFineOptions);
  fineStudentSearchResults.addEventListener("click", (event) => {
    const result = event.target.closest("[data-select-fine-student]");
    if (!result) return;
    fineStudent.value = result.dataset.selectFineStudent;
    fineStudentSearch.value = "";
    renderFineOptions();
    fineStudent.focus();
  });
  fineSearch.addEventListener("input", renderAdminFines);
  fineStatusFilter.addEventListener("change", renderAdminFines);
  fineDateFilter.addEventListener("change", renderAdminFines);
  fineSort.addEventListener("change", renderAdminFines);

  function getStudentPresence(uid) {
    const sessions = [...(presenceByUid.get(uid) || [])];
    const legacyPresence = legacyPresenceByUid.get(uid);
    if (legacyPresence) sessions.push(legacyPresence);
    const activeSessions = sessions.filter((session) => session.online === true && Date.now() - (session.lastSeen?.toMillis?.() || 0) < 135000);
    const latestSession = sessions.reduce((latest, session) => {
      const sessionTime = session.offlineAt?.toMillis?.() || session.lastSeen?.toMillis?.() || 0;
      const latestTime = latest?.offlineAt?.toMillis?.() || latest?.lastSeen?.toMillis?.() || 0;
      return sessionTime > latestTime ? session : latest;
    }, undefined);
    const isOnline = activeSessions.length > 0;
    const inactiveTimestamp = latestSession?.offlineAt?.toDate?.() || latestSession?.lastSeen?.toDate?.();
    const inactiveText = inactiveTimestamp
      ? `Last active ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(inactiveTimestamp)}`
      : "No activity recorded";
    const deviceText = activeSessions.length > 1 ? `Active on ${activeSessions.length} devices` : "Active now";
    const isLoggedOut = !isOnline && latestSession?.status === "logged-out";
    return { isOnline, status: isOnline ? "online" : isLoggedOut ? "logged-out" : "offline", label: isOnline ? "Online" : isLoggedOut ? "Logged out" : "Offline", detail: isOnline ? deviceText : inactiveText };
  }

  function setPresenceSessions(snapshot) {
    const nextPresence = new Map();
    snapshot.docs.forEach((item) => {
      const session = item.data();
      if (!session.studentUid) return;
      const sessions = nextPresence.get(session.studentUid) || [];
      sessions.push(session);
      nextPresence.set(session.studentUid, sessions);
    });
    presenceByUid = nextPresence;
  }

  function renderStudents() {
    if (activeView !== "modify-students") return;
    const search = studentSearch.value.trim().toLowerCase();
    const updateFilterOptions = (select, label, values) => {
      const currentValue = select.value;
      select.innerHTML = `<option value="all">All ${label}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
      select.value = values.includes(currentValue) ? currentValue : "all";
    };
    const courses = [...new Set(students.map((student) => student.course).filter(Boolean))].sort();
    const sections = [...new Set(students.map((student) => student.section).filter(Boolean))].sort();
    const filterSignature = `${courses.join("\u0001")}\u0002${sections.join("\u0001")}`;
    if (filterSignature !== studentFilterSignature) {
      studentFilterSignature = filterSignature;
      updateFilterOptions(studentCourseFilter, "courses", courses);
      updateFilterOptions(studentSectionFilter, "sections", sections);
    }

    const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const presentToday = new Set(attendance.filter((record) => record.eventDate === localDate).map((record) => record.studentUid));
    const pendingService = new Set(fines.filter((fine) => fine.status !== "Completed").map((fine) => fine.studentUid));
    const activityTime = (uid) => {
      const sessions = [...(presenceByUid.get(uid) || [])];
      const legacy = legacyPresenceByUid.get(uid);
      if (legacy) sessions.push(legacy);
      return Math.max(0, ...sessions.map((session) => session.offlineAt?.toMillis?.() || session.lastSeen?.toMillis?.() || 0));
    };
    const filtered = students.filter((student) => {
      const hasFaceRegistration = faceRegistrationsByUid.get(student.uid)?.registered === true;
      const matchesSearch = !search || [student.firstName, student.middleName, student.lastName, student.accountId, student.email, student.course, student.section].join(" ").toLowerCase().includes(search);
      const matchesCourse = studentCourseFilter.value === "all" || student.course === studentCourseFilter.value;
      const matchesSection = studentSectionFilter.value === "all" || student.section === studentSectionFilter.value;
      const matchesFace = studentFaceFilter.value === "all" || (studentFaceFilter.value === "registered" ? hasFaceRegistration : !hasFaceRegistration);
      const matchesAccount = studentAccountFilter.value === "all" || (studentAccountFilter.value === "active" ? student.active !== false : student.active === false);
      const matchesAttendance = studentAttendanceFilter.value === "all" || (studentAttendanceFilter.value === "present" ? presentToday.has(student.uid) : !presentToday.has(student.uid));
      const matchesFine = studentFineFilter.value === "all" || (studentFineFilter.value === "pending" ? pendingService.has(student.uid) : !pendingService.has(student.uid));
      return matchesSearch && matchesCourse && matchesSection && matchesFace && matchesAccount && matchesAttendance && matchesFine;
    }).sort((first, second) => {
      if (studentSort.value === "id") return String(first.accountId || "").localeCompare(String(second.accountId || ""), undefined, { numeric: true });
      if (studentSort.value === "newest") return (second.createdAt?.toMillis?.() || 0) - (first.createdAt?.toMillis?.() || 0);
      if (studentSort.value === "activity") return activityTime(second.uid) - activityTime(first.uid);
      return [first.lastName, first.firstName, first.middleName].filter(Boolean).join(" ").localeCompare([second.lastName, second.firstName, second.middleName].filter(Boolean).join(" "));
    });
    document.querySelector("#registeredCount").textContent = students.length;
    const totalPages = Math.max(1, Math.ceil(filtered.length / studentPageSize));
    studentPage = Math.min(studentPage, totalPages);
    const firstResult = filtered.length ? (studentPage - 1) * studentPageSize + 1 : 0;
    const visibleStudents = filtered.slice(firstResult - 1, firstResult - 1 + studentPageSize);
    document.querySelector("#studentResultCount").textContent = `${filtered.length} matching student${filtered.length === 1 ? "" : "s"}`;
    studentPagination.hidden = filtered.length <= studentPageSize;
    studentPageInfo.textContent = filtered.length ? `Showing ${firstResult}–${firstResult + visibleStudents.length - 1} of ${filtered.length}` : "No matching students";
    previousStudentPage.disabled = studentPage <= 1;
    nextStudentPage.disabled = studentPage >= totalPages;
    if (!filtered.length) {
      const emptyMessage = students.length ? "No students match the selected filters." : "No students have been registered yet.";
      studentTableBody.innerHTML = `<tr><td colspan="6"><div class="empty-state">${emptyMessage}</div></td></tr>`;
      studentMobileCards.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
      renderSelectedStudent();
      renderAdminAttendance();
      return;
    }
    const studentTableMarkup = visibleStudents.map((student) => {
      const avatar = student.photoDataUrl ? `<img src="${escapeHtml(student.photoDataUrl)}" alt="">` : escapeHtml(getInitials(student.firstName, student.lastName));
      const presence = getStudentPresence(student.uid);
      const hasFaceRegistration = faceRegistrationsByUid.get(student.uid)?.registered === true;
      const role = student.role || "student";
      const roleControl = currentUserRole === "head_admin"
        ? `<select class="role-select" data-role-select="${escapeHtml(student.uid)}" aria-label="Role for ${escapeHtml(student.accountId)}">${Object.entries(ROLE_LABELS).map(([value, label]) => `<option value="${value}"${value === role ? " selected" : ""}>${label}</option>`).join("")}</select>`
        : `<span class="badge blue">${escapeHtml(roleLabel(role))}</span>`;
      return `<tr><td><div class="student-cell"><span class="mini-avatar">${avatar}</span><div><strong>${escapeHtml([student.lastName, student.firstName, student.middleName].filter(Boolean).join(", "))}</strong><small>${escapeHtml(student.accountId)}</small></div></div></td><td><strong>${escapeHtml(student.course || "Not assigned")}</strong><br><small>Section ${escapeHtml(student.section)}</small></td><td><span class="badge ${hasFaceRegistration ? "green" : "gray"}">${hasFaceRegistration ? "Registered" : "Not registered"}</span><small class="presence-time presence-status is-${presence.status}"><i class="presence-dot"></i>${escapeHtml(presence.label)}</small></td><td>${escapeHtml(student.email || "Not provided")}</td><td>${roleControl}</td><td><div class="table-actions"><button class="small-button" type="button" data-view-student="${student.uid}">Profile</button>${hasFaceRegistration ? `<button class="small-button danger" type="button" data-reset-face="${student.uid}">Reset face</button>` : ""}<button class="small-button" type="button" data-password-student="${student.uid}">Password</button><button class="small-button danger" type="button" data-delete-student="${student.uid}">Clear account</button></div></td></tr>`;
    }).join("");
    const studentMobileMarkup = visibleStudents.map((student) => {
      const fullName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
      const avatar = student.photoDataUrl ? `<img src="${escapeHtml(student.photoDataUrl)}" alt="">` : escapeHtml(getInitials(student.firstName, student.lastName));
      const presence = getStudentPresence(student.uid);
      const hasFaceRegistration = faceRegistrationsByUid.get(student.uid)?.registered === true;
      return `<article class="student-mobile-card"><div class="student-mobile-card-head"><span class="mini-avatar">${avatar}</span><div><h3>${escapeHtml(fullName)}</h3><p>${escapeHtml(student.accountId)}</p></div><span class="badge ${hasFaceRegistration ? "green" : "gray"}">${hasFaceRegistration ? "Registered" : "Not registered"}</span></div><div class="student-mobile-card-details"><div><span>Course / Section</span><strong>${escapeHtml(student.course || "Not assigned")} · ${escapeHtml(student.section || "Not assigned")}</strong></div><div><span>Live status</span><strong class="presence-status is-${presence.status}"><i class="presence-dot"></i>${escapeHtml(presence.label)}</strong></div><div class="student-mobile-card-email"><span>Email</span><strong>${escapeHtml(student.email || "Not provided")}</strong></div></div><button class="outline-button" type="button" data-view-student="${escapeHtml(student.uid)}">View profile</button></article>`;
    }).join("");
    if (studentDirectoryMediaQuery.matches) {
      studentTableBody.innerHTML = "";
      studentMobileCards.innerHTML = studentMobileMarkup;
    } else {
      studentTableBody.innerHTML = studentTableMarkup;
      studentMobileCards.innerHTML = "";
    }
    renderSelectedStudent();
    renderAdminAttendance();
  }

  function renderSelectedStudent() {
    const student = students.find((item) => item.uid === selectedManagedStudentUid);
    if (!student) {
      adminStudentDetail.hidden = true;
      adminStudentDetail.innerHTML = "";
      return;
    }
    const fullName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
    const presence = getStudentPresence(student.uid);
    const avatar = student.photoDataUrl ? `<img src="${escapeHtml(student.photoDataUrl)}" alt="${escapeHtml(fullName)} profile photo">` : escapeHtml(getInitials(student.firstName, student.lastName));
    const studentAttendance = attendance
      .filter((record) => record.studentUid === student.uid)
      .sort((a, b) => (b.attendedAt?.seconds || 0) - (a.attendedAt?.seconds || 0));
    const attendedCards = studentAttendance.length
      ? studentAttendance.map((record) => `<article class="attended-event-box"><strong>${escapeHtml(record.eventName || "Attendance event")}</strong><span>${escapeHtml(record.eventDate || "Date unavailable")} · ${escapeHtml(record.location || "Location not provided")}</span><span>${escapeHtml(record.timeIn || "")} ${record.timeOut ? `– ${escapeHtml(record.timeOut)}` : ""}</span></article>`).join("")
      : '<div class="empty-state">This student has not attended an event yet.</div>';
    const hasFaceRegistration = faceRegistrationsByUid.get(student.uid)?.registered === true;
    adminStudentDetail.innerHTML = `<article class="panel admin-student-overview"><button class="modal-close" type="button" data-close-student-detail aria-label="Close student details">×</button><div class="profile-avatar">${avatar}</div><h3>${escapeHtml(fullName)}</h3><p>Student ID · ${escapeHtml(student.accountId)}</p><p class="profile-course-line" style="margin-top:-4px;color:var(--muted);font-size:.82rem;">Course Registered · <strong>${escapeHtml(student.course || "Not assigned")}</strong></p><span class="badge ${presence.isOnline ? "green" : "gray"}"><i class="presence-dot"></i>${presence.label}</span><small class="presence-profile-time">${escapeHtml(presence.detail)}</small><div class="admin-student-actions"><button class="primary-button" type="button" data-edit-student="${student.uid}">Edit information</button>${hasFaceRegistration ? `<button class="outline-button" type="button" data-reset-face="${student.uid}">Reset face registration</button>` : ""}<button class="outline-button" type="button" data-password-student="${student.uid}">Change password</button><button class="small-button danger modal-danger-button" type="button" data-delete-student="${student.uid}">Clear account</button></div></article><article class="panel admin-student-information"><div class="panel-head"><div><h3>Student information</h3><p>Profile details and recorded attendance.</p></div><span class="badge blue">${studentAttendance.length} attended</span></div><div class="student-info-boxes"><div class="student-info-box"><span>Student ID</span><strong>${escapeHtml(student.accountId)}</strong></div><div class="student-info-box"><span>Course Registered</span><strong>${escapeHtml(student.course || "Not assigned")}</strong></div><div class="student-info-box"><span>Section</span><strong>${escapeHtml(student.section)}</strong></div><div class="student-info-box"><span>Face registration</span><strong>${hasFaceRegistration ? "Registered" : "Not registered"}</strong></div><div class="student-info-box"><span>Email address</span><strong>${escapeHtml(student.email || "Not provided")}</strong></div><div class="student-info-box"><span>Phone number</span><strong>${escapeHtml(student.phone || "Not provided")}</strong></div><div class="student-info-box"><span>Live status</span><strong>${presence.label}</strong><small>${escapeHtml(presence.detail)}</small></div><div class="student-info-box"><span>Account access</span><strong>${student.active === false ? "Inactive" : "Active"}</strong></div></div><div class="panel-head"><div><h3>Attended events</h3><p>All attendance records saved for this student.</p></div></div><div class="attended-event-grid">${attendedCards}</div></article>`;
    const fineCount = fines.filter((fine) => fine.studentUid === student.uid).length;
    adminStudentDetail.querySelector(".admin-student-actions")?.insertAdjacentHTML("afterbegin", `<button class="outline-button" type="button" data-check-student-fines="${escapeHtml(student.uid)}">Check attendance fines${fineCount ? ` (${fineCount})` : ""}</button>`);
    adminStudentDetail.querySelector(".student-info-boxes")?.insertAdjacentHTML("afterbegin", `<div class="student-info-box"><span>Birthday</span><strong>${escapeHtml(formatBirthday(student.birthday))}</strong></div>`);
    adminStudentDetail.hidden = false;
  }

  function fineRecordModalMarkup(fine) {
    const status = fine.status === "Completed" ? "Completed" : "Needs review";
    return `<article class="community-service-record"><div class="community-service-record-top"><strong>${escapeHtml(fine.eventName || "Attendance absence")}</strong><span class="badge ${fine.status === "Completed" ? "green" : "orange"}">${escapeHtml(status)}</span></div><div class="fine-detail-grid"><div><span>Attendance date</span><strong>${escapeHtml(fine.eventDate || "Not recorded")}</strong></div><div><span>Service required</span><strong>${escapeHtml(formatServiceMinutes(fine.serviceMinutes))}</strong></div><div><span>Recorded</span><strong>${escapeHtml(formatFineDate(fine.assignedAt))}</strong></div><div class="fine-detail-full"><span>Reason</span><strong>${escapeHtml(fine.reason || "No reason provided.")}</strong></div></div></article>`;
  }

  function openAdminFineModal(student, trigger) {
    if (!student) return;
    selectedFineStudentUid = student.uid;
    const studentFines = fines.filter((fine) => fine.studentUid === student.uid);
    const currentRecords = studentFines.filter((fine) => fine.status !== "Completed");
    const reviewedRecords = studentFines.filter((fine) => fine.status === "Completed");
    const studentName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") || "Student";
    adminFineModalController.open({ title: `${studentName}'s attendance fines`, description: "Review attendance-fine records, then use Manage fines to update them.", markup: `<section class="community-service-section"><div class="community-service-section-heading"><h3>Current records</h3><p>Records that still need attention.</p></div>${currentRecords.length ? currentRecords.map(fineRecordModalMarkup).join("") : '<div class="community-service-empty">No current attendance fines recorded.</div>'}</section><section class="community-service-section"><div class="community-service-section-heading"><h3>Reviewed records</h3><p>Records marked as completed.</p></div>${reviewedRecords.length ? reviewedRecords.map(fineRecordModalMarkup).join("") : '<div class="community-service-empty">No reviewed attendance fines recorded.</div>'}</section>`, trigger });
  }

  async function resetStudentFaceRegistration(student) {
    if (!student || !faceRegistrationsByUid.get(student.uid)?.registered) return false;
    try {
      await resetFacePhotoInDrive(student.uid);
      const registration = await waitForFaceRegistration(student.uid, false);
      if (!registration) throw new Error("Drive did not confirm removal. The student remains registered.");
      await createNotification({ recipientUid: student.uid, category: "face", title: "Face registration reset", message: "Your administrator reset your face registration. You may now register one new photo.", targetView: "face", studentName: [student.firstName, student.lastName].filter(Boolean).join(" "), studentId: student.accountId, section: student.section });
      showDashboardToast("Face registration reset", `${student.accountId} can now register one new photo.`);
      return true;
    } catch (error) {
      showDashboardToast("Unable to reset face", error.message || "Try again after checking the Drive upload service.");
      return false;
    }
  }

  function resetEventForm() {
    eventForm.reset();
    eventGeofenceEditor.clear();
    document.querySelector("#editingEventId").value = "";
    document.querySelector("#eventFormTitle").textContent = "Event details";
    document.querySelector("#eventSubmitButton").textContent = "Create event";
    delete eventForm.dataset.returnView;
  }
  function editEvent(id) {
    const event = events.find((item) => item.id === id);
    if (!event) return;
    document.querySelector("#editingEventId").value = event.id;
    document.querySelector("#eventName").value = event.name;
    document.querySelector("#eventDate").value = event.date;
    document.querySelector("#eventLocation").value = event.location;
    document.querySelector("#eventType").value = event.type || "Other";
    document.querySelector("#eventTimeIn").value = event.timeIn;
    document.querySelector("#eventTimeOut").value = event.timeOut;
    document.querySelector("#eventCheckInCutoff").value = event.checkInCutoff || timePlusMinutes(event.timeIn) || event.timeOut;
    document.querySelector("#eventCheckOutCutoff").value = event.checkOutCutoff || timePlusMinutes(event.timeOut);
    document.querySelector("#eventAudience").value = event.audience;
    document.querySelector("#eventNotes").value = event.description || event.notes || "";
    eventGeofenceEditor.set(event.geofence || {});
    document.querySelector("#eventFormTitle").textContent = "Modify event";
    document.querySelector("#eventSubmitButton").textContent = "Save changes";
    eventForm.dataset.returnView = isEventFinished(event) ? "past-events" : "modify-events";
    openView("create");
  }

  async function writeInBatches(documents, write) {
    for (let start = 0; start < documents.length; start += 450) {
      const batch = writeBatch(db);
      documents.slice(start, start + 450).forEach((item) => write(batch, item));
      await batch.commit();
    }
  }

  async function syncEventRecords(eventId, event) {
    const [attendanceSnapshot, fineSnapshot] = await Promise.all([
      getDocs(query(collection(db, "attendance"), where("eventId", "==", eventId))),
      getDocs(query(collection(db, "fines"), where("eventId", "==", eventId)))
    ]);
    const attendanceUpdate = {
      eventName: event.name,
      eventType: event.type || "School Event",
      eventDescription: event.description || "",
      eventDate: event.date,
      timeIn: event.timeIn,
      timeOut: event.timeOut,
      location: event.location,
      audience: event.audience || "All students"
    };
    const fineUpdate = {
      eventName: event.name,
      eventDate: event.date,
      eventTimeIn: event.timeIn,
      eventTimeOut: event.timeOut,
      eventLocation: event.location,
      eventRemoved: false
    };
    await Promise.all([
      writeInBatches(attendanceSnapshot.docs, (batch, item) => batch.set(item.ref, attendanceUpdate, { merge: true })),
      writeInBatches(fineSnapshot.docs, (batch, item) => batch.set(item.ref, fineUpdate, { merge: true }))
    ]);
    return attendanceSnapshot.size;
  }

  function closePastEventRemovalModal() {
    pastEventRemovalModal.hidden = true;
    selectedPastEventForRemoval = undefined;
  }

  function openPastEventRemovalModal(eventId) {
    const event = events.find((item) => item.id === eventId);
    if (!event) return;
    selectedPastEventForRemoval = event;
    const attendanceCount = attendance.filter((record) => record.eventId === event.id).length;
    document.querySelector("#pastEventRemovalMessage").textContent = `Removing ${event.name} will permanently remove ${attendanceCount} student attendance record${attendanceCount === 1 ? "" : "s"} from My Attendances, Event History, and the Attendance Line. Linked fines will remain as administrative records.`;
    pastEventRemovalModal.hidden = false;
    document.querySelector("#confirmPastEventRemoval").focus();
  }

  async function removeEventAndRecords(event) {
    const [attendanceSnapshot, dismissedSnapshot, fineSnapshot] = await Promise.all([
      getDocs(query(collection(db, "attendance"), where("eventId", "==", event.id))),
      getDocs(query(collection(db, "dismissedHistory"), where("eventId", "==", event.id))),
      getDocs(query(collection(db, "fines"), where("eventId", "==", event.id)))
    ]);
    await Promise.all([
      writeInBatches(attendanceSnapshot.docs, (batch, item) => batch.delete(item.ref)),
      writeInBatches(dismissedSnapshot.docs, (batch, item) => batch.delete(item.ref)),
      writeInBatches(fineSnapshot.docs, (batch, item) => batch.set(item.ref, { eventRemoved: true, eventRemovedAt: serverTimestamp() }, { merge: true }))
    ]);
    await deleteDoc(doc(db, "events", event.id));
    return attendanceSnapshot.size;
  }

  eventForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const timeIn = document.querySelector("#eventTimeIn").value;
    const timeOut = document.querySelector("#eventTimeOut").value;
    const checkInCutoff = document.querySelector("#eventCheckInCutoff").value;
    const checkOutCutoff = document.querySelector("#eventCheckOutCutoff").value;
    const date = document.querySelector("#eventDate").value;
    if (timeOut <= timeIn) return showDashboardToast("Invalid attendance window", "Time Out must be later than Time In.");
    if (checkInCutoff <= timeIn || checkInCutoff > timeOut) return showDashboardToast("Invalid check-in cutoff", "The check-in cutoff must be after Time In and no later than Time Out.");
    if (checkOutCutoff <= timeOut) return showDashboardToast("Invalid checkout cutoff", "The checkout cutoff must be after Time Out.");
    const id = document.querySelector("#editingEventId").value;
    const requestedGeofence = eventGeofenceEditor.value();
    if (requestedGeofence.enabled && (!Number.isFinite(requestedGeofence.latitude) || !Number.isFinite(requestedGeofence.longitude))) return showDashboardToast("Choose an attendance area", "Click the map or search for the event location before saving.");
    const geofence = requestedGeofence.enabled ? requestedGeofence : { enabled: false };
    const record = { name: document.querySelector("#eventName").value.trim(), type: document.querySelector("#eventType").value, date, location: document.querySelector("#eventLocation").value.trim(), timeIn, checkInCutoff, timeOut, checkOutCutoff, audience: document.querySelector("#eventAudience").value, description: document.querySelector("#eventNotes").value.trim(), geofence, openAt: Timestamp.fromDate(new Date(`${date}T${timeIn}`)), checkInClosesAt: Timestamp.fromDate(new Date(`${date}T${checkInCutoff}`)), closeAt: Timestamp.fromDate(new Date(`${date}T${timeOut}`)), checkOutClosesAt: Timestamp.fromDate(new Date(`${date}T${checkOutCutoff}`)), updatedAt: serverTimestamp() };
    try {
      if (id) {
        await setDoc(doc(db, "events", id), record, { merge: true });
        await syncEventRecords(id, record);
        const recipients = students.filter((student) => student.active !== false && (record.audience === "All students" || record.audience === `Section ${student.section}`));
        Promise.allSettled(recipients.map((student) => createNotification({ recipientUid: student.uid, category: "system", title: "Event updated", message: `${record.name} was updated. Review the latest event details.`, targetView: "events", studentName: [student.firstName, student.lastName].filter(Boolean).join(" "), studentId: student.accountId, section: student.section }))).catch(() => {});
      } else {
        await addDoc(collection(db, "events"), { ...record, createdAt: serverTimestamp(), createdBy: currentUser.uid });
        const recipients = students.filter((student) => student.active !== false && (record.audience === "All students" || record.audience === `Section ${student.section}`));
        Promise.allSettled(recipients.map((student) => createNotification({ recipientUid: student.uid, category: "system", title: "New event published", message: `${record.name} is scheduled for ${formatEventDate(record.date)}.`, targetView: "events", studentName: [student.firstName, student.lastName].filter(Boolean).join(" "), studentId: student.accountId, section: student.section }))).catch(() => {});
      }
      const returnView = eventForm.dataset.returnView || "modify-events";
      resetEventForm();
      openView(returnView);
      showDashboardToast(id ? "Event updated" : "Event created", id ? "The event and linked attendance records were synced." : "The event and attendance window were saved and synced.");
    } catch (error) {
      showDashboardToast("Unable to save event", error.message);
    }
  });
  document.querySelector("#clearEventForm").addEventListener("click", resetEventForm);
  const handleEventCardAction = async (clickEvent) => {
    const manageGeofence = clickEvent.target.closest("[data-manage-geofence]");
    const edit = clickEvent.target.closest("[data-edit-event]");
    const remove = clickEvent.target.closest("[data-delete-event]");
    if (manageGeofence) {
      renderGeofenceEventOptions(manageGeofence.dataset.manageGeofence);
      openView("geofence");
      loadGeofenceManager(manageGeofence.dataset.manageGeofence);
    }
    if (edit) editEvent(edit.dataset.editEvent);
    if (remove) openPastEventRemovalModal(remove.dataset.deleteEvent);
  };
  eventTableBody.addEventListener("click", handleEventCardAction);
  pastEventList.addEventListener("click", handleEventCardAction);
  document.querySelectorAll("[data-close-past-event-removal]").forEach((button) => button.addEventListener("click", closePastEventRemovalModal));
  pastEventRemovalModal.addEventListener("click", (event) => { if (event.target === pastEventRemovalModal) closePastEventRemovalModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !pastEventRemovalModal.hidden) closePastEventRemovalModal(); });
  document.querySelector("#confirmPastEventRemoval").addEventListener("click", async () => {
    if (!selectedPastEventForRemoval) return;
    const event = selectedPastEventForRemoval;
    const button = document.querySelector("#confirmPastEventRemoval");
    button.disabled = true;
    button.textContent = "Removing event…";
    try {
      const removedRecords = await removeEventAndRecords(event);
      closePastEventRemovalModal();
      showDashboardToast("Event removed", `${event.name} and ${removedRecords} linked attendance record${removedRecords === 1 ? "" : "s"} were removed.`);
    } catch (error) {
      showDashboardToast("Unable to remove event", error.message || "Try again.");
    } finally {
      button.disabled = false;
      button.textContent = "Remove event";
    }
  });

  function resetStudentForm() {
    studentForm.reset();
    document.querySelector("#originalStudentId").value = "";
    document.querySelector("#managedStudentId").disabled = false;
    document.querySelector("#managedPassword").required = true;
    document.querySelector("#managedPassword").disabled = false;
    document.querySelector("#managedPassword").value = "";
    document.querySelector("#managedPassword").placeholder = "Visible · up to 8 digits";
    document.querySelector("#managedPasswordHelp").textContent = "The password stays visible while you type, accepts digits only, and is limited to 8 digits.";
    document.querySelector("#studentPageTitle").textContent = "Add Student";
    document.querySelector("#studentFormTitle").textContent = "Student information";
    document.querySelector("#studentSubmitButton").textContent = "Add student";
  }
  function editStudent(uid) {
    const student = students.find((item) => item.uid === uid);
    if (!student) return;
    document.querySelector("#originalStudentId").value = student.uid;
    document.querySelector("#managedStudentId").value = student.accountId;
    document.querySelector("#managedStudentId").disabled = false;
    document.querySelector("#managedFirstName").value = student.firstName;
    document.querySelector("#managedMiddleName").value = student.middleName || "";
    document.querySelector("#managedBirthday").value = student.birthday || "";
    document.querySelector("#managedLastName").value = student.lastName;
    document.querySelector("#managedSection").value = student.section;
    document.querySelector("#managedCourse").value = student.course || "";
    document.querySelector("#managedEmail").value = student.email || "";
    document.querySelector("#managedPhone").value = student.phone || "";
    document.querySelector("#managedPassword").required = false;
    document.querySelector("#managedPassword").disabled = true;
    document.querySelector("#managedPassword").value = "";
    document.querySelector("#managedPassword").placeholder = "Use the Password button in Modify Students";
    document.querySelector("#managedPasswordHelp").textContent = "Use the Password action in the student list to change this password.";
    document.querySelector("#studentPageTitle").textContent = "Modify Student";
    document.querySelector("#studentFormTitle").textContent = "Update student information";
    document.querySelector("#studentSubmitButton").textContent = "Save changes";
    openView("add-student");
  }
  studentForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const uid = document.querySelector("#originalStudentId").value;
    const student = { accountId: document.querySelector("#managedStudentId").value.trim(), firstName: document.querySelector("#managedFirstName").value.trim(), middleName: document.querySelector("#managedMiddleName").value.trim(), lastName: document.querySelector("#managedLastName").value.trim(), birthday: document.querySelector("#managedBirthday").value, course: document.querySelector("#managedCourse").value, section: document.querySelector("#managedSection").value, password: document.querySelector("#managedPassword").value, email: document.querySelector("#managedEmail").value.trim(), phone: document.querySelector("#managedPhone").value.trim() };
    if (!/^[A-Za-z0-9._-]+$/.test(student.accountId)) {
      showDashboardToast("Invalid Student ID", "Use only letters, numbers, periods, underscores, or dashes.");
      return;
    }
    try {
      if (uid) {
        const studentIdKey = student.accountId.toLowerCase();
        const { password, ...profile } = student;
        const existingStudent = students.find((s) => s.uid === uid);
        const oldKey = (existingStudent?.accountIdKey || existingStudent?.accountId || "").toLowerCase();
        if (oldKey !== studentIdKey) {
          const idSnap = await getDoc(doc(db, "studentIds", studentIdKey));
          if (idSnap.exists() && idSnap.data().uid !== uid) {
            showDashboardToast("Student ID taken", "This Student ID is already registered by another student.");
            return;
          }
        }
        const studentBatch = writeBatch(db);
        studentBatch.set(doc(db, "students", uid), {
          ...profile,
          accountIdKey: studentIdKey,
          grade: deleteField(),
          adviser: deleteField(),
          updatedAt: serverTimestamp()
        }, { merge: true });
        if (oldKey !== studentIdKey) {
          if (oldKey) studentBatch.delete(doc(db, "studentIds", oldKey));
          studentBatch.set(doc(db, "studentIds", studentIdKey), {
            studentId: student.accountId,
            uid,
            createdAt: serverTimestamp()
          });
        }
        await studentBatch.commit();
      } else {
        const studentIdKey = student.accountId.toLowerCase();
        const idReference = doc(db, "studentIds", studentIdKey);
        const idSnapshot = await getDoc(idReference);
        if (idSnapshot.exists()) {
          const indexedUid = idSnapshot.data()?.uid;
          if (typeof indexedUid === "string" && indexedUid) {
            const indexedProfile = await getDoc(doc(db, "students", indexedUid));
            if (indexedProfile.exists()) {
              showDashboardToast("Student ID taken", "This Student ID is already registered by another student.");
              return;
            }
          }
          await deleteDoc(idReference);
        }
        const authEmail = studentIdToEmail(student.accountId);
        let credential;
        try {
          credential = await createUserWithEmailAndPassword(studentProvisioningAuth, authEmail, student.password);
          await updateProfile(credential.user, { displayName: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") });
          const { password, ...profile } = student;
          const registration = writeBatch(db);
          registration.set(doc(db, "students", credential.user.uid), {
            ...profile,
            accountIdKey: studentIdKey,
            uid: credential.user.uid,
            authEmail,
            active: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          registration.set(idReference, {
            studentId: student.accountId,
            uid: credential.user.uid,
            createdAt: serverTimestamp()
          });
          await registration.commit();
        } catch (error) {
          if (credential?.user) await deleteUser(credential.user).catch(() => {});
          throw error;
        } finally {
          await signOut(studentProvisioningAuth).catch(() => {});
        }
      }
      resetStudentForm();
      openView("modify-students");
      showDashboardToast(uid ? "Student updated" : "Student created", `${student.accountId} is ready to sign in.`);
    } catch (error) {
      console.error("FULL FIREBASE ERROR:", error);
      const messages = {
        "auth/email-already-in-use": "This Student ID already has a Firebase login. Remove it from Firebase Authentication, or use the student’s password to clear the account first.",
        "auth/invalid-email": "The Student ID could not be used as a login.",
        "auth/weak-password": "The password must contain at least 6 characters.",
        "permission-denied": "Registration was rejected. Deploy the latest Firestore rules, then try again.",
        "firestore/permission-denied": "Registration was rejected. Deploy the latest Firestore rules, then try again."
      };
      const message = messages[error.code] || error.message || "The student could not be saved.";
      showDashboardToast("Unable to save student", message);
    }
  });
  document.querySelector("#cancelStudentForm").addEventListener("click", () => {
    const editingUid = document.querySelector("#originalStudentId").value;
    if (editingUid) {
      const studentToReset = students.find((s) => s.uid === editingUid);
      if (studentToReset) {
        openRemoveModal(studentToReset);
        return;
      }
    }
    resetStudentForm();
  });

  function closePasswordModal() {
    passwordModal.hidden = true;
    selectedPasswordStudent = undefined;
    document.querySelector("#passwordChangeForm").reset();
  }

  function closeRemoveModal() {
    window.clearInterval(removalCountdownTimer);
    removeStudentModal.hidden = true;
    selectedRemovalStudent = undefined;
    document.querySelector("#removeStudentPassword").value = "";
    document.querySelector("#removeStudentCountdown").textContent = "Review this action carefully.";
    const confirmButton = document.querySelector("#confirmRemoveStudent");
    confirmButton.disabled = true;
    confirmButton.textContent = "Wait 5 seconds";
  }

  function closeResetFaceModal() {
    resetFaceModal.hidden = true;
    selectedFaceResetStudent = undefined;
  }

  function openPasswordModal(student) {
    selectedPasswordStudent = student;
    if (!selectedPasswordStudent) return;
    document.querySelector("#passwordStudentName").textContent = `Change the password for ${selectedPasswordStudent.firstName} ${selectedPasswordStudent.lastName}. Enter the current password to continue.`;
    passwordModal.hidden = false;
    document.querySelector("#currentStudentPassword").focus();
  }

  function openRemoveModal(student) {
    selectedRemovalStudent = student;
    if (!selectedRemovalStudent) return;
    window.clearInterval(removalCountdownTimer);
    document.querySelector("#removeStudentMessage").textContent = `${selectedRemovalStudent.firstName} ${selectedRemovalStudent.lastName} (${selectedRemovalStudent.accountId})'s account and saved records will be completely removed from Firebase and logged out.`;
    document.querySelector("#removeStudentPassword").value = "";
    removeStudentModal.hidden = false;
    const countdown = document.querySelector("#removeStudentCountdown");
    const confirmButton = document.querySelector("#confirmRemoveStudent");
    let seconds = 5;
    countdown.textContent = `Account removal confirmation unlocks in ${seconds}s…`;
    confirmButton.disabled = true;
    confirmButton.textContent = `Wait ${seconds} seconds`;
    removalCountdownTimer = window.setInterval(() => {
      seconds -= 1;
      if (seconds > 0) {
        countdown.textContent = `Account removal confirmation unlocks in ${seconds}s…`;
        confirmButton.textContent = `Wait ${seconds} second${seconds === 1 ? "" : "s"}`;
        return;
      }
      window.clearInterval(removalCountdownTimer);
      countdown.textContent = "Countdown complete (5s–1s timer finished). Confirm to permanently remove this account from Firebase.";
      confirmButton.disabled = false;
      confirmButton.textContent = "Remove account completely";
    }, 1000);
    document.querySelector("#removeStudentPassword").focus();
  }

  function openResetFaceModal(student) {
    if (!student || !faceRegistrationsByUid.get(student.uid)?.registered) return;
    selectedFaceResetStudent = student;
    const studentName = [student.firstName, student.lastName].filter(Boolean).join(" ") || "this student";
    document.querySelector("#resetFaceMessage").textContent = `Reset ${studentName}'s face registration? Their current face photo will be moved to Drive Trash, and they will be allowed to register one new photo.`;
    resetFaceModal.hidden = false;
    document.querySelector("#confirmResetFace").focus();
  }

  studentTableBody.addEventListener("click", (clickEvent) => {
    const view = clickEvent.target.closest("[data-view-student]");
    const passwordButton = clickEvent.target.closest("[data-password-student]");
    const remove = clickEvent.target.closest("[data-delete-student]");
    const resetFace = clickEvent.target.closest("[data-reset-face]");
    if (view) {
      selectedManagedStudentUid = view.dataset.viewStudent;
      renderSelectedStudent();
      adminStudentDetail.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (passwordButton) openPasswordModal(students.find((student) => student.uid === passwordButton.dataset.passwordStudent));
    if (resetFace) openResetFaceModal(students.find((student) => student.uid === resetFace.dataset.resetFace));
    if (remove) openRemoveModal(students.find((student) => student.uid === remove.dataset.deleteStudent));
  });

  studentTableBody.addEventListener("change", async (changeEvent) => {
    const selector = changeEvent.target.closest("[data-role-select]");
    if (!selector || currentUserRole !== "head_admin") return;
    const student = students.find((item) => item.uid === selector.dataset.roleSelect);
    if (!student) return;
    const previousRole = student.role || "student";
    const role = selector.value;
    openRoleChangeModal(student, role, selector);
  });

  confirmRoleChange.addEventListener("click", async () => {
    if (!pendingRoleChange) return;
    const { student, role, previousRole, selector } = pendingRoleChange;
    selector.disabled = true;
    confirmRoleChange.disabled = true;
    confirmRoleChange.textContent = "Updating role…";
    try {
      await setDoc(doc(db, "students", student.uid), {
        role,
        roleUpdatedAt: serverTimestamp(),
        roleUpdatedBy: currentUser.uid
      }, { merge: true });
      pendingRoleChange = undefined;
      roleChangeModal.hidden = true;
      showDashboardToast("Role updated", `${student.accountId} is now ${roleLabel(role)}. They must sign out and sign back in for the new access to apply.`);
    } catch (error) {
      selector.value = previousRole;
      pendingRoleChange = undefined;
      roleChangeModal.hidden = true;
      showDashboardToast("Unable to update role", roleChangeErrorMessage(error));
    } finally {
      selector.disabled = false;
      confirmRoleChange.disabled = false;
      confirmRoleChange.textContent = "Update role";
    }
  });

  studentMobileCards.addEventListener("click", (clickEvent) => {
    const view = clickEvent.target.closest("[data-view-student]");
    if (!view) return;
    selectedManagedStudentUid = view.dataset.viewStudent;
    renderSelectedStudent();
    adminStudentDetail.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  adminStudentDetail.addEventListener("click", (clickEvent) => {
    const close = clickEvent.target.closest("[data-close-student-detail]");
    const edit = clickEvent.target.closest("[data-edit-student]");
    const passwordButton = clickEvent.target.closest("[data-password-student]");
    const remove = clickEvent.target.closest("[data-delete-student]");
    const resetFace = clickEvent.target.closest("[data-reset-face]");
    const checkFines = clickEvent.target.closest("[data-check-student-fines]");
    if (close) {
      selectedManagedStudentUid = undefined;
      renderSelectedStudent();
    }
    if (edit) editStudent(edit.dataset.editStudent);
    if (checkFines) openAdminFineModal(students.find((student) => student.uid === checkFines.dataset.checkStudentFines), checkFines);
    if (passwordButton) openPasswordModal(students.find((student) => student.uid === passwordButton.dataset.passwordStudent));
    if (resetFace) openResetFaceModal(students.find((student) => student.uid === resetFace.dataset.resetFace));
    if (remove) openRemoveModal(students.find((student) => student.uid === remove.dataset.deleteStudent));
  });

  document.querySelector("#manageStudentFines").addEventListener("click", () => {
    const student = students.find((item) => item.uid === selectedFineStudentUid);
    if (!student) return;
    fineSearch.value = [student.firstName, student.middleName, student.lastName, student.accountId].filter(Boolean).join(" ");
    adminFineModalController.close();
    openView("assigned-fines");
    renderAdminFines();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !document.querySelector("#adminFineModal").hidden) adminFineModalController.close(); });

  document.querySelector("#passwordChangeForm").addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    if (!selectedPasswordStudent) return;
    const currentPassword = document.querySelector("#currentStudentPassword").value;
    const newPassword = document.querySelector("#newStudentPassword").value;
    try {
      await signOut(studentProvisioningAuth).catch(() => {});
      const credential = await signInWithEmailAndPassword(studentProvisioningAuth, selectedPasswordStudent.authEmail || studentIdToEmail(selectedPasswordStudent.accountId), currentPassword);
      if (credential.user.uid !== selectedPasswordStudent.uid) throw new Error("The current password does not match this student.");
      await updatePassword(credential.user, newPassword);
      await signOut(studentProvisioningAuth);
      const accountId = selectedPasswordStudent.accountId;
      closePasswordModal();
      showDashboardToast("Password changed", `${accountId} can now use the new password.`);
    } catch (error) {
      await signOut(studentProvisioningAuth).catch(() => {});
      const message = error.code === "auth/invalid-credential"
        ? "The current password is incorrect."
        : error.code === "auth/weak-password"
          ? "The new password must contain at least 6 characters."
          : error.message || "The password could not be changed.";
      showDashboardToast("Unable to change password", message);
    }
  });

  document.querySelector("#confirmRemoveStudent").addEventListener("click", async () => {
    if (!selectedRemovalStudent) return;
    const currentPassword = document.querySelector("#removeStudentPassword").value.trim();
    if (currentPassword.length < 6) {
      showDashboardToast("Student password required", "Enter the student's current password before clearing the account.");
      document.querySelector("#removeStudentPassword").focus();
      return;
    }
    const studentToRemove = selectedRemovalStudent;
    const confirmButton = document.querySelector("#confirmRemoveStudent");
    confirmButton.disabled = true;
    confirmButton.textContent = "Removing account…";

    try {
      await signOut(studentProvisioningAuth).catch(() => {});
      const credential = await signInWithEmailAndPassword(studentProvisioningAuth, studentToRemove.authEmail || studentIdToEmail(studentToRemove.accountId), currentPassword);
      if (credential.user.uid !== studentToRemove.uid) throw new Error("The password does not match this student account.");
      const [dismissedSnapshot, presenceSnapshot] = await Promise.all([
        getDocs(query(collection(db, "dismissedHistory"), where("studentUid", "==", studentToRemove.uid))),
        getDocs(query(collection(db, "presenceSessions"), where("studentUid", "==", studentToRemove.uid)))
      ]);
      await deleteUser(credential.user);
      const cleanup = writeBatch(db);
      cleanup.delete(doc(db, "students", studentToRemove.uid));
      cleanup.delete(doc(db, "studentIds", studentToRemove.accountIdKey || studentToRemove.accountId.toLowerCase()));
      cleanup.delete(doc(db, "faceRegistrations", studentToRemove.uid));
      cleanup.delete(doc(db, "presence", studentToRemove.uid));
      attendance.filter((record) => record.studentUid === studentToRemove.uid).forEach((record) => cleanup.delete(doc(db, "attendance", record.id)));
      dismissedSnapshot.docs.forEach((record) => cleanup.delete(record.ref));
      presenceSnapshot.docs.forEach((record) => cleanup.delete(record.ref));
      await cleanup.commit();
      await signOut(studentProvisioningAuth).catch(() => {});

      if (selectedManagedStudentUid === studentToRemove.uid) selectedManagedStudentUid = undefined;
      resetStudentForm();
      closeRemoveModal();

      showDashboardToast("Account Completely Removed", `${studentToRemove.accountId} and all saved student data were removed from Firebase.`);
    } catch (error) {
      await signOut(studentProvisioningAuth).catch(() => {});
      confirmButton.disabled = false;
      confirmButton.textContent = "Remove account completely";
      const message = (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password")
        ? "The current student password is incorrect."
        : error.message || "An error occurred while removing the account.";
      showDashboardToast("Unable to remove account", message);
    }
  });

  document.querySelector("#confirmResetFace").addEventListener("click", async () => {
    if (!selectedFaceResetStudent) return;
    const studentToReset = selectedFaceResetStudent;
    const confirmButton = document.querySelector("#confirmResetFace");
    confirmButton.disabled = true;
    confirmButton.textContent = "Resetting…";
    const resetComplete = await resetStudentFaceRegistration(studentToReset);
    if (resetComplete) {
      closeResetFaceModal();
    } else {
      confirmButton.disabled = false;
      confirmButton.textContent = "Reset face registration";
    }
  });

  document.querySelectorAll("[data-close-password]").forEach((button) => button.addEventListener("click", closePasswordModal));
  document.querySelectorAll("[data-close-remove]").forEach((button) => button.addEventListener("click", closeRemoveModal));
  document.querySelectorAll("[data-close-reset-face]").forEach((button) => button.addEventListener("click", closeResetFaceModal));
  passwordModal.addEventListener("click", (event) => { if (event.target === passwordModal) closePasswordModal(); });
  removeStudentModal.addEventListener("click", (event) => { if (event.target === removeStudentModal) closeRemoveModal(); });
  resetFaceModal.addEventListener("click", (event) => { if (event.target === resetFaceModal) closeResetFaceModal(); });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!passwordModal.hidden) closePasswordModal();
    if (!removeStudentModal.hidden) closeRemoveModal();
    if (!resetFaceModal.hidden) closeResetFaceModal();
  });
  const resetStudentDirectoryPage = () => {
    studentPage = 1;
    renderStudents();
  };
  studentSearch.addEventListener("input", resetStudentDirectoryPage);
  [studentCourseFilter, studentSectionFilter, studentFaceFilter, studentAccountFilter, studentAttendanceFilter, studentFineFilter, studentSort]
    .forEach((filter) => filter.addEventListener("change", resetStudentDirectoryPage));
  document.querySelector("#clearStudentFilters").addEventListener("click", () => {
    studentSearch.value = "";
    studentCourseFilter.value = "all";
    studentSectionFilter.value = "all";
    studentFaceFilter.value = "all";
    studentAccountFilter.value = "all";
    studentAttendanceFilter.value = "all";
    studentFineFilter.value = "all";
    studentSort.value = "name";
    resetStudentDirectoryPage();
  });
  previousStudentPage.addEventListener("click", () => {
    if (studentPage <= 1) return;
    studentPage -= 1;
    renderStudents();
  });
  nextStudentPage.addEventListener("click", () => {
    studentPage += 1;
    renderStudents();
  });
  document.querySelector("#refreshStudentStatus").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const originalText = button.textContent;
    button.disabled = true;
    button.classList.add("is-refreshing");
    button.textContent = "↻ Refreshing…";
    try {
      const [studentSnapshot, presenceSnapshot, legacyPresenceSnapshot, attendanceSnapshot] = await Promise.all([
        getDocsFromServer(collection(db, "students")),
        getDocsFromServer(collection(db, "presenceSessions")),
        getDocsFromServer(collection(db, "presence")),
        getDocsFromServer(collection(db, "attendance"))
      ]);
      students = studentSnapshot.docs.map((item) => ({ uid: item.id, ...item.data() }));
      setPresenceSessions(presenceSnapshot);
      legacyPresenceByUid = new Map(legacyPresenceSnapshot.docs.map((item) => [item.id, item.data()]));
      attendance = attendanceSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderStudents();
      showDashboardToast("Student status refreshed", "Online, offline, and last-active information is up to date.");
    } catch (error) {
      showDashboardToast("Unable to refresh status", error.code === "permission-denied" ? "Publish the latest database rules first." : "Check your internet connection and try again.");
    } finally {
      button.disabled = false;
      button.classList.remove("is-refreshing");
      button.textContent = originalText;
    }
  });

  studentDirectoryMediaQuery.addEventListener("change", scheduleStudentsRender);
  window.addEventListener("presence:viewchange", (event) => {
    const viewName = event.detail?.viewName;
    if (viewName === "dashboard") {
      renderAdminAttendance();
      renderAdminEvents();
      renderAttendanceLine();
    }
    if (viewName === "attendance-line") renderAttendanceLine();
    if (viewName === "modify-students") scheduleStudentsRender();
    if (viewName === "modify-events") renderAdminEvents();
    if (viewName === "past-events") renderPastEvents();
    if (viewName === "geofence") { renderGeofenceEventOptions(); loadGeofenceManager(); }
    if (viewName === "assign-fine") renderFineOptions();
    if (viewName === "assigned-fines") renderAdminFines();
  });
  onSnapshot(query(collection(db, "events"), orderBy("openAt", "asc")), (snapshot) => {
    events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    if (["dashboard", "modify-events"].includes(activeView)) renderAdminEvents();
    if (activeView === "past-events") renderPastEvents();
    renderGeofenceEventOptions();
    if (activeView === "geofence") loadGeofenceManager();
    if (activeView === "assign-fine") renderFineOptions();
    if (["dashboard", "attendance-line"].includes(activeView)) renderAttendanceLine();
    scheduleAdminEventStatusRefresh();
  });
  onSnapshot(collection(db, "students"), (snapshot) => {
    students = snapshot.docs.map((item) => ({ uid: item.id, ...item.data() }));
    scheduleStudentsRender();
    if (activeView === "assign-fine") renderFineOptions();
    if (activeView === "dashboard") renderAdminAttendance();
    if (["dashboard", "attendance-line"].includes(activeView)) renderAttendanceLine();
  });
  onSnapshot(collection(db, "presenceSessions"), (snapshot) => { setPresenceSessions(snapshot); scheduleStudentsRender(); });
  onSnapshot(collection(db, "presence"), (snapshot) => { legacyPresenceByUid = new Map(snapshot.docs.map((item) => [item.id, item.data()])); scheduleStudentsRender(); });
  onSnapshot(collection(db, "attendance"), (snapshot) => {
    attendance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    scheduleStudentsRender();
    if (activeView === "dashboard") {
      renderAdminAttendance();
      renderAttendanceLine();
    }
    if (activeView === "attendance-line") renderAttendanceLine();
  });
  onSnapshot(collection(db, "fines"), (snapshot) => {
    fines = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    if (activeView === "assigned-fines") renderAdminFines();
    if (activeView === "modify-students") scheduleStudentsRender();
    if (activeView === "modify-students" && selectedManagedStudentUid) renderSelectedStudent();
  });
  onSnapshot(collection(db, "faceRegistrations"), (snapshot) => { faceRegistrationsByUid = new Map(snapshot.docs.map((item) => [item.id, item.data()])); scheduleStudentsRender(); });
  if (currentUserRole === "head_admin") onSnapshot(doc(db, "adminProfiles", currentUser.uid), (snapshot) => { renderAdminProfile(snapshot.data()); });
  resetStudentForm();
  resetEventForm();
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
  if (dashboardRole === "student") initializeStudent();
  else initializeAdmin();
  initializeDashboardHistory();
}

initialize().catch((error) => {
  showDashboardToast("Unable to load Presence", error.message);
});
