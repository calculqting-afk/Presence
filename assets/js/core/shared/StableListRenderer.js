// Retain unchanged live rows, their images, focus and browser scroll anchors.
// Callers supply escaped presentation markup; authorization remains with each controller.
export class StableListRenderer {
  static states = new WeakMap();

  static render(container, markup, keyAttribute = 'data-render-key') {
    if (!container) return;
    const previous = this.states.get(container);
    if (previous?.markup === markup) return;
    const document = container.ownerDocument;
    if (!document?.createRange) {
      container.innerHTML = markup;
      this.states.set(container, { markup });
      return;
    }
    // Contextual parsing also handles table rows without an extra wrapper element.
    const range = document.createRange();
    range.selectNodeContents(container);
    const fragment = range.createContextualFragment(markup);
    const next = [...fragment.children];
    const keys = next.map(node => node.getAttribute(keyAttribute));
    const existingKeys = [...container.children].map(node => node.getAttribute(keyAttribute));
    if (!next.length || keys.some(key => !key) || new Set(keys).size !== keys.length ||
        existingKeys.some(key => !key) || new Set(existingKeys).size !== existingKeys.length) {
      container.replaceChildren(fragment);
      this.states.set(container, { markup });
      return;
    }
    const current = new Map([...container.children].map(node => [node.getAttribute(keyAttribute), node]));
    const signatures = new Map();
    let cursor = container.firstElementChild;
    for (let index = 0; index < next.length; index++) {
      const incoming = next[index], key = keys[index], signature = incoming.outerHTML;
      const existing = current.get(key);
      const unchanged = existing && (previous?.signatures?.get(key) ?? existing.outerHTML) === signature;
      const node = unchanged ? existing : incoming;
      if (existing && !unchanged) {
        const controls = [...existing.querySelectorAll('button, input, select, textarea, a[href]')];
        const focusIndex = controls.indexOf(document.activeElement);
        if (cursor === existing) cursor = incoming;
        existing.replaceWith(incoming);
        if (focusIndex >= 0) incoming.querySelectorAll('button, input, select, textarea, a[href]')[focusIndex]?.focus({ preventScroll: true });
      }
      if (node !== cursor) container.insertBefore(node, cursor);
      cursor = node.nextElementSibling;
      current.delete(key);
      signatures.set(key, signature);
    }
    for (const node of current.values()) node.remove();
    this.states.set(container, { markup, signatures });
  }
}
