import { AttendanceAlertPolicy } from './AttendanceAlertPolicy.js';
import { activatePhoneReminders, clearPhoneReminders, replacePhoneReminders, requestPhoneReminders, supportsPhoneReminders } from './PhoneAttendanceReminders.js';

export class AttendanceAlertsController {
  constructor({ uid, getState, document = globalThis.document, window = globalThis.window, storage = globalThis.localStorage }) {
    Object.assign(this, { uid, getState, document, window, storage });
    this.seen = new Set(); this.busy = false; this.stopped = false;
  }
  initialize() {
    this.root = this.document.querySelector('#attendanceAlertSettings');
    this.banner = this.document.querySelector('#attendanceAlertBanner');
    if (!this.root || !this.banner) return;
    try { this.preferences = JSON.parse(this.storage.getItem(`presenceAttendanceAlerts:${this.uid}`) || '{}'); } catch { this.preferences = {}; }
    this.preferences ||= {};
    this.inApp = this.root.querySelector('[data-alert-in-app]');
    this.phone = this.root.querySelector('[data-alert-phone]');
    this.status = this.root.querySelector('[data-alert-status]');
    this.inApp.checked = this.preferences.inApp !== false;
    this.phone.disabled = !supportsPhoneReminders();
    this.phone.checked = supportsPhoneReminders() && this.preferences.phone === true;
    activatePhoneReminders(this.uid);
    this.onChange = async event => {
      if (this.busy || this.stopped) return;
      this.busy = true; this.phone.disabled = true; this.inApp.disabled = true;
      try {
        if (event?.target === this.phone && this.phone.checked && !(await requestPhoneReminders())) {
          this.phone.checked = false;
          this.status.textContent = 'Phone permission was not granted. Enable notifications in Android settings to try again.';
        } else this.status.textContent = this.phone.checked ? 'Phone reminders enabled. Sync after schedule changes; Android may delay delivery.' : 'Phone reminders off. In-app alerts work only while Presence is open.';
        if (this.stopped) return;
        this.preferences = { inApp: this.inApp.checked, phone: this.phone.checked };
        try { this.storage.setItem(`presenceAttendanceAlerts:${this.uid}`, JSON.stringify(this.preferences)); } catch {}
        this.update();
      } catch { this.phone.checked = false; this.preferences.phone = false; this.status.textContent = 'Phone reminders could not be enabled. Try again.'; this.update(); }
      finally { this.busy = false; this.phone.disabled = !supportsPhoneReminders(); this.inApp.disabled = false; }
    };
    this.root.addEventListener('change', this.onChange);
    this.onFocus = () => this.update();
    this.window.addEventListener('focus', this.onFocus);
    this.onVisible = () => { if (!this.document.hidden) this.update(); };
    this.document.addEventListener('visibilitychange', this.onVisible);
    this.timer = this.window.setInterval(() => this.update(), 15000);
    this.status.textContent = supportsPhoneReminders()
      ? 'Phone reminders need permission and a recent sync. Delivery may be delayed by Android. Schedule changes on other devices apply after you reopen/sync.'
      : 'Website: in-app alerts only. Phone reminders require the updated Android APK.';
    this.update();
  }
  update() {
    if (this.stopped || !this.root) return;
    const now = Date.now(), state = this.getState();
    // A temporary cache/offline transition must not erase previously synced
    // phone alarms. Explicit opt-out still cancels, even while offline.
    if (!state.ready) {
      this.banner.hidden = true;
      if (!this.phone.checked) void replacePhoneReminders(this.uid, []).catch(() => {});
      return;
    }
    const reminders = AttendanceAlertPolicy.reminders(state, now);
    // Show only the latest threshold per session; never replay expired reminders.
    const due = new Map();
    for (const item of reminders) if (item.at <= now && item.close > now) due.set(`${item.eventId}:${item.action}`, item);
    const visible = this.inApp.checked && !this.document.hidden ? [...due.values()].filter(item => !this.seen.has(item.key)) : [];
    const current = [...due.values()].find(item => item.key === this.banner.dataset.key);
    if (!this.inApp.checked || !current) this.banner.hidden = true;
    const item = visible[0] || (!this.banner.hidden && current);
    if (item) {
      this.seen.add(item.key);
      this.banner.dataset.key = item.key;
      this.banner.querySelector('[data-alert-message]').textContent = `${item.title}: ${state.events.find(event => event.id === item.eventId)?.name || 'Attendance session'}. About ${Math.ceil((item.close - now) / 60000)} minutes remaining. Open Events to take attendance.`;
      this.banner.hidden = false;
    }
    void replacePhoneReminders(this.uid, this.phone.checked ? reminders.filter(item => item.at > now) : [])
      .then(result => {
        if (this.stopped || !this.phone.checked) return;
        if (result === 'permission-denied') this.status.textContent = 'Phone notifications are blocked in Android settings. In-app alerts are unchanged.';
        if (result === 'synced') this.status.textContent = 'Phone reminders synced. Reopen/sync after remote changes; Android may delay delivery.';
      })
      .catch(() => { if (!this.stopped) this.status.textContent = 'Phone reminders could not sync. Reopen the app and try again; in-app alerts remain available.'; });
  }
  async stop() { this.dispose(); await clearPhoneReminders(); }
  dispose() {
    this.stopped = true;
    this.window.clearInterval(this.timer);
    this.root?.removeEventListener('change', this.onChange);
    this.window.removeEventListener('focus', this.onFocus);
    this.document.removeEventListener('visibilitychange', this.onVisible);
  }
}
