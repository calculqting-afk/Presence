// Philippine Standard Time is UTC+8 throughout the year.
export class DailyAttendanceClock {
  static dateKey(date = new Date()) {
    return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  constructor({ window, document, onDayChange, now = () => new Date() }) {
    Object.assign(this, { window, document, onDayChange, now });
  }
  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.day = DailyAttendanceClock.dateKey(this.now());
    this.onWake = () => this.check();
    this.window.addEventListener('focus', this.onWake);
    this.window.addEventListener('pageshow', this.onWake);
    this.document.addEventListener('visibilitychange', this.onWake);
    this.schedule();
  }
  schedule() {
    this.window.clearTimeout(this.timer);
    const nextMidnight = Date.parse(`${DailyAttendanceClock.dateKey(this.now())}T00:00:00+08:00`) + 86400000;
    this.timer = this.window.setTimeout(() => this.check(), Math.max(1, nextMidnight - this.now().getTime()));
  }
  check() {
    if (!this.initialized) return;
    const day = DailyAttendanceClock.dateKey(this.now());
    if (day !== this.day) { this.day = day; this.onDayChange(day); }
    this.schedule();
  }
  dispose() {
    this.initialized = false;
    this.window.clearTimeout(this.timer);
    this.window.removeEventListener('focus', this.onWake);
    this.window.removeEventListener('pageshow', this.onWake);
    this.document.removeEventListener('visibilitychange', this.onWake);
  }
}
