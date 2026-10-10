import { ButtonLoadingController } from './ButtonLoadingController.js';

// Owns one pending authentication action, including duplicate-click protection.
export class AuthActionController {
  constructor({ loading = new ButtonLoadingController() } = {}) {
    this.loading = loading;
    this.busy = false;
  }
  async run({ buttons, label, successLabel, action }) {
    if (this.busy) return false;
    this.busy = true;
    this.loading.start('auth', buttons[0], label);
    buttons.slice(1).forEach(button => this.loading.attach('auth', button));
    let succeeded = false;
    try {
      succeeded = await action() !== false;
      if (succeeded) this.loading.finish('auth', successLabel);
      return succeeded;
    } finally {
      if (!succeeded) {
        this.loading.reset('auth');
        this.busy = false;
      }
    }
  }
  dispose() { this.loading.dispose(); this.busy = false; }
}
