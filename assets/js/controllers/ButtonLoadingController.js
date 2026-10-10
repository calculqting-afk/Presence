// Owns presentation state independently of attendance persistence and verification.
export class ButtonLoadingController {
  constructor({ document: ownerDocument = globalThis.document } = {}) {
    this.operations = new Map();
    if (ownerDocument?.createElement && ownerDocument.body?.append) {
      this.announcer = ownerDocument.createElement('div');
      this.announcer.className = 'attendance-progress-announcer';
      this.announcer.setAttribute('role', 'status');
      this.announcer.setAttribute('aria-live', 'polite');
      this.announcer.setAttribute('aria-atomic', 'true');
      ownerDocument.body.append(this.announcer);
    }
  }
  announce(label) { if (this.announcer) this.announcer.textContent = label; }
  start(key, button, label) {
    if (this.operations.has(key)) return false;
    this.operations.set(key, { label, buttons: new Map() });
    this.attach(key, button);
    this.announce(label);
    return true;
  }
  attach(key, button) {
    const operation = this.operations.get(key);
    if (!operation || !button) return;
    if (!operation.buttons.has(button)) operation.buttons.set(button, {
      html: button.innerHTML, text: button.textContent, disabled: Boolean(button.disabled),
      busy: button.getAttribute?.('aria-busy'), live: button.getAttribute?.('aria-live')
    });
    this.paint(button, operation.label, true);
  }
  paint(button, label, busy) {
    const text = String(label).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    button.innerHTML = `${busy ? '<span class="attendance-button-spinner" aria-hidden="true"></span>' : '<span aria-hidden="true">✓</span>'}<span>${text}</span>`;
    button.disabled = true;
    button.classList?.toggle('attendance-button-loading', busy);
    button.setAttribute?.('aria-busy', String(busy));
    button.setAttribute?.('aria-live', 'polite');
  }
  update(key, label) {
    const operation = this.operations.get(key);
    if (!operation) return;
    operation.label = label;
    this.announce(label);
    for (const button of operation.buttons.keys()) this.paint(button, label, true);
  }
  finish(key, label) {
    const operation = this.operations.get(key);
    if (!operation) return;
    this.announce(label);
    for (const button of operation.buttons.keys()) this.paint(button, label, false);
    this.operations.delete(key);
  }
  reset(key) {
    const operation = this.operations.get(key);
    if (!operation) return;
    for (const [button, previous] of operation.buttons) {
      if (previous.html !== undefined) button.innerHTML = previous.html;
      else button.textContent = previous.text;
      button.disabled = previous.disabled;
      button.classList?.remove('attendance-button-loading');
      for (const [name, value] of [['aria-busy', previous.busy], ['aria-live', previous.live]]) {
        if (value == null) button.removeAttribute?.(name); else button.setAttribute?.(name, value);
      }
    }
    this.operations.delete(key);
  }
  dispose() { for (const key of this.operations.keys()) this.reset(key); this.announcer?.remove(); this.announcer = null; }
}
