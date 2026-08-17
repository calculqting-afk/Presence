import { ADMIN_EMAIL, auth, db, studentIdToEmail } from "./firebase-config.js";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

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

function setLoading(loading) {
  submitButton.classList.toggle("loading", loading);
  submitButton.disabled = loading;
  submitButton.querySelector("span:first-child").textContent = loading ? "Checking account" : "Continue";
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
  const accountId = accountInput.value.trim();
  const password = passwordInput.value;
  if (!accountId) setFieldError(accountInput, accountError, "Please enter your student ID or admin email.");
  if (!password) setFieldError(passwordInput, passwordError, "Please enter your password.");
  if (!accountId || !password) return;

  setLoading(true);
  try {
    const remember = form.elements.remember.checked;
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    const email = accountId.includes("@") ? accountId : studentIdToEmail(accountId);
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const isAdminEmail = credential.user.email?.toLowerCase() === ADMIN_EMAIL;
    let role;
    let studentRecord;
    if (isAdminEmail) {
      role = "admin";
    } else {
      studentRecord = await getDoc(doc(db, "students", credential.user.uid));
      if (studentRecord.exists() && studentRecord.data().active === true) {
        role = "student";
      } else {
        await signOut(auth);
        throw new Error("This account is not a registered student.");
      }
    }

    sessionStorage.setItem("presenceSession", JSON.stringify({
      role,
      uid: credential.user.uid,
      accountId: role === "student" ? studentRecord.data().accountId : credential.user.email
    }));
    showToast(role === "admin" ? "Admin access verified" : "Welcome to Presence", "Your account was verified successfully.");
    window.setTimeout(() => {
      window.location.href = role === "admin" ? "admin-dashboard.html" : "student-dashboard.html";
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
    setLoading(false);
  }
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
