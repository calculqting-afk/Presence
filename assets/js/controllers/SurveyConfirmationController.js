// Native dialog provides modal focus containment and Escape handling.
export class SurveyConfirmationController {
  constructor({ document = globalThis.document, now = () => Date.now(), schedule = callback => setInterval(callback, 200), cancelTimer = clearInterval } = {}) { Object.assign(this, { document, now, schedule, cancelTimer }); }
  open(enabled, options = {}) {
    if (this.resolve) return Promise.resolve(false);
    if (!this.dialog) {
      this.dialog = this.document.createElement('dialog');
      this.dialog.className = 'survey-confirmation';
      this.dialog.setAttribute('aria-labelledby', 'surveyToggleTitle');
      this.dialog.innerHTML = '<h2 id="surveyToggleTitle"></h2><p></p><div class="modal-actions"><button type="button" class="outline-button" data-cancel>Cancel</button><button type="button" class="primary-button" data-confirm></button></div>';
      this.dialog.querySelector('[data-cancel]').addEventListener('click', () => this.finish(false));
      this.dialog.querySelector('[data-confirm]').addEventListener('click', () => this.finish(true));
      this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.finish(false); });
      this.document.body.append(this.dialog);
    }
    this.dialog.querySelector('h2').textContent = options.title || (enabled ? 'Reopen survey?' : 'Pause survey?');
    this.dialog.querySelector('p').textContent = options.message || (enabled ? 'Students can answer within the original survey window. The deadline will not change.' : 'New answers will be blocked. Existing responses and saved progress will be kept.');
    this.confirmLabel = options.label || (enabled ? 'Reopen survey' : 'Pause survey');
    this.readyAt = this.now() + (options.countdown || 0) * 1000;
    const confirm = this.dialog.querySelector('[data-confirm]');
    confirm.classList?.toggle('danger', Boolean(options.countdown));
    this.paintCountdown();
    if (options.countdown) this.timer = this.schedule(() => this.paintCountdown());
    return new Promise(resolve => {
      this.resolve = resolve;
      try { this.dialog.showModal(); this.dialog.querySelector('[data-cancel]').focus(); }
      catch (error) { this.finish(false); throw error; }
    });
  }
  paintCountdown() {
    const seconds = Math.max(0, Math.ceil((this.readyAt - this.now()) / 1000));
    const confirm = this.dialog.querySelector('[data-confirm]');
    confirm.disabled = seconds > 0;
    confirm.textContent = seconds ? `Wait ${seconds}s` : this.confirmLabel;
    if (!seconds && this.timer != null) { this.cancelTimer(this.timer); this.timer = null; }
  }
  finish(value) {
    if (value && this.now() < this.readyAt) return;
    if (this.timer != null) { this.cancelTimer(this.timer); this.timer = null; }
    const resolve = this.resolve; this.resolve = null; this.dialog?.close(); resolve?.(value);
  }
  dispose() { this.finish(false); this.dialog?.remove(); this.dialog = null; }
}
