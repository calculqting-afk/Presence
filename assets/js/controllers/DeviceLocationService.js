export class DeviceLocationService {
  constructor({ native = () => globalThis.PresenceNative, browser = () => globalThis.navigator?.geolocation,
    document = globalThis.document } = {}) {
    Object.assign(this, { native, browser, document });
  }
  read(timeout = 15000) {
    if (this.pending) return this.pending;
    this.pending = this.request(timeout).finally(() => { this.pending = null; });
    return this.pending;
  }
  async request(timeout) {
    if (this.document?.visibilityState === 'hidden') throw this.issue('Return to Presence before requesting location.', 2);
    let leftPage = false;
    let leftView = false;
    const onVisibility = () => { if (this.document?.visibilityState === 'hidden') leftPage = true; };
    const ownerWindow = this.document?.defaultView || globalThis.window;
    const onNavigate = () => { leftView = true; };
    this.document?.addEventListener?.('visibilitychange', onVisibility);
    ownerWindow?.addEventListener?.('presence:viewchange', onNavigate);
    try {
      let position;
      const native = this.native();
      if (native?.isNative) {
        const permission = await native.geolocation.checkPermissions();
        const granted = permission.location === 'granted' ? permission : await native.geolocation.requestPermissions({ permissions: ['location'] });
        if (granted.location !== 'granted') throw this.issue('Allow precise location for Presence in Android app settings, then return and retry.', 1);
        // Android's permission dialog may temporarily pause the WebView.
        leftPage = leftView || this.document?.visibilityState === 'hidden';
        if (leftPage) throw this.issue('Location check paused. Return to Presence and retry.', 2);
        position = await native.geolocation.getCurrentPosition({ enableHighAccuracy: true, maximumAge: 0, timeout });
      } else {
        const gps = this.browser();
        if (!gps) throw this.issue('This browser does not support location services.', 2);
        const read = () => new Promise((resolve, reject) => gps.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout }));
        const locks = globalThis.navigator?.locks;
        position = locks ? await locks.request('presence-location', { ifAvailable: true }, lock => {
          if (!lock) throw this.issue('Another Presence tab is checking location. Finish there, then retry in this tab.', 2);
          return read();
        }) : await read();
      }
      if (leftPage || leftView) throw this.issue('Location check paused. Return to Presence and retry.', 2);
      return position;
    } catch (error) {
      if (error.geofenceIssue) throw error;
      const nativeCode = String(error.code || '');
      const code = typeof error.code === 'number' ? error.code : nativeCode === 'OS-PLUG-GLOC-0003' ? 1 : nativeCode === 'OS-PLUG-GLOC-0010' ? 3 : 2;
      throw this.issue(({ 1: 'Allow location for Presence in site or Android app settings, then return and retry.',
        2: 'Location is unavailable. Turn on device location, return to Presence, and retry.',
        3: 'Location timed out. Move somewhere with a clearer GPS signal and retry.' })[code], code);
    } finally {
      this.document?.removeEventListener?.('visibilitychange', onVisibility);
      ownerWindow?.removeEventListener?.('presence:viewchange', onNavigate);
    }
  }
  issue(message, code) { return Object.assign(new Error(message), { geofenceIssue: 'location', locationErrorCode: code, code }); }
}
export const deviceLocation = new DeviceLocationService();
