import { EmailAuthProvider, reauthenticateWithCredential } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';

export function hasRecentAdminLogin(claims, now = Date.now()) {
  const seconds = now / 1000;
  return Number.isFinite(claims?.auth_time) && claims.auth_time <= seconds
    && seconds - claims.auth_time < 240;
}

// The UI uses four minutes, leaving a minute for writes to reach the server.
// Firestore Rules independently enforce five minutes using the signed token.
export class AdminRecentLogin {
  constructor({ getUser, document = globalThis.document, reauthenticate = reauthenticateWithCredential,
    credential = EmailAuthProvider.credential, now = Date.now }) {
    Object.assign(this, { getUser, document, reauthenticate, credential, now });
  }
  async require() {
    const user = this.getUser();
    if (!user?.email) throw Error('Sign in again before continuing.');
    const token = await user.getIdTokenResult(true);
    if (hasRecentAdminLogin(token.claims, this.now())) return;
    if (this.pending) throw Error('Finish the current password confirmation first.');
    this.pending = true;
    try { await this.confirm(user); } finally { this.pending = false; }
  }
  confirm(user) {
    return new Promise((resolve, reject) => {
      const previousFocus = this.document.activeElement;
      const overlay = this.document.createElement('div');
      overlay.className = 'dashboard-modal-backdrop';
      overlay.style.zIndex = '10000';
      overlay.innerHTML = `<section class="dashboard-modal" role="dialog" aria-modal="true" aria-labelledby="adminRecentLoginTitle">
        <span class="modal-icon presence-modal-logo" aria-hidden="true"></span>
        <h2 id="adminRecentLoginTitle">Confirm your admin password</h2>
        <p>For your account’s security, confirm your password before continuing.</p>
        <form><div class="field"><label for="adminRecentLoginPassword">Your admin password</label>
        <input id="adminRecentLoginPassword" type="password" autocomplete="current-password" required></div>
        <p data-error role="alert"></p><div class="modal-actions">
        <button class="outline-button" type="button" data-cancel>Cancel</button>
        <button class="primary-button" type="submit">Confirm</button></div></form></section>`;
      const form = overlay.querySelector('form'), input = overlay.querySelector('input');
      const buttons = [...overlay.querySelectorAll('button')];
      let busy = false;
      const finish = error => {
        input.value = '';
        overlay.remove();
        this.document.removeEventListener('keydown', keyboard, true);
        previousFocus?.focus();
        error ? reject(error) : resolve();
      };
      const cancel = () => { if (!busy) finish(Error('Password confirmation cancelled. No changes were made.')); };
      const keyboard = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
        if (event.key === 'Tab') {
          const controls = [input, ...buttons].filter(node => !node.disabled);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && this.document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && this.document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      };
      overlay.querySelector('[data-cancel]').addEventListener('click', cancel);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || !input.value) return;
        busy = true;
        buttons.forEach(button => { button.disabled = true; });
        try {
          if (this.getUser()?.uid !== user.uid) throw Error('Session changed. Sign in again.');
          await this.reauthenticate(user, this.credential(user.email, input.value));
          input.value = '';
          const fresh = await user.getIdTokenResult(true);
          if (this.getUser()?.uid !== user.uid || !hasRecentAdminLogin(fresh.claims, this.now())) throw Error('Sign in again before continuing.');
          finish();
        } catch {
          input.value = '';
          overlay.querySelector('[data-error]').textContent = 'Unable to confirm your password. Retry or cancel.';
          busy = false;
          buttons.forEach(button => { button.disabled = false; });
          input.focus();
        }
      });
      this.document.addEventListener('keydown', keyboard, true);
      this.document.body.append(overlay);
      input.focus();
    });
  }
}
