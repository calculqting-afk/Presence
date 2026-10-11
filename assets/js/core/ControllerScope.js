// Owns one controller's listeners and cleanup callbacks; no global subscriptions.
export class ControllerScope {
  constructor() { this.cleanups = []; this.initialized = false; }
  initialize() {
    if (this.initialized) return false;
    this.initialized = true;
    return true;
  }
  addCleanup(cleanup) { this.cleanups.push(cleanup); }
  listen(target, type, handler, options) {
    if (!target) return;
    target.addEventListener(type, handler, options);
    this.addCleanup(() => target.removeEventListener(type, handler, options));
  }
  mount(target, position, markup) {
    const container = ['beforebegin', 'afterend'].includes(position) ? target.parentNode : target;
    const previous = new Set(container?.childNodes || []);
    target.insertAdjacentHTML(position, markup);
    const added = Array.from(container?.childNodes || []).filter(node => !previous.has(node));
    this.addCleanup(() => added.forEach(node => node.remove()));
  }
  dispose() {
    if (!this.initialized && !this.cleanups.length) return;
    this.initialized = false;
    const cleanups = this.cleanups.splice(0).reverse();
    let failure;
    for (const cleanup of cleanups) {
      try { cleanup(); } catch (error) { failure ||= error; }
    }
    if (failure) throw failure;
  }
}
