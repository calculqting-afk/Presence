/*
 * Local-only recovery tool for a trusted school administrator.
 * Do not expose this script or a service-account key through the website.
 */
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = "presence-a873f";

function normalizeStudentId(studentId) {
  return studentId.trim().toLowerCase();
}

function studentIdToEmail(studentId) {
  return `${normalizeStudentId(studentId).replace(/[^a-z0-9._-]/g, "-")}@students.presence.local`;
}

function loadServiceAccount() {
  const keyLocation = process.env.PRESENCE_SERVICE_ACCOUNT_KEY;
  if (!keyLocation) throw new Error("Set PRESENCE_SERVICE_ACCOUNT_KEY to the full path of the private service-account JSON file.");
  const keyPath = path.resolve(keyLocation);
  if (!fs.existsSync(keyPath)) throw new Error(`Service-account file not found: ${keyPath}`);
  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  if (serviceAccount.project_id !== PROJECT_ID) {
    throw new Error(`This key belongs to ${serviceAccount.project_id || "an unknown project"}, not ${PROJECT_ID}.`);
  }
  return serviceAccount;
}

function isValidTemporaryPassword(value) {
  return /^[0-9]{6,8}$/.test(value);
}

async function main() {
  const serviceAccount = loadServiceAccount();
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });

  const prompt = readline.createInterface({ input, output });
  try {
    console.log("\nPresence local student password recovery\n");
    const administratorEmail = (await prompt.question("Administrator email: ")).trim().toLowerCase();
    const studentId = (await prompt.question("Student ID: ")).trim();
    if (!administratorEmail || !studentId) throw new Error("Administrator email and Student ID are required.");

    const firebaseAuth = getAuth();
    const firestore = getFirestore();
    const studentIdSnapshot = await firestore.doc(`studentIds/${normalizeStudentId(studentId)}`).get();
    let indexedUid = studentIdSnapshot.data()?.uid;
    if (typeof indexedUid !== "string" || !indexedUid) {
      const profileMatches = await firestore.collection("students").where("accountIdKey", "==", normalizeStudentId(studentId)).limit(2).get();
      if (profileMatches.size > 1) throw new Error("More than one student profile matches that Student ID. Stop and review the records.");
      if (profileMatches.size === 1) {
        indexedUid = profileMatches.docs[0].id;
      } else {
        const legacyMatches = await firestore.collection("students").where("accountId", "==", studentId).limit(2).get();
        if (legacyMatches.size > 1) throw new Error("More than one student profile matches that Student ID. Stop and review the records.");
        if (legacyMatches.size === 1) indexedUid = legacyMatches.docs[0].id;
      }
    }
    if (typeof indexedUid !== "string" || !indexedUid) {
      throw new Error("No student profile was found for that Student ID. Check the exact ID and try again.");
    }
    const studentReference = firestore.doc(`students/${indexedUid}`);
    const studentSnapshot = await studentReference.get();
    if (!studentSnapshot.exists || studentSnapshot.data().active === false) throw new Error("No active student profile was found for that Student ID.");
    const student = studentSnapshot.data();
    if (String(student.accountId || "").trim().toLowerCase() !== studentId.toLowerCase()) {
      throw new Error("The Authentication account and student profile do not match. Stop and review the record.");
    }
    let user;
    let authenticationAccountMissing = false;
    try {
      user = await firebaseAuth.getUser(indexedUid);
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        authenticationAccountMissing = true;
      } else {
        throw error;
      }
    }

    const fullName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") || "Unnamed student";
    console.log(`\nSelected student: ${fullName}`);
    console.log(`Student ID: ${student.accountId}\n`);
    if (authenticationAccountMissing) {
      console.log("Warning: this student's Firebase Authentication account is missing.");
      console.log("The tool will restore it with the same UID and Student ID login after you verify the student.\n");
    }
    const identityConfirmation = (await prompt.question("Did you verify the student's school ID? Type VERIFY to continue: ")).trim();
    if (identityConfirmation !== "VERIFY") throw new Error("Identity verification was not confirmed. No password was changed.");

    const temporaryPassword = await prompt.question("New temporary password (6-8 digits): ");
    const passwordConfirmation = await prompt.question("Confirm temporary password: ");
    if (!isValidTemporaryPassword(temporaryPassword)) throw new Error("Temporary passwords must contain 6 to 8 digits.");
    if (temporaryPassword !== passwordConfirmation) throw new Error("The temporary passwords do not match.");

    const finalAction = authenticationAccountMissing ? "RESTORE" : "RESET";
    const finalConfirmation = (await prompt.question(`Type ${finalAction} ${student.accountId} to ${authenticationAccountMissing ? "restore this account" : "replace this student's password"}: `)).trim();
    if (finalConfirmation !== `${finalAction} ${student.accountId}`) throw new Error("Final confirmation did not match. No account was changed.");

    if (authenticationAccountMissing) {
      user = await firebaseAuth.createUser({
        uid: indexedUid,
        email: studentIdToEmail(student.accountId),
        password: temporaryPassword,
        displayName: fullName,
        disabled: false
      });
    } else {
      await firebaseAuth.updateUser(user.uid, { password: temporaryPassword });
      await firebaseAuth.revokeRefreshTokens(user.uid);
    }
    await studentReference.set({ mustChangePassword: true }, { merge: true });
    try {
      await firestore.collection("auditLogs").add({
        action: authenticationAccountMissing ? "student_auth_account_restored_locally" : "student_password_recovered_locally",
        actorEmail: administratorEmail,
        targetUid: user.uid,
        targetAccountId: student.accountId,
        identityVerification: "school_id",
        createdAt: FieldValue.serverTimestamp()
      });
    } catch (auditError) {
      console.warn(`Audit log could not be written after the password reset: ${auditError.message}`);
    }

    const completion = authenticationAccountMissing ? "Account restored" : "Password reset";
    console.log(`\n${completion} for ${student.accountId}. Give the temporary password to the student privately.`);
    console.log("The password was not saved in Firestore or the audit log.\n");
  } finally {
    prompt.close();
  }
}

main().catch((error) => {
  console.error(`\nPassword recovery stopped: ${error.message}`);
  process.exitCode = 1;
});
