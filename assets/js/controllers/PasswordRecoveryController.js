// Recovery retries sign-in only. Passwords remain in the caller's memory and
// are never persisted; dispose releases the retry callback on logout/unload.
export class PasswordRecoveryController {
  constructor({ document, window = globalThis.window, notify, now = () => Date.now() }) {
    Object.assign(this, { document, window, notify, now });
    this.button = document.querySelector('#retryRequiredPasswordSignIn');
    this.button.onclick = () => void this.retry();
  }
  enter({ saved, retry, error }) {
    this.active = true; this.saved = saved; this.restore = retry;
    this.document.querySelector('#requiredPasswordChangeTitle').textContent = saved ? 'Password changed successfully' : 'Password change status unconfirmed';
    this.document.querySelector('#requiredPasswordChangeMessage').textContent = saved
      ? 'Your new password is saved. Finish signing in with that same password; you do not need to create another one.'
      : 'Your chosen password may already be active. Try signing in with it before attempting another password change.';
    this.document.querySelector('#requiredPasswordFields').hidden = true;
    for (const id of ['#requiredNewPassword', '#requiredConfirmPassword']) this.document.querySelector(id).disabled = true;
    const save = this.document.querySelector('#completeRequiredPasswordChange'); save.disabled = true; save.hidden = true;
    this.document.querySelector('#requiredPasswordRecovery').hidden = false;
    this.document.querySelector('#requiredPasswordSignOut').textContent = 'Return to login';
    this.failed(error);
  }
  failed(error) {
    if (error?.code === 'auth/too-many-requests') this.retryAt = this.now() + 60000;
    const throttled = this.now() < (this.retryAt || 0);
    const message = throttled
      ? 'Sign-in is temporarily limited. Wait before retrying. Firebase controls when access resumes; the one-minute pause does not guarantee it has cleared.'
      : this.saved ? 'Password changed. Sign in with the new password to continue. Retry sign-in here or return to login.'
        : 'The save could not be confirmed. Retry sign-in with the password you chose, or return to login. Do not choose another password yet.';
    this.document.querySelector('#requiredPasswordRecoveryStatus').textContent = message;
    this.notify(this.saved ? 'Password changed' : 'Password change unconfirmed', message);
    this.button.hidden = false; this.button.disabled = throttled; this.button.textContent = throttled ? 'Wait before retrying' : 'Retry sign-in';
    this.window.clearTimeout?.(this.timer);
    if (throttled) this.timer = this.window.setTimeout(() => {
      if (!this.active) return;
      this.button.disabled = false; this.button.textContent = 'Retry sign-in';
    }, Math.max(0, this.retryAt - this.now()));
  }
  async retry() {
    if (!this.active || this.busy || this.now() < (this.retryAt || 0)) return;
    this.busy = true; this.button.disabled = true; this.button.textContent = 'Signing in…';
    this.document.querySelector('#requiredPasswordSignOut').disabled = true;
    try { await this.restore(); }
    catch (error) { if (this.active) this.failed(error); }
    finally {
      this.busy = false;
      this.document.querySelector('#requiredPasswordSignOut').disabled = false;
    }
  }
  dispose() {
    this.active = false; this.restore = null;
    for (const id of ['#requiredNewPassword', '#requiredConfirmPassword']) this.document.querySelector(id).value = '';
    this.window.clearTimeout?.(this.timer);
    this.button.onclick = null;
  }
}
