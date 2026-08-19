const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const ADMIN_EMAIL = "mikhailovna2007@gmail.com";

function studentIdToEmail(studentId) {
  const safeId = studentId.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `${safeId}@students.presence.local`;
}

async function requireAdmin(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  if (request.auth.token.email?.toLowerCase() !== ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "This account is not the authorized Presence administrator.");
  }
}

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
  if (!allowedSections.has(data.section)) {
    throw new HttpsError("invalid-argument", "Choose a valid section from 1A through 4B.");
  }
  if (data.password && data.password.length < 6) {
    throw new HttpsError("invalid-argument", "The password must contain at least 6 characters.");
  }
}

function toStudentError(error) {
  if (error instanceof HttpsError) return error;
  const code = String(error?.code || "");
  const knownErrors = {
    "auth/email-already-exists": ["already-exists", "This Student ID already has a Firebase login account."],
    "auth/invalid-email": ["invalid-argument", "Firebase could not create a login address from this Student ID."],
    "auth/invalid-password": ["invalid-argument", "Firebase requires a password containing at least 6 characters."],
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
        const indexedProfile = await firestore.doc(`students/${existingId.data().uid}`).get();
        if (indexedProfile.exists) throw new HttpsError("already-exists", "This Student ID is already registered.");
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
