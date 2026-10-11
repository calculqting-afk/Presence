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
  show(title, message) {
    this.dispose();
    const toast = this.document.querySelector('#dashboardToast');
    this.document.querySelector('#dashboardToastTitle').textContent = title;
    this.document.querySelector('#dashboardToastMessage').textContent = message;
    toast.classList.add('show');
    this.timer = this.schedule(() => {
      toast.classList.remove('show');
      this.timer = null;
    });
  }
  dispose() {
    if (this.timer != null) this.cancel(this.timer);
    this.timer = null;
  }
}
