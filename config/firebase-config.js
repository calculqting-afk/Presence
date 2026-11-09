import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore, clearIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCiHNnPQzPvGZLupVtYZ5uNNDPgdSK3m5I",
  authDomain: "presence-a873f.firebaseapp.com",
  projectId: "presence-a873f",
  storageBucket: "presence-a873f.firebasestorage.app",
  messagingSenderId: "248498873583",
  appId: "1:248498873583:web:5376740ce8cb0734ec671a",
  measurementId: "G-F3ZGMB1R3M"
};
  
// Query-string aliases are separate ES modules, but must share one SDK runtime.
// Store it before the first await so concurrent imports cannot initialize twice.
const runtimeKey = Symbol.for('presence.firebase.runtime');
const runtime = globalThis[runtimeKey] ||= {};
export const app = runtime.app ||= initializeApp(firebaseConfig);
export const auth = runtime.auth ||= getAuth(app);
// The Web SDK defaults to memory-only cache. getFirestore also safely reuses an
// instance started by an older cached module instead of reapplying its settings.
export const db = runtime.db ||= getFirestore(app);
// Remove data left by earlier versions before starting this Firestore instance.
// An older tab may hold IndexedDB open; new sessions still use memory only.
export const legacyCacheCleared = (runtime.legacyCacheCleared ||= clearIndexedDbPersistence(db).then(() => true).catch(() => {
  console.warn('Close older Presence tabs and reload to finish clearing the previous offline cache.');
  return false;
}));
const studentProvisioningApp = runtime.studentProvisioningApp ||= initializeApp(firebaseConfig, "student-provisioning");
export const studentProvisioningAuth = runtime.studentProvisioningAuth ||= getAuth(studentProvisioningApp);
// A separate Firebase app lets a new applicant authenticate and create only their
// own pending request without replacing the person currently using the login app.
export const studentProvisioningDb = runtime.studentProvisioningDb ||= getFirestore(studentProvisioningApp);
// Super Admin routing uses server-issued Firebase custom claims.

if (!runtime.analyticsScheduled) {
  runtime.analyticsScheduled = true;
  window.addEventListener("load", () => {
    import("https://www.gstatic.com/firebasejs/12.16.0/firebase-analytics.js")
      .then(async ({ getAnalytics, isSupported }) => {
        if (await isSupported()) getAnalytics(app);
      })
      .catch(() => {});
  }, { once: true });
}

export function studentIdToEmail(studentId) {
  const safeId = studentId.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `${safeId}@students.presence.local`;
}
