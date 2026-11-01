import { ControllerScope } from '../core/ControllerScope.js';
import { PolicyAgreementPolicy as Policy } from '../core/PolicyAgreementPolicy.js';

// Required acknowledgement precedes dashboard listeners, navigation and native prompts.
export class PolicyAgreementController {
  constructor({ document, window, uid, read, save, signOut }) {
    Object.assign(this, { document, window, uid, read, save, signOut });
    this.scope = new ControllerScope();
  }
  require() {
    if (this.pending) return this.pending;
    this.scope.initialize();
    this.pending = new Promise(resolve => { this.resolve = resolve; });
    this.document.body.setAttribute('data-policy-required', '');
    this.dialog = this.document.createElement('dialog');
    this.dialog.className = 'policy-agreement';
    this.dialog.setAttribute('aria-labelledby', 'policyAgreementTitle');
    this.dialog.setAttribute('aria-describedby', 'policyAgreementDescription');
    this.dialog.innerHTML = `<div class="policy-agreement-content"><img class="policy-logo" src="../assets/images/presence-logo.png" alt="Presence"><h2 id="policyAgreementTitle">Before you continue</h2><p id="policyAgreementDescription">Please review the Terms and Conditions and Privacy Policy before continuing.</p><div class="policy-document-links"><button type="button" data-policy-read="terms-and-conditions">Read Terms and Conditions</button><button type="button" data-policy-read="privacy-policy">Read Privacy Policy</button></div><section data-policy-reader hidden><button type="button" data-policy-reader-back>← Back to agreement</button><iframe title="Policy document" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe></section><form novalidate><label class="policy-checkbox"><input type="checkbox" name="agreement" disabled><span>I agree to the <strong>Terms and Conditions</strong> and acknowledge the <strong>Privacy Policy</strong>.</span></label><p class="policy-small">Camera, location and notification permissions are separate. Version ${Policy.version}.</p><p class="policy-error" role="alert" data-policy-error></p><p class="policy-small" role="status" data-policy-status>Checking your saved agreement…</p><div class="policy-actions"><button type="button" data-policy-signout>Sign out</button><button type="button" data-policy-retry hidden>Try again</button><button type="submit" data-policy-continue disabled>Continue</button></div></form></div>`;
    this.document.body.append(this.dialog);
    this.checkbox = this.dialog.querySelector('[name=agreement]');
    this.error = this.dialog.querySelector('[data-policy-error]');
    this.status = this.dialog.querySelector('[data-policy-status]');
    this.proceed = this.dialog.querySelector('[data-policy-continue]');
    this.retry = this.dialog.querySelector('[data-policy-retry]');
    this.reader = this.dialog.querySelector('[data-policy-reader]');
    this.scope.listen(this.dialog, 'cancel', event => { event.preventDefault(); this.explain(); });
    this.scope.listen(this.window, 'presence:policy-back', () => this.explain());
    this.scope.listen(this.dialog.querySelector('form'), 'submit', event => { event.preventDefault(); void this.accept(); });
    this.scope.listen(this.retry, 'click', () => void this.verify());
    this.scope.listen(this.dialog.querySelector('[data-policy-signout]'), 'click', () => void this.leave());
    this.dialog.querySelectorAll('[data-policy-read]').forEach(button => this.scope.listen(button, 'click', () => {
      this.dialog.querySelector('iframe').src = `./${button.dataset.policyRead}.html#embedded`;
      this.reader.hidden = false;
      this.dialog.querySelector('[data-policy-reader-back]').focus();
    }));
    this.scope.listen(this.dialog.querySelector('[data-policy-reader-back]'), 'click', () => {
      this.reader.hidden = true;
      this.checkbox.focus();
    });
    this.scope.listen(this.checkbox, 'change', () => { this.error.textContent = ''; this.checkbox.removeAttribute('aria-invalid'); });
    void this.verify();
    return this.pending;
  }
  explain() { if (!this.dialog.open) this.dialog.showModal?.(); this.error.textContent = Policy.message; }
  async verify() {
    if (this.busy) return;
    this.busy = true; this.ready = false;
    this.proceed.disabled = this.checkbox.disabled = true;
    this.retry.hidden = true; this.error.textContent = '';
    this.status.textContent = 'Checking your saved agreement…';
    try {
      const receipt = await this.read();
      if (!this.scope.initialized || this.leaving) return;
      if (Policy.accepted(receipt, this.uid)) { this.finish(true); return; }
      this.ready = true;
      this.proceed.disabled = this.checkbox.disabled = false;
      this.status.textContent = 'Your choice is saved to your account.';
      if (!this.dialog.open) this.dialog.showModal?.();
      this.checkbox.focus({ preventScroll: true });
    } catch {
      if (!this.scope.initialized) return;
      this.error.textContent = 'Unable to verify your agreement. Check your connection and try again.';
      this.status.textContent = 'Agreement has not been confirmed.';
      this.retry.hidden = false;
      if (!this.dialog.open) this.dialog.showModal?.();
    } finally { this.busy = false; }
  }
  async accept() {
    if (this.busy || !this.ready || this.leaving) return;
    if (!this.checkbox.checked) {
      this.explain(); this.checkbox.setAttribute('aria-invalid', 'true'); this.checkbox.focus(); return;
    }
    this.busy = true;
    this.proceed.disabled = this.checkbox.disabled = true;
    this.proceed.textContent = 'Saving…'; this.error.textContent = '';
    try {
      await this.save();
      if (this.scope.initialized && !this.leaving) this.finish(true);
    } catch {
      // Another device/tab may have created the same immutable receipt meanwhile.
      try { if (Policy.accepted(await this.read(), this.uid)) { if (this.scope.initialized && !this.leaving) this.finish(true); return; } } catch {}
      if (this.scope.initialized) this.error.textContent = 'Your agreement could not be saved. Check your connection and try again.';
    } finally {
      this.busy = false;
      if (this.scope.initialized) { this.proceed.disabled = this.checkbox.disabled = false; this.proceed.textContent = 'Continue'; }
    }
  }
  async leave() {
    if (this.leaving) return;
    this.leaving = true;
    try { await this.signOut(); this.finish(false); }
    catch { this.leaving = false; if (this.scope.initialized) { this.error.textContent = 'Unable to sign out. Please try again.'; this.retry.hidden = false; } }
  }
  finish(accepted) {
    const resolve = this.resolve; this.resolve = null;
    this.scope.dispose(); this.dialog?.close(); this.dialog?.remove();
    this.document.body.removeAttribute('data-policy-required');
    resolve?.(accepted);
  }
  dispose() { this.finish(false); }
}
