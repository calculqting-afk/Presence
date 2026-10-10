import { currentUser, currentUserProfile, showDashboardToast, openView, isCheckoutAvailable, db, Timestamp, doc, getDocFromServer, serverTimestamp, setDoc } from '../dashboard.js?v=20261010-surveys';
const GEOFENCE_GPS_ALLOWANCE_CAP_METERS = 20;
import { AttendanceSubmissionService } from './AttendanceSubmissionService.js?v=20261010-surveys';
import { GeofenceBoundary } from './GeofenceBoundary.js';
import { ButtonLoadingController } from './ButtonLoadingController.js';

export class StudentAttendanceController {
  constructor({ getState, setFaceRegistration, showError, bridge, checkIn }) {
    Object.assign(this, { getState, setFaceRegistration, showError, bridge, checkIn });
    this.submission = new AttendanceSubmissionService({ read: getDocFromServer, write: setDoc,
      onWaiting: () => showDashboardToast('Waiting for the server', 'Attendance is still awaiting a server response. Keep this page open and do not submit again.') });
    this.checkoutBusy = new Set();
    this.loading = new ButtonLoadingController();
    this.grid = document.querySelector('#studentEventGrid');
    this.listener = event => {
      if (this.busy) return;
      this.busy = true;
      void this.handleEventClick(event)
        .catch(error => showDashboardToast('Attendance unavailable', error.message))
        .finally(() => { this.busy = false; });
    };
    this.grid.addEventListener('click', this.listener);
  }

  dispose() { this.grid.removeEventListener('click', this.listener); this.loading.dispose(); }

  syncLoadingButtons() {
    for (const button of document.querySelectorAll?.('[data-attend-event], [data-check-out-event], [data-check-out-attendance]') || []) {
      let key;
      if (button.dataset.checkOutAttendance) {
        const record = this.getState().attendance.find(item => item.id === button.dataset.checkOutAttendance);
        if (record) key = `out:${record.eventId}`;
      } else key = button.dataset.checkOutEvent ? `out:${button.dataset.checkOutEvent}` : `in:${button.dataset.attendEvent}`;
      this.loading.attach(key, button);
    }
  }

  getCurrentCheckInLocation() {
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



  async verifiedGeofenceLocation(event) {
    let geofenceSnapshot;
    try {
      geofenceSnapshot = await getDocFromServer(doc(db, "eventGeofences", event.id));
    } catch (error) {
      const locationError = new Error("The attendance area could not be loaded. Please try again.");
      locationError.geofenceIssue = "configuration";
      locationError.cause = error;
      throw locationError;
    }

    const geofence = geofenceSnapshot.data();
    let boundary;
    try {
      if (!geofenceSnapshot.exists() || geofence?.enabled !== true) throw new Error('Missing boundary');
      boundary = GeofenceBoundary.create(geofence);
    } catch {
      const locationError = new Error("This event's attendance area needs to be configured by an administrator.");
      locationError.geofenceIssue = "configuration";
      throw locationError;
    }

    const position = await this.getCurrentCheckInLocation();
    const { latitude, longitude } = position.coords || {};
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      const error = new Error('Your browser returned an invalid GPS location. Enable precise location and try again.');
      error.geofenceIssue = 'location';
      throw error;
    }
    const reportedAccuracy = Number(position.coords.accuracy);
    const accuracyMeters = Number.isFinite(reportedAccuracy) && reportedAccuracy >= 0 ? Math.round(reportedAccuracy) : 0;
    const allowanceMeters = Math.min(accuracyMeters, GEOFENCE_GPS_ALLOWANCE_CAP_METERS);
    const result = boundary.evaluate({ latitude, longitude }, allowanceMeters);
    const { distanceMeters } = result;
    if (!result.inside) {
      const locationError = new Error("You are outside the attendance area.");
      locationError.geofenceIssue = "outside";
      locationError.distanceMeters = Math.round(distanceMeters);
      locationError.radiusMeters = Math.round(result.radiusMeters || 0);
      locationError.boundaryType = result.type;
      locationError.accuracyMeters = accuracyMeters;
      throw locationError;
    }

    return { latitude, longitude, accuracy: Math.min(accuracyMeters, 100000), distanceMeters: Math.round(distanceMeters) };
  }

  submissionErrorMessage(error, action = 'check-in') {
    if (error.code !== 'permission-denied') return error.message || 'Attendance could not be recorded. Please try again.';
    if (error.attendanceStage === 'preflight') return 'Firestore blocked the attendance-record check before saving. Publish the latest attendance read rules and confirm your student account is active.';
    if (action === 'checkout') return 'Firestore rejected checkout. Publish the latest checkout rules and verify the saved check-in status, server checkout window, and required location. Your check-in has not been changed.';
    return 'Firestore rejected the attendance save. Confirm the server attendance window, your participant-roster access, face registration, and deployed rules.';
  }

  showLocationError(error) {
    if (error.locationErrorCode === 1) this.showError('Allow location for Presence', 'This browser has not allowed this site to use your location. Set Location to Allow in the site controls, then reload and try again.');
    else this.showError('Location unavailable', error.message);
  }

  validateCheckoutRecord(snapshot, eventId) {
    const saved = snapshot.exists() ? snapshot.data() : null;
    if (!saved || saved.studentUid !== currentUser.uid || saved.eventId !== eventId || saved.status !== 'checked-in' || !saved.checkedInAt || saved.checkedOutAt) {
      throw new Error('A matching saved check-in is required before checkout. Refresh your attendance records or ask an Attendance Manager to review the record.');
    }
  }

  outsideGeofenceMessage(error, action) {
    if (error.boundaryType === 'polygon') return `You are ${error.distanceMeters} m outside the attendance boundary; your GPS accuracy is ±${error.accuracyMeters} m. Move inside the venue and try to ${action} again.`;
    return `You are ${error.distanceMeters} m from the attendance area. The allowed radius is ${error.radiusMeters} m; your GPS accuracy is ±${error.accuracyMeters} m. Move closer to the venue and try to ${action} again.`;
  }

  async checkOutAttendance(record, event, button) {
    if (this.checkoutBusy.has(record?.eventId)) return;
    if (!record || !event || !isCheckoutAvailable(event)) {
      showDashboardToast("Checkout unavailable", "Checkout is available from Time Out until the event's checkout cutoff.");
      return;
    }
    const loadingKey = `out:${record.eventId}`;
    this.loading.start(loadingKey, button, 'Checking out…');
    this.syncLoadingButtons();
    this.checkoutBusy.add(record.eventId);
    try {
      let checkOutLocation;
      if (event.requiresGeofence) {
        this.loading.update(loadingKey, 'Verifying location…');
        checkOutLocation = await this.verifiedGeofenceLocation(event);
      }
      if (!isCheckoutAvailable(event)) throw new Error('The checkout window closed while checking your location. Ask an Attendance Manager to review your record.');
      const attendanceReference = doc(db, "attendance", `${currentUser.uid}_${record.eventId}`);
      this.loading.update(loadingKey, 'Saving attendance…');
      const result = await this.submission.submit({ reference: attendanceReference,
        matches: data => data.studentUid === currentUser.uid && data.eventId === record.eventId && Boolean(data.checkedOutAt),
        validatePrevious: snapshot => this.validateCheckoutRecord(snapshot, record.eventId),
        payload: {
        ...(checkOutLocation ? { checkOutLocation } : {}),
        checkedOutAt: serverTimestamp(),
        status: "completed"
      }, options: { merge: true } });
      if (result.state === 'busy') { button.disabled = false; return; }
      if (result.state === 'unknown') {
        showDashboardToast('Checkout status unknown', 'The connection failed before checkout could be confirmed. Refresh to check the saved record before retrying.'); button.disabled = false; return;
      }
      if (result.state === 'confirmation-pending') {
        this.loading.finish(loadingKey, 'Saved · refresh');
        showDashboardToast('Checkout saved — confirmation pending', 'The server accepted your checkout. Do not submit again; refresh when your connection recovers.'); return;
      }
      const savedRecord = result.snapshot;
      this.loading.finish(loadingKey, 'Checked out');
      this.bridge.publish(savedRecord.id, savedRecord.data());
      showDashboardToast("Checkout recorded", "Your attendance record now includes your checkout time.");
    } catch (error) {
      if (error.geofenceIssue === "location") {
        this.showLocationError(error);
      } else if (error.geofenceIssue === "outside") {
        this.showError("You are outside the attendance area", this.outsideGeofenceMessage(error, "check out"));
      } else if (error.geofenceIssue === "configuration") {
        this.showError("Attendance area unavailable", error.message);
      } else {
        console.error('Checkout submission failed', { code: error.code, stage: error.attendanceStage });
        showDashboardToast("Unable to check out", this.submissionErrorMessage(error, 'checkout'));
      }
      button.disabled = false;
    } finally {
      this.loading.reset(loadingKey);
      this.checkoutBusy.delete(record.eventId);
    }
  }
  async handleEventClick(clickEvent) {
    const { events, attendance } = this.getState();
    const checkOutButton = clickEvent.target.closest("[data-check-out-event]");
    if (checkOutButton) {
      const event = events.find((item) => item.id === checkOutButton.dataset.checkOutEvent);
      const record = attendance.find((item) => item.eventId === event?.id && item.studentUid === currentUser.uid);
      await this.checkOutAttendance(record, event, checkOutButton);
      return;
    }
    const button = clickEvent.target.closest("[data-attend-event]");
    if (!button) return;
    const selectedEvent = events.find((event) => event.id === button.dataset.attendEvent);
    if (!selectedEvent) return;
    const loadingKey = `in:${selectedEvent.id}`;
    if (!this.loading.start(loadingKey, button, 'Checking in…')) return;
    this.syncLoadingButtons();
    try { await this.performCheckIn(selectedEvent, button, loadingKey); }
    finally { this.loading.reset(loadingKey); }
  }

  async performCheckIn(selectedEvent, button, loadingKey) {
    let faceRegistration;
    try {
      faceRegistration = await getDocFromServer(doc(db, "faceRegistrations", currentUser.uid));
    } catch {
      this.showError("Facial recognition could not be verified", "Presence must verify your facial recognition before attendance can be recorded. Check your connection and try again.");
      return;
    }
    const registered = faceRegistration.data()?.registered === true;
    this.setFaceRegistration(registered);
    if (!registered) {
      this.showError("Facial recognition required", "You have not completed facial recognition yet. You must register your face first before you can take attendance. The Face Registration page is now open.");
      openView("face");
      return;
    }
    let checkInResult = await this.checkIn.begin(selectedEvent, button);
    if (!checkInResult.available) {
      if (!checkInResult.cancelled) showDashboardToast("Attendance unavailable", "Attendance is allowed from Time In until Time Out. Check-ins after the cutoff are marked Late.");
      return;
    }
    button.disabled = true;
    try {
      let checkInLocation;
      if (selectedEvent.requiresGeofence) {
        this.loading.update(loadingKey, 'Verifying location…');
        showDashboardToast("Checking your location", "Allow location access to confirm you are in the attendance area.");
        checkInLocation = await this.verifiedGeofenceLocation(selectedEvent);
      }
      // GPS can take 15 seconds. Re-evaluate and request late consent if the
      // cutoff was crossed; never silently submit the original Present label.
      if (this.checkIn.policy) {
        const latest = this.checkIn.policy.evaluateCheckIn(selectedEvent);
        if (latest.arrivalStatus !== checkInResult.arrivalStatus && latest.available) checkInResult = await this.checkIn.begin(selectedEvent, button);
        else checkInResult = latest;
        if (!checkInResult.available) {
          button.disabled = false;
          if (!checkInResult.cancelled) showDashboardToast('Attendance window closed', 'The window closed while verifying your location. Ask an Attendance Manager to review your attendance.');
          return;
        }
      }
      const attendanceReference = doc(db, "attendance", `${currentUser.uid}_${selectedEvent.id}`);
      this.loading.update(loadingKey, 'Saving attendance…');
      const attendancePayload = {
        studentUid: currentUser.uid,
        studentId: currentUserProfile.accountId || "",
        eventId: selectedEvent.id,
        eventName: selectedEvent.name || "Attendance event",
        eventType: selectedEvent.type || "School Event",
        eventDescription: selectedEvent.description || "",
        eventDate: selectedEvent.date || "",
        timeIn: selectedEvent.timeIn || "",
        timeOut: selectedEvent.timeOut || "",
        location: selectedEvent.location || "",
        audience: selectedEvent.audience || "All students",
        ...(checkInLocation ? { checkInLocation } : {}),
        attendedAt: serverTimestamp(),
        checkedInAt: serverTimestamp(),
        status: "checked-in",
        arrivalStatus: checkInResult.arrivalStatus
      };
      const result = await this.submission.submit({ reference: attendanceReference, payload: attendancePayload,
        matches: data => data.studentUid === currentUser.uid && data.eventId === selectedEvent.id && Boolean(data.checkedInAt) });
      if (result.state === 'busy') { button.disabled = false; return; }
      if (result.state === 'unknown') {
        showDashboardToast('Attendance status unknown', 'The connection failed before attendance could be confirmed. Refresh to check the saved record before retrying.'); button.disabled = false; return;
      }
      if (result.state === 'confirmation-pending') {
        this.loading.finish(loadingKey, 'Saved · refresh');
        showDashboardToast('Attendance saved — confirmation pending', 'The server accepted your attendance. Do not submit again; refresh when your connection recovers.'); return;
      }
      const savedRecord = result.snapshot;
      this.loading.finish(loadingKey, 'Checked in');
      this.bridge.publish(savedRecord.id, savedRecord.data());
      if (result.state === 'existing') showDashboardToast('Attendance already recorded', 'Your existing check-in was preserved; no duplicate was created.');
      else showDashboardToast(savedRecord.data().arrivalStatus === "late" ? "Late attendance recorded" : "Attendance recorded", savedRecord.data().arrivalStatus === "late" ? "Your attendance was saved as Late." : "Your attendance was saved successfully.");
    } catch (error) {
      if (error.geofenceIssue === "location") {
        this.showLocationError(error);
      } else if (error.geofenceIssue === "outside") {
        this.showError("You are outside the attendance area", this.outsideGeofenceMessage(error, "check in"));
      } else if (error.geofenceIssue === "configuration") {
        this.showError("Attendance area unavailable", error.message);
      } else {
        console.error('Attendance submission failed', { code: error.code, stage: error.attendanceStage });
        showDashboardToast("Attendance rejected", this.submissionErrorMessage(error));
      }
      button.disabled = false;
    }
  }
}
