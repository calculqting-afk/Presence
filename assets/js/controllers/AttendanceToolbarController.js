// Presentation-only behavior shared by the admin and student attendance views.
export class AttendanceToolbarController {
  constructor({ form, prefix, onClear, document: ownerDocument = document }) {
    Object.assign(this, { form, prefix, onClear, document: ownerDocument });
    this.expanded = false;
  }
  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.clear = this.document.querySelector(`#${this.prefix}ClearFilters`);
    this.toggle = this.document.querySelector(`#${this.prefix}ToggleFilters`);
    this.help = this.document.querySelector(`#${this.prefix}Help`);
    this.onReset = () => { this.form.reset(); this.onClear(); };
    this.onToggle = () => this.setExpanded(!this.expanded);
    this.onEscape = event => {
      if (event.key === 'Escape' && this.help.open) { this.help.open = false; this.help.querySelector('summary').focus(); }
    };
    this.clear.addEventListener('click', this.onReset);
    this.toggle.addEventListener('click', this.onToggle);
    this.document.addEventListener('keydown', this.onEscape);
    this.setExpanded(false);
  }
  setExpanded(expanded) {
    this.expanded = expanded;
    this.form.classList.toggle('filters-expanded', expanded);
    this.toggle.setAttribute('aria-expanded', String(expanded));
  }
  dispose() {
    if (!this.initialized) return;
    this.clear.removeEventListener('click', this.onReset);
    this.toggle.removeEventListener('click', this.onToggle);
    this.document.removeEventListener('keydown', this.onEscape);
    this.initialized = false;
  }
  static emptyState({ busy = false, partial = false, filtered = false } = {}) {
    const title = busy ? 'Loading attendance' : partial || filtered ? 'No matching records' : 'No attendance records yet';
    return `<div class="attendance-empty" role="status"><span class="attendance-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 10h16m-11 5h6"/></svg></span><h3>${title}</h3>${busy ? '' : partial ? '<p>Load more to continue searching.</p>' : filtered ? '<p>Try clearing your filters.</p>' : ''}</div>`;
  }
}
