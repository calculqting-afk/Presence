import { attendanceMilliseconds } from './AttendanceTimePolicy.js';
// Stateless formatting and policy helpers; no page startup or mutable session state.
const FACE_UPLOAD_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzXA8Gi7akcpT3MS87kOKC-7MCpejazTeK0zLtu-pUNugXL4YBeUan5vVLXhqKTHzsQ_Q/exec";
const pageCopy = {
  student: {
    dashboard: ["Dashboard", "Your attendance at a glance"],
    events: ["Announcements & Events", "Clear descriptions and attendance schedules"],
    attendances: ["My Attendances", "Your check-in and check-out records"],
    history: ["Event History", "Completed events and attendance records"],
    surveys: ["My Surveys", "Answer and resume your event surveys"],
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
    surveys: ["Event Surveys", "Configure questions, share QR links and review responses"],
    "account-approvals": ["Account Approvals", "Review pending student registration requests"],
    "correction-requests": ["Correction Requests", "Review student attendance correction requests"],
    "activity-history": ["Admin Activity History", "Review recorded administrative changes"],
    profile: ["Profile", "Update your administrator information"]
  }
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

const ROLE_LABELS = { super_admin: "Super Admin", head_admin: "Head Admin", attendance_admin: "Attendance Manager", student_manager: "Student Manager", student: "Student" };
const ASSIGNABLE_ROLE_LABELS = { head_admin: "Head Admin", attendance_admin: "Attendance Manager", student_manager: "Student Manager", student: "Student" };
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



// Spark-plan client-side policy. Firestore Rules repeat the same time-window
// checks so the recorded arrival label cannot be changed after check-in.


function formatNotificationTime(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "Just now";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  return event.lateAfterAt?.toDate?.()
    || event.checkInClosesAt?.toDate?.()
    || (event.checkInCutoff ? new Date(`${event.date}T${event.checkInCutoff}`) : eventCloseDate(event));
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
  const elapsed = attendanceMilliseconds(checkOut) - attendanceMilliseconds(checkIn);
  if (elapsed <= 0) return "Needs review — invalid duration";
  if (elapsed < 60000) return "Less than 1 minute";
  return formatServiceMinutes(Math.floor(elapsed / 60000));
}
function getEventStatus(event, now = new Date()) {
  if (now < eventOpenDate(event)) return "upcoming";
  if (now > eventCheckoutCloseDate(event)) return "closed";
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


function createDeviceSessionToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}


export { FACE_UPLOAD_WEB_APP_URL, pageCopy, ROLE_ACCESS_LABELS, NOTIFICATION_CATEGORIES_BY_ROLE, canReceiveNotification, escapeHtml, ROLE_LABELS, ASSIGNABLE_ROLE_LABELS, firebaseErrorCode, roleLabel, roleChangeErrorMessage, formatBirthday, formatNotificationTime, formatEventDate, formatEventTime, timePlusMinutes, formatTimeWindow, eventOpenDate, eventCloseDate, eventCheckInCloseDate, eventCheckoutCloseDate, isCheckoutAvailable, isEventFinished, formatAttendanceTimestamp, attendanceDuration, getEventStatus, arrivalStatusBadge, eventStatusBadge, getInitials, formatServiceMinutes, formatFineDate, formatFineEventDate, formatFineTimestamp, getFineHistory, fineDetailsMarkup, studentFineInfoMarkup, studentFineDetailsMarkup, getDashboardGreeting, createDeviceSessionToken };
