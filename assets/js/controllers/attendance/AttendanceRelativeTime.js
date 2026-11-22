// Display only: never writes attendance or requests another Firestore snapshot.
export class AttendanceRelativeTime {
  static milliseconds(value) {
    if (value == null) return NaN;
    try {
      const milliseconds = value.toMillis?.() ?? value.toDate?.()?.getTime?.()
        ?? (typeof value.getTime === 'function' ? value.getTime() : typeof value === 'number' ? value
          : typeof value.seconds === 'number' ? value.seconds * 1000 : NaN);
      return Number.isFinite(milliseconds) && Math.abs(milliseconds) <= 8640000000000000 ? milliseconds : NaN;
    } catch { return NaN; }
  }
  static label(milliseconds, action, now = Date.now()) {
    if (!Number.isFinite(milliseconds) || !Number.isFinite(now)) return '';
    const prefix = action === 'out' ? 'Checked out' : 'Checked in';
    if (milliseconds - now > 60000) return 'Time unavailable — check device clock';
    const minutes = Math.floor(Math.max(0, now - milliseconds) / 60000);
    if (!minutes) return `${prefix} just now`;
    if (minutes < 60) return `${prefix} ${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${prefix} ${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return `${prefix} ${days} day${days === 1 ? '' : 's'} ago`;
  }
  static render(value, action, now = Date.now()) {
    const milliseconds = this.milliseconds(value);
    if (!Number.isFinite(milliseconds)) return '';
    const safeAction = action === 'out' ? 'out' : 'in';
    return `<small class="attendance-time-since" data-attendance-time="${milliseconds}" data-attendance-action="${safeAction}">${this.label(milliseconds, safeAction, now)}</small>`;
  }
  constructor({ window, document, now = () => Date.now() }) { Object.assign(this, { window, document, now }); }
  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.wake = () => this.refresh();
    this.document.addEventListener('visibilitychange', this.wake);
    for (const event of ['focus', 'pageshow', 'presence:viewchange']) this.window.addEventListener(event, this.wake);
    this.refresh();
  }
  refresh() {
    this.window.clearTimeout(this.timer);
    if (!this.initialized || this.document.hidden) return;
    const now = this.now();
    for (const node of this.document.querySelectorAll('[data-attendance-time]')) {
      if (!node.closest?.('[hidden]')) node.textContent = AttendanceRelativeTime.label(Number(node.dataset.attendanceTime), node.dataset.attendanceAction, now);
    }
    this.timer = this.window.setTimeout(() => this.refresh(), 60000);
  }
  dispose() {
    this.initialized = false;
    this.window.clearTimeout(this.timer);
    this.document.removeEventListener('visibilitychange', this.wake);
    for (const event of ['focus', 'pageshow', 'presence:viewchange']) this.window.removeEventListener(event, this.wake);
  }
}
