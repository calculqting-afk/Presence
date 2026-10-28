import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCiHNnPQzPvGZLupVtYZ5uNNDPgdSK3m5I",
  authDomain: "presence-a873f.firebaseapp.com",
  projectId: "presence-a873f",
  storageBucket: "presence-a873f.firebasestorage.app",
  messagingSenderId: "248498873583",
  appId: "1:248498873583:web:5376740ce8cb0734ec671a",
  measurementId: "G-F3ZGMB1R3M"
};
  
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const studentProvisioningApp = initializeApp(firebaseConfig, "student-provisioning");
export const studentProvisioningAuth = getAuth(studentProvisioningApp);
// A separate Firebase app lets a new applicant authenticate and create only their
// own pending request without replacing the person currently using the login app.
export const studentProvisioningDb = getFirestore(studentProvisioningApp);
// Public account identifier, never a credential. Rules and backend services verify
// the authenticated UID independently; an email address grants no privileges.
export const SUPER_ADMIN_UID = "8uEjAk72BLWKjvnQJEatBdeVAi02";

window.addEventListener("load", () => {
  import("https://www.gstatic.com/firebasejs/12.16.0/firebase-analytics.js")
    .then(async ({ getAnalytics, isSupported }) => {
      if (await isSupported()) getAnalytics(app);
    })
    .catch(() => {});
}, { once: true });

export function studentIdToEmail(studentId) {
  const safeId = studentId.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `${safeId}@students.presence.local`;
}
