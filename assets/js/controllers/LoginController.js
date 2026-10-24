import { db, studentIdToEmail, studentProvisioningAuth, studentProvisioningDb } from '../../../config/firebase-config.js';
import { ControllerScope } from '../core/ControllerScope.js';
import { AuthActionController } from './AuthActionController.js';
import { StudentIdentityController } from './StudentIdentityController.js';
import { SurveyLinkService } from './SurveyLinkService.js';
import { SurveyEntryController } from './SurveyEntryController.js';
import { RegistrationController } from './RegistrationController.js';
import { LoginSessionService } from './LoginSessionService.js';
import { clearPhoneReminders } from './PhoneAttendanceReminders.js';

/** Owns the login page lifecycle, form actions, help dialog, and login feedback. */
export class LoginController {
  constructor({ document = globalThis.document, window = globalThis.window,
    storage = globalThis.sessionStorage, sessionService = new LoginSessionService(),
    loginAction = new AuthActionController(), identity = new StudentIdentityController({ document, storage }),
    registration, surveyEntry } = {}) {
    Object.assign(this, { document, window, storage, sessionService, loginAction, identity });
    this.scope = new ControllerScope();
    this.registration = registration || new RegistrationController({ document, db,
      provisioningAuth: studentProvisioningAuth, provisioningDb: studentProvisioningDb,
      studentIdToEmail, onSuccess: (title, message) => this.showToast(title, message) });
    this.surveyEntry = surveyEntry || new SurveyEntryController({ window, auth: sessionService.auth,
      subscribe: sessionService.subscribe, isLoginBusy: () => this.loginAction.busy,
      resolveRole: user => sessionService.resolveExistingRole(user) });
  }

  initialize() {
    if (this.disposed || !this.scope.initialize()) return;
    void clearPhoneReminders().catch(() => {});
    for (const [name, selector] of Object.entries({ form: '#loginForm', accountInput: '#accountId',
      passwordInput: '#password', passwordToggle: '#passwordToggle', accountError: '#accountError',
      passwordError: '#passwordError', toast: '#toast', toastTitle: '#toastTitle',
      toastMessage: '#toastMessage', helpDialog: '#helpDialog' })) this[name] = this.document.querySelector(selector);
    this.submitButton = this.form.querySelector('.submit-button');
    this.scope.listen(this.form, 'submit', event => this.submit(event));
    this.scope.listen(this.passwordToggle, 'click', () => this.togglePassword());
    for (const [input, error] of [[this.accountInput, this.accountError], [this.passwordInput, this.passwordError]]) {
      this.scope.listen(input, 'input', () => this.setFieldError(input, error));
    }
    this.scope.listen(this.document.querySelector('#helpButton'), 'click', () => this.openHelp());
    for (const selector of ['#dialogClose', '#dialogOkay']) {
      this.scope.listen(this.document.querySelector(selector), 'click', () => this.closeHelp());
    }
    this.scope.listen(this.helpDialog, 'click', event => { if (event.target === this.helpDialog) this.closeHelp(); });
    this.scope.listen(this.document, 'keydown', event => { if (event.key === 'Escape' && !this.helpDialog.hidden) this.closeHelp(); });
    this.scope.listen(this.document.querySelector('#toastClose'), 'click', () => this.hideToast());
    this.scope.listen(this.window, 'pagehide', () => this.dispose(), { once: true });
    this.registration.initialize();
    this.surveyEntry.initialize();
  }

  setFieldError(input, errorElement, message = '') {
    input.closest('.input-wrap').classList.toggle('invalid', Boolean(message));
    input.setAttribute('aria-invalid', String(Boolean(message)));
    errorElement.textContent = message;
  }

  togglePassword() {
    const show = this.passwordInput.type === 'password';
    this.passwordInput.type = show ? 'text' : 'password';
    this.passwordToggle.setAttribute('aria-pressed', String(show));
    this.passwordToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  }

  showToast(title, message) {
    if (this.disposed) return;
    this.hideToast();
    this.toastTitle.textContent = title;
    this.toastMessage.textContent = message;
    this.toast.classList.add('show');
    this.toastTimer = this.window.setTimeout(() => this.hideToast(), 5000);
  }
  hideToast() {
    if (this.toastTimer != null) this.window.clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.toast?.classList.remove('show');
  }
  openHelp() { this.helpDialog.hidden = false; this.document.querySelector('#dialogOkay').focus(); }
  closeHelp() { this.helpDialog.hidden = true; this.document.querySelector('#helpButton').focus(); }

  async submit(event) {
    event.preventDefault();
    if (this.disposed || this.loginAction.busy) return;
    const accountId = this.accountInput.value.trim(), password = this.passwordInput.value;
    if (!accountId) this.setFieldError(this.accountInput, this.accountError, 'Please enter your student ID or admin email.');
    if (!password) this.setFieldError(this.passwordInput, this.passwordError, 'Please enter your password.');
    if (!accountId || !password) return;
    await this.loginAction.run({ buttons: [this.submitButton], label: 'Signing in…', successLabel: 'Signed in',
      action: () => this.authenticate({ accountId, password, remember: this.form.elements.remember.checked }) });
  }

  async authenticate(credentials) {
    try {
      const result = await this.sessionService.authenticate({ ...credentials,
        completeRegistration: input => this.registration.completeApprovedRegistration(input) });
      if (this.disposed) return false;
      this.storage.setItem('presenceSession', JSON.stringify(result.session));
      const role = result.session.role;
      this.showToast(role === 'admin' ? 'Admin access verified' : 'Welcome to Presence', 'Your account was verified successfully.');
      if (role === 'student') this.identity.save(result.user.uid, result.profile);
      else this.identity.clear();
      const surveyId = new SurveyLinkService({ href: this.window.location.href }).eventId();
      const destination = role === 'admin' ? 'pages/admin-dashboard.html' : 'pages/student-dashboard.html';
      this.window.location.href = destination + (surveyId ? `?survey=${encodeURIComponent(surveyId)}` : '');
    } catch (error) {
      if (!this.disposed) {
        this.setFieldError(this.passwordInput, this.passwordError, this.sessionService.errorMessage(error));
        this.passwordInput.focus();
      }
      return false;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scope.dispose();
    this.hideToast();
    this.registration.dispose();
    this.surveyEntry.dispose();
    this.loginAction.dispose();
  }
}
