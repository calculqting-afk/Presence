export class DashboardToastController {
  constructor({
    document = globalThis.document,
    schedule = callback => setTimeout(callback, 4200),
    cancel = timer => clearTimeout(timer)
  } = {}) {
    Object.assign(this, {
      document,
      schedule,
      cancel
    });
    this.timer = null;
  }
  show(title, message, { attendanceSuccess = false } = {}) {
    this.dispose();
    const toast = this.document.querySelector('#dashboardToast');
    const mark = toast.querySelector('.toast-mark');
    if (mark && attendanceSuccess) {
      const asset = name => new URL(`../../emoji/${name}`, import.meta.url).href;
      mark.classList.add('is-attendance-success');
      mark.setAttribute('aria-hidden', 'true');
      mark.innerHTML = `<picture><source media="(prefers-reduced-motion: reduce)" srcset="${asset('presence-check-in.png')}"><source type="image/webp" srcset="${asset('presence-check-in-smooth.webp')}"><img src="${asset('presence-check-in-128.gif')}" alt="" width="64" height="64"></picture>`;
      this.mark = mark;
    }
    this.document.querySelector('#dashboardToastTitle').textContent = title;
    this.document.querySelector('#dashboardToastMessage').textContent = message;
    toast.classList.add('show');
    this.timer = this.schedule(() => {
      toast.classList.remove('show');
      this.clearMark();
      this.timer = null;
    });
  }
  dispose() {
    if (this.timer != null) this.cancel(this.timer);
    this.timer = null;
    this.clearMark();
  }
  clearMark() {
    if (!this.mark) return;
    this.mark.classList.remove('is-attendance-success');
    this.mark.textContent = '✓';
    this.mark = null;
  }
}
