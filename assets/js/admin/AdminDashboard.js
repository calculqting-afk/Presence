import { currentUser, activeView, currentUserRole, escapeHtml, ASSIGNABLE_ROLE_LABELS, firebaseErrorCode, roleLabel, roleChangeErrorMessage, formatBirthday, FineModalController, showDashboardToast, createNotification, resetFacePhotoInDrive, waitForFaceRegistration, openView, formatEventDate, formatEventTime, timePlusMinutes, formatTimeWindow, eventOpenDate, eventCloseDate, eventCheckInCloseDate, eventCheckoutCloseDate, isEventFinished, formatAttendanceTimestamp, attendanceDuration, getEventStatus, arrivalStatusBadge, eventStatusBadge, getInitials, formatServiceMinutes, formatFineDate, getFineHistory, fineDetailsMarkup, updateDashboardGreeting, SUPER_ADMIN_EMAIL, auth, db, studentIdToEmail, studentProvisioningAuth, createUserWithEmailAndPassword, deleteUser, signInWithEmailAndPassword, signOut, updatePassword, updateProfile, Timestamp, addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, getDocsFromServer, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, writeBatch } from '../dashboard.js?v=20261010-surveys';
import { ScopedSubscriptions } from '../core/ScopedSubscriptions.js';
import { AttendanceSyncService, AttendanceRealtimeBridge } from '../controllers/AttendanceController.js?v=20261010-surveys';
import { GeofenceController } from '../controllers/GeofenceController.js?v=20261010-surveys';
import { hasPermission } from '../core/permissions.js?v=20261010-surveys';
import { AttendanceCorrectionController } from '../controllers/AttendanceCorrectionController.js?v=20261010-surveys';
import { AttendanceSummaryService } from '../controllers/AttendanceSummaryService.js';
import { AttendanceHistoryController, AttendanceRepository } from '../controllers/AttendanceHistoryController.js?v=20261010-surveys';
import { AttendanceToolbarController } from '../controllers/AttendanceToolbarController.js';
import { EventSchedulePresenter } from '../controllers/EventSchedulePresenter.js';
import { StudentActionsPresenter } from '../controllers/StudentActionsPresenter.js';

export class AdminDashboard {
initialize() {
  const can = action => hasPermission(currentUserRole, action);
  const studentActions = new StudentActionsPresenter({ can, escapeHtml });
  const actionSelectors = {
    changePasswords: '[data-password-student]', deleteStudents: '[data-delete-student]',
    resetFace: '[data-reset-face]', editStudents: '[data-edit-student]',
    manageFines: '[data-edit-fine], #manageStudentFines', deleteFines: '[data-delete-fine]',
    deleteEvents: '[data-delete-event], [data-remove-event]', resetData: '#openDataCleanup'
  };
  const applyActionPermissions = () => Object.entries(actionSelectors).forEach(([action, selector]) => {
    document.querySelectorAll(selector).forEach(button => { button.hidden = !can(action); });
  });
  applyActionPermissions();
  const subscriptions = new ScopedSubscriptions({ onError: (error, key) => { console.error(key, error); showDashboardToast('Data sync unavailable', 'Check your connection and reload to retry.'); } });
  const listen = (key, views, reference, callback) => {
    if (['presence-sessions', 'legacy-presence', 'faces'].includes(key) && !can('viewStudents')) return;
    subscriptions.register(key, views, (guard, onError) => key === 'students'
      // Readiness depends on fromCache, including server confirmation with unchanged documents.
      ? onSnapshot(reference, { includeMetadataChanges: true }, guard(callback), onError)
      : onSnapshot(reference, guard(callback), onError));
  };
  const changeSubscriptions = event => subscriptions.setView(event.detail.viewName);
  window.addEventListener('presence:viewchange', changeSubscriptions);
  this.dispose = () => { subscriptions.stop(); window.removeEventListener('presence:viewchange', changeSubscriptions); };

  let events = [];
  let geofencesByEventId = new Map();
  let students = [];
  let studentsLoaded = false;
  let attendanceConfirmed = false;
  let attendance = [];
  let attendanceSyncService;
  let fines = [];
  let selectedFineStudentUid = "";
  let faceRegistrationsByUid = new Map();
  let presenceByUid = new Map();
  let legacyPresenceByUid = new Map();
  const summaryService = new AttendanceSummaryService({ closeDate: eventCloseDate, checkoutCloseDate: eventCheckoutCloseDate });
  const schedulePresenter = new EventSchedulePresenter({ formatTime: formatEventTime, escapeHtml, addMinutes: timePlusMinutes });
  const coverageDate = new Date(Date.now() - 30 * 86400000);
  const recentAttendanceFrom = new Date(coverageDate.getTime() - coverageDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const attendanceCoverageFrom = '';
  const historyController = new AttendanceHistoryController({ repository: new AttendanceRepository(db),
    getStudents: () => students, getEvents: () => events, summary: summaryService, notify: showDashboardToast, onStatus: updateAttendanceSyncStatus,
    render: (records, state) => { document.querySelector('#adminAttendanceLine').innerHTML = records.length ? attendanceLineMarkup(records) : AttendanceToolbarController.emptyState(state); } });
  historyController.initialize();
  document.querySelector('#attendanceFromDate').value = recentAttendanceFrom;
  const onHistoryView = event => {
    if (event.detail.viewName === 'attendance-line') void historyController.reload();
    else historyController.suspend();
  };
  window.addEventListener('presence:viewchange', onHistoryView);
  const disposeHistory = this.dispose;
  this.dispose = () => { historyController.dispose(); window.removeEventListener('presence:viewchange', onHistoryView); disposeHistory(); };
  const correctionController = new AttendanceCorrectionController({ db, user: currentUser, role: currentUserRole,
    getStudents: () => students, getEvents: () => events, escapeHtml, notify: showDashboardToast });
  correctionController.initialize();
  const disposeSubscriptions = this.dispose;
  this.dispose = () => { correctionController.dispose(); disposeSubscriptions(); };
  const handleCorrection = event => {
    const button = event.target.closest('[data-correct-attendance]');
    if (button) correctionController.open(historyController.records.find(item => item.id === button.dataset.correctAttendance)
      || attendance.find(item => item.id === button.dataset.correctAttendance));
  };
  document.querySelector('#adminAttendanceLine').addEventListener('click', handleCorrection);
  document.querySelector('#adminDashboardAttendanceLine').addEventListener('click', handleCorrection);
  const disposeCorrections = this.dispose;
  this.dispose = () => {
    document.querySelector('#adminAttendanceLine').removeEventListener('click', handleCorrection);
    document.querySelector('#adminDashboardAttendanceLine').removeEventListener('click', handleCorrection);
    disposeCorrections();
  };
  async function notifyRoles(roles, notification) {
    const recipients = students
      .filter((student) => student.active !== false && roles.includes(student.role))
      .map((student) => ({ uid: student.uid, role: student.role }));
    if (roles.includes(currentUserRole) && !recipients.some((recipient) => recipient.uid === currentUser.uid)) {
      recipients.push({ uid: currentUser.uid, role: currentUserRole });
    }
    const results = await Promise.allSettled(recipients.map((recipient) => createNotification({
      ...notification,
      recipientUid: recipient.uid,
      recipientRole: recipient.role
    })));
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }
  const eventForm = document.querySelector("#eventForm");
  const attendanceSyncStatus = document.querySelector("#attendanceSyncStatus");
  const syncAttendanceNow = document.querySelector("#syncAttendanceNow");
  const canManuallySyncAttendance = can('correctAttendance');
  attendanceSyncStatus.hidden = !canManuallySyncAttendance;
  syncAttendanceNow.hidden = !canManuallySyncAttendance;
  function updateAttendanceSyncStatus({ state, syncedAt, error }) {
    attendanceConfirmed = state === 'live';
    scheduleStudentsRender();
    const labels = {
      connecting: ["Connecting…", "gray"],
      syncing: ["Syncing…", "blue"],
      live: [syncedAt ? `Live · synced ${syncedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Live", "green"],
      offline: ["Offline · showing saved data", "orange"],
      cached: ["Cached data · connecting to server", "orange"],
      error: ["Sync unavailable · Retry", "orange"]
    };
    const [label, color] = labels[state] || labels.connecting;
    attendanceSyncStatus.textContent = label;
    attendanceSyncStatus.className = `badge ${color}`;
    attendanceSyncStatus.title = error?.message || "";
  }
  const attendanceRealtimeBridge = new AttendanceRealtimeBridge((portableRecord) => {
    const fromMillis = (value) => Number.isFinite(value) ? Timestamp.fromMillis(value) : undefined;
    const record = {
      ...portableRecord,
      attendedAt: fromMillis(portableRecord.attendedAt),
      checkedInAt: fromMillis(portableRecord.checkedInAt),
      checkedOutAt: fromMillis(portableRecord.checkedOutAt)
    };
    attendance = [...attendance.filter((item) => item.id !== record.id), record];
    scheduleStudentsRender();
    if (activeView === "dashboard") {
      renderAdminAttendance();
      renderAttendanceLine();
    }
    if (activeView === "attendance-line") renderAttendanceLine();
  });
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
  const adminAbsenceModalController = new FineModalController({ modal: document.querySelector("#adminAbsenceModal"), content: document.querySelector("#adminAbsenceModalContent"), title: document.querySelector("#adminAbsenceModalTitle"), description: document.querySelector("#adminAbsenceModalDescription"), closeSelector: "[data-close-admin-absences]" });
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
  const pendingRoleWrites = new Map();
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
    if (!can('changeRoles')) return;
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
      if (['dashboard', 'attendance-line'].includes(activeView)) renderAttendanceLine();
      scheduleStudentsRender();
      scheduleAdminEventStatusRefresh();
    }, Math.max(0, nextStatusChange - now) + 50);
  }

  const eventSyncNotice = document.querySelector(".notice");
  if (eventSyncNotice) eventSyncNotice.textContent = "Events sync online. Publishing saves the active participant roster. Re-save upcoming events after adding students or changing sections; the roster is locked once attendance opens. Older events without a roster have unverified absence eligibility.";
  studentTableBody.closest("table").querySelectorAll("th")[1].textContent = "Course / Section";
  studentTableBody.closest("table").querySelectorAll("th")[2].textContent = "Face / live status";
  document.querySelector('label[for="eventNotes"]').textContent = "Description";
  document.querySelector("#eventNotes").placeholder = "Write a clear announcement or event description";
  document.querySelector("#eventLocation").closest(".field").insertAdjacentHTML("beforebegin", '<div class="field"><label for="eventType">Event type</label><select id="eventType" required><option value="Assembly">Assembly</option><option value="Meeting">Meeting</option><option value="Seminar">Seminar</option><option value="Workshop">Workshop</option><option value="School Activity">School Activity</option><option value="Ceremony">Ceremony</option><option value="Sports">Sports</option><option value="Other">Other</option></select></div>');
  document.querySelector("#eventNotes").closest(".field").insertAdjacentHTML("beforebegin", `<fieldset class="geofence-editor field full"><legend>Attendance area</legend><label class="geofence-toggle"><input id="eventGeofenceEnabled" type="checkbox"> <span>Require location to check in</span></label><p>Choose a circle radius or draw a custom polygon boundary.</p><div class="map-search-row"><input id="eventGeofenceSearch" type="search" placeholder="Search an address or place"><button id="eventGeofenceSearchButton" class="outline-button" type="button">Search</button></div><div id="eventGeofenceMap" class="geofence-map" aria-label="Event attendance area map"></div><div class="geofence-fields"><div class="field"><label for="eventGeofenceRadius">Allowed radius (meters)</label><input id="eventGeofenceRadius" type="number" min="25" max="5000" step="5" value="100"></div><div class="field"><label for="eventGeofenceAddress">Selected address</label><input id="eventGeofenceAddress" type="text" readonly placeholder="Click the map or search for a place"></div><div class="field"><label for="eventGeofenceLatitude">Latitude</label><input id="eventGeofenceLatitude" type="number" step="any" readonly></div><div class="field"><label for="eventGeofenceLongitude">Longitude</label><input id="eventGeofenceLongitude" type="number" step="any" readonly></div></div><small class="geofence-help">Circle: click to set the center. Polygon: add 3–10 points around the area, then close the boundary. Students must allow location access.</small></fieldset>`);
  document.querySelector(".content").insertAdjacentHTML("beforeend", `<section class="view-section" data-section="geofence" hidden><div class="section-head"><div><p class="eyebrow">Attendance setup</p><h2>Geofence Locations</h2><p>Select an event and update the area where students may check in.</p></div></div><article class="panel geofence-manager-panel"><div class="field"><label for="geofenceEventSelect">Event</label><select id="geofenceEventSelect"><option value="">Select an event</option></select></div><div id="geofenceManagerContent" hidden><div class="geofence-manager-head"><div><strong id="geofenceManagerEventName"></strong><small id="geofenceManagerEventDetails"></small></div><label class="geofence-toggle"><input id="managerGeofenceEnabled" type="checkbox"> <span>Require location to check in</span></label></div><div class="map-search-row"><input id="managerGeofenceSearch" type="search" placeholder="Search an address or place"><button id="managerGeofenceSearchButton" class="outline-button" type="button">Search</button></div><div id="managerGeofenceMap" class="geofence-map" aria-label="Selected event attendance area map"></div><div class="geofence-fields"><div class="field"><label for="managerGeofenceRadius">Allowed radius (meters)</label><input id="managerGeofenceRadius" type="number" min="25" max="5000" step="5" value="100"></div><div class="field"><label for="managerGeofenceAddress">Selected address</label><input id="managerGeofenceAddress" type="text" readonly></div><div class="field"><label for="managerGeofenceLatitude">Latitude</label><input id="managerGeofenceLatitude" type="number" step="any" readonly></div><div class="field"><label for="managerGeofenceLongitude">Longitude</label><input id="managerGeofenceLongitude" type="number" step="any" readonly></div></div><div class="form-actions"><button id="geofenceEditEvent" class="outline-button" type="button">Edit full event</button><button id="saveManagerGeofence" class="primary-button" type="button">Save attendance area</button></div></div><div id="geofenceManagerEmpty" class="empty-state">Select an event to view or change its attendance area.</div></article></section>`);
  document.querySelector("#adminProfileEmail").value = currentUser.email || SUPER_ADMIN_EMAIL;

  const makeGeofenceEditor = (prefix) => new GeofenceController(prefix, { showToast: showDashboardToast });

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
    if (!can('manageGeofences')) return;
    const selectedEvent = events.find((event) => event.id === geofenceEventSelect.value);
    if (!selectedEvent) return;
    let geofence;
    try { geofence = managerGeofenceEditor.validate(); }
    catch (error) { return showDashboardToast('Choose a valid attendance area', error.message); }
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, "eventGeofences", selectedEvent.id), geofence);
      batch.set(doc(db, "events", selectedEvent.id), { requiresGeofence: geofence.enabled, updatedAt: serverTimestamp() }, { merge: true });
      await batch.commit();
      showDashboardToast("Attendance area saved", `${selectedEvent.name} now uses the updated location rule.`);
    } catch (error) { showDashboardToast("Unable to save area", error.message); }
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
    if (!can('adminProfile')) { event.preventDefault(); return; }
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
    confirmDataCleanup.disabled = !selected || dataCleanupConfirm.value.trim() !== "RESET DATA";
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
    if (!can('resetData')) return;
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
    if (!can('resetData')) return;
    if (confirmDataCleanup.disabled) return;
    confirmDataCleanup.disabled = true;
    confirmDataCleanup.textContent = "Resetting data…";
    try {
      const clearEvents = clearEventData.checked;
      const clearFines = clearFineData.checked;
      const [eventSnapshot, attendanceSnapshot, dismissedSnapshot, geofenceSnapshot, fineSnapshot] = await Promise.all([
        clearEvents ? getDocs(collection(db, "events")) : Promise.resolve(null),
        clearEvents ? getDocs(collection(db, "attendance")) : Promise.resolve(null),
        clearEvents ? getDocs(collection(db, "dismissedHistory")) : Promise.resolve(null),
        clearEvents ? getDocs(collection(db, "eventGeofences")) : Promise.resolve(null),
        clearFines ? getDocs(collection(db, "fines")) : Promise.resolve(null)
      ]);
      await Promise.all([
        eventSnapshot ? writeInBatches(eventSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve(),
        attendanceSnapshot ? writeInBatches(attendanceSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve(),
        dismissedSnapshot ? writeInBatches(dismissedSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve(),
        geofenceSnapshot ? writeInBatches(geofenceSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve(),
        fineSnapshot ? writeInBatches(fineSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve()
      ]);
      const counts = { events: eventSnapshot?.size || 0, attendance: attendanceSnapshot?.size || 0, fines: fineSnapshot?.size || 0 };
      closeDataCleanupModal();
      const eventFollowUp = clearEvents ? " Linked event areas and dismissed-event history were also removed." : "";
      showDashboardToast("Operational data reset", `${counts.events || 0} event${counts.events === 1 ? "" : "s"}, ${counts.attendance || 0} attendance record${counts.attendance === 1 ? "" : "s"}, and ${counts.fines || 0} fine${counts.fines === 1 ? "" : "s"} were removed.${eventFollowUp}`);
    } catch (error) {
      const code = firebaseErrorCode(error);
      showDashboardToast("Unable to reset data", code === "permission-denied" ? "Only the Super Admin can reset operational data. Deploy the latest Firestore Rules, then sign in again." : error.message || "Try again after refreshing the dashboard.");
      updateDataCleanupState();
    } finally {
      confirmDataCleanup.textContent = "Reset selected data";
    }
  });

  function renderAdminAttendance() {
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const totals = summaryService.today(students, events, attendance, localDate);
    const { present, expected, unverified } = totals;
    const pending = attendanceConfirmed ? totals.pending : 0, rate = attendanceConfirmed ? totals.rate : 0;
    document.querySelector("#registeredCount").textContent = students.length;
    document.querySelector("#presentTodayCount").textContent = present;
    document.querySelector("#presentTodayMeta").textContent = expected ? `${rate}% of ${expected} scheduled participants` : 'No verified participant roster for today';
    document.querySelector("#notCheckedInCount").textContent = pending;
    document.querySelector("#notCheckedInMeta").textContent = attendanceConfirmed
      ? `${expected ? 'Scheduled participants without a check-in' : 'No verified attendance requirement today'}${unverified ? ` · ${unverified} legacy eligibility unverified` : ''}` : 'Waiting for server attendance verification';
    document.querySelector("#adminAttendancePercent").textContent = `${rate}%`;
    document.querySelector("#adminAttendanceDetail").textContent = `${present} present`;
    document.querySelector("#adminAttendanceRing").style.background = `conic-gradient(var(--blue) 0 ${rate}%, var(--ring-track, #e8eef7) ${rate}% 100%)`;
  }

  function attendanceLineMarkup(records) {
    if (!records.length) return '<div class="empty-state">No attendance activity yet.</div>';
    return records.map((record) => {
      const student = students.find((item) => item.uid === record.studentUid);
      const studentName = student ? [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") : record.studentId || "Student";
      const avatar = student?.photoDataUrl ? `<img src="${escapeHtml(student.photoDataUrl)}" alt="">` : escapeHtml(getInitials(student?.firstName || studentName, student?.lastName || ""));
      const checkedInAt = record.checkedInAt || record.attendedAt;
      const completed = Boolean(record.checkedOutAt);
      return `<article class="attendance-line-item"><div class="attendance-line-person"><span class="mini-avatar">${avatar}</span><div><strong>${escapeHtml(studentName)}</strong><small>${escapeHtml(student?.accountId || record.studentId || "Student ID unavailable")}${student?.section ? ` · ${escapeHtml(student.section)}` : ""}</small></div></div><div class="attendance-line-event"><strong>${escapeHtml(record.eventName || "Attendance event")}</strong><small>${escapeHtml(record.eventDate || "Date unavailable")}</small></div><div class="attendance-line-times"><div><span>IN</span><strong>${escapeHtml(formatAttendanceTimestamp(checkedInAt))}</strong></div><div><span>OUT</span><strong>${escapeHtml(formatAttendanceTimestamp(record.checkedOutAt))}</strong></div><div><span>Duration</span><strong>${escapeHtml(attendanceDuration(checkedInAt, record.checkedOutAt))}</strong></div></div><div class="attendance-line-status">${record.recordSource === "admin-corrected" ? `<span class="badge orange" title="${escapeHtml(`${record.correctedBy || "Administrator"} · ${formatAttendanceTimestamp(record.correctedAt)} · ${record.correctionReason || ""}`)}">Manual correction</span>` : ""}${can("correctAttendance") ? `<button class="small-button" type="button" data-correct-attendance="${escapeHtml(record.id)}">Correct</button>` : ""}${arrivalStatusBadge(record.arrivalStatus)}<span class="badge ${completed ? "green" : summaryService.needsReview(record, events.find(event => event.id === record.eventId)) ? "orange" : "blue"}">${completed ? "Completed" : summaryService.needsReview(record, events.find(event => event.id === record.eventId)) ? "Needs review — missed checkout" : "Checked in"}</span></div></article>`;
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
    if (activeView === 'attendance-line') historyController.draw();
    document.querySelector("#adminDashboardAttendanceLine").innerHTML = attendanceLineMarkup(records.slice(0, 5));
  }

  syncAttendanceNow.addEventListener("click", async () => {
    if (!canManuallySyncAttendance) return;
    if (!attendanceSyncService) return;
    syncAttendanceNow.disabled = true;
    try {
      if (activeView === 'attendance-line') await historyController.reload();
      else await attendanceSyncService.syncNow();
      showDashboardToast("Attendance synced", "The Attendance Line was refreshed from Firestore.");
    } catch (error) {
      const message = firebaseErrorCode(error) === "permission-denied"
        ? "Firestore denied this server refresh. Confirm the deployed rules recognize your active attendance-management role, then sign out and sign in again."
        : "Firestore could not refresh attendance. Check your connection and try again.";
      showDashboardToast("Attendance sync failed", message);
    } finally {
      syncAttendanceNow.disabled = false;
    }
  });

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
    return `<article class="event-card admin-event-card admin-event-card-student-style"><div class="event-accent"></div><div class="event-body"><div class="event-card-kicker"><span class="event-type-badge">${escapeHtml(event.type || "School Event")}</span><span class="event-date">${escapeHtml(formatEventDate(event.date))}</span></div><h3>${escapeHtml(event.name)}</h3><div class="event-description"><strong>Description</strong>${escapeHtml(event.description || event.notes || "No description provided.")}</div>${schedulePresenter.render(event)}<div class="event-card-actions">${eventStatusBadge(getEventStatus(event))}<div class="admin-event-card-actions">${can("manageSurveys") ? `<button class="outline-button" type="button" data-survey-event="${escapeHtml(event.id)}">Survey / QR</button>` : ""}${past ? "" : `<button class="outline-button" type="button" data-manage-geofence="${event.id}">Attendance area</button>`}<button class="outline-button" type="button" data-edit-event="${event.id}">Edit event</button><button class="small-button danger modal-danger-button" type="button" data-delete-event="${event.id}" ${can("deleteEvents") ? "" : "hidden"}>Remove</button></div></div></div></article>`;
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
      const detailArea = sameReasonCount > 1 ? fineDetailsMarkup(fine, can('manageFines')) : can('manageFines') ? actions : '';
      return `<article class="fine-record-card"><div class="history-card-top"><span class="event-type-badge">${escapeHtml(fine.studentId || "Student")}</span><span class="badge orange">${escapeHtml(formatServiceMinutes(fine.serviceMinutes))}</span></div><h3>${escapeHtml(fine.studentName || "Student")}</h3><div class="fine-record-event"><span>Missed attendance</span><strong>${escapeHtml(fine.eventName || "Attendance absence")}</strong></div><p>${escapeHtml(fine.reason || "No reason provided.")}</p><div class="fine-record-meta"><div><span>Status</span><strong class="${fine.status === "Completed" ? "is-completed" : ""}">${escapeHtml(fine.status || "Pending")}</strong></div><div><span>Assigned</span><strong>${escapeHtml(formatFineDate(fine.assignedAt))}</strong></div></div>${detailArea}</article>`;
    }).join("");
    applyActionPermissions();
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
    if (!can('manageFines')) return;
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
    if (!can('manageFines')) { event.preventDefault(); return; }
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
        notifyRoles(["super_admin", "head_admin", "student_manager"], { category: "service", title: "Community service updated", message: `${student.accountId}'s service requirement was updated.`, targetView: "assigned-fines", studentName: fineData.studentName, studentId: student.accountId, section: student.section }).catch(() => {});
        showDashboardToast(addingCommunityService ? "Community service added" : "Fine updated", addingCommunityService ? `${formatServiceMinutes(enteredServiceMinutes)} was added to this fine.` : `${student.accountId}'s fine was updated.`);
      } else {
        await addDoc(collection(db, "fines"), {
          ...fineData,
          assignmentHistory: [{ action: "Assigned", addedMinutes: serviceMinutes, newMinutes: serviceMinutes, reason: fineData.reason, recordedAt: new Date().toISOString() }],
          assignedAt: serverTimestamp(),
          assignedBy: currentUser.uid
        });
        notifyRoles(["super_admin", "head_admin", "student_manager"], { category: "service", title: "Community service assigned", message: `${student.accountId} was assigned a community-service requirement.`, targetView: "assigned-fines", studentName: fineData.studentName, studentId: student.accountId, section: student.section }).catch(() => {});
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
    if (!button || !can("deleteFines")) return;
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
      const role = student.role === "viewer" ? "student" : student.role || "student";
      const roleControl = can('changeRoles')
        ? `<select class="role-select" data-role-select="${escapeHtml(student.uid)}" aria-label="Role for ${escapeHtml(student.accountId)}">${Object.entries(ASSIGNABLE_ROLE_LABELS).map(([value, label]) => `<option value="${value}"${value === role ? " selected" : ""}>${label}</option>`).join("")}</select>`
        : `<span class="badge blue">${escapeHtml(roleLabel(role))}</span>`;
      return `<tr><td><div class="student-cell"><span class="mini-avatar">${avatar}</span><div><strong>${escapeHtml([student.lastName, student.firstName, student.middleName].filter(Boolean).join(", "))}</strong><small>${escapeHtml(student.accountId)}</small></div></div></td><td><strong>${escapeHtml(student.course || "Not assigned")}</strong><br><small>Section ${escapeHtml(student.section)}</small></td><td><span class="badge ${hasFaceRegistration ? "green" : "gray"}">${hasFaceRegistration ? "Registered" : "Not registered"}</span><small class="presence-time presence-status is-${presence.status}"><i class="presence-dot"></i>${escapeHtml(presence.label)}</small></td><td>${escapeHtml(student.email || "Not provided")}</td><td>${roleControl}</td><td><div class="table-actions">${studentActions.render({ uid: student.uid, hasFaceRegistration })}</div></td></tr>`;
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
    const absenceCount = can('viewAbsences') ? getStudentAbsences(student).length : 0;
    const attendedCards = studentAttendance.length
      ? studentAttendance.map((record) => `<article class="attended-event-box"><strong>${escapeHtml(record.eventName || "Attendance event")}</strong><span>${escapeHtml(record.eventDate || "Date unavailable")} · ${escapeHtml(record.location || "Location not provided")}</span><span>${escapeHtml(record.timeIn || "")} ${record.timeOut ? `– ${escapeHtml(record.timeOut)}` : ""}</span></article>`).join("")
      : '<div class="empty-state">This student has not attended an event yet.</div>';
    const hasFaceRegistration = faceRegistrationsByUid.get(student.uid)?.registered === true;
    adminStudentDetail.innerHTML = `<article class="panel admin-student-overview"><button class="modal-close" type="button" data-close-student-detail aria-label="Close student details">×</button><div class="profile-avatar">${avatar}</div><h3>${escapeHtml(fullName)}</h3><p>Student ID · ${escapeHtml(student.accountId)}</p><p class="profile-course-line" style="margin-top:-4px;color:var(--muted);font-size:.82rem;">Course Registered · <strong>${escapeHtml(student.course || "Not assigned")}</strong></p><span class="badge ${presence.isOnline ? "green" : "gray"}"><i class="presence-dot"></i>${presence.label}</span><small class="presence-profile-time">${escapeHtml(presence.detail)}</small><div class="admin-student-actions">${studentActions.render({ uid: student.uid, hasFaceRegistration, profile: true })}</div></article><article class="panel admin-student-information"><div class="panel-head"><div><h3>Student information</h3><p>Profile details and recorded attendance.</p></div><span class="badge blue">${studentAttendance.length} attended</span></div><div class="student-info-boxes"><div class="student-info-box"><span>Student ID</span><strong>${escapeHtml(student.accountId)}</strong></div><div class="student-info-box"><span>Course Registered</span><strong>${escapeHtml(student.course || "Not assigned")}</strong></div><div class="student-info-box"><span>Section</span><strong>${escapeHtml(student.section)}</strong></div><div class="student-info-box"><span>Face registration</span><strong>${hasFaceRegistration ? "Registered" : "Not registered"}</strong></div><div class="student-info-box"><span>Email address</span><strong>${escapeHtml(student.email || "Not provided")}</strong></div><div class="student-info-box"><span>Phone number</span><strong>${escapeHtml(student.phone || "Not provided")}</strong></div><div class="student-info-box"><span>Live status</span><strong>${presence.label}</strong><small>${escapeHtml(presence.detail)}</small></div><div class="student-info-box"><span>Account access</span><strong>${student.active === false ? "Inactive" : "Active"}</strong></div></div><div class="panel-head"><div><h3>Attended events</h3><p>All attendance records saved for this student.</p></div></div><div class="attended-event-grid">${attendedCards}</div></article>`;
    const fineCount = fines.filter((fine) => fine.studentUid === student.uid).length;
    const profileActions = adminStudentDetail.querySelector(".admin-student-actions");
    if (can("viewFines")) profileActions?.insertAdjacentHTML("afterbegin", `<button class="outline-button" type="button" data-check-student-fines="${escapeHtml(student.uid)}">Check attendance fines${fineCount ? ` (${fineCount})` : ""}</button>`);
    if (can('viewAbsences')) profileActions?.insertAdjacentHTML("afterbegin", `<button class="outline-button" type="button" data-view-student-absences="${escapeHtml(student.uid)}">View absences${absenceCount ? ` (${absenceCount})` : ""}</button>`);
    adminStudentDetail.querySelector(".student-info-boxes")?.insertAdjacentHTML("afterbegin", `<div class="student-info-box"><span>Birthday</span><strong>${escapeHtml(formatBirthday(student.birthday))}</strong></div>`);
    adminStudentDetail.hidden = false;
    applyActionPermissions();
  }

  function getStudentAbsences(student) {
    return summaryService.summarize(student, events, attendance, { coverageFrom: attendanceCoverageFrom, coverageConfirmed: attendanceConfirmed }).absences
      .sort((first, second) => eventCloseDate(second).getTime() - eventCloseDate(first).getTime());
  }

  async function openAdminAbsenceModal(student, trigger) {
    if (!can('viewAbsences') || !student) return;
    const studentName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") || "Student";
    let result;
    try {
      const snapshot = await getDocsFromServer(query(collection(db, 'attendance'), where('studentUid', '==', student.uid)));
      result = summaryService.summarize(student, events, snapshot.docs.map(item => item.data()));
    } catch { showDashboardToast('Absence verification unavailable', 'No absence decision was made. Check your connection and retry.'); return; }
    const absences = result.absences;
    const records = absences.length
      ? absences.map((event) => `<article class="community-service-record"><div class="community-service-record-top"><strong>${escapeHtml(event.name || "Attendance event")}</strong><span class="badge orange">Absent</span></div><div class="fine-detail-grid"><div><span>Date</span><strong>${escapeHtml(formatEventDate(event.date))}</strong></div><div><span>Time</span><strong>${escapeHtml(formatTimeWindow(event))}</strong></div><div><span>Location</span><strong>${escapeHtml(event.location || "Not specified")}</strong></div><div><span>Audience</span><strong>${escapeHtml(event.audience || "All students")}</strong></div></div></article>`).join("")
      : '<div class="community-service-empty">No recorded absences for this student.</div>';
    adminAbsenceModalController.open({ title: `${studentName}'s absences`, description: `${absences.length} confirmed absences · ${result.unverified.length} historical events unverified.`, markup: `<section class="community-service-section"><div class="community-service-section-heading"><h3>Missed events</h3><p>Confirmed roster participants only. Historical events without eligibility records are unverified. Missed checkout needs review, not an automatic absence.</p></div>${records}</section>`, trigger });
  }

  function fineRecordModalMarkup(fine) {
    const status = fine.status === "Completed" ? "Completed" : "Needs review";
    return `<article class="community-service-record"><div class="community-service-record-top"><strong>${escapeHtml(fine.eventName || "Attendance absence")}</strong><span class="badge ${fine.status === "Completed" ? "green" : "orange"}">${escapeHtml(status)}</span></div><div class="fine-detail-grid"><div><span>Attendance date</span><strong>${escapeHtml(fine.eventDate || "Not recorded")}</strong></div><div><span>Service required</span><strong>${escapeHtml(formatServiceMinutes(fine.serviceMinutes))}</strong></div><div><span>Recorded</span><strong>${escapeHtml(formatFineDate(fine.assignedAt))}</strong></div><div class="fine-detail-full"><span>Reason</span><strong>${escapeHtml(fine.reason || "No reason provided.")}</strong></div></div></article>`;
  }

  function openAdminFineModal(student, trigger) {
    if (!can('viewFines')) return;
    if (!student) return;
    selectedFineStudentUid = student.uid;
    const studentFines = fines.filter((fine) => fine.studentUid === student.uid);
    const currentRecords = studentFines.filter((fine) => fine.status !== "Completed");
    const reviewedRecords = studentFines.filter((fine) => fine.status === "Completed");
    const studentName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") || "Student";
    adminFineModalController.open({ title: `${studentName}'s attendance fines`, description: can("manageFines") ? "Review attendance-fine records, then use Manage fines to update them." : "Read-only attendance-fine records.", markup: `<section class="community-service-section"><div class="community-service-section-heading"><h3>Current records</h3><p>Records that still need attention.</p></div>${currentRecords.length ? currentRecords.map(fineRecordModalMarkup).join("") : '<div class="community-service-empty">No current attendance fines recorded.</div>'}</section><section class="community-service-section"><div class="community-service-section-heading"><h3>Reviewed records</h3><p>Records marked as completed.</p></div>${reviewedRecords.length ? reviewedRecords.map(fineRecordModalMarkup).join("") : '<div class="community-service-empty">No reviewed attendance fines recorded.</div>'}</section>`, trigger });
  }

  async function resetStudentFaceRegistration(student) {
    if (!can('resetFace')) return;
    if (!student || !faceRegistrationsByUid.get(student.uid)?.registered) return false;
    try {
      await resetFacePhotoInDrive(student.uid);
      const registration = await waitForFaceRegistration(student.uid, false);
      if (!registration) throw new Error("Drive did not confirm removal. The student remains registered.");
      await createNotification({ recipientUid: student.uid, recipientRole: "student", category: "face", title: "Face registration reset", message: "Your administrator reset your face registration. You may now register one new photo.", targetView: "face", studentName: [student.firstName, student.lastName].filter(Boolean).join(" "), studentId: student.accountId, section: student.section });
      await notifyRoles(["super_admin", "head_admin", "student_manager"], { category: "face", title: "Face registration reset", message: `${student.accountId}'s face registration was reset.`, targetView: "modify-students", studentName: [student.firstName, student.lastName].filter(Boolean).join(" "), studentId: student.accountId, section: student.section });
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
  function duplicateEventSignature(event) {
    const normalized = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
    return [
      event.name,
      event.date,
      event.location,
      event.audience,
      event.timeIn,
      event.checkInCutoff,
      event.timeOut,
      event.checkOutCutoff
    ].map(normalized).join("\u001f");
  }
  async function editEvent(id) {
    if (!can('manageEvents')) return;
    const event = events.find((item) => item.id === id);
    if (!event) return;
    try {
      const snapshot = await getDoc(doc(db, "eventGeofences", id));
      event.geofence = snapshot.data() || { enabled: false };
    } catch (error) {
      showDashboardToast("Attendance area unavailable", "The current area could not be loaded. Retry before editing this event.");
      return;
    }
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
      can('manageFines') ? getDocs(query(collection(db, "fines"), where("eventId", "==", eventId))) : Promise.resolve({ docs: [] })
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
    if (!can('deleteEvents')) return;
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
    if (!can('manageEvents')) { submitEvent.preventDefault(); return; }
    submitEvent.preventDefault();
    if (!studentsLoaded) return showDashboardToast('Participant roster not ready', 'Wait for the student directory to load before publishing an event.');
    const timeIn = document.querySelector("#eventTimeIn").value;
    const timeOut = document.querySelector("#eventTimeOut").value;
    const checkInCutoff = document.querySelector("#eventCheckInCutoff").value;
    const checkOutCutoff = document.querySelector("#eventCheckOutCutoff").value;
    const date = document.querySelector("#eventDate").value;
    if (timeOut <= timeIn) return showDashboardToast("Invalid attendance window", "Time Out must be later than Time In.");
    if (checkInCutoff <= timeIn || checkInCutoff > timeOut) return showDashboardToast("Invalid check-in cutoff", "The check-in cutoff must be after Time In and no later than Time Out.");
    if (checkOutCutoff <= timeOut) return showDashboardToast("Invalid checkout cutoff", "The checkout cutoff must be after Time Out.");
    const id = document.querySelector("#editingEventId").value;
    let requestedGeofence;
    try { requestedGeofence = eventGeofenceEditor.validate(); }
    catch (error) { return showDashboardToast('Choose a valid attendance area', error.message); }
    const geofence = requestedGeofence.enabled ? requestedGeofence : { enabled: false };
    const record = { name: document.querySelector("#eventName").value.trim(), type: document.querySelector("#eventType").value, date, location: document.querySelector("#eventLocation").value.trim(), timeIn, checkInCutoff, timeOut, checkOutCutoff, audience: document.querySelector("#eventAudience").value, description: document.querySelector("#eventNotes").value.trim(), requiresGeofence: geofence.enabled, openAt: Timestamp.fromDate(new Date(`${date}T${timeIn}`)), checkInClosesAt: Timestamp.fromDate(new Date(`${date}T${checkInCutoff}`)), closeAt: Timestamp.fromDate(new Date(`${date}T${timeOut}`)), checkOutClosesAt: Timestamp.fromDate(new Date(`${date}T${checkOutCutoff}`)), updatedAt: serverTimestamp() };
    const duplicate = events.find((event) => event.id !== id && duplicateEventSignature(event) === duplicateEventSignature(record));
    const previousEvent = events.find(event => event.id === id);
    if (!previousEvent || new Date() < eventOpenDate(previousEvent)) {
      record.attendanceRoster = summaryService.captureRoster(students, record);
      if (Object.keys(record.attendanceRoster).length > 5000) return showDashboardToast('Participant roster too large', 'This event supports up to 5,000 participants. Select a smaller audience.');
      record.rosterCapturedAt = serverTimestamp();
    }
    if (duplicate) {
      return showDashboardToast("Duplicate event", `An event named ${record.name} already uses this date, location, audience, and attendance schedule. Change one of those details before saving.`);
    }
    try {
      if (id) {
        const batch = writeBatch(db);
        batch.set(doc(db, "events", id), record, { merge: true });
        batch.set(doc(db, "eventGeofences", id), geofence);
        await batch.commit();
        await syncEventRecords(id, record);
        if (!isEventFinished(record)) {
          const recipients = students.filter((student) => student.active !== false && (record.audience === "All students" || record.audience === `Section ${student.section}`));
          Promise.allSettled(recipients.map((student) => createNotification({ recipientUid: student.uid, recipientRole: "student", category: "attendance", title: "Event updated", message: `${record.name} was updated. Review the latest event details.`, targetView: "events", eventId: id, studentName: [student.firstName, student.lastName].filter(Boolean).join(" "), studentId: student.accountId, section: student.section }))).catch(() => {});
          notifyRoles(["super_admin", "head_admin", "attendance_admin"], { category: "system", title: "Event updated", message: `${record.name} was updated. Review the latest event details.`, targetView: "modify-events", eventId: id }).catch(() => {});
        }
      } else {
        const eventReference = doc(collection(db, "events"));
        const batch = writeBatch(db);
        batch.set(eventReference, { ...record, createdAt: serverTimestamp(), createdBy: currentUser.uid });
        batch.set(doc(db, "eventGeofences", eventReference.id), geofence);
        await batch.commit();
        if (!isEventFinished(record)) {
          const recipients = students.filter((student) => student.active !== false && (record.audience === "All students" || record.audience === `Section ${student.section}`));
          Promise.allSettled(recipients.map((student) => createNotification({ recipientUid: student.uid, recipientRole: "student", category: "attendance", title: "New event published", message: `${record.name} is scheduled for ${formatEventDate(record.date)}.`, targetView: "events", eventId: eventReference.id, studentName: [student.firstName, student.lastName].filter(Boolean).join(" "), studentId: student.accountId, section: student.section }))).catch(() => {});
          notifyRoles(["super_admin", "head_admin", "attendance_admin"], { category: "system", title: "New event published", message: `${record.name} is scheduled for ${formatEventDate(record.date)}.`, targetView: "modify-events", eventId: eventReference.id }).catch(() => {});
        }
      }
      const returnView = eventForm.dataset.returnView || "modify-events";
      resetEventForm();
      openView(returnView);
      showDashboardToast(id ? "Event updated" : "Event created", id ? "The event and linked attendance records were synced." : "The event and attendance window were saved and synced.");
    } catch (error) {
      const message = firebaseErrorCode(error) === "permission-denied"
        ? "Your account is not allowed to create events. Confirm you are signed in as a Head Admin or Attendance Admin and that the latest Firestore Rules are deployed."
        : (error.message || "The event could not be saved. Please try again.");
      showDashboardToast("Unable to save event", message);
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
    if (!can('deleteEvents')) return;
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
    if (!can('editStudents')) return;
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
    if (!can('addStudents') || !can('editStudents')) { submitEvent.preventDefault(); return; }
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
    if (!can('changePasswords')) return;
    selectedPasswordStudent = student;
    if (!selectedPasswordStudent) return;
    document.querySelector("#passwordStudentName").textContent = `Change the password for ${selectedPasswordStudent.firstName} ${selectedPasswordStudent.lastName}. Enter the current password to continue.`;
    passwordModal.hidden = false;
    document.querySelector("#currentStudentPassword").focus();
  }

  function openRemoveModal(student) {
    if (!can('deleteStudents')) return;
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
    if (!can('resetFace')) return;
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
    if (!selector || !can('changeRoles')) return;
    const student = students.find((item) => item.uid === selector.dataset.roleSelect);
    if (!student) return;
    const pendingWrite = pendingRoleWrites.get(student.uid);
    if (pendingWrite) {
      selector.value = pendingWrite.role;
      showDashboardToast("Role update still syncing", `${student.accountId}'s role change is still waiting for Firestore confirmation. Do not submit it again yet.`);
      return;
    }
    const previousRole = student.role || "student";
    const role = selector.value;
    openRoleChangeModal(student, role, selector);
  });

  confirmRoleChange.addEventListener("click", async () => {
    if (!can('changeRoles')) return;
    if (!pendingRoleChange) return;
    const { student, role, previousRole, selector } = pendingRoleChange;
    selector.disabled = true;
    confirmRoleChange.disabled = true;
    confirmRoleChange.textContent = "Updating role…";
    const roleWrite = setDoc(doc(db, "students", student.uid), {
      role,
      roleUpdatedAt: serverTimestamp(),
      roleUpdatedBy: currentUser.uid
    }, { merge: true });
    let syncTimer;
    try {
      const acknowledged = await Promise.race([
        roleWrite.then(() => true),
        new Promise((resolve) => { syncTimer = window.setTimeout(() => resolve(false), 10000); })
      ]);
      if (!acknowledged) {
        pendingRoleWrites.set(student.uid, { role, previousRole, selector });
        pendingRoleChange = undefined;
        roleChangeModal.hidden = true;
        showDashboardToast("Role update still syncing", `${student.accountId}'s change was queued locally and is waiting for Firestore. Do not submit it again; Presence will confirm once the server responds.`);
        roleWrite.then(() => {
          pendingRoleWrites.delete(student.uid);
          showDashboardToast("Role updated", `${student.accountId} is now ${roleLabel(role)}. They must sign out and sign back in for the new access to apply.`);
        }).catch((error) => {
          pendingRoleWrites.delete(student.uid);
          if (selector.value === role) selector.value = previousRole;
          showDashboardToast("Unable to update role", roleChangeErrorMessage(error));
        });
        return;
      }
      pendingRoleChange = undefined;
      roleChangeModal.hidden = true;
      showDashboardToast("Role updated", `${student.accountId} is now ${roleLabel(role)}. They must sign out and sign back in for the new access to apply.`);
    } catch (error) {
      selector.value = previousRole;
      pendingRoleChange = undefined;
      roleChangeModal.hidden = true;
      showDashboardToast("Unable to update role", roleChangeErrorMessage(error));
    } finally {
      window.clearTimeout(syncTimer);
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
    const viewAbsences = clickEvent.target.closest("[data-view-student-absences]");
    if (close) {
      selectedManagedStudentUid = undefined;
      renderSelectedStudent();
    }
    if (edit) editStudent(edit.dataset.editStudent);
    if (checkFines) openAdminFineModal(students.find((student) => student.uid === checkFines.dataset.checkStudentFines), checkFines);
    if (viewAbsences) openAdminAbsenceModal(students.find((student) => student.uid === viewAbsences.dataset.viewStudentAbsences), viewAbsences);
    if (passwordButton) openPasswordModal(students.find((student) => student.uid === passwordButton.dataset.passwordStudent));
    if (resetFace) openResetFaceModal(students.find((student) => student.uid === resetFace.dataset.resetFace));
    if (remove) openRemoveModal(students.find((student) => student.uid === remove.dataset.deleteStudent));
  });

  document.querySelector("#manageStudentFines").addEventListener("click", () => {
    if (!can("manageFines")) return;
    const student = students.find((item) => item.uid === selectedFineStudentUid);
    if (!student) return;
    fineSearch.value = [student.firstName, student.middleName, student.lastName, student.accountId].filter(Boolean).join(" ");
    adminFineModalController.close();
    openView("assigned-fines");
    renderAdminFines();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !document.querySelector("#adminFineModal").hidden) adminFineModalController.close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !document.querySelector("#adminAbsenceModal").hidden) adminAbsenceModalController.close(); });

  document.querySelector("#passwordChangeForm").addEventListener("submit", async (submitEvent) => {
    if (!can('changePasswords')) { submitEvent.preventDefault(); return; }
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
    if (!can('deleteStudents')) return;
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
    if (!can('resetFace')) return;
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
  if (can('manageGeofences')) listen('geofences', ["create","geofence","modify-events","past-events"], collection(db, "eventGeofences"), (snapshot) => {
    geofencesByEventId = new Map(snapshot.docs.map((item) => [item.id, item.data()]));
    events = events.map((event) => ({ ...event, geofence: geofencesByEventId.get(event.id) || { enabled: false } }));
    if (activeView === "geofence") loadGeofenceManager();
    if (["dashboard", "modify-events", "past-events"].includes(activeView)) renderAdminEvents();
  });
  listen('events', ["*"], query(collection(db, "events"), orderBy("openAt", "asc")), (snapshot) => {
    events = snapshot.docs.map((item) => ({ id: item.id, ...item.data(), ...(can('manageGeofences') ? { geofence: geofencesByEventId.get(item.id) || { enabled: false } } : {}) }));
    if (["dashboard", "modify-events"].includes(activeView)) renderAdminEvents();
    if (activeView === "past-events") renderPastEvents();
    renderGeofenceEventOptions();
    if (activeView === "geofence") loadGeofenceManager();
    if (activeView === "assign-fine") renderFineOptions();
    if (["dashboard", "attendance-line"].includes(activeView)) renderAttendanceLine();
    scheduleAdminEventStatusRefresh();
  });
  listen('students', ["*"], collection(db, "students"), (snapshot) => {
    studentsLoaded = !snapshot.metadata?.fromCache;
    students = snapshot.docs.map((item) => ({ uid: item.id, ...item.data() }));
    scheduleStudentsRender();
    if (activeView === "assign-fine") renderFineOptions();
    if (activeView === "dashboard") renderAdminAttendance();
    if (["dashboard", "attendance-line"].includes(activeView)) renderAttendanceLine();
  });
  listen('presence-sessions', ["modify-students"], collection(db, "presenceSessions"), (snapshot) => { setPresenceSessions(snapshot); scheduleStudentsRender(); });
  listen('legacy-presence', ["modify-students"], collection(db, "presence"), (snapshot) => { legacyPresenceByUid = new Map(snapshot.docs.map((item) => [item.id, item.data()])); scheduleStudentsRender(); });
  attendanceSyncService = new AttendanceSyncService({
    onRecords(records) {
      attendance = records;
      scheduleStudentsRender();
      if (activeView === "dashboard") {
        renderAdminAttendance();
        renderAttendanceLine();
      }
      if (activeView === "attendance-line") renderAttendanceLine();
    },
    reference: collection(db, 'attendance'),
    onStatus: updateAttendanceSyncStatus
  });
  subscriptions.register('attendance', ['dashboard', 'modify-students', 'modify-events', 'past-events', 'profile'], () => {
    attendanceSyncService.start();
    return () => attendanceSyncService.stop();
  });
  const disposeListeners = this.dispose;
  this.dispose = () => { disposeListeners(); eventGeofenceEditor.dispose(); managerGeofenceEditor.dispose(); attendanceRealtimeBridge.close(); window.clearTimeout(adminEventStatusTimer); window.cancelAnimationFrame(studentRenderFrame); };
  if (can('viewFines')) listen('fines', ["assign-fine","assigned-fines","modify-students","profile"], collection(db, "fines"), (snapshot) => {
    fines = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    if (activeView === "assigned-fines") renderAdminFines();
    if (activeView === "modify-students") scheduleStudentsRender();
    if (activeView === "modify-students" && selectedManagedStudentUid) renderSelectedStudent();
  });
  listen('faces', ["modify-students"], collection(db, "faceRegistrations"), (snapshot) => { faceRegistrationsByUid = new Map(snapshot.docs.map((item) => [item.id, item.data()])); scheduleStudentsRender(); });
  if (can('adminProfile')) listen('admin-profile', ["*"], doc(db, "adminProfiles", currentUser.uid), (snapshot) => { renderAdminProfile(snapshot.data()); });
  resetStudentForm();
  resetEventForm();
}
}
