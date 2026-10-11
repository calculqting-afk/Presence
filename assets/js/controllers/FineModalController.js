import { ControllerScope } from '../core/ControllerScope.js';
export class FineModalController {
  constructor({
    modal,
    content,
    title,
    description,
    closeSelector,
    document = globalThis.document
  }) {
    Object.assign(this, {
      modal,
      content,
      title,
      description,
      closeSelector,
      document
    });
    this.trigger = null;
    this.scope = new ControllerScope();
    this.scope.initialize();
    document.querySelectorAll(closeSelector).forEach(button => this.scope.listen(button, 'click', () => this.close()));
    this.scope.listen(modal, 'click', event => {
      if (event.target === modal) this.close();
    });
  }
  open({
    title,
    description,
    markup,
    trigger
  }) {
    this.trigger = trigger;
    this.title.textContent = title;
    this.description.textContent = description;
    this.content.innerHTML = markup;
    this.modal.hidden = false;
    this.modal.querySelector(this.closeSelector)?.focus();
  }
  close() {
    this.modal.hidden = true;
    this.trigger?.focus();
  }
  dispose() {
    this.scope.dispose();
    this.modal.hidden = true;
    this.trigger = null;
  }
}
