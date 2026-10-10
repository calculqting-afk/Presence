// Render only permitted actions; authorization remains in action handlers/backend.
export class StudentActionsPresenter {
  constructor({ can, escapeHtml }) {
    this.can = can;
    this.escapeHtml = escapeHtml;
  }
  render({ uid, hasFaceRegistration, profile = false }) {
    const id = this.escapeHtml(uid);
    const button = (permission, attribute, label, classes) => this.can(permission)
      ? `<button class="${classes}" type="button" ${attribute}="${id}">${label}</button>` : '';
    const standard = profile ? 'outline-button' : 'small-button';
    return [
      profile
        ? button('editStudents', 'data-edit-student', 'Edit information', 'primary-button')
        : button('viewStudents', 'data-view-student', 'Profile', standard),
      hasFaceRegistration ? button('resetFace', 'data-reset-face', profile ? 'Reset face registration' : 'Reset face', profile ? standard : 'small-button danger') : '',
      button('changePasswords', 'data-password-student', profile ? 'Change password' : 'Password', standard),
      button('deleteStudents', 'data-delete-student', 'Clear account', profile ? 'small-button danger modal-danger-button' : 'small-button danger')
    ].join('');
  }
}
