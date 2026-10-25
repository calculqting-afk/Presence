import { AttendanceAlertPolicy } from './AttendanceAlertPolicy.js';
import { activatePhoneReminders, clearPhoneReminders, replacePhoneReminders, requestPhoneReminders, phoneReminderPermission, supportsPhoneReminders } from './PhoneAttendanceReminders.js';

export class AttendanceAlertsController {
  constructor({ uid, getState, document = globalThis.document, window = globalThis.window, storage = globalThis.localStorage }) {
    Object.assign(this, { uid, getState, document, window, storage });
    this.seen = new Set(); this.stopped = false; this.phoneVersion = 0;
  }
  initialize() {
    if (this.initialized || this.stopped) return;
    this.banner = this.document.querySelector('#attendanceAlertBanner');
    if (!this.banner) return;
    this.initialized = true;
    try { this.prompted = this.storage?.getItem('presenceAttendancePhonePrompted') === '1'; } catch { this.prompted = false; }
    activatePhoneReminders(this.uid);
    this.onFocus = () => this.update();
    this.window.addEventListener('focus', this.onFocus);
    this.onVisible = () => { if (!this.document.hidden) this.update(); };
    this.document.addEventListener('visibilitychange', this.onVisible);
    this.timer = this.window.setInterval(() => this.update(), 15000);
    this.update();
  }
  update() {
    if (this.stopped || !this.initialized) return;
    const now = Date.now(), state = this.getState();
    // A temporary cache/offline transition must not erase previously synced
    // phone alarms.
    if (!state.ready) {
      this.banner.hidden = true;
      return;
    }
    const reminders = AttendanceAlertPolicy.reminders(state, now);
    // Show only the latest threshold per session; never replay expired reminders.
    const due = new Map();
    for (const item of reminders) if (item.at <= now && (item.expiresAt || item.close) > now) due.set(`${item.eventId}:${item.action}`, item);
    const visible = !this.document.hidden ? [...due.values()].filter(item => !this.seen.has(item.key)) : [];
    const current = [...due.values()].find(item => item.key === this.banner.dataset.key);
    if (!current) this.banner.hidden = true;
    const item = visible[0] || (!this.banner.hidden && current);
    if (item) {
      this.seen.add(item.key);
      this.banner.dataset.key = item.key;
      const detail = item.kind === 'opening' ? `Open Events to ${item.action === 'checkout' ? 'check out' : 'check in'}.` : `About ${Math.ceil((item.close - now) / 60000)} minutes remaining. Open Events to take attendance.`;
      this.banner.querySelector('[data-alert-message]').textContent = `${item.title}: ${state.events.find(event => event.id === item.eventId)?.name || 'Attendance session'}. ${detail}`;
      this.banner.hidden = false;
    }
    if (supportsPhoneReminders()) void this.syncPhone(reminders.filter(item => item.at > now));
  }
  syncPhone(reminders) {
    this.pendingReminders = reminders; this.phoneVersion++;
    if (this.phoneSync) return this.phoneSync;
    const run = async () => {
      let version;
      do {
        version = this.phoneVersion;
        let permission = await phoneReminderPermission();
        if (this.stopped) return;
        // APK foreground only. Ask once for an eligible future reminder.
        // Denied/rationale states never trigger repeated permission prompts.
        if (permission === 'prompt' && !this.prompted && !this.document.hidden && this.pendingReminders.length) {
          this.prompted = true;
          try { this.storage?.setItem('presenceAttendancePhonePrompted', '1'); } catch {}
          permission = await requestPhoneReminders() ? 'granted' : 'denied';
        }
        if (this.stopped) return;
        await replacePhoneReminders(this.uid, permission === 'granted' ? this.pendingReminders : []);
      } while (!this.stopped && version !== this.phoneVersion);
    };
    this.phoneSync = run().catch(() => { this.phoneSyncFailed = true; })
      .finally(() => { this.phoneSync = null; });
    return this.phoneSync;
  }
  async stop() { this.dispose(); await clearPhoneReminders(); }
  dispose() {
    this.stopped = true;
    this.window.clearInterval(this.timer);
    this.window.removeEventListener('focus', this.onFocus);
    this.document.removeEventListener('visibilitychange', this.onVisible);
  }
}
