import { PasswordResetApi } from './PasswordResetApi.js';

// Random installation identifier, not hardware fingerprinting. Authority lives in
// the signed Firebase token and the server-controlled accountSessions document.
export class DeviceSessionController {
  constructor({ document = globalThis.document, window = globalThis.window, api = new PasswordResetApi(),
    authentication, signIn } = {}) {
    Object.assign(this, { document, window, api, authentication, signIn });
  }
  deviceId() {
    try {
      const storage = this.window.localStorage, key = 'presence.installation';
      let id = storage.getItem(key);
      if (!/^[a-f0-9-]{36}$/.test(id || '')) { id = crypto.randomUUID(); storage.setItem(key, id); }
      return id;
    } catch { throw Error('Allow local storage for Presence before signing in on this device.'); }
  }
  async bind(user, { allowTransfer = false } = {}) {
    // Firebase refreshes expiring tokens itself. A password sign-in has just
    // issued a fresh token; acquire performs the account and conflict checks.
    let claims = (await user.getIdTokenResult()).claims;
    const tokenOptions = { forceRefresh: false };
    const passwordLogin = claims.firebase?.sign_in_provider === 'password' && !claims.presenceSession;
    if (!passwordLogin) {
      // Restored/custom sessions get one fresh authority check before routing.
      claims = (await user.getIdTokenResult(true)).claims;
      const status = await this.api.call('/v1/session/status', user, {}, tokenOptions);
      if (status.current) return user;
    }
    // A displaced device must authenticate with a password again, never silently
    // reclaim its session using the old custom-token/refresh-token pair.
    if (claims.presenceSession) throw Error('Your session was transferred or ended. Sign in again with your password.');
    const body = { deviceId: this.deviceId() };
    let result = await this.api.call('/v1/session/acquire', user, body, tokenOptions);
    if (result.transferRequired) {
      if (!allowTransfer || !await this.confirmTransfer()) throw Error('Login cancelled. The other device remains signed in.');
      result = await this.api.call('/v1/session/acquire', user, { ...body, transferRevision: result.revision }, tokenOptions);
    }
    if (!result.customToken || this.disposed) throw Error('Device session could not be confirmed. Sign in again.');
    const signIn = this.signIn || (await import('https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js')).signInWithCustomToken;
    const authentication = this.authentication || (await import('../../../config/firebase-config.js')).auth;
    const credential = await signIn(authentication, result.customToken);
    return credential.user;
  }
  confirmTransfer() {
    const dialog = this.document.createElement('dialog');
    dialog.className = 'policy-agreement';
    dialog.setAttribute('aria-labelledby', 'deviceTransferTitle');
    dialog.innerHTML = `<div class="policy-agreement-content"><h2 id="deviceTransferTitle">Account active on another device</h2><p>Your account is active on another device. Transfer your session here?</p><p>Cancel keeps the other device signed in. Transfer ends its access and signs you in here.</p><div class="policy-actions"><button type="button" data-cancel>Cancel</button><button type="button" class="primary-button" data-transfer>Transfer session here</button></div></div>`;
    this.document.body.append(dialog); this.dialog = dialog;
    this.document.body.setAttribute('data-device-transfer', '');
    return new Promise(resolve => {
      this.finishTransfer = value => {
        dialog.close(); dialog.remove(); this.dialog = null;
        this.document.body.removeAttribute('data-device-transfer');
        this.window.removeEventListener('presence:device-transfer-back', cancel);
        this.finishTransfer = null; resolve(value);
      };
      const cancel = () => this.finishTransfer?.(false);
      dialog.addEventListener('cancel', e => { e.preventDefault(); cancel(); });
      dialog.querySelector('[data-cancel]').addEventListener('click', cancel);
      dialog.querySelector('[data-transfer]').addEventListener('click', () => this.finishTransfer?.(true));
      this.window.addEventListener('presence:device-transfer-back', cancel);
      dialog.showModal(); dialog.querySelector('[data-cancel]').focus();
    });
  }
  async watch(user, onLost) {
    const claims = (await user.getIdTokenResult()).claims;
    if (this.disposed) return;
    const { db } = await import('../../../config/firebase-config.js');
    const { doc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js');
    if (this.disposed) return;
    this.onSigningOut = () => { this.releasing = true; };
    let latestSession;
    const checkSession = () => {
      if (this.disposed || this.releasing || latestSession === undefined) return;
      if (latestSession !== claims.presenceSession) { this.unsubscribe?.(); onLost(); }
    };
    this.onSignOutFailed = () => { this.releasing = false; checkSession(); };
    this.window.addEventListener('presence:device-signing-out', this.onSigningOut);
    this.window.addEventListener('presence:device-signout-failed', this.onSignOutFailed);
    this.unsubscribe = onSnapshot(doc(db, 'accountSessions', user.uid), snapshot => {
      if (this.disposed || snapshot.metadata?.fromCache) return;
      latestSession = snapshot.data()?.sessionId ?? null;
      checkSession();
    }, () => { /* Offline reads do not prove a transfer. Rules still protect writes. */ });
  }
  static async rebind(user) {
    return new DeviceSessionController().bind(user);
  }
  static async release(user, { api = new PasswordResetApi(), window = globalThis.window } = {}) {
    if (!user) return;
    window?.dispatchEvent(new Event('presence:device-signing-out'));
    try {
      const result = await api.call('/v1/session/release', user, {}, { forceRefresh: false });
      if (result.released !== true) throw Error('The device session could not be ended. Retry logout.');
    } catch (error) {
      window?.dispatchEvent(new Event('presence:device-signout-failed'));
      throw error;
    }
  }
  dispose() { this.window?.removeEventListener('presence:device-signing-out', this.onSigningOut); this.window?.removeEventListener('presence:device-signout-failed', this.onSignOutFailed); this.disposed = true; this.unsubscribe?.(); this.finishTransfer?.(false); }
}
