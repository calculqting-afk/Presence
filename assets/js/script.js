import { SUPER_ADMIN_EMAIL, auth, db, studentIdToEmail } from "../../config/firebase-config.js";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { AuthActionController } from './controllers/AuthActionController.js';
import { SurveyLinkService } from './controllers/SurveyLinkService.js';
import { SurveyEntryController } from './controllers/SurveyEntryController.js';

const form = document.querySelector("#loginForm");
const accountInput = document.querySelector("#accountId");
const passwordInput = document.querySelector("#password");
const passwordToggle = document.querySelector("#passwordToggle");
const accountError = document.querySelector("#accountError");
const passwordError = document.querySelector("#passwordError");
const submitButton = form.querySelector(".submit-button");
const toast = document.querySelector("#toast");
const toastTitle = document.querySelector("#toastTitle");
const toastMessage = document.querySelector("#toastMessage");
const helpDialog = document.querySelector("#helpDialog");
let toastTimer;
const loginAction = new AuthActionController();
window.addEventListener('pagehide', () => loginAction.dispose(), { once: true });
const surveyEntry = new SurveyEntryController({ auth, subscribe: onAuthStateChanged, isLoginBusy: () => loginAction.busy,
  resolveRole: async user => {
    if (user.email?.toLowerCase() === SUPER_ADMIN_EMAIL) return 'admin';
    const snapshot = await getDoc(doc(db, 'students', user.uid));
    const profile = snapshot.data();
    if (!snapshot.exists() || profile.active !== true) return null;
    return ['head_admin', 'attendance_admin', 'student_manager'].includes(profile.role) ? 'admin' : 'student';
  } });
surveyEntry.initialize();
window.addEventListener('pagehide', () => surveyEntry.dispose(), { once: true });

function setFieldError(input, errorElement, message = "") {
  input.closest(".input-wrap").classList.toggle("invalid", Boolean(message));
  input.setAttribute("aria-invalid", Boolean(message).toString());
  errorElement.textContent = message;
}

function showToast(title, message) {
  clearTimeout(toastTimer);
  toastTitle.textContent = title;
  toastMessage.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 5000);
}

passwordToggle.addEventListener("click", () => {
  const shouldShow = passwordInput.type === "password";
  passwordInput.type = shouldShow ? "text" : "password";
  passwordToggle.setAttribute("aria-pressed", shouldShow.toString());
  passwordToggle.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
});

[accountInput, passwordInput].forEach((input) => {
  input.addEventListener("input", () => setFieldError(input, input === accountInput ? accountError : passwordError));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (loginAction.busy) return;
  const accountId = accountInput.value.trim();
  const password = passwordInput.value;
  if (!accountId) setFieldError(accountInput, accountError, "Please enter your student ID or admin email.");
  if (!password) setFieldError(passwordInput, passwordError, "Please enter your password.");
  if (!accountId || !password) return;

  await loginAction.run({ buttons: [submitButton], label: 'Signing in…', successLabel: 'Signed in', action: async () => {
      try {
        const remember = form.elements.remember.checked;
        await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
        const email = accountId.includes("@") ? accountId : studentIdToEmail(accountId);
        const credential = await signInWithEmailAndPassword(auth, email, password);
        const isSuperAdmin = credential.user.email?.toLowerCase() === SUPER_ADMIN_EMAIL;
        let role;
        let studentRecord;
        if (!isSuperAdmin) {
          studentRecord = await getDoc(doc(db, "students", credential.user.uid));
          const storedRole = studentRecord.data()?.role || "student";
          const assignedRole = storedRole === "viewer" ? "student" : storedRole;
          if (["head_admin", "attendance_admin", "student_manager"].includes(assignedRole)) {
            role = "admin";
          } else if (studentRecord.exists() && studentRecord.data().active === true) {
            role = "student";
          } else {
            await signOut(auth);
            throw new Error("This account is not a registered student.");
          }
        } else {
          role = "admin";
        }

        sessionStorage.setItem("presenceSession", JSON.stringify({
          role,
          uid: credential.user.uid,
          accountId: role === "student" ? studentRecord.data().accountId : credential.user.email,
          assignedRole: isSuperAdmin ? "super_admin" : (studentRecord?.data()?.role === "viewer" ? "student" : studentRecord?.data()?.role || "student")
        }));
        showToast(role === "admin" ? "Admin access verified" : "Welcome to Presence", "Your account was verified successfully.");
        window.setTimeout(() => {
          const surveyId = new SurveyLinkService({ href: window.location.href }).eventId();
          const destination = role === "admin" ? "pages/admin-dashboard.html" : "pages/student-dashboard.html";
          window.location.href = destination + (surveyId ? `?survey=${encodeURIComponent(surveyId)}` : '');
        }, 450);
      } catch (error) {
        const permissionDenied = error.code === "permission-denied"
          || error.code === "firestore/permission-denied"
          || error.message?.toLowerCase().includes("insufficient permissions");
        const message = error.code === "auth/invalid-credential"
          ? "The account or password is incorrect."
          : error.code === "auth/too-many-requests"
            ? "Too many attempts. Please wait and try again."
            : permissionDenied
              ? "Password accepted, but the latest Firestore rules have not been published yet."
              : error.message || "Unable to sign in right now.";
        setFieldError(passwordInput, passwordError, message);
        passwordInput.focus();
        return false;
      }
  } });
});

function openHelpDialog() {
  helpDialog.hidden = false;
  document.querySelector("#dialogOkay").focus();
}
function closeHelpDialog() {
  helpDialog.hidden = true;
  document.querySelector("#helpButton").focus();
}

document.querySelector("#helpButton").addEventListener("click", openHelpDialog);
document.querySelector("#dialogClose").addEventListener("click", closeHelpDialog);
document.querySelector("#dialogOkay").addEventListener("click", closeHelpDialog);
document.querySelector("#toastClose").addEventListener("click", () => toast.classList.remove("show"));
helpDialog.addEventListener("click", (event) => { if (event.target === helpDialog) closeHelpDialog(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !helpDialog.hidden) closeHelpDialog(); });
