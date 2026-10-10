import { StudentAttendanceController } from '../controllers/StudentAttendanceController.js?v=20261010-role-actions';
import { currentUser, currentUserProfile, escapeHtml, formatBirthday, FineModalController, showDashboardToast, createNotification, uploadFacePhotoToDrive, waitForFaceRegistration, openView, formatEventDate, formatEventTime, timePlusMinutes, formatTimeWindow, eventOpenDate, eventCloseDate, eventCheckInCloseDate, eventCheckoutCloseDate, isCheckoutAvailable, isEventFinished, formatAttendanceTimestamp, attendanceDuration, getEventStatus, arrivalStatusBadge, eventStatusBadge, getInitials, formatServiceMinutes, formatFineDate, formatFineTimestamp, getFineHistory, updateDashboardGreeting, createDeviceSessionToken, auth, db, signOut, updatePassword, Timestamp, collection, deleteField, doc, getDoc, getDocFromServer, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, writeBatch, sessionState } from '../dashboard.js?v=20261010-role-actions';
import { ScopedSubscriptions } from '../core/ScopedSubscriptions.js';
import { AttendancePolicy, LateCheckInModal, AttendanceCheckInController, AttendanceRealtimeBridge } from '../controllers/AttendanceController.js?v=20261010-role-actions';
import { AttendanceSummaryService } from '../controllers/AttendanceSummaryService.js';
import { StudentAttendanceListController } from '../controllers/StudentAttendanceListController.js?v=20261010-role-actions';
import { AttendanceToolbarController } from '../controllers/AttendanceToolbarController.js';

import { EventSchedulePresenter } from '../controllers/EventSchedulePresenter.js';
export class StudentDashboard {
initialize() {
  const subscriptions = new ScopedSubscriptions({ onError: (error, key) => { console.error(key, error); showDashboardToast('Data sync unavailable', 'Check your connection and reload to retry.'); } });
  const listen = (key, views, reference, callback) => subscriptions.register(key, views, (guard, onError) => onSnapshot(reference, { includeMetadataChanges: true }, guard(callback), onError));
  const changeSubscriptions = event => subscriptions.setView(event.detail.viewName);
  window.addEventListener('presence:viewchange', changeSubscriptions);
  this.dispose = () => { subscriptions.stop(); window.removeEventListener('presence:viewchange', changeSubscriptions); };

  let events = [];
  let attendance = [];
  let attendanceConfirmed = false;
  let fines = [];
  let dismissedIds = new Set();
  let studentProfile;
  const summaryService = new AttendanceSummaryService({ closeDate: eventCloseDate, checkoutCloseDate: eventCheckoutCloseDate });
  const schedulePresenter = new EventSchedulePresenter({ formatTime: formatEventTime, escapeHtml, addMinutes: timePlusMinutes });
  const attendanceList = new StudentAttendanceListController({ summary: summaryService, getEvents: () => events, render: renderMyAttendances, notify: showDashboardToast });
  attendanceList.initialize();
  let pendingProfilePhoto = "";
  let presenceWriteErrorShown = false;
  let eventRenderFrame;
  let eventStatusTimer;
  const disposeListeners = this.dispose;
  this.dispose = () => { disposeListeners(); attendanceRealtimeBridge.close(); window.clearTimeout(eventStatusTimer); window.cancelAnimationFrame(eventRenderFrame); window.clearInterval(sessionState.presenceHeartbeatTimer); sessionState.mediaStream?.getTracks().forEach(track => track.stop()); };
  sessionState.studentLoggedOut = false;
  const studentProfileModal = document.querySelector("#studentProfileModal");
  const requiredPasswordChangeModal = document.querySelector("#requiredPasswordChangeModal");
  const requiredPasswordChangeForm = document.querySelector("#requiredPasswordChangeForm");
  const completeRequiredPasswordChange = document.querySelector("#completeRequiredPasswordChange");
  const attendanceCheckInController = new AttendanceCheckInController({
    policy: new AttendancePolicy({ eventOpenDate, eventCloseDate, eventCheckInCloseDate }),
    lateModal: new LateCheckInModal(document.querySelector("#lateCheckInModal"))
  });
  const attendanceRealtimeBridge = new AttendanceRealtimeBridge();
  let storedPresenceSession = "";
  try { storedPresenceSession = sessionStorage.getItem("presenceDeviceSession") || ""; } catch {}
  sessionState.presenceSessionId = storedPresenceSession || `${currentUser.uid}_${createDeviceSessionToken()}`;
  try { sessionStorage.setItem("presenceDeviceSession", sessionState.presenceSessionId); } catch {}

  const updatePresence = async (status = "online", silent = false) => {
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
  sessionState.presenceHeartbeatTimer = window.setInterval(() => updatePresence("online"), 60000);
  window.addEventListener("focus", () => updatePresence("online"));
  window.addEventListener("pagehide", () => {
    if (!sessionState.studentLoggedOut) updatePresence("offline", true);
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

  function openRequiredPasswordChangeModal() {
    if (!requiredPasswordChangeModal.hidden) return;
    requiredPasswordChangeForm.reset();
    requiredPasswordChangeModal.hidden = false;
    document.querySelector("#requiredNewPassword").focus();
  }

  function closeRequiredPasswordChangeModal() {
    requiredPasswordChangeModal.hidden = true;
    requiredPasswordChangeForm.reset();
  }

  function renderEvents() {
    const attendanceByEventId = new Map(attendance.map((record) => [record.eventId, record]));
    const activeEvents = events.filter(event => !isEventFinished(event) && (attendanceByEventId.has(event.id)
      || summaryService.eligibility({ ...studentProfile, uid: currentUser.uid }, event) !== 'excluded'));
    const eventGrid = document.querySelector("#studentEventGrid");
    const timeline = document.querySelector("#studentEventTimeline");
    if (!activeEvents.length) {
      eventGrid.innerHTML = '<div class="empty-state panel event-empty">No open or upcoming events.</div>';
      timeline.innerHTML = '<div class="empty-state">No open or upcoming events.</div>';
    } else {
      eventGrid.innerHTML = activeEvents.map((event) => {
        const status = getEventStatus(event);
        const checkInResult = attendanceCheckInController.policy.evaluateCheckIn(event);
        const attendanceRecord = attendanceByEventId.get(event.id);
        const attended = Boolean(attendanceRecord);
        const completed = attendanceRecord?.status === "completed" || Boolean(attendanceRecord?.checkedOutAt);
        const checkoutOpen = attended && !completed && isCheckoutAvailable(event);
        const missedCheckIn = !attended && isCheckoutAvailable(event);
        const disabled = completed || (attended ? !checkoutOpen : !checkInResult.available);
        const buttonText = completed
          ? "✓ Attendance completed"
          : attended
            ? checkoutOpen ? "Check out" : "✓ Checked in"
            : missedCheckIn ? "Check-out unavailable" : checkInResult.available ? checkInResult.arrivalStatus === "late" ? "Check in late" : "Check in" : status === "closed" ? "Check-in unavailable" : "Not open yet";
        const attendanceBadge = completed
          ? '<span class="badge green">Completed</span>'
          : attended
            ? `<span class="badge green">${checkoutOpen ? "Checkout available" : "Checked in"}</span>`
            : missedCheckIn ? '<span class="badge orange">Check-in missed</span>' : checkInResult.available && checkInResult.arrivalStatus === "late" ? '<span class="badge orange">Late check-in</span>' : eventStatusBadge(status);
        const description = event.description || event.notes || `Attendance event for ${event.audience}.`;
        const missedCheckInMessage = missedCheckIn ? `<p class="event-card-notice">You cannot check out because no check-in was recorded before Time Out (${escapeHtml(formatEventTime(event.timeOut))}).</p>` : "";
        const action = checkoutOpen ? `data-check-out-event="${escapeHtml(event.id)}"` : `data-attend-event="${escapeHtml(event.id)}"`;
        const buttonClass = checkoutOpen || (!attended && checkInResult.available) ? "primary-button" : "outline-button";
        return `<article class="event-card"><div class="event-accent"></div><div class="event-body"><div class="event-card-kicker"><span class="event-type-badge">${escapeHtml(event.type || "School Event")}</span><span class="event-date">${escapeHtml(formatEventDate(event.date))}</span></div><h3>${escapeHtml(event.name)}</h3><div class="event-description"><strong>Description</strong>${escapeHtml(description)}</div>${schedulePresenter.render(event)}${missedCheckInMessage}<div class="event-card-actions">${attendanceBadge}<button class="${buttonClass} attendance-action-button" type="button" ${action} ${disabled ? "disabled" : ""}>${buttonText}</button></div></div></article>`;
      }).join("");
      timeline.innerHTML = `<div class="timeline">${activeEvents.slice(0, 4).map((event) => `<div class="timeline-item"><span class="timeline-time">${escapeHtml(formatEventTime(event.timeIn))}</span><div class="timeline-main"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(formatEventDate(event.date))} · ${escapeHtml(formatTimeWindow(event))}</small></div>${attendanceByEventId.has(event.id) ? '<span class="badge green">Attended</span>' : eventStatusBadge(getEventStatus(event))}</div>`).join("")}</div>`;
    }
    attendanceController.syncLoadingButtons();
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
    const result = summaryService.summarize({ ...studentProfile, uid: currentUser.uid }, events, attendance, { coverageConfirmed: attendanceConfirmed });
    const { attendedIds, absences, presentDays } = result;
    const closedEvents = events.filter(event => isEventFinished(event)
      && (attendedIds.has(event.id) || summaryService.eligibility({ ...studentProfile, uid: currentUser.uid }, event) !== 'excluded'));
    document.querySelector("#eventsAttendedCount").textContent = attendance.length;
    document.querySelector("#absenceCount").textContent = absences.length;
    document.querySelector("#daysPresentCount").textContent = presentDays;
    document.querySelector("#eventsAttendedMeta").textContent = attendance.length ? `${attendance.length} attendance record${attendance.length === 1 ? "" : "s"}` : "No attendance recorded yet";
    document.querySelector("#absenceMeta").textContent = `${absences.length} confirmed absences · ${result.unverified.length} historical events unverified · ${result.review.length} checkouts need review`;
    document.querySelector("#absenceSummaryCard").setAttribute("aria-label", absences.length ? `View details for ${absences.length} absence${absences.length === 1 ? "" : "s"}` : "View absence details");
    document.querySelector("#daysPresentMeta").textContent = presentDays ? `${presentDays} unique event day${presentDays === 1 ? "" : "s"}` : "Based on attended events";
    const records = closedEvents.filter((event) => !dismissedIds.has(event.id)).map((event) => ({ event,
      status: attendedIds.has(event.id) ? result.review.some(record => record.eventId === event.id) ? 'Needs review' : 'Attended'
        : absences.some(item => item.id === event.id) ? 'Absent' : 'Eligibility unverified' }));
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
    const records = attendanceList.select(attendance.slice().sort((first, second) => {
      const firstTime = first.checkedInAt?.seconds || first.attendedAt?.seconds || 0;
      const secondTime = second.checkedInAt?.seconds || second.attendedAt?.seconds || 0;
      return secondTime - firstTime;
    }));
    if (!records.length) {
      container.innerHTML = AttendanceToolbarController.emptyState({ filtered: attendance.length > 0 });
      return;
    }
    container.innerHTML = records.map((record) => {
      const event = events.find((item) => item.id === record.eventId) || record;
      const checkedInAt = record.checkedInAt || record.attendedAt;
      const completed = Boolean(record.checkedOutAt);
      const readyToCheckOut = !completed && record.status === "checked-in" && isCheckoutAvailable(event);
      const hasVerifiedCheckIn = Boolean(checkedInAt);
      const status = completed ? "Completed" : !hasVerifiedCheckIn ? "Check-in incomplete" : summaryService.needsReview(record, event) ? 'Needs review — missed checkout' : readyToCheckOut ? "Ready to check out" : "Checked in";
      const color = completed ? "green" : readyToCheckOut || status.startsWith('Needs review') ? "orange" : status === "Checked in" ? "blue" : "gray";
      const checkInWindow = event.timeIn ? `${formatEventTime(event.timeIn)} – ${formatEventTime(event.checkInCutoff || event.timeOut)}` : "Not recorded";
      const checkOutWindow = event.timeOut ? `${formatEventTime(event.timeOut)} – ${formatEventTime(event.checkOutCutoff || timePlusMinutes(event.timeOut))}` : "Not recorded";
      return `<article class="history-event-card attendance-record-card"><div class="history-card-top"><span class="event-type-badge">${escapeHtml(record.eventType || "School Event")}</span><div class="attendance-record-badges"><span class="badge ${color}">${escapeHtml(status)}</span>${arrivalStatusBadge(record.arrivalStatus)}${record.recordSource === "admin-corrected" ? `<span class="badge orange" title="${escapeHtml(`${record.correctedBy || "Administrator"} · ${formatAttendanceTimestamp(record.correctedAt)} · ${record.correctionReason || ""}`)}">Manual correction</span>` : ""}</div></div><h3>${escapeHtml(record.eventName || "Attendance event")}</h3><p>${escapeHtml(record.location || "Location not recorded")}</p><div class="event-detail-boxes"><div><span>Checked in</span><strong>${escapeHtml(formatAttendanceTimestamp(checkedInAt))}</strong></div><div><span>Checked out</span><strong>${escapeHtml(formatAttendanceTimestamp(record.checkedOutAt))}</strong></div><div><span>Arrival</span><strong>${escapeHtml(record.arrivalStatus === "late" ? "Late" : "Present")}</strong></div><div><span>Check-in window</span><strong>${escapeHtml(checkInWindow)}</strong></div><div><span>Checkout window</span><strong>${escapeHtml(checkOutWindow)}</strong></div><div><span>Duration</span><strong>${escapeHtml(attendanceDuration(checkedInAt, record.checkedOutAt))}</strong></div></div>${readyToCheckOut ? `<div class="history-card-actions"><button class="primary-button attendance-action-button" type="button" data-check-out-attendance="${escapeHtml(record.id)}">Check out</button></div>` : ""}</article>`;
    }).join("");
    attendanceController.syncLoadingButtons();
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

  requiredPasswordChangeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const newPassword = document.querySelector("#requiredNewPassword").value;
    const confirmPassword = document.querySelector("#requiredConfirmPassword").value;
    if (!/^\d{6,8}$/.test(newPassword)) {
      showDashboardToast("Invalid password", "Use a new password containing 6 to 8 digits.");
      document.querySelector("#requiredNewPassword").focus();
      return;
    }
    if (newPassword !== confirmPassword) {
      showDashboardToast("Passwords do not match", "Enter the same new password in both fields.");
      document.querySelector("#requiredConfirmPassword").focus();
      return;
    }
    completeRequiredPasswordChange.disabled = true;
    completeRequiredPasswordChange.textContent = "Saving password…";
    let passwordUpdated = false;
    try {
      await updatePassword(currentUser, newPassword);
      passwordUpdated = true;
      await setDoc(doc(db, "students", currentUser.uid), {
        mustChangePassword: false,
        updatedAt: serverTimestamp()
      }, { merge: true });
      closeRequiredPasswordChangeModal();
      showDashboardToast("Password changed", "Your new password is now active.");
    } catch (error) {
      const message = passwordUpdated
        ? "Your password was changed, but Presence could not unlock the dashboard. Refresh after the latest Firestore Rules are published."
        : error.code === "auth/requires-recent-login"
          ? "Please sign out and sign in again with the temporary password, then create your new password immediately."
          : error.code === "auth/weak-password"
            ? "The new password must contain at least 6 characters."
            : error.message || "Your password could not be changed.";
      showDashboardToast("Unable to finish password change", message);
    } finally {
      completeRequiredPasswordChange.disabled = false;
      completeRequiredPasswordChange.textContent = "Save new password";
    }
  });

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

  const attendanceController = new StudentAttendanceController({
    getState: () => ({ events, attendance }),
    setFaceRegistration: registered => { faceAlreadyRegistered = registered; },
    showError: showGeofenceError, bridge: attendanceRealtimeBridge, checkIn: attendanceCheckInController
  });
  const disposeDashboard = this.dispose;
  this.dispose = () => { attendanceList.dispose(); attendanceController.dispose(); disposeDashboard(); };

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
    await attendanceController.checkOutAttendance(record, event, button);
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

  function lockFaceRegistration() {
    faceAlreadyRegistered = true;
    clearFaceGuidanceTimers();
    if (sessionState.mediaStream) sessionState.mediaStream.getTracks().forEach((track) => track.stop());
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
      sessionState.mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      cameraPreview.srcObject = sessionState.mediaStream;
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
    showDashboardToast("Face registered", "Registration status was saved successfully.");
  });

  listen('profile', ["*"], doc(db, "students", currentUser.uid), async (snapshot) => {
    if (!snapshot.exists()) {
      sessionStorage.removeItem("presenceSession");
      await signOut(auth);
      window.location.replace("../index.html");
      return;
    }
    studentProfile = snapshot.data();
    scheduleEventRender();
    renderProfile();
    if (studentProfile.mustChangePassword === true) openRequiredPasswordChangeModal();
    else closeRequiredPasswordChangeModal();
  });
  listen('events', ["*"], query(collection(db, "events"), orderBy("openAt", "asc")), (snapshot) => { events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); scheduleEventRender(); renderMyAttendances(); scheduleEventStatusRefresh(); });
  listen('attendance', ["*"], query(collection(db, "attendance"), where("studentUid", "==", currentUser.uid)), (snapshot) => { attendanceConfirmed = !snapshot.metadata?.fromCache; attendance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); scheduleEventRender(); renderMyAttendances(); });
  listen('dismissed-history', ["history"], query(collection(db, "dismissedHistory"), where("studentUid", "==", currentUser.uid)), (snapshot) => { dismissedIds = new Set(snapshot.docs.map((item) => item.data().eventId)); scheduleEventRender(); });
  listen('fines', ["*"], query(collection(db, "fines"), where("studentUid", "==", currentUser.uid)), (snapshot) => { fines = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderFines(); renderProfile(); });
  listen('face', ["face","profile","events"], doc(db, "faceRegistrations", currentUser.uid), (snapshot) => {
    if (snapshot.data()?.registered) {
      document.querySelector("#faceStatus").textContent = "Registered";
      document.querySelector("#faceStatus").className = "badge green";
      lockFaceRegistration();
    } else {
      unlockFaceRegistration();
    }
  });
}
}
