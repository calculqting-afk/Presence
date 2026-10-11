export class DashboardGreetingController {
  constructor({
    document = globalThis.document,
    getGreeting
  }) {
    Object.assign(this, {
      document,
      getGreeting
    });
  }
  render(name = 'Student') {
    const greeting = this.getGreeting();
    this.document.querySelectorAll('[data-dashboard-greeting]').forEach(element => {
      element.textContent = greeting.label;
    });
    this.document.querySelectorAll('[data-dashboard-greeting-title]').forEach(element => {
      element.textContent = `${greeting.label}, ${name}.`;
    });
    this.document.querySelectorAll('[data-dashboard-greeting-message]').forEach(element => {
      element.textContent = greeting.message;
    });
  }
}
