import { ControllerScope } from '../core/ControllerScope.js';
import { StudentAttendanceController } from '../controllers/StudentAttendanceController.js?v=20261011-student-startup';
import { currentUser, currentUserProfile, escapeHtml, formatBirthday, FineModalController, showDashboardToast, createNotification, uploadFacePhotoToDrive, waitForFaceRegistration, openView, formatEventDate, formatEventTime, timePlusMinutes, formatTimeWindow, eventOpenDate, eventCloseDate, eventCheckInCloseDate, eventCheckoutCloseDate, isCheckoutAvailable, isEventFinished, formatAttendanceTimestamp, attendanceDuration, getEventStatus, arrivalStatusBadge, eventStatusBadge, getInitials, formatServiceMinutes, formatFineDate, formatFineTimestamp, getFineHistory, updateDashboardGreeting, createDeviceSessionToken, auth, db, signOut, updatePassword, Timestamp, collection, deleteField, doc, getDoc, getDocFromServer, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, writeBatch, sessionState } from '../dashboard.js?v=20261011-student-startup';
import { ScopedSubscriptions } from '../core/ScopedSubscriptions.js';
import { AttendancePolicy, LateCheckInModal, AttendanceCheckInController, AttendanceRealtimeBridge } from '../controllers/AttendanceController.js?v=20261011-student-startup';
import { AttendanceSummaryService } from '../controllers/AttendanceSummaryService.js';
import { StudentAttendanceListController } from '../controllers/StudentAttendanceListController.js?v=20261011-student-startup';
import { AttendanceToolbarController } from '../controllers/AttendanceToolbarController.js';
import { EventSchedulePresenter } from '../controllers/EventSchedulePresenter.js';
export class StudentDashboard {
  constructor({
    document = globalThis.document,
    window = globalThis.window,
    sessionStorage = globalThis.sessionStorage
  } = {}) {
    this.document = document;
    this.window = window;
    this.sessionStorage = sessionStorage;
    this.scope = new ControllerScope();
    this.listen = this.listen.bind(this);
    this.changeSubscriptions = this.changeSubscriptions.bind(this);
    this.updatePresence = this.updatePresence.bind(this);
    this.updatePhotoPreview = this.updatePhotoPreview.bind(this);
    this.prepareProfilePhoto = this.prepareProfilePhoto.bind(this);
    this.closeStudentProfileModal = this.closeStudentProfileModal.bind(this);
    this.openRequiredPasswordChangeModal = this.openRequiredPasswordChangeModal.bind(this);
    this.closeRequiredPasswordChangeModal = this.closeRequiredPasswordChangeModal.bind(this);
    this.renderEvents = this.renderEvents.bind(this);
    this.scheduleEventRender = this.scheduleEventRender.bind(this);
    this.scheduleEventStatusRefresh = this.scheduleEventStatusRefresh.bind(this);
    this.renderAttendanceSummary = this.renderAttendanceSummary.bind(this);
    this.renderMyAttendances = this.renderMyAttendances.bind(this);
    this.renderFines = this.renderFines.bind(this);
    this.renderProfile = this.renderProfile.bind(this);
    this.serviceRecordMarkup = this.serviceRecordMarkup.bind(this);
    this.openCommunityServiceModal = this.openCommunityServiceModal.bind(this);
    this.openAllStudentFinesModal = this.openAllStudentFinesModal.bind(this);
    this.closeCommunityServiceModal = this.closeCommunityServiceModal.bind(this);
    this.closeGeofenceError = this.closeGeofenceError.bind(this);
    this.showGeofenceError = this.showGeofenceError.bind(this);
    this.lockFaceRegistration = this.lockFaceRegistration.bind(this);
    this.unlockFaceRegistration = this.unlockFaceRegistration.bind(this);
    this.setFaceGuidance = this.setFaceGuidance.bind(this);
    this.clearFaceGuidanceTimers = this.clearFaceGuidanceTimers.bind(this);
    this.updateFaceCaptureAvailability = this.updateFaceCaptureAvailability.bind(this);
    this.beginFaceGuidance = this.beginFaceGuidance.bind(this);
    this.retakeFacePhoto = this.retakeFacePhoto.bind(this);
    this.captureFacePhoto = this.captureFacePhoto.bind(this);
    this.handleInitializePresenceFocus = this.handleInitializePresenceFocus.bind(this);
    this.handleInitializePresencePagehide = this.handleInitializePresencePagehide.bind(this);
    this.handleStudentProfileContentClick = this.handleStudentProfileContentClick.bind(this);
    this.handleStudentProfileFormSubmit = this.handleStudentProfileFormSubmit.bind(this);
    this.handleProfilePhotoChange = this.handleProfilePhotoChange.bind(this);
    this.handleRemoveProfilePhotoClick = this.handleRemoveProfilePhotoClick.bind(this);
    this.handleProfileFirstNameInput = this.handleProfileFirstNameInput.bind(this);
    this.handleProfileLastNameInput = this.handleProfileLastNameInput.bind(this);
    this.handleStudentProfileModalClick = this.handleStudentProfileModalClick.bind(this);
    this.handleWireProfileActionsKeydown = this.handleWireProfileActionsKeydown.bind(this);
    this.handleRequiredPasswordChangeFormSubmit = this.handleRequiredPasswordChangeFormSubmit.bind(this);
    this.handleStudentFineListClick = this.handleStudentFineListClick.bind(this);
    this.handleStudentProfileContentClick2 = this.handleStudentProfileContentClick2.bind(this);
    this.handleAbsenceSummaryCardClick = this.handleAbsenceSummaryCardClick.bind(this);
    this.handleWireFineActionsKeydown = this.handleWireFineActionsKeydown.bind(this);
    this.handleGeofenceErrorModalClick = this.handleGeofenceErrorModalClick.bind(this);
    this.handleStudentEventHistoryClick = this.handleStudentEventHistoryClick.bind(this);
    this.handleStudentAttendanceListClick = this.handleStudentAttendanceListClick.bind(this);
    this.handleStartCameraButtonClick = this.handleStartCameraButtonClick.bind(this);
    this.handleCaptureFaceButtonClick = this.handleCaptureFaceButtonClick.bind(this);
  }
  dispose() {
    this.clearFaceGuidanceTimers();
    this.communityServiceModalController?.dispose?.();
    this.scope.dispose();
  }
  initialize() {
    if (!this.scope.initialize()) return;
    this.initializeState();
    this.initializePresence();
    this.wireProfileActions();
    this.wireFineActions();
    this.wireAttendanceActions();
    this.wireFaceRegistrationActions();
    this.applyProfile(currentUserProfile);
    this.startSubscriptions();
  }
  initializeState() {
    const dashboard = this;
    dashboard.subscriptions = new ScopedSubscriptions({
      onError: (error, key) => {
        console.error(key, error);
        showDashboardToast('Data sync unavailable', 'Check your connection and reload to retry.');
      }
    });
    dashboard.scope.listen(dashboard.window, 'presence:viewchange', dashboard.changeSubscriptions);
    dashboard.scope.addCleanup(() => {
      dashboard.subscriptions.stop();
      dashboard.window.removeEventListener('presence:viewchange', dashboard.changeSubscriptions);
    });
    dashboard.events = [];
    dashboard.attendance = [];
    dashboard.attendanceConfirmed = false;
    dashboard.fines = [];
    dashboard.dismissedIds = new Set();
    dashboard.studentProfile = undefined;
    dashboard.summaryService = new AttendanceSummaryService({
      closeDate: eventCloseDate,
      checkoutCloseDate: eventCheckoutCloseDate
    });
    dashboard.schedulePresenter = new EventSchedulePresenter({
      formatTime: formatEventTime,
      escapeHtml,
      addMinutes: timePlusMinutes
    });
    dashboard.attendanceList = new StudentAttendanceListController({
      summary: dashboard.summaryService,
      getEvents: () => dashboard.events,
      render: dashboard.renderMyAttendances,
      notify: showDashboardToast
    });
    dashboard.attendanceList.initialize();
    dashboard.pendingProfilePhoto = "";
    dashboard.presenceWriteErrorShown = false;
    dashboard.eventRenderFrame = undefined;
    dashboard.eventStatusTimer = undefined;
    dashboard.scope.addCleanup(() => {
      dashboard.attendanceRealtimeBridge.close();
      dashboard.window.clearTimeout(dashboard.eventStatusTimer);
      dashboard.window.cancelAnimationFrame(dashboard.eventRenderFrame);
      dashboard.window.clearInterval(sessionState.presenceHeartbeatTimer);
      sessionState.mediaStream?.getTracks().forEach(track => track.stop());
    });
  }
  initializePresence() {
    const dashboard = this;
    sessionState.studentLoggedOut = false;
    dashboard.studentProfileModal = dashboard.document.querySelector("#studentProfileModal");
    dashboard.requiredPasswordChangeModal = dashboard.document.querySelector("#requiredPasswordChangeModal");
    dashboard.requiredPasswordChangeForm = dashboard.document.querySelector("#requiredPasswordChangeForm");
    dashboard.completeRequiredPasswordChange = dashboard.document.querySelector("#completeRequiredPasswordChange");
    dashboard.attendanceCheckInController = new AttendanceCheckInController({
      policy: new AttendancePolicy({
        eventOpenDate,
        eventCloseDate,
        eventCheckInCloseDate
      }),
      lateModal: new LateCheckInModal(dashboard.document.querySelector("#lateCheckInModal"))
    });
    dashboard.attendanceRealtimeBridge = new AttendanceRealtimeBridge();
    dashboard.storedPresenceSession = "";
    try {
      dashboard.storedPresenceSession = dashboard.sessionStorage.getItem("presenceDeviceSession") || "";
    } catch {}
    sessionState.presenceSessionId = dashboard.storedPresenceSession || `${currentUser.uid}_${createDeviceSessionToken()}`;
    try {
      dashboard.sessionStorage.setItem("presenceDeviceSession", sessionState.presenceSessionId);
    } catch {}
    dashboard.updatePresence("online");
    sessionState.presenceHeartbeatTimer = dashboard.window.setInterval(() => dashboard.updatePresence("online"), 60000);
    dashboard.scope.listen(dashboard.window, "focus", dashboard.handleInitializePresenceFocus);
    dashboard.scope.listen(dashboard.window, "pagehide", dashboard.handleInitializePresencePagehide);
  }
  wireProfileActions() {
    const dashboard = this;
    dashboard.scope.listen(dashboard.document.querySelector("#studentProfileContent"), "click", dashboard.handleStudentProfileContentClick);
    dashboard.scope.listen(dashboard.document.querySelector("#studentProfileForm"), "submit", dashboard.handleStudentProfileFormSubmit);
    dashboard.scope.listen(dashboard.document.querySelector("#profilePhoto"), "change", dashboard.handleProfilePhotoChange);
    dashboard.scope.listen(dashboard.document.querySelector("#removeProfilePhoto"), "click", dashboard.handleRemoveProfilePhotoClick);
    dashboard.scope.listen(dashboard.document.querySelector("#profileFirstName"), "input", dashboard.handleProfileFirstNameInput);
    dashboard.scope.listen(dashboard.document.querySelector("#profileLastName"), "input", dashboard.handleProfileLastNameInput);
    dashboard.document.querySelectorAll("[data-close-student-profile]").forEach(button => dashboard.scope.listen(button, "click", dashboard.closeStudentProfileModal));
    dashboard.scope.listen(dashboard.studentProfileModal, "click", dashboard.handleStudentProfileModalClick);
    dashboard.scope.listen(dashboard.document, "keydown", dashboard.handleWireProfileActionsKeydown);
    dashboard.scope.listen(dashboard.requiredPasswordChangeForm, "submit", dashboard.handleRequiredPasswordChangeFormSubmit);
  }
  wireFineActions() {
    const dashboard = this;
    dashboard.communityServiceModal = dashboard.document.querySelector("#studentCommunityServiceModal");
    dashboard.communityServiceModalContent = dashboard.document.querySelector("#studentCommunityServiceModalContent");
    dashboard.communityServiceModalController = new FineModalController({
      modal: dashboard.communityServiceModal,
      content: dashboard.communityServiceModalContent,
      title: dashboard.document.querySelector("#studentCommunityServiceModalTitle"),
      description: dashboard.document.querySelector("#studentCommunityServiceModalDescription"),
      closeSelector: "[data-close-community-service]",
      document: dashboard.document
    });
    dashboard.scope.listen(dashboard.document.querySelector("#studentFineList"), "click", dashboard.handleStudentFineListClick);
    dashboard.scope.listen(dashboard.document.querySelector("#studentProfileContent"), "click", dashboard.handleStudentProfileContentClick2);
    dashboard.scope.listen(dashboard.document.querySelector("#absenceSummaryCard"), "click", dashboard.handleAbsenceSummaryCardClick);
    dashboard.scope.listen(dashboard.document, "keydown", dashboard.handleWireFineActionsKeydown);
  }
  wireAttendanceActions() {
    const dashboard = this;
    dashboard.scope.mount(dashboard.document.body, "beforeend", `<div class="dashboard-modal-backdrop" id="geofenceErrorModal" hidden><section class="dashboard-modal" role="alertdialog" aria-modal="true" aria-labelledby="geofenceErrorTitle" aria-describedby="geofenceErrorMessage"><button class="modal-close" type="button" data-close-geofence-error aria-label="Close">×</button><span class="modal-icon danger">!</span><h2 id="geofenceErrorTitle">Attendance unavailable</h2><p id="geofenceErrorMessage"></p><div class="modal-actions"><button class="primary-button" type="button" data-close-geofence-error>Okay</button></div></section></div>`);
    dashboard.geofenceErrorModal = dashboard.document.querySelector("#geofenceErrorModal");
    dashboard.document.querySelectorAll("[data-close-geofence-error]").forEach(element => dashboard.scope.listen(element, "click", dashboard.closeGeofenceError));
    dashboard.scope.listen(dashboard.geofenceErrorModal, "click", dashboard.handleGeofenceErrorModalClick);
    dashboard.attendanceController = new StudentAttendanceController({
      getState: () => ({
        events: dashboard.events,
        attendance: dashboard.attendance
      }),
      setFaceRegistration: registered => {
        dashboard.faceAlreadyRegistered = registered;
      },
      showError: dashboard.showGeofenceError,
      bridge: dashboard.attendanceRealtimeBridge,
      checkIn: dashboard.attendanceCheckInController
    });
    dashboard.scope.addCleanup(() => {
      dashboard.attendanceList.dispose();
      dashboard.attendanceController.dispose();
    });
    dashboard.scope.listen(dashboard.document.querySelector("#studentEventHistory"), "click", dashboard.handleStudentEventHistoryClick);
    dashboard.scope.listen(dashboard.document.querySelector("#studentAttendanceList"), "click", dashboard.handleStudentAttendanceListClick);
  }
  wireFaceRegistrationActions() {
    const dashboard = this;
    dashboard.startCameraButton = dashboard.document.querySelector("#startCamera");
    dashboard.captureFaceButton = dashboard.document.querySelector("#captureFace");
    dashboard.retakeFaceButton = dashboard.document.querySelector("#retakeFace");
    dashboard.cameraPreview = dashboard.document.querySelector("#cameraPreview");
    dashboard.faceCapturePreview = dashboard.document.querySelector("#faceCapturePreview");
    dashboard.cameraPlaceholder = dashboard.document.querySelector("#cameraPlaceholder");
    dashboard.faceCameraBox = dashboard.document.querySelector("#faceCameraBox");
    dashboard.faceRegistrationGuide = dashboard.document.querySelector("#faceRegistrationGuide");
    dashboard.faceGuidancePanel = dashboard.document.querySelector("#faceGuidancePanel");
    dashboard.faceGuidanceStep = dashboard.document.querySelector("#faceGuidanceStep");
    dashboard.faceGuidanceTitle = dashboard.document.querySelector("#faceGuidanceTitle");
    dashboard.faceGuidanceMessage = dashboard.document.querySelector("#faceGuidanceMessage");
    dashboard.faceConsentLabel = dashboard.document.querySelector("#faceConsentLabel");
    dashboard.faceRegistrationConsent = dashboard.document.querySelector("#faceRegistrationConsent");
    dashboard.faceGuidanceTimers = [];
    dashboard.facePhotoCaptured = false;
    dashboard.faceAlreadyRegistered = false;
    dashboard.scope.listen(dashboard.startCameraButton, "click", dashboard.handleStartCameraButtonClick);
    dashboard.scope.listen(dashboard.faceRegistrationConsent, "change", dashboard.updateFaceCaptureAvailability);
    dashboard.scope.listen(dashboard.retakeFaceButton, "click", dashboard.retakeFacePhoto);
    dashboard.scope.listen(dashboard.captureFaceButton, "click", dashboard.handleCaptureFaceButtonClick);
  }
  startSubscriptions() {
    const dashboard = this;
    dashboard.listen('profile', ["*"], doc(db, "students", currentUser.uid), async snapshot => {
      if (!snapshot.exists()) {
        dashboard.sessionStorage.removeItem("presenceSession");
        await signOut(auth);
        dashboard.window.location.replace("../index.html");
        return;
      }
      dashboard.applyProfile(snapshot.data());
    });
    dashboard.listen('events', ["*"], query(collection(db, "events"), orderBy("openAt", "asc")), snapshot => {
      dashboard.events = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));
      dashboard.scheduleEventRender();
      dashboard.renderMyAttendances();
      dashboard.scheduleEventStatusRefresh();
    });
    dashboard.listen('attendance', ["*"], query(collection(db, "attendance"), where("studentUid", "==", currentUser.uid)), snapshot => {
      dashboard.attendanceConfirmed = !snapshot.metadata?.fromCache;
      dashboard.attendance = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));
      dashboard.scheduleEventRender();
      dashboard.renderMyAttendances();
    });
    dashboard.listen('dismissed-history', ["history"], query(collection(db, "dismissedHistory"), where("studentUid", "==", currentUser.uid)), snapshot => {
      dashboard.dismissedIds = new Set(snapshot.docs.map(item => item.data().eventId));
      dashboard.scheduleEventRender();
    });
    dashboard.listen('fines', ["*"], query(collection(db, "fines"), where("studentUid", "==", currentUser.uid)), snapshot => {
      dashboard.fines = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));
      dashboard.renderFines();
      dashboard.renderProfile();
    });
    dashboard.listen('face', ["face", "profile", "events"], doc(db, "faceRegistrations", currentUser.uid), snapshot => {
      if (snapshot.data()?.registered) {
        dashboard.document.querySelector("#faceStatus").textContent = "Registered";
        dashboard.document.querySelector("#faceStatus").className = "badge green";
        dashboard.lockFaceRegistration();
      } else {
        dashboard.unlockFaceRegistration();
      }
    });
  }
  applyProfile(profile) {
    if (!this.scope.initialized || !profile || !Object.keys(profile).length) return;
    this.studentProfile = { ...profile };
    this.renderProfile();
    this.scheduleEventRender();
    if (this.studentProfile.mustChangePassword === true) this.openRequiredPasswordChangeModal();
    else this.closeRequiredPasswordChangeModal();
  }
  listen(key, views, reference, callback) {
    const dashboard = this;
    return dashboard.subscriptions.register(key, views, (guard, onError) => onSnapshot(reference, {
      includeMetadataChanges: true
    }, guard(callback), onError));
  }
  changeSubscriptions(event) {
    const dashboard = this;
    return dashboard.subscriptions.setView(event.detail.viewName);
  }
  async updatePresence(status = "online", silent = false) {
    const dashboard = this;
    const online = status === "online";
    const statusPayload = {
      online,
      status,
      lastSeen: serverTimestamp(),
      offlineAt: online ? deleteField() : serverTimestamp()
    };
    try {
      await setDoc(doc(db, "presenceSessions", sessionState.presenceSessionId), {
        studentUid: currentUser.uid,
        sessionId: sessionState.presenceSessionId,
        ...statusPayload
      }, {
        merge: true
      });
    } catch (error) {
      console.error("PRESENCE UPDATE FAILED:", error);
      try {
        await setDoc(doc(db, "presence", currentUser.uid), statusPayload, {
          merge: true
        });
      } catch (fallbackError) {
        console.error("PRESENCE FALLBACK FAILED:", fallbackError);
        if (!silent && !dashboard.presenceWriteErrorShown) {
          dashboard.presenceWriteErrorShown = true;
          showDashboardToast("Live status unavailable", fallbackError.code === "permission-denied" ? "Publish the latest database rules, then reload this device." : "This device could not sync its online status.");
        }
      }
    }
  }
  updatePhotoPreview(photoDataUrl = "") {
    const dashboard = this;
    const image = dashboard.document.querySelector("#profilePhotoPreviewImage");
    const initials = dashboard.document.querySelector("#profilePhotoPreviewInitials");
    if (photoDataUrl) {
      image.src = photoDataUrl;
      image.hidden = false;
      initials.hidden = true;
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      initials.hidden = false;
      initials.textContent = getInitials(dashboard.document.querySelector("#profileFirstName").value, dashboard.document.querySelector("#profileLastName").value);
    }
  }
  async prepareProfilePhoto(file) {
    const dashboard = this;
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
    const canvas = dashboard.document.createElement("canvas");
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
  closeStudentProfileModal() {
    const dashboard = this;
    dashboard.studentProfileModal.hidden = true;
  }
  openRequiredPasswordChangeModal() {
    const dashboard = this;
    if (!dashboard.requiredPasswordChangeModal.hidden) return;
    dashboard.requiredPasswordChangeForm.reset();
    dashboard.requiredPasswordChangeModal.hidden = false;
    dashboard.document.querySelector("#requiredNewPassword").focus();
  }
  closeRequiredPasswordChangeModal() {
    const dashboard = this;
    dashboard.requiredPasswordChangeModal.hidden = true;
    dashboard.requiredPasswordChangeForm.reset();
  }
  renderEvents() {
    const dashboard = this;
    const attendanceByEventId = new Map(dashboard.attendance.map(record => [record.eventId, record]));
    const activeEvents = dashboard.events.filter(event => !isEventFinished(event) && (attendanceByEventId.has(event.id) || dashboard.summaryService.eligibility({
      ...dashboard.studentProfile,
      uid: currentUser.uid
    }, event) !== 'excluded'));
    const eventGrid = dashboard.document.querySelector("#studentEventGrid");
    const timeline = dashboard.document.querySelector("#studentEventTimeline");
    if (!activeEvents.length) {
      eventGrid.innerHTML = '<div class="empty-state panel event-empty">No open or upcoming events.</div>';
      timeline.innerHTML = '<div class="empty-state">No open or upcoming events.</div>';
    } else {
      eventGrid.innerHTML = activeEvents.map(event => {
        const status = getEventStatus(event);
        const checkInResult = dashboard.attendanceCheckInController.policy.evaluateCheckIn(event);
        const attendanceRecord = attendanceByEventId.get(event.id);
        const attended = Boolean(attendanceRecord);
        const completed = attendanceRecord?.status === "completed" || Boolean(attendanceRecord?.checkedOutAt);
        const checkoutOpen = attended && !completed && isCheckoutAvailable(event);
        const missedCheckIn = !attended && isCheckoutAvailable(event);
        const disabled = completed || (attended ? !checkoutOpen : !checkInResult.available);
        const buttonText = completed ? "✓ Attendance completed" : attended ? checkoutOpen ? "Check out" : "✓ Checked in" : missedCheckIn ? "Check-out unavailable" : checkInResult.available ? checkInResult.arrivalStatus === "late" ? "Check in late" : "Check in" : status === "closed" ? "Check-in unavailable" : "Not open yet";
        const attendanceBadge = completed ? '<span class="badge green">Completed</span>' : attended ? `<span class="badge green">${checkoutOpen ? "Checkout available" : "Checked in"}</span>` : missedCheckIn ? '<span class="badge orange">Check-in missed</span>' : checkInResult.available && checkInResult.arrivalStatus === "late" ? '<span class="badge orange">Late check-in</span>' : eventStatusBadge(status);
        const description = event.description || event.notes || `Attendance event for ${event.audience}.`;
        const missedCheckInMessage = missedCheckIn ? `<p class="event-card-notice">You cannot check out because no check-in was recorded before Time Out (${escapeHtml(formatEventTime(event.timeOut))}).</p>` : "";
        const action = checkoutOpen ? `data-check-out-event="${escapeHtml(event.id)}"` : `data-attend-event="${escapeHtml(event.id)}"`;
        const buttonClass = checkoutOpen || !attended && checkInResult.available ? "primary-button" : "outline-button";
        return `<article class="event-card"><div class="event-accent"></div><div class="event-body"><div class="event-card-kicker"><span class="event-type-badge">${escapeHtml(event.type || "School Event")}</span><span class="event-date">${escapeHtml(formatEventDate(event.date))}</span></div><h3>${escapeHtml(event.name)}</h3><div class="event-description"><strong>Description</strong>${escapeHtml(description)}</div>${dashboard.schedulePresenter.render(event)}${missedCheckInMessage}${event.hasSurvey && !event.surveyArchived ? `<div class="survey-student-tools"><button class="outline-button" type="button" data-survey-event="${escapeHtml(event.id)}">Open / resume survey</button></div>` : ""}<div class="event-card-actions">${attendanceBadge}<button class="${buttonClass} attendance-action-button" type="button" ${action} ${disabled ? "disabled" : ""}>${buttonText}</button></div></div></article>`;
      }).join("");
      timeline.innerHTML = `<div class="timeline">${activeEvents.slice(0, 4).map(event => `<div class="timeline-item"><span class="timeline-time">${escapeHtml(formatEventTime(event.timeIn))}</span><div class="timeline-main"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(formatEventDate(event.date))} · ${escapeHtml(formatTimeWindow(event))}</small></div>${attendanceByEventId.has(event.id) ? '<span class="badge green">Attended</span>' : eventStatusBadge(getEventStatus(event))}</div>`).join("")}</div>`;
    }
    dashboard.attendanceController.syncLoadingButtons();
    dashboard.renderAttendanceSummary();
  }
  scheduleEventRender() {
    const dashboard = this;
    if (dashboard.eventRenderFrame) return;
    dashboard.eventRenderFrame = dashboard.window.requestAnimationFrame(() => {
      dashboard.eventRenderFrame = undefined;
      dashboard.renderEvents();
    });
  }
  scheduleEventStatusRefresh() {
    const dashboard = this;
    dashboard.window.clearTimeout(dashboard.eventStatusTimer);
    const now = Date.now();
    const nextStatusChange = Math.min(...dashboard.events.flatMap(event => [eventOpenDate(event).getTime(), eventCheckInCloseDate(event).getTime(), eventCloseDate(event).getTime(), eventCheckoutCloseDate(event).getTime()]).filter(time => time > now));
    if (!Number.isFinite(nextStatusChange)) return;
    dashboard.eventStatusTimer = dashboard.window.setTimeout(() => {
      dashboard.renderEvents();
      dashboard.renderMyAttendances();
      dashboard.scheduleEventStatusRefresh();
    }, Math.max(0, nextStatusChange - now) + 50);
  }
  renderAttendanceSummary() {
    const dashboard = this;
    const result = dashboard.summaryService.summarize({
      ...dashboard.studentProfile,
      uid: currentUser.uid
    }, dashboard.events, dashboard.attendance, {
      coverageConfirmed: dashboard.attendanceConfirmed
    });
    const {
      attendedIds,
      absences,
      presentDays
    } = result;
    const closedEvents = dashboard.events.filter(event => isEventFinished(event) && (attendedIds.has(event.id) || dashboard.summaryService.eligibility({
      ...dashboard.studentProfile,
      uid: currentUser.uid
    }, event) !== 'excluded'));
    dashboard.document.querySelector("#eventsAttendedCount").textContent = dashboard.attendance.length;
    dashboard.document.querySelector("#absenceCount").textContent = absences.length;
    dashboard.document.querySelector("#daysPresentCount").textContent = presentDays;
    dashboard.document.querySelector("#eventsAttendedMeta").textContent = dashboard.attendance.length ? `${dashboard.attendance.length} attendance record${dashboard.attendance.length === 1 ? "" : "s"}` : "No attendance recorded yet";
    dashboard.document.querySelector("#absenceMeta").textContent = `${absences.length} confirmed absences · ${result.unverified.length} historical events unverified · ${result.review.length} checkouts need review`;
    dashboard.document.querySelector("#absenceSummaryCard").setAttribute("aria-label", absences.length ? `View details for ${absences.length} absence${absences.length === 1 ? "" : "s"}` : "View absence details");
    dashboard.document.querySelector("#daysPresentMeta").textContent = presentDays ? `${presentDays} unique event day${presentDays === 1 ? "" : "s"}` : "Based on attended events";
    const records = closedEvents.filter(event => !dashboard.dismissedIds.has(event.id)).map(event => ({
      event,
      status: attendedIds.has(event.id) ? result.review.some(record => record.eventId === event.id) ? 'Needs review' : 'Attended' : absences.some(item => item.id === event.id) ? 'Absent' : 'Eligibility unverified'
    }));
    const history = dashboard.document.querySelector("#studentEventHistory");
    if (!records.length) {
      history.innerHTML = '<div class="empty-state">No finished event history yet.</div>';
      return;
    }
    history.innerHTML = records.reverse().map(({
      event,
      status
    }) => {
      const description = event.description || event.notes || "No description provided.";
      return `<article class="history-event-card"><div class="history-card-top"><span class="event-type-badge">${escapeHtml(event.type || "School Event")}</span><span class="badge ${status === "Attended" ? "green" : "orange"}">${status}</span></div><h3>${escapeHtml(event.name)}</h3><p>${escapeHtml(description)}</p><div class="event-detail-boxes"><div><span>Date</span><strong>${escapeHtml(formatEventDate(event.date))}</strong></div><div><span>Time</span><strong>${escapeHtml(formatTimeWindow(event))}</strong></div><div><span>Location</span><strong>${escapeHtml(event.location)}</strong></div><div><span>Audience</span><strong>${escapeHtml(event.audience || "All students")}</strong></div></div><div class="history-card-actions"><button class="small-button danger" type="button" data-dismiss-history="${escapeHtml(event.id)}">Remove from history</button></div></article>`;
    }).join("");
  }
  renderMyAttendances() {
    const dashboard = this;
    const container = dashboard.document.querySelector("#studentAttendanceList");
    const records = dashboard.attendanceList.select(dashboard.attendance.slice().sort((first, second) => {
      const firstTime = first.checkedInAt?.seconds || first.attendedAt?.seconds || 0;
      const secondTime = second.checkedInAt?.seconds || second.attendedAt?.seconds || 0;
      return secondTime - firstTime;
    }));
    if (!records.length) {
      container.innerHTML = AttendanceToolbarController.emptyState({
        filtered: dashboard.attendance.length > 0
      });
      return;
    }
    container.innerHTML = records.map(record => {
      const event = dashboard.events.find(item => item.id === record.eventId) || record;
      const checkedInAt = record.checkedInAt || record.attendedAt;
      const completed = Boolean(record.checkedOutAt);
      const readyToCheckOut = !completed && record.status === "checked-in" && isCheckoutAvailable(event);
      const hasVerifiedCheckIn = Boolean(checkedInAt);
      const status = completed ? "Completed" : !hasVerifiedCheckIn ? "Check-in incomplete" : dashboard.summaryService.needsReview(record, event) ? 'Needs review — missed checkout' : readyToCheckOut ? "Ready to check out" : "Checked in";
      const color = completed ? "green" : readyToCheckOut || status.startsWith('Needs review') ? "orange" : status === "Checked in" ? "blue" : "gray";
      const checkInWindow = event.timeIn ? `${formatEventTime(event.timeIn)} – ${formatEventTime(event.checkInCutoff || event.timeOut)}` : "Not recorded";
      const checkOutWindow = event.timeOut ? `${formatEventTime(event.timeOut)} – ${formatEventTime(event.checkOutCutoff || timePlusMinutes(event.timeOut))}` : "Not recorded";
      return `<article class="history-event-card attendance-record-card"><div class="history-card-top"><span class="event-type-badge">${escapeHtml(record.eventType || "School Event")}</span><div class="attendance-record-badges"><span class="badge ${color}">${escapeHtml(status)}</span>${arrivalStatusBadge(record.arrivalStatus)}${record.recordSource === "admin-corrected" ? `<span class="badge orange" title="${escapeHtml(`${record.correctedBy || "Administrator"} · ${formatAttendanceTimestamp(record.correctedAt)} · ${record.correctionReason || ""}`)}">Manual correction</span>` : ""}</div></div><h3>${escapeHtml(record.eventName || "Attendance event")}</h3><p>${escapeHtml(record.location || "Location not recorded")}</p><div class="event-detail-boxes"><div><span>Checked in</span><strong>${escapeHtml(formatAttendanceTimestamp(checkedInAt))}</strong></div><div><span>Checked out</span><strong>${escapeHtml(formatAttendanceTimestamp(record.checkedOutAt))}</strong></div><div><span>Arrival</span><strong>${escapeHtml(record.arrivalStatus === "late" ? "Late" : "Present")}</strong></div><div><span>Check-in window</span><strong>${escapeHtml(checkInWindow)}</strong></div><div><span>Checkout window</span><strong>${escapeHtml(checkOutWindow)}</strong></div><div><span>Duration</span><strong>${escapeHtml(attendanceDuration(checkedInAt, record.checkedOutAt))}</strong></div></div>${readyToCheckOut ? `<div class="history-card-actions"><button class="primary-button attendance-action-button" type="button" data-check-out-attendance="${escapeHtml(record.id)}">Check out</button></div>` : ""}</article>`;
    }).join("");
    dashboard.attendanceController.syncLoadingButtons();
  }
  renderFines() {
    const dashboard = this;
    const container = dashboard.document.querySelector("#studentFineList");
    const fineWarning = dashboard.document.querySelector("#studentFineWarning");
    const hasPendingFine = dashboard.fines.some(fine => fine.status !== "Completed");
    fineWarning.hidden = !hasPendingFine;
    fineWarning.closest(".nav-button").classList.toggle("has-pending-fines", hasPendingFine);
    if (!dashboard.fines.length) {
      container.innerHTML = '<div class="empty-state panel">You have no assigned fines.</div>';
      return;
    }
    const groupedFines = Array.from(dashboard.fines.reduce((groups, fine) => {
      const reasonKey = String(fine.eventName || "Attendance absence").trim().toLowerCase();
      const group = groups.get(reasonKey) || [];
      group.push(fine);
      groups.set(reasonKey, group);
      return groups;
    }, new Map()).values());
    container.innerHTML = groupedFines.map(group => {
      const firstFine = group[0];
      const totalMinutes = group.reduce((total, fine) => total + (Number(fine.serviceMinutes) || 0), 0);
      const status = group.every(fine => fine.status === "Completed") ? "Completed" : "Pending";
      const latestAssigned = group.reduce((latest, fine) => {
        const latestTime = latest?.assignedAt?.toDate?.()?.getTime?.() || 0;
        const fineTime = fine.assignedAt?.toDate?.()?.getTime?.() || 0;
        return fineTime > latestTime ? fine : latest;
      }, firstFine);
      const serviceLabel = status === "Completed" ? "Completed" : `${formatServiceMinutes(totalMinutes)} remaining`;
      const fineIds = group.map(fine => fine.id).join(",");
      const needsReview = status !== "Completed";
      const warningBadge = needsReview ? '<span class="community-service-warning" role="status"><span aria-hidden="true">!!</span> Needs review</span>' : "";
      return `<button class="history-event-card community-service-card${needsReview ? " needs-settlement" : ""}" type="button" data-open-community-service="${escapeHtml(fineIds)}" aria-label="View attendance-fine details for ${escapeHtml(firstFine.eventName || "attendance absence")}${needsReview ? ", needs review" : ""}"><div class="history-card-top"><span class="event-type-badge">Attendance fine</span><span class="community-service-card-statuses">${warningBadge}<span class="badge orange">${escapeHtml(serviceLabel)}</span></span></div><h3>${escapeHtml(firstFine.eventName || "Attendance absence")}</h3><p>${group.length === 1 ? escapeHtml(firstFine.reason || "No reason provided.") : `${group.length} attendance records combined`}</p><div class="event-detail-boxes"><div><span>Status</span><strong>${escapeHtml(status)}</strong></div><div><span>Assigned</span><strong>${escapeHtml(formatFineDate(latestAssigned.assignedAt))}</strong></div></div><span class="community-service-card-action">View attendance-fine record <span aria-hidden="true">→</span></span></button>`;
    }).join("");
  }
  renderProfile() {
    const dashboard = this;
    const container = dashboard.document.querySelector("#studentProfileContent");
    const badge = dashboard.document.querySelector("#profileStatusBadge");
    if (!dashboard.studentProfile) return;
    const fullName = [dashboard.studentProfile.firstName, dashboard.studentProfile.middleName, dashboard.studentProfile.lastName].filter(Boolean).join(" ");
    const initials = getInitials(dashboard.studentProfile.firstName, dashboard.studentProfile.lastName);
    badge.textContent = "Profile active";
    badge.className = "badge green";
    dashboard.document.querySelectorAll("[data-student-name]").forEach(element => {
      element.textContent = fullName;
    });
    dashboard.document.querySelectorAll("[data-student-meta]").forEach(element => {
      element.textContent = `${dashboard.studentProfile.course || "Course pending"} · Section ${dashboard.studentProfile.section}`;
    });
    dashboard.document.querySelectorAll("[data-student-initials]").forEach(element => {
      element.textContent = initials;
      element.hidden = Boolean(dashboard.studentProfile.photoDataUrl);
    });
    dashboard.document.querySelectorAll("[data-student-photo]").forEach(element => {
      if (dashboard.studentProfile.photoDataUrl) element.src = dashboard.studentProfile.photoDataUrl;else element.removeAttribute("src");
      element.hidden = !dashboard.studentProfile.photoDataUrl;
    });
    dashboard.document.querySelectorAll("[data-student-first-name]").forEach(element => {
      element.textContent = dashboard.studentProfile.firstName;
    });
    updateDashboardGreeting(dashboard.studentProfile.firstName || "Student");
    const profileVisual = dashboard.studentProfile.photoDataUrl ? `<img src="${escapeHtml(dashboard.studentProfile.photoDataUrl)}" alt="${escapeHtml(fullName)} profile photo">` : escapeHtml(initials);
    const fineCount = dashboard.fines.length;
    container.innerHTML = `<div class="profile-grid"><article class="panel student-profile-card"><header class="student-profile-header"><div class="student-profile-identity"><div class="profile-avatar">${profileVisual}</div><div><h3>${escapeHtml(fullName)}</h3><p>Student ID · ${escapeHtml(dashboard.studentProfile.accountId)}</p><span>Course Registered · <strong>${escapeHtml(dashboard.studentProfile.course || "Not assigned")}</strong></span></div></div><button class="primary-button" type="button" id="editStudentProfile">Edit profile</button></header><div class="student-profile-details"><div class="profile-fact"><span>Birthday</span><strong>${escapeHtml(formatBirthday(dashboard.studentProfile.birthday))}</strong></div><div class="profile-fact"><span>Course</span><strong>${escapeHtml(dashboard.studentProfile.course || "Not assigned")}</strong></div><div class="profile-fact"><span>Section</span><strong>${escapeHtml(dashboard.studentProfile.section)}</strong></div><div class="profile-fact"><span>Account</span><strong>Active</strong></div><div class="profile-fact"><span>Student ID</span><strong>${escapeHtml(dashboard.studentProfile.accountId)}</strong></div><div class="profile-fact"><span>Phone</span><strong>${escapeHtml(dashboard.studentProfile.phone || "Not provided")}</strong></div><div class="profile-fact profile-fact-wide"><span>Email</span><strong>${escapeHtml(dashboard.studentProfile.email || "Not provided")}</strong></div></div><footer class="student-profile-actions"><button class="outline-button" type="button" id="checkStudentFines">Check attendance fines${fineCount ? ` (${fineCount})` : ""}</button></footer></article></div>`;
  }
  serviceRecordMarkup(fine) {
    const dashboard = this;
    const serviceStatus = fine.status === "Completed" ? "Completed" : "Pending";
    const history = getFineHistory(fine).slice().reverse().map(entry => {
      const action = entry.action === "Added" ? `Additional service: ${formatServiceMinutes(entry.addedMinutes)}` : entry.action === "Updated" ? "Service requirement updated" : `Assigned: ${formatServiceMinutes(entry.newMinutes || fine.serviceMinutes)}`;
      return `<li><strong>${escapeHtml(action)}</strong><span>${escapeHtml(formatFineTimestamp(entry.recordedAt))}</span>${entry.reason ? `<small>Reason: ${escapeHtml(entry.reason)}</small>` : ""}</li>`;
    }).join("");
    return `<article class="community-service-record"><div class="community-service-record-top"><strong>${escapeHtml(fine.eventName || "Attendance absence")}</strong><span class="badge ${serviceStatus === "Completed" ? "green" : "orange"}">${escapeHtml(serviceStatus)}</span></div><div class="fine-detail-grid"><div><span>Service required</span><strong>${escapeHtml(formatServiceMinutes(fine.serviceMinutes))}</strong></div><div><span>Assigned</span><strong>${escapeHtml(formatFineDate(fine.assignedAt))}</strong></div><div class="fine-detail-full"><span>Reason</span><strong>${escapeHtml(fine.reason || "No reason provided.")}</strong></div></div>${history ? `<h4>Service history</h4><ol class="fine-history-list">${history}</ol>` : ""}</article>`;
  }
  openCommunityServiceModal(fineIds, trigger) {
    const dashboard = this;
    const selectedFines = fineIds.split(",").map(id => dashboard.fines.find(fine => fine.id === id)).filter(Boolean);
    if (!selectedFines.length) return;
    const currentService = selectedFines.filter(fine => fine.status !== "Completed");
    const pastService = selectedFines.filter(fine => fine.status === "Completed");
    dashboard.communityServiceModalController.open({
      title: "Attendance fine details",
      description: "Review the attendance-fine records for this event.",
      markup: `<section class="community-service-section"><div class="community-service-section-heading"><h3>Current records</h3><p>Records that still need attention.</p></div>${currentService.length ? currentService.map(dashboard.serviceRecordMarkup).join("") : '<div class="community-service-empty">No current attendance-fine records for this event.</div>'}</section><section class="community-service-section"><div class="community-service-section-heading"><h3>Reviewed records</h3><p>Completed attendance-fine records and their notes.</p></div>${pastService.length ? pastService.map(dashboard.serviceRecordMarkup).join("") : '<div class="community-service-empty">No reviewed attendance-fine records for this event yet.</div>'}</section>`,
      trigger
    });
  }
  openAllStudentFinesModal(trigger) {
    const dashboard = this;
    const currentRecords = dashboard.fines.filter(fine => fine.status !== "Completed");
    const reviewedRecords = dashboard.fines.filter(fine => fine.status === "Completed");
    dashboard.communityServiceModalController.open({
      title: "Your attendance fines",
      description: "Review all attendance-fine records assigned to your profile.",
      markup: `<section class="community-service-section"><div class="community-service-section-heading"><h3>Current records</h3><p>Attendance-fine records that still need attention.</p></div>${currentRecords.length ? currentRecords.map(dashboard.serviceRecordMarkup).join("") : '<div class="community-service-empty">No current attendance fines recorded.</div>'}</section><section class="community-service-section"><div class="community-service-section-heading"><h3>Reviewed records</h3><p>Attendance-fine records marked as completed.</p></div>${reviewedRecords.length ? reviewedRecords.map(dashboard.serviceRecordMarkup).join("") : '<div class="community-service-empty">No reviewed attendance fines recorded.</div>'}</section>`,
      trigger
    });
  }
  closeCommunityServiceModal() {
    const dashboard = this;
    dashboard.communityServiceModalController.close();
  }
  closeGeofenceError() {
    const dashboard = this;
    dashboard.geofenceErrorModal.hidden = true;
  }
  showGeofenceError(title, message) {
    const dashboard = this;
    dashboard.document.querySelector("#geofenceErrorTitle").textContent = title;
    dashboard.document.querySelector("#geofenceErrorMessage").textContent = message;
    dashboard.geofenceErrorModal.hidden = false;
  }
  lockFaceRegistration() {
    const dashboard = this;
    dashboard.faceAlreadyRegistered = true;
    dashboard.clearFaceGuidanceTimers();
    if (sessionState.mediaStream) sessionState.mediaStream.getTracks().forEach(track => track.stop());
    dashboard.cameraPreview.hidden = true;
    dashboard.faceCapturePreview.hidden = true;
    dashboard.cameraPlaceholder.hidden = false;
    dashboard.faceRegistrationGuide.hidden = true;
    dashboard.faceConsentLabel.hidden = true;
    dashboard.retakeFaceButton.hidden = true;
    dashboard.faceGuidancePanel.hidden = false;
    dashboard.setFaceGuidance("complete", "✓", "Face registration already complete", "To replace your photo, ask your administrator to reset your face registration.");
    dashboard.startCameraButton.disabled = true;
    dashboard.startCameraButton.textContent = "Face registered";
    dashboard.captureFaceButton.disabled = true;
    dashboard.captureFaceButton.textContent = "Face registered";
  }
  unlockFaceRegistration() {
    const dashboard = this;
    dashboard.faceAlreadyRegistered = false;
    dashboard.facePhotoCaptured = false;
    dashboard.clearFaceGuidanceTimers();
    dashboard.cameraPreview.hidden = true;
    dashboard.faceCapturePreview.hidden = true;
    dashboard.cameraPlaceholder.hidden = false;
    dashboard.faceRegistrationGuide.hidden = true;
    dashboard.faceGuidancePanel.hidden = true;
    dashboard.faceConsentLabel.hidden = false;
    dashboard.faceRegistrationConsent.checked = false;
    dashboard.retakeFaceButton.hidden = true;
    dashboard.startCameraButton.disabled = false;
    dashboard.startCameraButton.textContent = "Start camera";
    dashboard.captureFaceButton.disabled = true;
    dashboard.captureFaceButton.textContent = "Capture photo";
    dashboard.faceCameraBox.dataset.guidance = "idle";
  }
  setFaceGuidance(state, step, title, message) {
    const dashboard = this;
    dashboard.faceCameraBox.dataset.guidance = state;
    dashboard.faceGuidanceStep.textContent = step;
    dashboard.faceGuidanceTitle.textContent = title;
    dashboard.faceGuidanceMessage.textContent = message;
  }
  clearFaceGuidanceTimers() {
    const dashboard = this;
    (dashboard.faceGuidanceTimers || []).forEach(timer => dashboard.window.clearTimeout(timer));
    dashboard.faceGuidanceTimers = [];
  }
  updateFaceCaptureAvailability() {
    const dashboard = this;
    const isReady = dashboard.faceCameraBox.dataset.guidance === "ready";
    dashboard.captureFaceButton.disabled = !isReady || !dashboard.faceRegistrationConsent.checked;
  }
  beginFaceGuidance() {
    const dashboard = this;
    dashboard.clearFaceGuidanceTimers();
    dashboard.facePhotoCaptured = false;
    dashboard.faceCapturePreview.hidden = true;
    dashboard.faceRegistrationGuide.hidden = false;
    dashboard.faceGuidancePanel.hidden = false;
    dashboard.faceConsentLabel.hidden = false;
    dashboard.retakeFaceButton.hidden = true;
    dashboard.captureFaceButton.textContent = "Capture photo";
    dashboard.setFaceGuidance("positioning", "1", "Fit your face in the outline", "Center your full face, look directly at the camera, and use even lighting.");
    dashboard.faceGuidanceTimers.push(dashboard.window.setTimeout(() => {
      dashboard.setFaceGuidance("steady", "2", "Hold still…", "Keep your face inside the outline while we prepare your registration photo.");
    }, 1600));
    dashboard.faceGuidanceTimers.push(dashboard.window.setTimeout(() => {
      dashboard.setFaceGuidance("ready", "3", "Steady — ready to capture", "Your face is positioned. Confirm consent, then capture your photo.");
      dashboard.updateFaceCaptureAvailability();
    }, 3600));
  }
  retakeFacePhoto() {
    const dashboard = this;
    dashboard.facePhotoCaptured = false;
    dashboard.faceCapturePreview.hidden = true;
    dashboard.cameraPreview.hidden = false;
    dashboard.faceRegistrationGuide.hidden = false;
    dashboard.retakeFaceButton.hidden = true;
    dashboard.captureFaceButton.textContent = "Capture photo";
    dashboard.setFaceGuidance("ready", "3", "Steady — ready to capture", "Check your position, then capture a new photo.");
    dashboard.updateFaceCaptureAvailability();
  }
  captureFacePhoto() {
    const dashboard = this;
    const canvas = dashboard.document.createElement("canvas");
    const sourceWidth = dashboard.cameraPreview.videoWidth || 640;
    const sourceHeight = dashboard.cameraPreview.videoHeight || 480;
    const scale = Math.min(1, 640 / sourceWidth);
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    canvas.getContext("2d").drawImage(dashboard.cameraPreview, 0, 0, canvas.width, canvas.height);
    dashboard.faceCapturePreview.src = canvas.toDataURL("image/jpeg", .78);
    dashboard.facePhotoCaptured = true;
    dashboard.cameraPreview.hidden = true;
    dashboard.faceCapturePreview.hidden = false;
    dashboard.faceRegistrationGuide.hidden = true;
    dashboard.retakeFaceButton.hidden = false;
    dashboard.captureFaceButton.textContent = "Register face";
    dashboard.captureFaceButton.disabled = false;
    dashboard.setFaceGuidance("review", "4", "Review your photo", "If your face is clear and centered, register it. Otherwise, choose Retake.");
  }
  handleInitializePresenceFocus() {
    const dashboard = this;
    return dashboard.updatePresence("online");
  }
  handleInitializePresencePagehide() {
    const dashboard = this;
    if (!sessionState.studentLoggedOut) dashboard.updatePresence("offline", true);
  }
  handleStudentProfileContentClick(event) {
    const dashboard = this;
    if (!event.target.closest("#editStudentProfile") || !dashboard.studentProfile) return;
    dashboard.document.querySelector("#profileAccountId").value = dashboard.studentProfile.accountId || "";
    dashboard.document.querySelector("#profileFirstName").value = dashboard.studentProfile.firstName || "";
    dashboard.document.querySelector("#profileMiddleName").value = dashboard.studentProfile.middleName || "";
    dashboard.document.querySelector("#profileLastName").value = dashboard.studentProfile.lastName || "";
    dashboard.document.querySelector("#profileBirthday").value = dashboard.studentProfile.birthday || "";
    dashboard.document.querySelector("#profileCourse").value = dashboard.studentProfile.course || "BSInfo Tech";
    dashboard.document.querySelector("#profileSection").value = dashboard.studentProfile.section || "1A";
    dashboard.document.querySelector("#profileEmail").value = dashboard.studentProfile.email || "";
    dashboard.document.querySelector("#profilePhone").value = dashboard.studentProfile.phone || "";
    dashboard.document.querySelector("#profilePhoto").value = "";
    dashboard.pendingProfilePhoto = dashboard.studentProfile.photoDataUrl || "";
    dashboard.updatePhotoPreview(dashboard.pendingProfilePhoto);
    dashboard.studentProfileModal.hidden = false;
    dashboard.document.querySelector("#profileFirstName").focus();
  }
  async handleStudentProfileFormSubmit(event) {
    const dashboard = this;
    event.preventDefault();
    const newAccountId = dashboard.document.querySelector("#profileAccountId").value.trim();
    if (!/^[A-Za-z0-9._-]+$/.test(newAccountId)) {
      showDashboardToast("Invalid Student ID", "Use only letters, numbers, periods, underscores, or dashes.");
      return;
    }
    const newKey = newAccountId.toLowerCase();
    const oldAccountId = dashboard.studentProfile.accountId;
    const oldKey = (dashboard.studentProfile.accountIdKey || oldAccountId || "").toLowerCase();
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
        firstName: dashboard.document.querySelector("#profileFirstName").value.trim(),
        middleName: dashboard.document.querySelector("#profileMiddleName").value.trim(),
        lastName: dashboard.document.querySelector("#profileLastName").value.trim(),
        birthday: dashboard.document.querySelector("#profileBirthday").value,
        course: dashboard.document.querySelector("#profileCourse").value,
        section: dashboard.document.querySelector("#profileSection").value,
        email: dashboard.document.querySelector("#profileEmail").value.trim(),
        phone: dashboard.document.querySelector("#profilePhone").value.trim(),
        photoDataUrl: dashboard.pendingProfilePhoto,
        updatedAt: serverTimestamp()
      };
      if (oldKey !== newKey) {
        const batch = writeBatch(db);
        batch.set(doc(db, "students", currentUser.uid), updateData, {
          merge: true
        });
        if (oldKey) batch.delete(doc(db, "studentIds", oldKey));
        batch.set(doc(db, "studentIds", newKey), {
          studentId: newAccountId,
          uid: currentUser.uid,
          createdAt: serverTimestamp()
        });
        await batch.commit();
      } else {
        await setDoc(doc(db, "students", currentUser.uid), updateData, {
          merge: true
        });
      }
      dashboard.closeStudentProfileModal();
      showDashboardToast("Profile updated", "Your changes are now live.");
    } catch (error) {
      showDashboardToast("Unable to update profile", error.code === "permission-denied" ? "Publish the latest database rules first." : error.message);
    }
  }
  async handleProfilePhotoChange(event) {
    const dashboard = this;
    const [file] = event.target.files;
    if (!file) return;
    try {
      dashboard.pendingProfilePhoto = await dashboard.prepareProfilePhoto(file);
      dashboard.updatePhotoPreview(dashboard.pendingProfilePhoto);
    } catch (error) {
      event.target.value = "";
      showDashboardToast("Unable to use photo", error.message);
    }
  }
  handleRemoveProfilePhotoClick() {
    const dashboard = this;
    dashboard.pendingProfilePhoto = "";
    dashboard.document.querySelector("#profilePhoto").value = "";
    dashboard.updatePhotoPreview();
  }
  handleProfileFirstNameInput() {
    const dashboard = this;
    if (!dashboard.pendingProfilePhoto) dashboard.updatePhotoPreview();
  }
  handleProfileLastNameInput() {
    const dashboard = this;
    if (!dashboard.pendingProfilePhoto) dashboard.updatePhotoPreview();
  }
  handleStudentProfileModalClick(event) {
    const dashboard = this;
    if (event.target === dashboard.studentProfileModal) dashboard.closeStudentProfileModal();
  }
  handleWireProfileActionsKeydown(event) {
    const dashboard = this;
    if (event.key === "Escape" && !dashboard.studentProfileModal.hidden) dashboard.closeStudentProfileModal();
  }
  async handleRequiredPasswordChangeFormSubmit(event) {
    const dashboard = this;
    event.preventDefault();
    const newPassword = dashboard.document.querySelector("#requiredNewPassword").value;
    const confirmPassword = dashboard.document.querySelector("#requiredConfirmPassword").value;
    if (!/^\d{6,8}$/.test(newPassword)) {
      showDashboardToast("Invalid password", "Use a new password containing 6 to 8 digits.");
      dashboard.document.querySelector("#requiredNewPassword").focus();
      return;
    }
    if (newPassword !== confirmPassword) {
      showDashboardToast("Passwords do not match", "Enter the same new password in both fields.");
      dashboard.document.querySelector("#requiredConfirmPassword").focus();
      return;
    }
    dashboard.completeRequiredPasswordChange.disabled = true;
    dashboard.completeRequiredPasswordChange.textContent = "Saving password…";
    let passwordUpdated = false;
    try {
      await updatePassword(currentUser, newPassword);
      passwordUpdated = true;
      await setDoc(doc(db, "students", currentUser.uid), {
        mustChangePassword: false,
        updatedAt: serverTimestamp()
      }, {
        merge: true
      });
      dashboard.closeRequiredPasswordChangeModal();
      showDashboardToast("Password changed", "Your new password is now active.");
    } catch (error) {
      const message = passwordUpdated ? "Your password was changed, but Presence could not unlock the dashboard. Refresh after the latest Firestore Rules are published." : error.code === "auth/requires-recent-login" ? "Please sign out and sign in again with the temporary password, then create your new password immediately." : error.code === "auth/weak-password" ? "The new password must contain at least 6 characters." : error.message || "Your password could not be changed.";
      showDashboardToast("Unable to finish password change", message);
    } finally {
      dashboard.completeRequiredPasswordChange.disabled = false;
      dashboard.completeRequiredPasswordChange.textContent = "Save new password";
    }
  }
  handleStudentFineListClick(event) {
    const dashboard = this;
    const button = event.target.closest("[data-open-community-service]");
    if (button) dashboard.openCommunityServiceModal(button.dataset.openCommunityService, button);
  }
  handleStudentProfileContentClick2(event) {
    const dashboard = this;
    const button = event.target.closest("#checkStudentFines");
    if (button) dashboard.openAllStudentFinesModal(button);
  }
  handleAbsenceSummaryCardClick() {
    const dashboard = this;
    const hasPendingFine = dashboard.fines.some(fine => fine.status !== "Completed");
    openView(hasPendingFine ? "fines" : "history");
  }
  handleWireFineActionsKeydown(event) {
    const dashboard = this;
    if (event.key === "Escape" && !dashboard.communityServiceModal.hidden) dashboard.closeCommunityServiceModal();
  }
  handleGeofenceErrorModalClick(event) {
    const dashboard = this;
    if (event.target === dashboard.geofenceErrorModal) dashboard.closeGeofenceError();
  }
  async handleStudentEventHistoryClick(clickEvent) {
    const dashboard = this;
    const button = clickEvent.target.closest("[data-dismiss-history]");
    if (!button) return;
    await setDoc(doc(db, "dismissedHistory", `${currentUser.uid}_${button.dataset.dismissHistory}`), {
      studentUid: currentUser.uid,
      eventId: button.dataset.dismissHistory,
      dismissedAt: serverTimestamp()
    });
    showDashboardToast("History entry removed", "The finished event is hidden from your history.");
  }
  async handleStudentAttendanceListClick(clickEvent) {
    const dashboard = this;
    const button = clickEvent.target.closest("[data-check-out-attendance]");
    if (!button) return;
    const record = dashboard.attendance.find(item => item.id === button.dataset.checkOutAttendance);
    const event = dashboard.events.find(item => item.id === record?.eventId);
    await dashboard.attendanceController.checkOutAttendance(record, event, button);
  }
  async handleStartCameraButtonClick() {
    const dashboard = this;
    if (dashboard.faceAlreadyRegistered) return;
    if (!dashboard.faceRegistrationConsent.checked) {
      showDashboardToast("Consent required", "Please check the consent checkbox before starting the camera.");
      dashboard.faceRegistrationConsent.focus();
      return;
    }
    try {
      sessionState.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user"
        },
        audio: false
      });
      dashboard.cameraPreview.srcObject = sessionState.mediaStream;
      dashboard.cameraPreview.hidden = false;
      dashboard.cameraPlaceholder.hidden = true;
      await dashboard.cameraPreview.play();
      dashboard.captureFaceButton.disabled = true;
      dashboard.startCameraButton.disabled = true;
      dashboard.startCameraButton.textContent = "Camera ready";
      dashboard.beginFaceGuidance();
    } catch {
      dashboard.clearFaceGuidanceTimers();
      dashboard.faceRegistrationGuide.hidden = true;
      dashboard.faceGuidancePanel.hidden = true;
      dashboard.faceCameraBox.dataset.guidance = "idle";
      showDashboardToast("Camera permission needed", "Allow camera access to continue face registration.");
    }
  }
  async handleCaptureFaceButtonClick() {
    const dashboard = this;
    if (!dashboard.facePhotoCaptured) {
      if (!dashboard.faceRegistrationConsent.checked) return;
      dashboard.captureFacePhoto();
      return;
    }
    dashboard.captureFaceButton.disabled = true;
    dashboard.captureFaceButton.textContent = "Saving securely…";
    try {
      await uploadFacePhotoToDrive(dashboard.faceCapturePreview.src, dashboard.studentProfile);
    } catch (error) {
      dashboard.captureFaceButton.disabled = false;
      dashboard.captureFaceButton.textContent = "Register face";
      showDashboardToast("Photo upload unavailable", "Check your connection, then try registering again.");
      return;
    }
    const registration = await waitForFaceRegistration(currentUser.uid, true);
    if (!registration) {
      dashboard.captureFaceButton.disabled = false;
      dashboard.captureFaceButton.textContent = "Register face";
      showDashboardToast("Registration not confirmed", "The Drive upload did not finish. Please try again or contact your administrator.");
      return;
    }
    dashboard.document.querySelector("#faceStatus").textContent = "Registered";
    dashboard.document.querySelector("#faceStatus").className = "badge green";
    dashboard.lockFaceRegistration();
    createNotification({
      recipientUid: currentUser.uid,
      category: "face",
      title: "Face registration confirmed",
      message: "Your face registration is ready for future attendance check-ins.",
      targetView: "face"
    }).catch(() => {});
    showDashboardToast("Face registered", "Registration status was saved successfully.");
  }
}
