import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

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
export const db = getFirestore(app);
const studentProvisioningApp = initializeApp(firebaseConfig, "student-provisioning");
export const studentProvisioningAuth = getAuth(studentProvisioningApp);
export const ADMIN_EMAIL = "mikhailovna2007@gmail.com";

isSupported().then((supported) => {
  if (supported) getAnalytics(app);
}).catch(() => {});

export function studentIdToEmail(studentId) {
  const safeId = studentId.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `${safeId}@students.presence.local`;
}
