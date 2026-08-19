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
const pageCopy = {
  student: {
    dashboard: ["Dashboard", "Your attendance at a glance"],
    events: ["Announcements & Events", "Clear descriptions and attendance schedules"],
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
    "assign-fine": ["Assign Fine", "Create or update community-service requirements"],
    "assigned-fines": ["Assigned Fines", "Search and manage student fine records"],
    profile: ["Profile", "Update your administrator information"]
  }
};

let currentUser;
let toastTimer;
let mediaStream;
let presenceHeartbeatTimer;
let presenceSessionId;
let activeView;
let previousView = "dashboard";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function showDashboardToast(titleText, messageText) {
  const toast = document.querySelector("#dashboardToast");
  clearTimeout(toastTimer);
  document.querySelector("#dashboardToastTitle").textContent = titleText;
  document.querySelector("#dashboardToastMessage").textContent = messageText;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

function renderView(viewName) {
  if (!pageCopy[dashboardRole][viewName]) return;
  activeView = viewName;
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  document.querySelectorAll("[data-section]").forEach((section) => { section.hidden = section.dataset.section !== viewName; });
  const copy = pageCopy[dashboardRole][viewName];
  if (copy) [document.querySelector("#pageTitle").textContent, document.querySelector("#pageSubtitle").textContent] = copy;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openView(viewName) {
  if (!pageCopy[dashboardRole][viewName] || viewName === activeView) return;
  previousView = activeView || "dashboard";
  renderView(viewName);
  history.pushState({ presenceDashboard: true, view: viewName }, "", window.location.href);
}

function initializeDashboardHistory() {
  const initialView = history.state?.presenceDashboard && pageCopy[dashboardRole][history.state.view]
    ? history.state.view
    : "dashboard";
  history.replaceState({ presenceDashboard: true, view: initialView, root: true }, "", window.location.href);
  history.pushState({ presenceDashboard: true, view: initialView }, "", window.location.href);
  renderView(initialView);

  window.addEventListener("popstate", (event) => {
    const state = event.state;
    if (!state?.presenceDashboard || state.root) {
      history.go(1);
      return;
    }
    renderView(state.view);
  });
}

function formatEventDate(value) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", weekday: "long" }).format(new Date(`${value}T00:00:00`));
}
function formatEventTime(value) {
  return new Date(`2000-01-01T${value}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
function getEventStatus(event, now = new Date()) {
  if (now < eventOpenDate(event)) return "upcoming";
  if (now > eventCloseDate(event)) return "closed";
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
  const value = Number(minutes) || 0;
  if (value < 60) return `${value} minutes`;
  return `${value / 60} hour${value === 60 ? "" : "s"}`;
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
  if (dashboardRole === "admin") {
    return user.email?.toLowerCase() === ADMIN_EMAIL;
  }
  if (user.email?.toLowerCase() === ADMIN_EMAIL) return false;
  const record = await getDoc(doc(db, "students", user.uid));
  return record.exists() && record.data().active === true;
}

function wireCommonNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => openView(button.dataset.view)));
  document.querySelectorAll("[data-go-view]").forEach((button) => button.addEventListener("click", () => openView(button.dataset.goView)));
  document.querySelectorAll("[data-go-back]").forEach((button) => button.addEventListener("click", () => openView(previousView)));
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
      await Promise.allSettled([
        setDoc(doc(db, "presenceSessions", presenceSessionId), { studentUid: currentUser.uid, sessionId: presenceSessionId, online: false, lastSeen: serverTimestamp(), offlineAt: serverTimestamp() }, { merge: true }),
        setDoc(doc(db, "presence", currentUser.uid), { online: false, lastSeen: serverTimestamp(), offlineAt: serverTimestamp() }, { merge: true })
      ]);
    }
    try {
      sessionStorage.removeItem("presenceSession");
      sessionStorage.removeItem("presenceDeviceSession");
    } catch {}
    await signOut(auth);
    window.location.href = "../index.html";
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
  const studentProfileModal = document.querySelector("#studentProfileModal");
  let storedPresenceSession = "";
  try { storedPresenceSession = sessionStorage.getItem("presenceDeviceSession") || ""; } catch {}
  presenceSessionId = storedPresenceSession || `${currentUser.uid}_${createDeviceSessionToken()}`;
  try { sessionStorage.setItem("presenceDeviceSession", presenceSessionId); } catch {}

  const updatePresence = async (online = true, silent = false) => {
    const statusPayload = {
      online,
      lastSeen: serverTimestamp(),
      ...(online ? {} : { offlineAt: serverTimestamp() })
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
  updatePresence(true);
  presenceHeartbeatTimer = window.setInterval(() => updatePresence(true), 60000);
  window.addEventListener("focus", () => updatePresence(true));
  window.addEventListener("pagehide", () => updatePresence(false, true));

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
        const buttonText = attended ? "✓ Attendance saved" : status === "open" ? "Check in" : "Not open yet";
        const description = event.description || event.notes || `Attendance event for ${event.audience}.`;
        return `<article class="event-card"><div class="event-accent"></div><div class="event-body"><div class="event-card-kicker"><span class="event-type-badge">${escapeHtml(event.type || "School Event")}</span><span class="event-date">${escapeHtml(formatEventDate(event.date))}</span></div><h3>${escapeHtml(event.name)}</h3><div class="event-description"><strong>Description</strong>${escapeHtml(description)}</div><div class="event-meta"><span>${escapeHtml(formatTimeWindow(event))}</span><span>${escapeHtml(event.location)}</span></div><div class="event-card-actions">${attended ? '<span class="badge green">Attended</span>' : eventStatusBadge(status)}<button class="${attended ? "outline-button" : "primary-button"}" type="button" data-attend-event="${escapeHtml(event.id)}" ${disabled ? "disabled" : ""}>${buttonText}</button></div></div></article>`;
      }).join("");
      timeline.innerHTML = `<div class="timeline">${activeEvents.slice(0, 4).map((event) => `<div class="timeline-item"><span class="timeline-time">${escapeHtml(formatEventTime(event.timeIn))}</span><div class="timeline-main"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(formatEventDate(event.date))} · ${escapeHtml(formatTimeWindow(event))}</small></div>${attendanceIds.has(event.id) ? '<span class="badge green">Attended</span>' : eventStatusBadge(getEventStatus(event))}</div>`).join("")}</div>`;
    }
    renderAttendanceSummary();
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

  function renderFines() {
    const container = document.querySelector("#studentFineList");
    if (!fines.length) {
      container.innerHTML = '<div class="empty-state panel">You have no assigned fines.</div>';
      return;
    }
    container.innerHTML = fines.map((fine) => `<article class="history-event-card"><div class="history-card-top"><span class="event-type-badge">Community service</span><span class="badge orange">${escapeHtml(formatServiceMinutes(fine.serviceMinutes))}</span></div><h3>${escapeHtml(fine.eventName || "Attendance absence")}</h3><p>${escapeHtml(fine.reason || "No reason provided.")}</p><div class="event-detail-boxes"><div><span>Status</span><strong>${escapeHtml(fine.status || "Pending")}</strong></div><div><span>Assigned</span><strong>${escapeHtml(fine.assignedAt?.toDate?.().toLocaleDateString() || "Recently")}</strong></div></div></article>`).join("");
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
    container.innerHTML = `<div class="profile-grid"><article class="panel profile-summary"><div class="profile-avatar">${profileVisual}</div><h3>${escapeHtml(fullName)}</h3><p>Student ID · ${escapeHtml(studentProfile.accountId)}</p><p class="profile-course-line" style="margin-top:-4px;color:var(--muted);font-size:.82rem;">Course Registered · <strong>${escapeHtml(studentProfile.course || "Not assigned")}</strong></p><div class="profile-facts"><div class="profile-fact"><span>Course</span><strong>${escapeHtml(studentProfile.course || "Not assigned")}</strong></div><div class="profile-fact"><span>Section</span><strong>${escapeHtml(studentProfile.section)}</strong></div><div class="profile-fact"><span>Account</span><strong>Active</strong></div></div></article><article class="panel"><div class="panel-head"><div><h3>Contact details</h3><p>Your updates appear here immediately.</p></div><button class="primary-button" type="button" id="editStudentProfile">Edit profile</button></div><div class="profile-facts"><div class="profile-fact"><span>Student ID</span><strong>${escapeHtml(studentProfile.accountId)}</strong></div><div class="profile-fact"><span>Course Registered</span><strong>${escapeHtml(studentProfile.course || "Not assigned")}</strong></div><div class="profile-fact"><span>Email</span><strong>${escapeHtml(studentProfile.email || "Not provided")}</strong></div><div class="profile-fact"><span>Phone</span><strong>${escapeHtml(studentProfile.phone || "Not provided")}</strong></div></div></article></div>`;
  }

  document.querySelector("#studentProfileContent").addEventListener("click", (event) => {
    if (!event.target.closest("#editStudentProfile") || !studentProfile) return;
    document.querySelector("#profileAccountId").value = studentProfile.accountId || "";
    document.querySelector("#profileFirstName").value = studentProfile.firstName || "";
    document.querySelector("#profileMiddleName").value = studentProfile.middleName || "";
    document.querySelector("#profileLastName").value = studentProfile.lastName || "";
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

  document.querySelector("#studentEventGrid").addEventListener("click", async (clickEvent) => {
    const button = clickEvent.target.closest("[data-attend-event]");
    if (!button) return;
    const selectedEvent = events.find((event) => event.id === button.dataset.attendEvent);
    if (!selectedEvent || getEventStatus(selectedEvent) !== "open") return showDashboardToast("Attendance unavailable", "Attendance is allowed only between Time In and Time Out.");
    try {
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
        attendedAt: serverTimestamp()
      });
      showDashboardToast("Attendance recorded", "Your attendance was saved successfully.");
    } catch (error) {
      showDashboardToast("Attendance rejected", error.code === "permission-denied" ? "The attendance window is not open." : error.message);
    }
  });

  document.querySelector("#studentEventHistory").addEventListener("click", async (clickEvent) => {
    const button = clickEvent.target.closest("[data-dismiss-history]");
    if (!button) return;
    await setDoc(doc(db, "dismissedHistory", `${currentUser.uid}_${button.dataset.dismissHistory}`), { studentUid: currentUser.uid, eventId: button.dataset.dismissHistory, dismissedAt: serverTimestamp() });
    showDashboardToast("History entry removed", "The finished event is hidden from your history.");
  });

  const startCameraButton = document.querySelector("#startCamera");
  const captureFaceButton = document.querySelector("#captureFace");
  const cameraPreview = document.querySelector("#cameraPreview");
  const cameraPlaceholder = document.querySelector("#cameraPlaceholder");
  startCameraButton.addEventListener("click", async () => {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      cameraPreview.srcObject = mediaStream;
      cameraPreview.hidden = false;
      cameraPlaceholder.hidden = true;
      await cameraPreview.play();
      captureFaceButton.disabled = false;
      startCameraButton.disabled = true;
      startCameraButton.textContent = "Camera ready";
    } catch {
      showDashboardToast("Camera permission needed", "Allow camera access to continue face registration.");
    }
  });
  captureFaceButton.addEventListener("click", async () => {
    await setDoc(doc(db, "faceRegistrations", currentUser.uid), { registered: true, updatedAt: serverTimestamp() }, { merge: true });
    document.querySelector("#faceStatus").textContent = "Registered";
    document.querySelector("#faceStatus").className = "badge green";
    if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
    cameraPreview.hidden = true;
    cameraPlaceholder.hidden = false;
    captureFaceButton.disabled = true;
    captureFaceButton.textContent = "Face registered";
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
  onSnapshot(query(collection(db, "events"), orderBy("openAt", "asc")), (snapshot) => { events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderEvents(); });
  onSnapshot(query(collection(db, "attendance"), where("studentUid", "==", currentUser.uid)), (snapshot) => { attendance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderEvents(); });
  onSnapshot(query(collection(db, "dismissedHistory"), where("studentUid", "==", currentUser.uid)), (snapshot) => { dismissedIds = new Set(snapshot.docs.map((item) => item.data().eventId)); renderEvents(); });
  onSnapshot(query(collection(db, "fines"), where("studentUid", "==", currentUser.uid)), (snapshot) => { fines = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderFines(); });
  onSnapshot(doc(db, "faceRegistrations", currentUser.uid), (snapshot) => {
    if (snapshot.data()?.registered) {
      document.querySelector("#faceStatus").textContent = "Registered";
      document.querySelector("#faceStatus").className = "badge green";
    }
  });
  window.setInterval(renderEvents, 15000);
}

function initializeAdmin() {
  let events = [];
  let students = [];
  let attendance = [];
  let fines = [];
  let presenceByUid = new Map();
  let legacyPresenceByUid = new Map();
  const eventForm = document.querySelector("#eventForm");
  const studentForm = document.querySelector("#studentForm");
  const eventTableBody = document.querySelector("#eventTableBody");
  const studentTableBody = document.querySelector("#studentTableBody");
  const studentSearch = document.querySelector("#studentSearch");
  const fineForm = document.querySelector("#fineForm");
  const fineStudent = document.querySelector("#fineStudent");
  const fineStudentSearch = document.querySelector("#fineStudentSearch");
  fineStudentSearch.insertAdjacentHTML("afterend", '<div class="fine-student-search-results" id="fineStudentSearchResults" role="listbox" hidden></div>');
  const fineStudentSearchResults = document.querySelector("#fineStudentSearchResults");
  const fineEvent = document.querySelector("#fineEvent");
  const adminFineList = document.querySelector("#adminFineList");
  const fineSearch = document.querySelector("#fineSearch");
  const fineStatusFilter = document.querySelector("#fineStatusFilter");
  const passwordModal = document.querySelector("#passwordModal");
  const removeStudentModal = document.querySelector("#removeStudentModal");
  const adminStudentDetail = document.querySelector("#adminStudentDetail");
  let selectedPasswordStudent;
  let selectedRemovalStudent;
  let selectedManagedStudentUid;
  let removalCountdownTimer;
  let pendingAdminProfilePhoto = "";

  const eventSyncNotice = document.querySelector(".notice");
  if (eventSyncNotice) eventSyncNotice.textContent = "Events are saved online and sync automatically to student dashboards, including after refresh.";
  studentTableBody.closest("table").querySelectorAll("th")[1].textContent = "Course / Section";
  studentTableBody.closest("table").querySelectorAll("th")[2].textContent = "Live status";
  document.querySelector('label[for="eventNotes"]').textContent = "Description";
  document.querySelector("#eventNotes").placeholder = "Write a clear announcement or event description";
  document.querySelector("#eventLocation").closest(".field").insertAdjacentHTML("beforebegin", '<div class="field"><label for="eventType">Event type</label><select id="eventType" required><option value="Assembly">Assembly</option><option value="Meeting">Meeting</option><option value="Seminar">Seminar</option><option value="Workshop">Workshop</option><option value="School Activity">School Activity</option><option value="Ceremony">Ceremony</option><option value="Sports">Sports</option><option value="Other">Other</option></select></div>');
  document.querySelector("#adminProfileEmail").value = currentUser.email || ADMIN_EMAIL;

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

  function renderAdminAttendance() {
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const presentIds = new Set(attendance.filter((record) => record.eventDate === localDate).map((record) => record.studentUid));
    const present = presentIds.size;
    const pending = Math.max(students.length - present, 0);
    const rate = students.length ? Math.round((present / students.length) * 100) : 0;
    document.querySelector("#presentTodayCount").textContent = present;
    document.querySelector("#presentTodayMeta").textContent = students.length ? `${rate}% of registered students` : "No attendance records yet";
    document.querySelector("#notCheckedInCount").textContent = pending;
    document.querySelector("#notCheckedInMeta").textContent = students.length ? "Registered students without a check-in today" : "No students registered";
    document.querySelector("#adminAttendancePercent").textContent = `${rate}%`;
    document.querySelector("#adminAttendanceDetail").textContent = `${present} present`;
    document.querySelector("#adminAttendanceRing").style.background = `conic-gradient(#1f6feb 0 ${rate}%, #e8eef7 ${rate}% 100%)`;
  }

  function renderAdminEvents() {
    document.querySelector("#eventCount").textContent = events.length;
    const timeline = document.querySelector("#adminEventTimeline");
    if (!events.length) {
      timeline.innerHTML = '<div class="empty-state">No events have been created yet.</div>';
      eventTableBody.innerHTML = '<div class="empty-state panel">No events have been created yet.</div>';
      return;
    }
    timeline.innerHTML = events.slice(0, 5).map((event) => `<div class="timeline-item"><span class="timeline-time">${escapeHtml(formatEventTime(event.timeIn))}</span><div class="timeline-main"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(formatEventDate(event.date))} · ${escapeHtml(formatTimeWindow(event))}</small></div>${eventStatusBadge(getEventStatus(event))}</div>`).join("");
    eventTableBody.innerHTML = events.map((event) => `<article class="admin-event-card"><div class="admin-event-card-top"><span class="event-type-badge">${escapeHtml(event.type || "School Event")}</span>${eventStatusBadge(getEventStatus(event))}</div><h3>${escapeHtml(event.name)}</h3><p>${escapeHtml(event.description || event.notes || "No description provided.")}</p><div class="event-detail-boxes"><div><span>Date</span><strong>${escapeHtml(formatEventDate(event.date))}</strong></div><div><span>Time</span><strong>${escapeHtml(formatTimeWindow(event))}</strong></div><div><span>Location</span><strong>${escapeHtml(event.location)}</strong></div><div><span>Audience</span><strong>${escapeHtml(event.audience || "All students")}</strong></div></div><div class="admin-event-card-actions"><button class="outline-button" type="button" data-edit-event="${event.id}">Edit event</button><button class="small-button danger modal-danger-button" type="button" data-delete-event="${event.id}">Remove</button></div></article>`).join("");
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
    fineEvent.innerHTML = `<option value="">General attendance absence</option>${events.map((event) => `<option value="${escapeHtml(event.id)}">${escapeHtml(event.name)}${event.date ? ` · ${escapeHtml(event.date)}` : ""}</option>`).join("")}`;
    fineStudent.value = selectedStudent;
    fineEvent.value = selectedEvent;
  }

  function renderAdminFines() {
    const search = fineSearch.value.trim().toLowerCase();
    const statusFilter = fineStatusFilter.value;
    const filteredFines = fines
      .filter((fine) => statusFilter === "all" || (fine.status || "Pending") === statusFilter)
      .filter((fine) => !search || [fine.studentName, fine.studentId, fine.eventName, fine.reason, fine.status].join(" ").toLowerCase().includes(search))
      .sort((first, second) => (second.assignedAt?.seconds || 0) - (first.assignedAt?.seconds || 0));
    document.querySelector("#fineResultCount").textContent = `${filteredFines.length} fine${filteredFines.length === 1 ? "" : "s"} shown`;
    if (!filteredFines.length) {
      adminFineList.innerHTML = `<div class="empty-state">${fines.length ? "No fines match the current search or filter." : "No fines have been assigned."}</div>`;
      return;
    }
    adminFineList.innerHTML = filteredFines.map((fine) => `<article class="fine-record-card"><div class="history-card-top"><span class="event-type-badge">${escapeHtml(fine.studentId || "Student")}</span><span class="badge orange">${escapeHtml(formatServiceMinutes(fine.serviceMinutes))}</span></div><h3>${escapeHtml(fine.studentName || "Student")}</h3><div class="fine-record-event"><span>Missed attendance</span><strong>${escapeHtml(fine.eventName || "Attendance absence")}</strong></div><p>${escapeHtml(fine.reason || "No reason provided.")}</p><div class="fine-record-meta"><div><span>Status</span><strong class="${fine.status === "Completed" ? "is-completed" : ""}">${escapeHtml(fine.status || "Pending")}</strong></div><div><span>Assigned</span><strong>${escapeHtml(fine.assignedAt?.toDate?.().toLocaleDateString() || "Recently")}</strong></div></div><div class="history-card-actions"><button class="outline-button" type="button" data-edit-fine="${escapeHtml(fine.id)}">Modify</button><button class="small-button danger" type="button" data-delete-fine="${escapeHtml(fine.id)}">Remove</button></div></article>`).join("");
  }

  function resetFineForm() {
    fineForm.reset();
    fineStudentSearch.value = "";
    renderFineOptions();
    document.querySelector("#editingFineId").value = "";
    document.querySelector("#fineFormTitle").textContent = "Assign a fine";
    document.querySelector("#fineSubmitButton").textContent = "Assign fine";
  }

  function editFine(fine) {
    if (!fine) return;
    openView("assign-fine");
    document.querySelector("#editingFineId").value = fine.id;
    fineStudent.value = fine.studentUid || "";
    if (fine.eventId && !events.some((event) => event.id === fine.eventId)) fineEvent.add(new Option(fine.eventName || "Previously selected event", fine.eventId));
    fineEvent.value = fine.eventId || "";
    document.querySelector("#fineHours").value = String(fine.serviceMinutes || 30);
    document.querySelector("#fineStatus").value = fine.status || "Pending";
    document.querySelector("#fineReason").value = fine.reason || "";
    document.querySelector("#fineFormTitle").textContent = `Modify fine for ${fine.studentId || "student"}`;
    document.querySelector("#fineSubmitButton").textContent = "Save fine changes";
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
    const fineData = {
      studentUid: student.uid,
      studentId: student.accountId,
      studentName: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
      eventId: attendanceEvent?.id || (editingFine?.eventId === fineEvent.value ? editingFine.eventId : ""),
      eventName: attendanceEvent?.name || (editingFine?.eventId === fineEvent.value ? editingFine.eventName : "Attendance absence"),
      eventDate: attendanceEvent?.date || (editingFine?.eventId === fineEvent.value ? editingFine.eventDate : ""),
      serviceMinutes: Number(document.querySelector("#fineHours").value),
      reason: document.querySelector("#fineReason").value.trim(),
      status: document.querySelector("#fineStatus").value
    };
    try {
      if (editingFineId) {
        await setDoc(doc(db, "fines", editingFineId), { ...fineData, updatedAt: serverTimestamp(), updatedBy: currentUser.uid }, { merge: true });
        showDashboardToast("Fine updated", `${student.accountId}'s fine was updated.`);
      } else {
        await addDoc(collection(db, "fines"), { ...fineData, assignedAt: serverTimestamp(), assignedBy: currentUser.uid });
        showDashboardToast("Fine assigned", `${student.accountId} was assigned community service.`);
      }
      resetFineForm();
      openView("assigned-fines");
    } catch (error) {
      showDashboardToast("Unable to assign fine", error.code === "permission-denied" ? "Publish the latest database rules, then try again." : error.message);
    }
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
    return { isOnline, label: isOnline ? "Online" : "Offline", detail: isOnline ? deviceText : inactiveText };
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
    const search = studentSearch.value.trim().toLowerCase();
    const filtered = students.filter((student) => Object.values(student).join(" ").toLowerCase().includes(search));
    document.querySelector("#registeredCount").textContent = students.length;
    document.querySelector("#studentResultCount").textContent = `${filtered.length} student${filtered.length === 1 ? "" : "s"} shown`;
    if (!filtered.length) {
      studentTableBody.innerHTML = `<tr><td colspan="5"><div class="empty-state">${students.length ? "No students match your search." : "No students have been registered yet."}</div></td></tr>`;
      renderSelectedStudent();
      renderAdminAttendance();
      return;
    }
    studentTableBody.innerHTML = filtered.map((student) => {
      const avatar = student.photoDataUrl ? `<img src="${escapeHtml(student.photoDataUrl)}" alt="">` : escapeHtml(getInitials(student.firstName, student.lastName));
      const presence = getStudentPresence(student.uid);
      return `<tr><td><div class="student-cell"><span class="mini-avatar">${avatar}</span><div><strong>${escapeHtml([student.lastName, student.firstName, student.middleName].filter(Boolean).join(", "))}</strong><small>${escapeHtml(student.accountId)}</small></div></div></td><td><strong>${escapeHtml(student.course || "Not assigned")}</strong><br><small>Section ${escapeHtml(student.section)}</small></td><td><span class="badge ${presence.isOnline ? "green" : "gray"}"><i class="presence-dot"></i>${presence.label}</span><small class="presence-time">${escapeHtml(presence.detail)}</small></td><td>${escapeHtml(student.email || "Not provided")}</td><td><div class="table-actions"><button class="small-button" type="button" data-view-student="${student.uid}">Profile</button><button class="small-button" type="button" data-password-student="${student.uid}">Password</button><button class="small-button danger" type="button" data-delete-student="${student.uid}">Clear account</button></div></td></tr>`;
    }).join("");
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
    adminStudentDetail.innerHTML = `<article class="panel admin-student-overview"><button class="modal-close" type="button" data-close-student-detail aria-label="Close student details">×</button><div class="profile-avatar">${avatar}</div><h3>${escapeHtml(fullName)}</h3><p>Student ID · ${escapeHtml(student.accountId)}</p><p class="profile-course-line" style="margin-top:-4px;color:var(--muted);font-size:.82rem;">Course Registered · <strong>${escapeHtml(student.course || "Not assigned")}</strong></p><span class="badge ${presence.isOnline ? "green" : "gray"}"><i class="presence-dot"></i>${presence.label}</span><small class="presence-profile-time">${escapeHtml(presence.detail)}</small><div class="admin-student-actions"><button class="primary-button" type="button" data-edit-student="${student.uid}">Edit information</button><button class="outline-button" type="button" data-password-student="${student.uid}">Change password</button><button class="small-button danger modal-danger-button" type="button" data-delete-student="${student.uid}">Clear account</button></div></article><article class="panel admin-student-information"><div class="panel-head"><div><h3>Student information</h3><p>Profile details and recorded attendance.</p></div><span class="badge blue">${studentAttendance.length} attended</span></div><div class="student-info-boxes"><div class="student-info-box"><span>Student ID</span><strong>${escapeHtml(student.accountId)}</strong></div><div class="student-info-box"><span>Course Registered</span><strong>${escapeHtml(student.course || "Not assigned")}</strong></div><div class="student-info-box"><span>Section</span><strong>${escapeHtml(student.section)}</strong></div><div class="student-info-box"><span>Email address</span><strong>${escapeHtml(student.email || "Not provided")}</strong></div><div class="student-info-box"><span>Phone number</span><strong>${escapeHtml(student.phone || "Not provided")}</strong></div><div class="student-info-box"><span>Live status</span><strong>${presence.label}</strong><small>${escapeHtml(presence.detail)}</small></div><div class="student-info-box"><span>Account access</span><strong>${student.active === false ? "Inactive" : "Active"}</strong></div></div><div class="panel-head"><div><h3>Attended events</h3><p>All attendance records saved for this student.</p></div></div><div class="attended-event-grid">${attendedCards}</div></article>`;
    adminStudentDetail.hidden = false;
  }

  function resetEventForm() {
    eventForm.reset();
    document.querySelector("#editingEventId").value = "";
    document.querySelector("#eventFormTitle").textContent = "Event details";
    document.querySelector("#eventSubmitButton").textContent = "Create event";
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
    document.querySelector("#eventAudience").value = event.audience;
    document.querySelector("#eventNotes").value = event.description || event.notes || "";
    document.querySelector("#eventFormTitle").textContent = "Modify event";
    document.querySelector("#eventSubmitButton").textContent = "Save changes";
    openView("create");
  }
  eventForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const timeIn = document.querySelector("#eventTimeIn").value;
    const timeOut = document.querySelector("#eventTimeOut").value;
    const date = document.querySelector("#eventDate").value;
    if (timeOut <= timeIn) return showDashboardToast("Invalid attendance window", "Time Out must be later than Time In.");
    const id = document.querySelector("#editingEventId").value;
    const record = { name: document.querySelector("#eventName").value.trim(), type: document.querySelector("#eventType").value, date, location: document.querySelector("#eventLocation").value.trim(), timeIn, timeOut, audience: document.querySelector("#eventAudience").value, description: document.querySelector("#eventNotes").value.trim(), openAt: Timestamp.fromDate(new Date(`${date}T${timeIn}`)), closeAt: Timestamp.fromDate(new Date(`${date}T${timeOut}`)), updatedAt: serverTimestamp() };
    try {
      if (id) await setDoc(doc(db, "events", id), record, { merge: true });
      else await addDoc(collection(db, "events"), { ...record, createdAt: serverTimestamp(), createdBy: currentUser.uid });
      resetEventForm();
      openView("modify-events");
      showDashboardToast(id ? "Event updated" : "Event created", "The event and attendance window were saved and synced.");
    } catch (error) {
      showDashboardToast("Unable to save event", error.message);
    }
  });
  document.querySelector("#clearEventForm").addEventListener("click", resetEventForm);
  eventTableBody.addEventListener("click", async (clickEvent) => {
    const edit = clickEvent.target.closest("[data-edit-event]");
    const remove = clickEvent.target.closest("[data-delete-event]");
    if (edit) editEvent(edit.dataset.editEvent);
    if (remove) {
      await deleteDoc(doc(db, "events", remove.dataset.deleteEvent));
      showDashboardToast("Event removed", "The event was deleted.");
    }
  });

  function resetStudentForm() {
    studentForm.reset();
    document.querySelector("#originalStudentId").value = "";
    document.querySelector("#managedStudentId").disabled = false;
    document.querySelector("#managedPassword").required = true;
    document.querySelector("#managedPassword").disabled = false;
    document.querySelector("#managedPassword").value = "";
    document.querySelector("#managedPassword").placeholder = "Visible · minimum 6 characters";
    document.querySelector("#managedPasswordHelp").textContent = "The password stays visible while you type and must contain at least 6 characters.";
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
    const student = { accountId: document.querySelector("#managedStudentId").value.trim(), firstName: document.querySelector("#managedFirstName").value.trim(), middleName: document.querySelector("#managedMiddleName").value.trim(), lastName: document.querySelector("#managedLastName").value.trim(), course: document.querySelector("#managedCourse").value, section: document.querySelector("#managedSection").value, password: document.querySelector("#managedPassword").value, email: document.querySelector("#managedEmail").value.trim(), phone: document.querySelector("#managedPhone").value.trim() };
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

  studentTableBody.addEventListener("click", (clickEvent) => {
    const view = clickEvent.target.closest("[data-view-student]");
    const passwordButton = clickEvent.target.closest("[data-password-student]");
    const remove = clickEvent.target.closest("[data-delete-student]");
    if (view) {
      selectedManagedStudentUid = view.dataset.viewStudent;
      renderSelectedStudent();
      adminStudentDetail.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (passwordButton) openPasswordModal(students.find((student) => student.uid === passwordButton.dataset.passwordStudent));
    if (remove) openRemoveModal(students.find((student) => student.uid === remove.dataset.deleteStudent));
  });

  adminStudentDetail.addEventListener("click", (clickEvent) => {
    const close = clickEvent.target.closest("[data-close-student-detail]");
    const edit = clickEvent.target.closest("[data-edit-student]");
    const passwordButton = clickEvent.target.closest("[data-password-student]");
    const remove = clickEvent.target.closest("[data-delete-student]");
    if (close) {
      selectedManagedStudentUid = undefined;
      renderSelectedStudent();
    }
    if (edit) editStudent(edit.dataset.editStudent);
    if (passwordButton) openPasswordModal(students.find((student) => student.uid === passwordButton.dataset.passwordStudent));
    if (remove) openRemoveModal(students.find((student) => student.uid === remove.dataset.deleteStudent));
  });

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

  document.querySelectorAll("[data-close-password]").forEach((button) => button.addEventListener("click", closePasswordModal));
  document.querySelectorAll("[data-close-remove]").forEach((button) => button.addEventListener("click", closeRemoveModal));
  passwordModal.addEventListener("click", (event) => { if (event.target === passwordModal) closePasswordModal(); });
  removeStudentModal.addEventListener("click", (event) => { if (event.target === removeStudentModal) closeRemoveModal(); });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!passwordModal.hidden) closePasswordModal();
    if (!removeStudentModal.hidden) closeRemoveModal();
  });
  studentSearch.addEventListener("input", renderStudents);
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

  onSnapshot(query(collection(db, "events"), orderBy("openAt", "asc")), (snapshot) => { events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderAdminEvents(); renderFineOptions(); });
  onSnapshot(collection(db, "students"), (snapshot) => { students = snapshot.docs.map((item) => ({ uid: item.id, ...item.data() })); renderStudents(); renderFineOptions(); });
  onSnapshot(collection(db, "presenceSessions"), (snapshot) => { setPresenceSessions(snapshot); renderStudents(); });
  onSnapshot(collection(db, "presence"), (snapshot) => { legacyPresenceByUid = new Map(snapshot.docs.map((item) => [item.id, item.data()])); renderStudents(); });
  onSnapshot(collection(db, "attendance"), (snapshot) => { attendance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderAdminAttendance(); renderSelectedStudent(); });
  onSnapshot(collection(db, "fines"), (snapshot) => { fines = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderAdminFines(); });
  onSnapshot(doc(db, "adminProfiles", currentUser.uid), (snapshot) => { renderAdminProfile(snapshot.data()); });
  window.setInterval(() => { renderAdminEvents(); renderStudents(); }, 15000);
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
  updateDashboardGreeting(dashboardRole === "admin" ? "Admin" : "Student");
  if (dashboardRole === "student") initializeStudent();
  else initializeAdmin();
  initializeDashboardHistory();
}

initialize().catch((error) => {
  showDashboardToast("Unable to load Presence", error.message);
});
