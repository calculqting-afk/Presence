import { deviceLocation, attendanceLocationIssue } from './DeviceLocationService.js';

// Preparation only: never writes attendance or replaces final server/geofence checks.
export class AttendanceReadinessController {
  constructor({ document = globalThis.document, window = globalThis.window, readFace, openFace,
    location = deviceLocation, native = () => globalThis.PresenceNative } = {}) {
    Object.assign(this, { document, window, readFace, openFace, location, native });
  }
  require(event) {
    this.close(false);
    this.event = event;
    this.locationAt = 0;
    this.faceReady = false;
    this.connected = false;
    const dialog = this.document.createElement('dialog');
    this.dialog = dialog;
    dialog.className = 'attendance-readiness';
    dialog.setAttribute('aria-labelledby', 'readinessTitle');
    dialog.innerHTML = `<h2 id="readinessTitle">Ready to check in?</h2><p>Check your device before continuing. Attendance is saved only after the final checks.</p><ul class="readiness-list"><li><strong>Internet</strong><span data-state="internet" role="status">Checking connection…</span></li><li><strong>Face registration</strong><span data-state="face" role="status">Checking registration…</span><button type="button" data-action="face" hidden>Register face</button></li><li><strong>Location permission</strong><span data-state="permission" role="status">Checking permission…</span></li><li><strong>GPS</strong><span data-state="gps" role="status"></span><button type="button" data-action="location">Check location</button></li></ul><p class="readiness-note">Location readiness does not confirm that you are inside the event boundary.</p><div class="readiness-actions"><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="retry">Check again</button><button type="button" data-action="continue" class="primary-button" disabled>Continue to check in</button></div>`;
    this.document.body.append(dialog);
    this.document.body.setAttribute("data-attendance-readiness", "");
    this.pending = new Promise(resolve => { this.resolve = resolve; });
    dialog.addEventListener('cancel', e => { e.preventDefault(); this.close(false); });
    dialog.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'cancel') this.close(false);
      if (action === 'retry') void this.check(dialog);
      if (action === 'location') void this.checkLocation(dialog);
      if (action === 'face') { this.close(false); this.openFace(); }
      if (action === 'continue' && this.ready()) this.close(true);
    });
    this.onOffline = () => { this.connected = false; this.state('internet', 'Offline — reconnect, then select Check again.'); this.render(); };
    this.onOnline = () => { if (this.dialog === dialog) void this.check(dialog); };
    this.onView = () => this.close(false);
    this.window.addEventListener('offline', this.onOffline);
    this.window.addEventListener('online', this.onOnline);
    this.window.addEventListener('presence:viewchange', this.onView);
    this.window.addEventListener('presence:readiness-back', this.onView);
    this.timer = this.window.setInterval(() => this.render(), 1000);
    dialog.showModal();
    void this.check(dialog);
    return this.pending;
  }
  state(name, text) { const node = this.dialog?.querySelector(`[data-state="${name}"]`); if (node) node.textContent = text; }
  ready() {
    return this.window.navigator?.onLine !== false && this.connected && this.faceReady &&
      (!this.event.requiresGeofence || Date.now() - this.locationAt < 30000);
  }
  render() {
    if (!this.dialog) return;
    this.dialog.querySelector('[data-action="continue"]').disabled = !this.ready();
    if (this.event.requiresGeofence && this.locationAt && Date.now() - this.locationAt >= 30000) {
      this.state('gps', 'Location check expired — select Check location again.');
    }
  }
  async check(dialog) {
    if (this.checking === dialog) return;
    this.checking = dialog; this.connected = this.faceReady = false; this.render();
    this.state('internet', 'Checking connection…'); this.state('face', 'Checking registration…');
    try {
      if (this.window.navigator?.onLine === false) throw new Error('offline');
      const registered = await this.readFace();
      if (this.dialog !== dialog) return;
      this.connected = true; this.faceReady = registered === true;
      this.state('internet', 'Connected — server reached');
      this.state('face', this.faceReady ? 'Registered' : 'Not registered — complete face registration.');
      dialog.querySelector('[data-action="face"]').hidden = this.faceReady;
    } catch {
      if (this.dialog !== dialog) return;
      this.state('internet', this.window.navigator?.onLine === false ? 'Offline — reconnect and try again.' : 'Server check failed — check your connection and retry.');
      this.state('face', 'Not verified — select Check again.');
    } finally {
      if (this.checking === dialog) this.checking = null;
      if (this.dialog === dialog) { await this.checkPermission(dialog); this.render(); }
    }
  }
  async checkPermission(dialog) {
    dialog.querySelector('[data-action="location"]').hidden = !this.event.requiresGeofence;
    if (!this.event.requiresGeofence) { this.state('permission', 'Not required for this event'); this.state('gps', 'Not required for this event'); return; }
    if (!this.locationAt) this.state('gps', 'Not checked — turn on device location, then select Check location.');
    try {
      const native = this.native();
      const result = native?.isNative ? await native.geolocation.checkPermissions() : await this.window.navigator.permissions.query({ name: 'geolocation' });
      if (this.dialog !== dialog) return;
      const state = native?.isNative ? result.location : result.state;
      this.state('permission', state === 'granted' ? 'Allowed' : state === 'denied' ? 'Blocked — allow location in site/app settings, then retry.' : 'Not granted yet — select Check location.');
    } catch { if (this.dialog === dialog) this.state('permission', 'Select Check location to verify access.'); }
  }
  async checkLocation(dialog) {
    if (this.locating === dialog || !this.event.requiresGeofence) return;
    this.locating = dialog; this.locationAt = 0; this.render();
    const button = dialog.querySelector('[data-action="location"]'); button.disabled = true; button.textContent = 'Checking location…';
    this.state('gps', 'Getting a fresh location…');
    try {
      const position = await this.location.read();
      if (this.dialog !== dialog) return;
      const { latitude, longitude, accuracy } = position.coords || {};
      const issue = attendanceLocationIssue({ latitude, longitude, accuracy }, position.timestamp);
      if (issue) throw new Error(issue);
      this.locationAt = position.timestamp;
      this.state('permission', 'Allowed');
      this.state('gps', `Location received (accuracy ±${Math.round(accuracy)} m). Final boundary verification follows.`);
    } catch (error) {
      if (this.dialog !== dialog) return;
      this.state('gps', error.message || 'Turn on device location and retry.');
      if (error.locationErrorCode === 1 || error.code === 1) this.state('permission', 'Blocked — allow location in site/app settings, then retry.');
    } finally {
      if (this.locating === dialog) this.locating = null;
      if (this.dialog === dialog) { button.disabled = false; button.textContent = 'Check location'; this.render(); }
    }
  }
  close(accepted = false) {
    if (!this.dialog) return;
    this.window.clearInterval(this.timer);
    this.window.removeEventListener('offline', this.onOffline);
    this.window.removeEventListener('online', this.onOnline);
    this.window.removeEventListener('presence:viewchange', this.onView);
    this.window.removeEventListener('presence:readiness-back', this.onView);
    this.document.body.removeAttribute('data-attendance-readiness');
    this.dialog.close(); this.dialog.remove(); this.dialog = null;
    const resolve = this.resolve; this.resolve = null; resolve?.(accepted);
  }
  dispose() { this.close(false); }
}
