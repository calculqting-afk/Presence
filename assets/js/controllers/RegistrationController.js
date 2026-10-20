import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { CoursePolicy } from '../core/CoursePolicy.js';

export class RegistrationController {
  constructor({ document = globalThis.document, db, provisioningAuth, provisioningDb, studentIdToEmail, onSuccess = () => {} } = {}) {
    this.document = document;
    this.db = db;
    this.provisioningAuth = provisioningAuth;
    this.provisioningDb = provisioningDb;
    this.studentIdToEmail = studentIdToEmail;
    this.onSuccess = onSuccess;
    this.bound = false;
  }

  initialize() {
    if (this.bound) return;
    this.bound = true;
    this.abort = new AbortController();
    this.registrationDialog = this.document.querySelector('#registrationDialog');
    this.statusDialog = this.document.querySelector('#registrationStatusDialog');
    this.registrationForm = this.document.querySelector('#registrationForm');
    this.statusForm = this.document.querySelector('#registrationStatusForm');
    this.registrationError = this.document.querySelector('#registrationError');
    this.statusError = this.document.querySelector('#registrationStatusError');
    this.statusResult = this.document.querySelector('#registrationStatusResult');
    this.listen(this.document.querySelector('#openRegistration'), 'click', () => this.open(this.registrationDialog));
    this.listen(this.document.querySelector('#openRegistrationStatus'), 'click', () => this.open(this.statusDialog));
    this.document.querySelectorAll('[data-close-registration]').forEach(button => this.listen(button, 'click', () => this.close(this.registrationDialog)));
    this.document.querySelectorAll('[data-close-registration-status]').forEach(button => this.listen(button, 'click', () => this.close(this.statusDialog)));
    this.listen(this.registrationDialog, 'click', event => { if (event.target === this.registrationDialog) this.close(this.registrationDialog); });
    this.listen(this.statusDialog, 'click', event => { if (event.target === this.statusDialog) this.close(this.statusDialog); });
    this.listen(this.registrationForm, 'submit', event => this.submitRegistration(event));
    this.listen(this.statusForm, 'submit', event => this.submitStatus(event));
  }

  listen(target, type, handler) { target?.addEventListener(type, handler, { signal: this.abort.signal }); }
  dispose() { this.abort?.abort(); this.closeTimers?.forEach(timer => this.document.defaultView?.clearTimeout(timer)); this.bound = false; }

  open(dialog) {
    this.closeTimers ||= new Map();
    this.document.defaultView?.clearTimeout(this.closeTimers.get(dialog));
    dialog.classList.remove('is-closing');
    dialog.hidden = false;
    this.document.defaultView?.requestAnimationFrame(() => dialog.classList.add('is-open'));
    dialog.querySelector('input')?.focus();
  }
  close(dialog) {
    if (!dialog || dialog.hidden) return;
    this.closeTimers ||= new Map();
    dialog.classList.remove('is-open');
    dialog.classList.add('is-closing');
    const complete = () => { dialog.hidden = true; dialog.classList.remove('is-closing'); };
    this.document.defaultView?.clearTimeout(this.closeTimers.get(dialog));
    this.closeTimers.set(dialog, this.document.defaultView?.setTimeout(complete, 180));
  }
  setBusy(form, busy, label) {
    const button = form.querySelector('[type="submit"]');
    button.disabled = busy;
    button.textContent = busy ? label : button.dataset.defaultLabel;
  }
  message(error) { return String(error?.message || 'Unable to complete this request.').replace(/^.*?:\s*/, ''); }
  statusErrorMessage(error) {
    const code = String(error?.code || '');
    if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-email'].includes(code)) {
      return 'No account matches that Student ID and password. Check your details or register for an account.';
    }
    return this.message(error);
  }
  accountIdKey(value) { return String(value || '').trim().toLowerCase(); }

  registrationValidationMessage(values) {
    const required = ['accountId', 'birthday', 'firstName', 'lastName', 'course', 'section', 'password', 'confirmPassword'];
    if (required.some(name => !String(values[name] ?? '').trim())) {
      return 'Fill all the fields first before proceeding';
    }
    if (values.password !== values.confirmPassword) return 'Passwords do not match.';
    if (String(values.password).length < 8) return 'Use a password with at least 8 characters.';
    return '';
  }

  async submitRegistration(event) {
    event.preventDefault();
    const form = this.registrationForm;
    const values = Object.fromEntries(new FormData(form));
    this.registrationError.textContent = this.registrationValidationMessage(values);
    if (this.registrationError.textContent) return;
    const submit = form.querySelector('[type="submit"]'); submit.dataset.defaultLabel ||= submit.textContent;
    this.setBusy(form, true, 'Sending…');
    try {
      const accountIdKey = this.accountIdKey(values.accountId);
      let credential;
      try {
        credential = await createUserWithEmailAndPassword(this.provisioningAuth, this.studentIdToEmail(values.accountId), values.password);
      } catch (error) {
        if (error.code !== 'auth/email-already-in-use') throw error;
        credential = await signInWithEmailAndPassword(this.provisioningAuth, this.studentIdToEmail(values.accountId), values.password);
        try {
          const previous = await getDoc(doc(this.provisioningDb, 'registrationRequests', accountIdKey));
          if (!previous.exists() || previous.data().uid !== credential.user.uid || previous.data().status !== 'declined') {
            throw new Error('This Student ID already has an account or a pending registration request.');
          }
          await updateDoc(doc(this.provisioningDb, 'registrationRequests', accountIdKey), {
            birthday: values.birthday, firstName: values.firstName.trim(), lastName: values.lastName.trim(),
            course: CoursePolicy.normalize(values.course), section: values.section, status: 'pending', updatedAt: serverTimestamp()
          });
          form.reset(); this.close(this.registrationDialog);
          this.onSuccess('Registration resubmitted', 'Your request is pending administrator approval again.');
          return;
        } finally { await signOut(this.provisioningAuth); }
      }
      try {
        await setDoc(doc(this.provisioningDb, 'registrationRequests', accountIdKey), {
          uid: credential.user.uid, accountId: values.accountId.trim(), accountIdKey,
          birthday: values.birthday, firstName: values.firstName.trim(), lastName: values.lastName.trim(),
          course: CoursePolicy.normalize(values.course), section: values.section, status: 'pending',
          requestedAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
      } finally { await signOut(this.provisioningAuth); }
      form.reset(); this.close(this.registrationDialog);
      this.onSuccess('Registration submitted', 'Your account is waiting for administrator approval. Use the same Student ID and password after approval.');
    } catch (error) { this.registrationError.textContent = this.message(error); }
    finally { this.setBusy(form, false); }
  }

  async submitStatus(event) {
    event.preventDefault();
    const form = this.statusForm;
    this.statusError.textContent = ''; this.statusResult.hidden = true;
    const submit = form.querySelector('[type="submit"]'); submit.dataset.defaultLabel ||= submit.textContent;
    this.setBusy(form, true, 'Checking…');
    try {
      const values = Object.fromEntries(new FormData(form));
      const credential = await signInWithEmailAndPassword(this.provisioningAuth, this.studentIdToEmail(values.accountId), values.password);
      const accountIdKey = this.accountIdKey(values.accountId);
      let status;
      try {
        const student = await getDoc(doc(this.provisioningDb, 'students', credential.user.uid));
        if (student.exists() && student.data().birthday === values.birthday) {
          status = 'existing-account';
        } else {
          const request = await getDoc(doc(this.provisioningDb, 'registrationRequests', accountIdKey));
          status = request.exists() && request.data().uid === credential.user.uid && request.data().birthday === values.birthday
            ? request.data().status : 'not-found';
        }
      } finally { await signOut(this.provisioningAuth); }
      const text = { pending: 'Pending approval — an administrator still needs to review your request.', approved: 'Approved — you can now sign in using your Student ID and password.', 'existing-account': 'This account is already active. Close this window and sign in using your Student ID and password.', declined: 'Not approved — please contact your school administrator.', 'not-found': 'No matching registration request was found.' }[status] || 'No matching registration request was found.';
      this.statusResult.textContent = text; this.statusResult.hidden = false;
    } catch (error) { this.statusError.textContent = this.statusErrorMessage(error); }
    finally { this.setBusy(form, false); }
  }

  async completeApprovedRegistration({ user, accountId }) {
    const accountIdKey = this.accountIdKey(accountId);
    const request = await getDoc(doc(this.db, 'registrationRequests', accountIdKey));
    if (!request.exists() || request.data().uid !== user.uid) return null;
    const data = request.data();
    if (data.status === 'pending') throw new Error('Your registration is waiting for administrator approval.');
    if (data.status === 'declined') throw new Error('Your registration was not approved. Please contact your school administrator.');
    if (data.status !== 'approved') throw new Error('Your registration status could not be verified.');
    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'students', user.uid), {
      uid: user.uid, accountId: data.accountId, accountIdKey, authEmail: this.studentIdToEmail(data.accountId),
      birthday: data.birthday, firstName: data.firstName, lastName: data.lastName, middleName: '',
      course: CoursePolicy.normalize(data.course), section: data.section, role: 'student', active: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    batch.set(doc(this.db, 'studentIds', accountIdKey), { studentId: data.accountId, uid: user.uid, createdAt: serverTimestamp() });
    await batch.commit();
    return { ...data, uid: user.uid, active: true, role: 'student' };
  }
}
