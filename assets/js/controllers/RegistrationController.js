import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { CoursePolicy } from '../core/CoursePolicy.js';
import { GenderPolicy } from '../core/GenderPolicy.js';

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
    this.wizard = new RegistrationWizard({ form: this.registrationForm, error: this.registrationError,
      listen: (target, type, handler) => this.listen(target, type, handler), isBusy: () => this.registrationBusy });
    this.wizard.initialize();
    this.listen(this.document.querySelector('#openRegistration'), 'click', () => this.open(this.registrationDialog));
    this.listen(this.document.querySelector('#openRegistrationStatus'), 'click', () => this.open(this.statusDialog));
    this.document.querySelectorAll('[data-close-registration]').forEach(button => this.listen(button, 'click', () => this.close(this.registrationDialog)));
    this.document.querySelectorAll('[data-close-registration-status]').forEach(button => this.listen(button, 'click', () => this.close(this.statusDialog)));
    this.listen(this.registrationDialog, 'click', event => { if (event.target === this.registrationDialog) this.close(this.registrationDialog); });
    this.listen(this.registrationDialog, 'keydown', event => this.registrationKeydown(event));
    this.listen(this.statusDialog, 'click', event => { if (event.target === this.statusDialog) this.close(this.statusDialog); });
    this.listen(this.registrationForm, 'submit', event => this.submitRegistration(event));
    this.listen(this.statusForm, 'submit', event => this.submitStatus(event));
  }

  listen(target, type, handler) { target?.addEventListener(type, handler, { signal: this.abort.signal }); }
  dispose() { this.abort?.abort(); this.wizard?.clearPasswords(); this.closeTimers?.forEach(timer => this.document.defaultView?.clearTimeout(timer)); this.bound = false; }

  open(dialog) {
    if (this.registrationBusy) return;
    if (dialog === this.registrationDialog) this.wizard?.reset();
    this.closeTimers ||= new Map();
    this.document.defaultView?.clearTimeout(this.closeTimers.get(dialog));
    dialog.classList.remove('is-closing');
    dialog.hidden = false;
    this.document.defaultView?.requestAnimationFrame(() => dialog.classList.add('is-open'));
    dialog.querySelector('input')?.focus();
  }
  close(dialog, force = false) {
    if (!dialog || dialog.hidden) return;
    if (dialog === this.registrationDialog && this.registrationBusy && !force) return;
    if (dialog === this.registrationDialog) this.wizard?.clearPasswords();
    this.closeTimers ||= new Map();
    dialog.classList.remove('is-open');
    dialog.classList.add('is-closing');
    const complete = () => {
      dialog.hidden = true; dialog.classList.remove('is-closing');
      this.document.querySelector(dialog === this.registrationDialog ? '#openRegistration' : '#openRegistrationStatus')?.focus();
    };
    this.document.defaultView?.clearTimeout(this.closeTimers.get(dialog));
    this.closeTimers.set(dialog, this.document.defaultView?.setTimeout(complete, 180));
  }
  setBusy(form, busy, label) {
    const button = form.querySelector('[type="submit"]');
    button.disabled = busy;
    button.textContent = busy ? label : button.dataset.defaultLabel;
  }
  registrationKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); this.close(this.registrationDialog); return; }
    if (event.key !== 'Tab') return;
    const controls = [...this.registrationDialog.querySelectorAll('button, input, select, [tabindex]')].filter(node => !node.disabled && node.tabIndex !== -1 && !node.closest('[hidden]'));
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && this.document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && this.document.activeElement === last) { event.preventDefault(); first.focus(); }
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
    if (!GenderPolicy.valid(values.gender)) return 'Choose Male, Female, or Not specified for gender.';
    if (String(values.password).length < 8) return 'Use a password with at least 8 characters.';
    return '';
  }

  async submitRegistration(event) {
    event.preventDefault();
    if (this.registrationBusy) return;
    if (this.wizard?.active && this.wizard.step < 2) { this.wizard.next(); return; }
    if (this.wizard?.active && !this.wizard.validateAll()) return;
    const form = this.registrationForm;
    const values = Object.fromEntries(new FormData(form));
    this.registrationError.textContent = this.registrationValidationMessage(values);
    if (this.registrationError.textContent) return;
    const submit = form.querySelector('[type="submit"]'); submit.dataset.defaultLabel ||= submit.textContent;
    this.registrationBusy = true;
    this.wizard?.setBusy(true);
    this.registrationDialog?.querySelectorAll('[data-close-registration]').forEach(button => { button.disabled = true; });
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
            birthday: values.birthday, firstName: values.firstName.trim(), lastName: values.lastName.trim(), gender: GenderPolicy.normalize(values.gender),
            course: CoursePolicy.normalize(values.course), section: values.section, status: 'pending', updatedAt: serverTimestamp()
          });
          form.reset(); this.wizard?.complete(); this.close(this.registrationDialog, true);
          this.onSuccess('Registration resubmitted', 'Your request is pending administrator approval again.');
          return;
        } finally { await signOut(this.provisioningAuth); }
      }
      try {
        await setDoc(doc(this.provisioningDb, 'registrationRequests', accountIdKey), {
          uid: credential.user.uid, accountId: values.accountId.trim(), accountIdKey,
          birthday: values.birthday, firstName: values.firstName.trim(), lastName: values.lastName.trim(), gender: GenderPolicy.normalize(values.gender),
          course: CoursePolicy.normalize(values.course), section: values.section, status: 'pending',
          requestedAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
      } finally { await signOut(this.provisioningAuth); }
      form.reset(); this.wizard?.complete(); this.close(this.registrationDialog, true);
      this.onSuccess('Registration submitted', 'Your account is waiting for administrator approval. Use the same Student ID and password after approval.');
    } catch (error) { this.registrationError.textContent = this.message(error); }
    finally {
      this.registrationBusy = false; this.wizard?.setBusy(false);
      this.registrationDialog?.querySelectorAll('[data-close-registration]').forEach(button => { button.disabled = false; });
      this.setBusy(form, false);
    }
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
      birthday: data.birthday, firstName: data.firstName, lastName: data.lastName, middleName: '', gender: GenderPolicy.normalize(data.gender),
      course: CoursePolicy.normalize(data.course), section: data.section, role: 'student', active: true,
      mustChangePassword: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    batch.set(doc(this.db, 'studentIds', accountIdKey), { studentId: data.accountId, uid: user.uid, createdAt: serverTimestamp() });
    await batch.commit();
    return { ...data, uid: user.uid, active: true, role: 'student', mustChangePassword: true };
  }
}

export class RegistrationWizard {
  constructor({ form, error, listen, isBusy = () => false }) { Object.assign(this, { form, error, listen, isBusy }); this.step = 0; }
  initialize() {
    this.panels = [...(this.form?.querySelectorAll?.('[data-registration-step]') || [])];
    this.active = this.panels.length === 3;
    if (!this.active) return;
    this.indicators = [...this.form.querySelectorAll('[data-registration-indicator]')];
    this.nextButton = this.form.querySelector('[data-registration-next]');
    this.backButton = this.form.querySelector('[data-registration-back]');
    this.submitButton = this.form.querySelector('[type="submit"]');
    this.status = this.form.querySelector('[data-registration-step-status]');
    this.listen(this.nextButton, 'click', () => this.next());
    this.listen(this.backButton, 'click', () => { if (!this.isBusy()) this.showStep(this.step - 1); });
    this.listen(this.form, 'input', event => { event.target.setCustomValidity?.(''); this.error.textContent = ''; if (this.step === 2) this.updateReview(); });
    const birthday = this.form.elements.namedItem('birthday'), today = new Date();
    birthday.max = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    this.showStep(0, false);
  }
  controls(index) { return [...this.panels[index].querySelectorAll('input, select')]; }
  invalidControl(index) {
    const controls = this.controls(index);
    for (const field of controls) {
      field.setCustomValidity('');
      if (field.required && !String(field.value || '').trim()) field.setCustomValidity('Please fill out this field.');
    }
    if (index === 2) {
      const password = this.form.elements.namedItem('password'), confirm = this.form.elements.namedItem('confirmPassword');
      if (password.value !== confirm.value) confirm.setCustomValidity('Passwords do not match.');
    }
    return controls.find(field => !field.checkValidity());
  }
  validate(index) {
    const invalid = this.invalidControl(index);
    if (!invalid) { this.error.textContent = ''; return true; }
    this.showStep(index, false);
    this.error.textContent = invalid.validationMessage || 'Check the highlighted field before proceeding.';
    invalid.focus(); invalid.reportValidity();
    return false;
  }
  validateAll() { for (let index = 0; index < this.panels.length; index++) if (!this.validate(index)) return false; return true; }
  next() { if (!this.isBusy() && this.step < 2 && this.validate(this.step)) this.showStep(this.step + 1); }
  showStep(index, focus = true) {
    this.step = Math.max(0, Math.min(2, index));
    this.error.textContent = '';
    this.panels.forEach((panel, i) => { panel.hidden = i !== this.step; });
    this.indicators.forEach((indicator, i) => {
      indicator.classList.toggle('is-current', i === this.step);
      indicator.classList.toggle('is-complete', i < this.step);
      if (i === this.step) indicator.setAttribute('aria-current', 'step'); else indicator.removeAttribute('aria-current');
    });
    this.backButton.hidden = this.step === 0; this.nextButton.hidden = this.step === 2; this.submitButton.hidden = this.step !== 2;
    this.status.textContent = `Step ${this.step + 1} of 3: ${['Personal details', 'School details', 'Account security'][this.step]}`;
    if (this.step === 2) this.updateReview();
    if (focus) this.controls(this.step)[0]?.focus();
  }
  updateReview() {
    this.form.querySelectorAll('[data-registration-review]').forEach(node => {
      const value = this.form.elements.namedItem(node.dataset.registrationReview)?.value;
      node.textContent = node.dataset.registrationReview === 'gender' ? GenderPolicy.label(value) : String(value || '').trim();
    });
  }
  setBusy(busy) {
    if (!this.active) return;
    this.panels.forEach(panel => { panel.disabled = busy; });
    this.nextButton.disabled = this.backButton.disabled = busy;
  }
  clearPasswords() { for (const name of ['password', 'confirmPassword']) { const field = this.form?.elements?.namedItem?.(name); if (field) field.value = ''; } }
  reset() { if (!this.active) return; this.clearPasswords(); this.setBusy(false); this.showStep(0, false); }
  complete() {
    if (!this.active) return;
    this.indicators.forEach(indicator => { indicator.classList.remove('is-current'); indicator.classList.add('is-complete'); indicator.removeAttribute('aria-current'); });
    this.status.textContent = 'Request submitted — awaiting administrator approval.';
  }
}
