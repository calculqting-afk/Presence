import { currentUser, currentUserProfile, showDashboardToast, openView, isCheckoutAvailable, db, Timestamp, doc, getDocFromServer, serverTimestamp, setDoc } from '../dashboard.js?v=20261009-oop';
const GEOFENCE_GPS_ALLOWANCE_CAP_METERS = 20;

export class StudentAttendanceController {
  constructor({ getState, setFaceRegistration, showError, bridge, checkIn }) {
    Object.assign(this, { getState, setFaceRegistration, showError, bridge, checkIn });
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

  dispose() { this.grid.removeEventListener('click', this.listener); }

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



  distanceInMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
    const toRadians = (value) => value * Math.PI / 180;
    const earthRadiusMeters = 6371000;
    const latitudeDelta = toRadians(latitudeB - latitudeA);
    const longitudeDelta = toRadians(longitudeB - longitudeA);
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2;
    return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    const centerLatitude = Number(geofence?.latitude);
    const centerLongitude = Number(geofence?.longitude);
    const radiusMeters = Number(geofence?.radiusMeters);
    if (!geofenceSnapshot.exists() || geofence?.enabled !== true
      || !Number.isFinite(centerLatitude) || centerLatitude < -90 || centerLatitude > 90
      || !Number.isFinite(centerLongitude) || centerLongitude < -180 || centerLongitude > 180
      || !Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      const locationError = new Error("This event's attendance area needs to be configured by an administrator.");
      locationError.geofenceIssue = "configuration";
      throw locationError;
    }

    const position = await this.getCurrentCheckInLocation();
    const { latitude, longitude } = position.coords;
    const reportedAccuracy = Number(position.coords.accuracy);
    const accuracyMeters = Number.isFinite(reportedAccuracy) && reportedAccuracy >= 0 ? Math.round(reportedAccuracy) : 0;
    const allowanceMeters = Math.min(accuracyMeters, GEOFENCE_GPS_ALLOWANCE_CAP_METERS);
    const distanceMeters = this.distanceInMeters(latitude, longitude, centerLatitude, centerLongitude);
    if (distanceMeters > radiusMeters + allowanceMeters) {
      const locationError = new Error("You are outside the attendance area.");
      locationError.geofenceIssue = "outside";
      locationError.distanceMeters = Math.round(distanceMeters);
      locationError.radiusMeters = Math.round(radiusMeters);
      locationError.accuracyMeters = accuracyMeters;
      throw locationError;
    }

    return { latitude, longitude, accuracy: accuracyMeters, distanceMeters: Math.round(distanceMeters) };
  }

  outsideGeofenceMessage(error, action) {
    return `You are ${error.distanceMeters} m from the attendance area. The allowed radius is ${error.radiusMeters} m; your GPS accuracy is ±${error.accuracyMeters} m. Move closer to the venue and try to ${action} again.`;
  }

  async checkOutAttendance(record, event, button) {
    if (!record || !event || !isCheckoutAvailable(event)) {
      showDashboardToast("Checkout unavailable", "Checkout is available from Time Out until the event's checkout cutoff.");
      return;
    }
    button.disabled = true;
    try {
      let checkOutLocation;
      if (event.requiresGeofence) {
        checkOutLocation = await this.verifiedGeofenceLocation(event);
      }
      const attendanceReference = doc(db, "attendance", `${currentUser.uid}_${record.eventId}`);
      await setDoc(attendanceReference, {
        ...(checkOutLocation ? { checkOutLocation } : {}),
        checkedOutAt: serverTimestamp(),
        status: "completed"
      }, { merge: true });
      this.bridge.publish(attendanceReference.id, {
        ...record,
        ...(checkOutLocation ? { checkOutLocation } : {}),
        checkedOutAt: Timestamp.now(),
        status: "completed"
      });
      const savedRecord = await getDocFromServer(attendanceReference);
      if (!savedRecord.exists() || savedRecord.data().status !== "completed" || !savedRecord.data().checkedOutAt) {
        throw new Error("Checkout is still waiting to sync. Please try again in a moment.");
      }
      this.bridge.publish(savedRecord.id, savedRecord.data());
      showDashboardToast("Checkout recorded", "Your attendance record now includes your checkout time.");
    } catch (error) {
      if (error.geofenceIssue === "location") {
        this.showError("Allow location for Presence", "Your device location may be on, but this browser has not allowed this site to use it. Click the site controls icon to the left of the address bar, set Location to Allow, then reload this page and try again.");
      } else if (error.geofenceIssue === "outside") {
        this.showError("You are outside the attendance area", this.outsideGeofenceMessage(error, "check out"));
      } else if (error.geofenceIssue === "configuration") {
        this.showError("Attendance area unavailable", error.message);
      } else {
        showDashboardToast("Unable to check out", error.message || "Try again while you are in the attendance area.");
      }
      button.disabled = false;
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
    const checkInResult = await this.checkIn.begin(selectedEvent, button);
    if (!checkInResult.available) {
      if (!checkInResult.cancelled) showDashboardToast("Attendance unavailable", "Attendance is allowed from Time In until Time Out. Check-ins after the cutoff are marked Late.");
      return;
    }
    button.disabled = true;
    try {
      let checkInLocation;
      if (selectedEvent.requiresGeofence) {
        showDashboardToast("Checking your location", "Allow location access to confirm you are in the attendance area.");
        checkInLocation = await this.verifiedGeofenceLocation(selectedEvent);
      }
      const attendanceReference = doc(db, "attendance", `${currentUser.uid}_${selectedEvent.id}`);
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
      await setDoc(attendanceReference, attendancePayload);
      const checkedInAt = Timestamp.now();
      this.bridge.publish(attendanceReference.id, {
        ...attendancePayload,
        attendedAt: checkedInAt,
        checkedInAt
      });
      const savedRecord = await getDocFromServer(attendanceReference);
      if (!savedRecord.exists()
        || savedRecord.data().studentUid !== currentUser.uid
        || savedRecord.data().eventId !== selectedEvent.id
        || savedRecord.data().status !== "checked-in"
        || savedRecord.data().arrivalStatus !== checkInResult.arrivalStatus
        || !savedRecord.data().checkedInAt) {
        throw new Error("Attendance is still waiting to sync. Please try again in a moment.");
      }
      this.bridge.publish(savedRecord.id, savedRecord.data());
      showDashboardToast(checkInResult.arrivalStatus === "late" ? "Late attendance recorded" : "Attendance recorded", checkInResult.arrivalStatus === "late" ? "Your attendance was saved as Late." : "Your attendance was saved successfully.");
    } catch (error) {
      if (error.geofenceIssue === "location") {
        this.showError("Allow location for Presence", "Your device location may be on, but this browser has not allowed this site to use it. Click the site controls icon to the left of the address bar, set Location to Allow, then reload this page and try again.");
      } else if (error.geofenceIssue === "outside") {
        this.showError("You are outside the attendance area", this.outsideGeofenceMessage(error, "check in"));
      } else if (error.geofenceIssue === "configuration") {
        this.showError("Attendance area unavailable", error.message);
      } else {
        const message = error.code === "permission-denied"
          ? "Attendance was rejected by Firestore. Confirm the attendance window, your event access, and the deployed Firestore Rules."
          : (error.message || "Attendance could not be recorded. Please try again.");
        showDashboardToast("Attendance rejected", message);
      }
      button.disabled = false;
    }
  }
}
