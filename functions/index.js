const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const SUPER_ADMIN_EMAIL = "mikhailovna2007@gmail.com";
const ROLE = Object.freeze({
  SUPER_ADMIN: "super_admin",
  HEAD_ADMIN: "head_admin",
  ATTENDANCE_ADMIN: "attendance_admin",
  STUDENT_MANAGER: "student_manager",
  STUDENT: "student"
});
const ASSIGNABLE_ROLES = new Set([ROLE.HEAD_ADMIN, ROLE.ATTENDANCE_ADMIN, ROLE.STUDENT_MANAGER, ROLE.STUDENT]);

function studentMatchesEventAudience(student, audience) {
  return student.active !== false
    && (audience === "All students" || audience === `Section ${student.section}`);
}

function notificationData(recipient, notification) {
  return {
    recipientUid: recipient.uid,
    recipientRole: recipient.role || ROLE.STUDENT,
    category: notification.category || "system",
    title: notification.title,
    message: notification.message,
    targetView: notification.targetView || "dashboard",
    studentName: notification.studentName || "",
    studentId: notification.studentId || "",
    section: notification.section || "",
    read: false,
    createdAt: FieldValue.serverTimestamp()
  };
}

async function notifyRoles(firestore, roles, notification) {
  const profiles = await firestore.collection("students").where("active", "==", true).get();
  const recipients = profiles.docs
    .map((snapshot) => ({ uid: snapshot.id, ...snapshot.data() }))
    .filter((profile) => roles.includes(profile.role));
  if (roles.includes(ROLE.SUPER_ADMIN)) {
    const bootstrap = await getAuth().getUserByEmail(SUPER_ADMIN_EMAIL).catch((error) => error.code === "auth/user-not-found" ? null : Promise.reject(error));
    if (bootstrap && !recipients.some((recipient) => recipient.uid === bootstrap.uid)) recipients.push({ uid: bootstrap.uid, role: ROLE.SUPER_ADMIN });
  }
  await Promise.all(recipients.map((recipient) => firestore.collection("notifications").add(notificationData(recipient, notification))));
}

function distanceInMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = (value) => value * Math.PI / 180;
  const earthRadius = 6371000;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function verifiedGeofenceLocation(location, geofence, fieldName) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  const accuracy = Number(location?.accuracy);
  const centerLatitude = Number(geofence?.latitude);
  const centerLongitude = Number(geofence?.longitude);
  const radiusMeters = Number(geofence?.radiusMeters);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || !Number.isFinite(centerLatitude) || centerLatitude < -90 || centerLatitude > 90
    || !Number.isFinite(centerLongitude) || centerLongitude < -180 || centerLongitude > 180
    || !Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new HttpsError("invalid-argument", `A valid ${fieldName} location is required for this event.`);
  }
  const distanceMeters = distanceInMeters(latitude, longitude, centerLatitude, centerLongitude);
  if (distanceMeters > radiusMeters) throw new HttpsError("permission-denied", "You are outside the allowed attendance area.");
  return {
    latitude,
    longitude,
    ...(Number.isFinite(accuracy) && accuracy >= 0 ? { accuracy: Math.round(accuracy) } : {}),
    distanceMeters: Math.round(distanceMeters)
  };
}

exports.checkInWithGeofence = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in before checking in.");
  const { eventId, checkInLocation } = request.data || {};
  if (typeof eventId !== "string" || !eventId) throw new HttpsError("invalid-argument", "An event is required.");

  const firestore = getFirestore();
  const [studentSnapshot, eventSnapshot, faceSnapshot, geofenceSnapshot] = await Promise.all([
    firestore.doc(`students/${request.auth.uid}`).get(),
    firestore.doc(`events/${eventId}`).get(),
    firestore.doc(`faceRegistrations/${request.auth.uid}`).get(),
    firestore.doc(`eventGeofences/${eventId}`).get()
  ]);
  if (!studentSnapshot.exists || studentSnapshot.data().active !== true) throw new HttpsError("permission-denied", "Only active students can check in.");
  if (!faceSnapshot.exists || faceSnapshot.data().registered !== true) throw new HttpsError("permission-denied", "Face registration is required before checking in.");
  if (!eventSnapshot.exists) throw new HttpsError("not-found", "This event no longer exists.");

  const student = studentSnapshot.data();
  const event = eventSnapshot.data();
  const now = Date.now();
  const checkInCloseAt = event.checkInClosesAt?.toMillis ? event.checkInClosesAt : event.closeAt;
  if (!event.openAt?.toMillis || !checkInCloseAt?.toMillis || now < event.openAt.toMillis() || now > checkInCloseAt.toMillis()) throw new HttpsError("permission-denied", "The check-in window is not open.");
  if (!studentMatchesEventAudience(student, event.audience || "All students")) throw new HttpsError("permission-denied", "This event is not assigned to your section.");

  let verifiedLocation;
  const geofence = geofenceSnapshot.exists ? geofenceSnapshot.data() : event.geofence;
  if (event.requiresGeofence || geofence?.enabled) {
    verifiedLocation = verifiedGeofenceLocation(checkInLocation, geofence, "check-in");
  }

  const attendanceReference = firestore.doc(`attendance/${request.auth.uid}_${eventId}`);
  await firestore.runTransaction(async (transaction) => {
    if ((await transaction.get(attendanceReference)).exists) throw new HttpsError("already-exists", "Attendance has already been recorded for this event.");
    transaction.set(attendanceReference, {
      studentUid: request.auth.uid,
      studentId: student.accountId || "",
      eventId,
      eventName: event.name || "Attendance event",
      eventType: event.type || "School Event",
      eventDescription: event.description || event.notes || "",
      eventDate: event.date || "",
      timeIn: event.timeIn || "",
      timeOut: event.timeOut || "",
      location: event.location || "",
      audience: event.audience || "All students",
      ...(verifiedLocation ? { checkInLocation: verifiedLocation } : {}),
      attendedAt: FieldValue.serverTimestamp(),
      checkedInAt: FieldValue.serverTimestamp(),
      status: "checked-in"
    });
  });
  return { ok: true };
});

exports.checkOutWithGeofence = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in before checking out.");
  const { eventId, checkOutLocation } = request.data || {};
  if (typeof eventId !== "string" || !eventId) throw new HttpsError("invalid-argument", "An event is required.");

  const firestore = getFirestore();
  const attendanceReference = firestore.doc(`attendance/${request.auth.uid}_${eventId}`);
  const [studentSnapshot, eventSnapshot, attendanceSnapshot, geofenceSnapshot] = await Promise.all([
    firestore.doc(`students/${request.auth.uid}`).get(),
    firestore.doc(`events/${eventId}`).get(),
    attendanceReference.get(),
    firestore.doc(`eventGeofences/${eventId}`).get()
  ]);
  if (!studentSnapshot.exists || studentSnapshot.data().active !== true) throw new HttpsError("permission-denied", "Only active students can check out.");
  if (!eventSnapshot.exists) throw new HttpsError("not-found", "This event no longer exists.");
  if (!attendanceSnapshot.exists || attendanceSnapshot.data().studentUid !== request.auth.uid || attendanceSnapshot.data().status !== "checked-in") throw new HttpsError("failed-precondition", "You must check in before checking out.");

  const event = eventSnapshot.data();
  const checkOutCloseAt = event.checkOutClosesAt?.toMillis ? event.checkOutClosesAt : event.closeAt;
  const now = Date.now();
  if (!event.closeAt?.toMillis || !checkOutCloseAt?.toMillis || now < event.closeAt.toMillis() || now > checkOutCloseAt.toMillis()) throw new HttpsError("permission-denied", "The check-out window is not open.");
  const geofence = geofenceSnapshot.exists ? geofenceSnapshot.data() : event.geofence;
  const verifiedLocation = (event.requiresGeofence || geofence?.enabled)
    ? verifiedGeofenceLocation(checkOutLocation, geofence, "check-out")
    : undefined;

  await firestore.runTransaction(async (transaction) => {
    const attendance = await transaction.get(attendanceReference);
    if (!attendance.exists || attendance.data().studentUid !== request.auth.uid || attendance.data().status !== "checked-in") throw new HttpsError("failed-precondition", "You must check in before checking out.");
    transaction.update(attendanceReference, {
      ...(verifiedLocation ? { checkOutLocation: verifiedLocation } : {}),
      checkedOutAt: FieldValue.serverTimestamp(),
      status: "completed"
    });
  });
  return { ok: true };
});

exports.notifyFaceRegistration = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  const firestore = getFirestore();
  const [studentSnapshot, registrationSnapshot] = await Promise.all([
    firestore.doc(`students/${request.auth.uid}`).get(),
    firestore.doc(`faceRegistrations/${request.auth.uid}`).get()
  ]);
  if (!studentSnapshot.exists || studentSnapshot.data().active !== true || registrationSnapshot.data()?.registered !== true) {
    throw new HttpsError("permission-denied", "Face registration has not been verified.");
  }
  const student = studentSnapshot.data();
  await notifyRoles(firestore, [ROLE.SUPER_ADMIN, ROLE.HEAD_ADMIN, ROLE.STUDENT_MANAGER], {
    category: "face",
    title: "Face registration completed",
    message: `${[student.firstName, student.lastName].filter(Boolean).join(" ") || "A student"} completed face registration.`,
    targetView: "modify-students",
    studentName: [student.firstName, student.lastName].filter(Boolean).join(" "),
    studentId: student.accountId || "",
    section: student.section || ""
  });
  return { ok: true };
});

// One-time, Super Admin-only migration for event documents created before
// geofence coordinates were moved out of student-readable event records.
exports.migrateEventGeofences = onCall(async (request) => {
  await requireSuperAdmin(request);
  const firestore = getFirestore();
  const events = await firestore.collection("events").get();
  let migrated = 0;
  while (events.docs.length) {
    const group = events.docs.splice(0, 400);
    const batch = firestore.batch();
    group.forEach((snapshot) => {
      const legacyGeofence = snapshot.data().geofence;
      if (!legacyGeofence) return;
      batch.set(firestore.doc(`eventGeofences/${snapshot.id}`), legacyGeofence);
      batch.update(snapshot.ref, {
        geofence: FieldValue.delete(),
        requiresGeofence: legacyGeofence.enabled === true
      });
      migrated += 1;
    });
    await batch.commit();
  }
  return { ok: true, migrated };
});

async function createReminderNotifications(firestore, events, reminder) {
  if (events.empty) return 0;
  const students = await firestore.collection("students").where("active", "==", true).get();
  const writes = [];
  events.docs.forEach((eventSnapshot) => {
    const event = eventSnapshot.data();
    students.docs.map((studentSnapshot) => studentSnapshot.data())
      .filter((student) => studentMatchesEventAudience(student, event.audience))
      .forEach((student) => {
        const documentId = `event_${eventSnapshot.id}_${student.uid}_${reminder.key}`;
        writes.push({
          reference: firestore.doc(`notifications/${documentId}`),
          data: {
            recipientUid: student.uid,
            recipientRole: "",
            category: "attendance",
            title: reminder.title,
            message: `${event.name || "Your event"} ${reminder.message}`,
            targetView: "events",
            studentName: [student.firstName, student.lastName].filter(Boolean).join(" "),
            studentId: student.accountId || "",
            section: student.section || "",
            eventId: eventSnapshot.id,
            reminderType: reminder.key,
            read: false,
            createdAt: FieldValue.serverTimestamp()
          }
        });
      });
  });
  let created = 0;
  while (writes.length) {
    const group = writes.splice(0, 400);
    await Promise.all(group.map(async ({ reference, data }) => {
      try {
        await reference.create(data);
        created += 1;
      } catch (error) {
        if (error.code !== 6 && error.code !== "already-exists") throw error;
      }
    }));
  }
  return created;
}

exports.sendEventReminders = onSchedule({ schedule: "every 5 minutes", timeZone: "Asia/Manila" }, async () => {
  const firestore = getFirestore();
  const now = new Date();
  const opensBy = new Date(now.getTime() + 15 * 60 * 1000);
  const closesBy = new Date(now.getTime() + 10 * 60 * 1000);
  const [openingEvents, closingEvents] = await Promise.all([
    firestore.collection("events").where("openAt", ">=", now).where("openAt", "<=", opensBy).get(),
    firestore.collection("events").where("closeAt", ">=", now).where("closeAt", "<=", closesBy).get()
  ]);
  const [openingCreated, closingCreated] = await Promise.all([
    createReminderNotifications(firestore, openingEvents, { key: "opens", title: "Attendance opens soon", message: "check-in opens in 15 minutes." }),
    createReminderNotifications(firestore, closingEvents, { key: "closes", title: "Attendance closes soon", message: "check-in closes in 10 minutes." })
  ]);
  console.log("Event reminders sent", { openingCreated, closingCreated });
});

function studentIdToEmail(studentId) {
  const safeId = studentId.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `${safeId}@students.presence.local`;
}

async function requireAdmin(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  const role = request.auth.token.role;
  const isSuperAdmin = request.auth.token.email?.toLowerCase() === SUPER_ADMIN_EMAIL;
  if (role !== ROLE.HEAD_ADMIN && !isSuperAdmin) {
    throw new HttpsError("permission-denied", "Only the Head Admin can manage student accounts.");
  }
}

function requireSuperAdmin(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  if (request.auth.token.email?.toLowerCase() !== SUPER_ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "Only the Super Admin can manage roles.");
  }
}

exports.assignUserRole = onCall(async (request) => {
  await requireSuperAdmin(request);
  const uid = String(request.data?.uid || "").trim();
  const role = String(request.data?.role || "").trim();
  if (!uid || !ASSIGNABLE_ROLES.has(role)) {
    throw new HttpsError("invalid-argument", "Choose a valid account and role.");
  }

  const firebaseAuth = getAuth();
  const firestore = getFirestore();
  const target = await firebaseAuth.getUser(uid).catch((error) => {
    if (error.code === "auth/user-not-found") throw new HttpsError("not-found", "This account no longer exists.");
    throw error;
  });
  const previousRole = target.customClaims?.role || ROLE.STUDENT;
  const nextClaims = { ...(target.customClaims || {}), role };
  await firebaseAuth.setCustomUserClaims(uid, nextClaims);
  await firestore.doc(`students/${uid}`).set({ role, roleUpdatedAt: FieldValue.serverTimestamp(), roleUpdatedBy: request.auth.uid }, { merge: true });
  await firestore.collection("auditLogs").add({
    action: "role_changed",
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email || "",
    targetUid: uid,
    previousRole,
    role,
    createdAt: FieldValue.serverTimestamp()
  });
  return { ok: true, role };
});

function validateStudent(data) {
  const required = ["accountId", "firstName", "lastName", "section"];
  const allowedSections = new Set(["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"]);
  for (const field of required) {
    if (typeof data[field] !== "string" || !data[field].trim()) {
      throw new HttpsError("invalid-argument", `${field} is required.`);
    }
  }
  if (!/^[A-Za-z0-9._-]+$/.test(data.accountId)) {
    throw new HttpsError("invalid-argument", "Student ID may only use letters, numbers, dots, dashes, and underscores.");
  }
  if (typeof data.email === "string" && data.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL) {
    throw new HttpsError("invalid-argument", "The protected Super Admin email cannot be registered as a student email.");
  }
  if (!allowedSections.has(data.section)) {
    throw new HttpsError("invalid-argument", "Choose a valid section from 1A through 4B.");
  }
  if (data.password && data.password.length < 6) {
    throw new HttpsError("invalid-argument", "The password must contain at least 6 characters.");
  }
  if (data.password && (typeof data.password !== "string" || !/^[0-9]{1,8}$/.test(data.password))) {
    throw new HttpsError("invalid-argument", "The password must use digits only and cannot contain more than 8 digits.");
  }
  if (data.phone && (typeof data.phone !== "string" || !/^[0-9]{1,11}$/.test(data.phone))) {
    throw new HttpsError("invalid-argument", "The phone number must use digits only and cannot contain more than 11 digits.");
  }
}

function toStudentError(error) {
  if (error instanceof HttpsError) return error;
  const code = String(error?.code || "");
  const knownErrors = {
    "auth/email-already-exists": ["already-exists", "This Student ID already has a Firebase login account."],
    "auth/invalid-email": ["invalid-argument", "Firebase could not create a login address from this Student ID."],
    "auth/invalid-password": ["invalid-argument", "Firebase requires a password containing at least 6 characters."],
    "auth/internal-error": ["unavailable", "Firebase Authentication is temporarily unavailable. Please try again."],
    "auth/user-not-found": ["not-found", "The student's Firebase login account no longer exists."],
    "auth/uid-already-exists": ["already-exists", "This student already has a Firebase login account."]
  };
  const [publicCode, publicMessage] = knownErrors[code] || [
    "internal",
    `Firebase could not save the student${code ? ` (${code})` : ""}. Check the function logs for details.`
  ];
  console.error("manageStudent failed", { code, message: error?.message, stack: error?.stack });
  return new HttpsError(publicCode, publicMessage, { firebaseCode: code || "unknown" });
}

async function findUserByEmail(firebaseAuth, email) {
  try {
    return await firebaseAuth.getUserByEmail(email);
  } catch (error) {
    if (error.code === "auth/user-not-found") return null;
    throw error;
  }
}

async function deleteQueryResults(firestore, querySnapshot) {
  const references = querySnapshot.docs.map((snapshot) => snapshot.ref);
  while (references.length) {
    const batch = firestore.batch();
    references.splice(0, 450).forEach((reference) => batch.delete(reference));
    await batch.commit();
  }
}

async function removeStudentData(firestore, uid, accountIdKey = "") {
  const [attendance, dismissedHistory, presenceSessions, idRegistrations] = await Promise.all([
    firestore.collection("attendance").where("studentUid", "==", uid).get(),
    firestore.collection("dismissedHistory").where("studentUid", "==", uid).get(),
    firestore.collection("presenceSessions").where("studentUid", "==", uid).get(),
    firestore.collection("studentIds").where("uid", "==", uid).get()
  ]);

  await Promise.all([
    deleteQueryResults(firestore, attendance),
    deleteQueryResults(firestore, dismissedHistory),
    deleteQueryResults(firestore, presenceSessions),
    deleteQueryResults(firestore, idRegistrations)
  ]);

  const batch = firestore.batch();
  batch.delete(firestore.doc(`students/${uid}`));
  batch.delete(firestore.doc(`faceRegistrations/${uid}`));
  batch.delete(firestore.doc(`presence/${uid}`));
  if (accountIdKey) batch.delete(firestore.doc(`studentIds/${accountIdKey}`));
  await batch.commit();
}

exports.manageStudent = onCall(async (request) => {
  try {
    await requireAdmin(request);
    const data = request.data || {};
    const action = data.action;
    const firebaseAuth = getAuth();
    const firestore = getFirestore();

    if (action === "delete") {
      if (request.auth.token.email?.toLowerCase() !== SUPER_ADMIN_EMAIL) {
        throw new HttpsError("permission-denied", "Only the Super Admin can delete student accounts.");
      }
      if (!data.uid) throw new HttpsError("invalid-argument", "Student UID is required.");
      const studentSnapshot = await firestore.doc(`students/${data.uid}`).get();
      const accountIdKey = String(studentSnapshot.data()?.accountIdKey || studentSnapshot.data()?.accountId || "").trim().toLowerCase();
      await removeStudentData(firestore, data.uid, accountIdKey);
      try {
        await firebaseAuth.deleteUser(data.uid);
      } catch (error) {
        if (error.code !== "auth/user-not-found") throw error;
      }
      return { ok: true };
    }

    validateStudent(data.student || {});
    const student = data.student;
    const authEmail = studentIdToEmail(student.accountId);
    const accountIdKey = student.accountId.trim().toLowerCase();

    if (action === "create") {
      if (!student.password) throw new HttpsError("invalid-argument", "A password is required.");
      const displayName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
      const existingId = await firestore.doc(`studentIds/${accountIdKey}`).get();
      if (existingId.exists) {
        const indexedUid = existingId.data()?.uid;
        if (typeof indexedUid === "string" && indexedUid) {
          const indexedProfile = await firestore.doc(`students/${indexedUid}`).get();
          if (indexedProfile.exists) throw new HttpsError("already-exists", "This Student ID is already registered.");
        }
        await firestore.doc(`studentIds/${accountIdKey}`).delete();
      }
      let user = await findUserByEmail(firebaseAuth, authEmail);
      let createdNow = false;
      if (user) {
        const existingProfile = await firestore.doc(`students/${user.uid}`).get();
        if (existingProfile.exists) {
          throw new HttpsError("already-exists", "This Student ID is already registered.");
        }
        await removeStudentData(firestore, user.uid);
        user = await firebaseAuth.updateUser(user.uid, { password: student.password, displayName, disabled: false });
      } else {
        user = await firebaseAuth.createUser({ email: authEmail, password: student.password, displayName, disabled: false });
        createdNow = true;
      }
      const { password, ...profile } = student;
      try {
        const registration = firestore.batch();
        registration.set(firestore.doc(`students/${user.uid}`), {
          ...profile,
          accountIdKey,
          uid: user.uid,
          authEmail,
          active: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        registration.set(firestore.doc(`studentIds/${accountIdKey}`), {
          studentId: student.accountId,
          uid: user.uid,
          createdAt: FieldValue.serverTimestamp()
        });
        await registration.commit();
      } catch (error) {
        if (createdNow) await firebaseAuth.deleteUser(user.uid).catch(() => {});
        throw error;
      }
      return { ok: true, uid: user.uid, accountId: student.accountId };
    }

    if (action === "update") {
      if (!data.uid) throw new HttpsError("invalid-argument", "Student UID is required.");
      const authUpdate = {
        email: authEmail,
        displayName: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ")
      };
      if (student.password) authUpdate.password = student.password;
      await firebaseAuth.updateUser(data.uid, authUpdate);
      const { password, ...profile } = student;
      await firestore.doc(`students/${data.uid}`).set({
        ...profile,
        grade: FieldValue.delete(),
        adviser: FieldValue.delete(),
        uid: data.uid,
        authEmail,
        active: true,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return { ok: true, uid: data.uid, accountId: student.accountId };
    }

    throw new HttpsError("invalid-argument", "Unsupported student action.");
  } catch (error) {
    throw toStudentError(error);
  }
});
