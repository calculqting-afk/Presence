// Display-only directory filter. An empty selection means all sections.
export class StudentSectionFilter {
  constructor({ root, document, escapeHtml, onChange }) {
    Object.assign(this, { root, document, escapeHtml, onChange });
    this.selected = new Set();
    this.options = [];
  }
  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.change = event => {
      if (event.target.dataset?.sectionOption === undefined) return;
      const section = event.target.value;
      if (!this.options.includes(section)) return;
      if (event.target.checked) this.selected.add(section); else this.selected.delete(section);
      this.updateLabel(); this.onChange();
    };
    this.click = event => {
      const action = event.target.closest('[data-section-action]')?.dataset.sectionAction;
      if (!action) return;
      if (action === 'all') this.selected = new Set(this.options);
      else if (action === 'clear') this.selected.clear(); else return;
      this.renderOptions(); this.onChange();
    };
    this.outside = event => { if (!this.root.contains(event.target)) this.root.open = false; };
    this.key = event => { if (event.key === 'Escape' && this.root.open) { this.root.open = false; this.root.querySelector('summary').focus(); } };
    this.root.addEventListener('change', this.change);
    this.root.addEventListener('click', this.click);
    this.document.addEventListener('click', this.outside);
    this.root.addEventListener('keydown', this.key);
  }
  setOptions(sections) {
    this.options = [...new Set([...sections, ...this.selected])].sort();
    this.renderOptions();
  }
  matches(section) { return !this.selected.size || this.selected.has(section); }
  reset() { this.selected.clear(); this.root.open = false; this.renderOptions(); }
  updateLabel() {
    const all = !this.selected.size || this.selected.size === this.options.length;
    this.root.querySelector('[data-section-filter-label]').textContent = all ? 'All sections' : this.selected.size === 1 ? `Section ${[...this.selected][0]}` : `${this.selected.size} sections selected`;
  }
  renderOptions() {
    const e = this.escapeHtml;
    this.root.querySelector('[data-section-options]').innerHTML = this.options.map(section => `<label><input type="checkbox" data-section-option value="${e(section)}"${this.selected.has(section) ? ' checked' : ''}><span>Section ${e(section)}</span></label>`).join('') || '<p>No sections available.</p>';
    this.updateLabel();
  }
  dispose() {
    if (!this.initialized) return;
    this.root.removeEventListener('change', this.change);
    this.root.removeEventListener('click', this.click);
    this.document.removeEventListener('click', this.outside);
    this.root.removeEventListener('keydown', this.key);
    this.initialized = false;
  }
}
