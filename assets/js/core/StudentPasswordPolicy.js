// Shared policy only; passwords are sent to Firebase Auth, never stored in profiles.
export class StudentPasswordPolicy {
  static birthdayPassword(birthday, today = new Date().toISOString().slice(0, 10)) {
    const value = String(birthday || '');
    const date = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(+date)
        || date.toISOString().slice(0, 10) !== value || value > today) {
      throw new Error('Enter a valid birthday before creating the account.');
    }
    const [year, month, day] = value.split('-');
    return month + day + year;
  }

  static newPasswordError(password, { accountId = '', birthday = '' } = {}) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128 || !password.trim()) {
      return 'Use a new password containing 8–128 characters.';
    }
    if (password.toLowerCase() === String(accountId).toLowerCase()) return 'Do not use your Student ID as your new password.';
    try {
      if (birthday && password === this.birthdayPassword(birthday)) return 'Do not reuse your birthday password. Choose a different password.';
    } catch { /* Legacy accounts may not have a valid birthday. */ }
    return '';
  }
}
