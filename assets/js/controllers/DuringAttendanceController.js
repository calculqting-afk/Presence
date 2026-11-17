import { PasswordResetApi } from './PasswordResetApi.js';
import { duringTime } from '../core/DuringAttendancePolicy.js';

export class DuringAttendanceController {
  constructor({ document, getEvents, getUser, can, notify, onSaved, api }) {
    Object.assign(this, { document, getEvents, getUser, can, notify, onSaved, api });
  }
  initialize() {
    this.onClick = event => {
      const button = event.target.closest?.('[data-during-event]');
      if (button && this.can('manageEvents')) this.open(button.dataset.duringEvent);
    };
    this.document.addEventListener('click', this.onClick);
  }
  open(eventId) {
    if (this.busy || !this.can('manageEvents')) return;
    const event = this.getEvents().find(item => item.id === eventId);
    if (!event) return;
    this.close();
    const checkpoint = event.duringAttendance;
    const dialog = this.document.createElement('dialog');
    dialog.className = 'policy-agreement during-modal';
    dialog.setAttribute('aria-labelledby', 'duringAttendanceTitle');
    dialog.setAttribute('aria-describedby', 'duringDescription');
    dialog.innerHTML = `<form class="policy-agreement-content during-form">
      <header class="during-header"><div><span class="during-eyebrow">Optional checkpoint</span><h2 id="duringAttendanceTitle">During attendance</h2><p class="during-session" data-session></p></div><button type="button" class="during-close" data-close aria-label="Close During attendance">×</button></header>
      <div class="during-body"><p id="duringDescription" class="during-description">Let checked-in students confirm they are still present during the event.</p>
      <label class="during-enable"><span><strong>Enable during attendance</strong><small>Applies only to this session</small></span><input type="checkbox" name="enabled" role="switch"></label>
      <section class="during-details" aria-labelledby="duringDetailsTitle"><div class="during-section-heading"><h3 id="duringDetailsTitle">Checkpoint details</h3><span>Philippine time</span></div>
      <div class="form-grid"><div class="field full"><label for="duringLabel">Checkpoint name</label><input id="duringLabel" name="label" maxlength="80" placeholder="e.g. Mid-event check"></div>
      <div class="field"><label for="duringOpens">Opens at</label><input id="duringOpens" name="opens" type="time" aria-describedby="duringTimeHelp"></div><div class="field"><label for="duringCloses">Closes at</label><input id="duringCloses" name="closes" type="time" aria-describedby="duringTimeHelp"></div></div>
      <p id="duringTimeHelp" class="during-help">Choose future times on this session’s date, ending before checkout opens. Settings lock when the checkpoint starts.</p></section>
      <div class="during-notice"><strong>For presence review only</strong><p>Missing this checkpoint won’t automatically create a fine.</p></div><p class="during-status" data-status role="status" aria-live="polite"></p></div>
      <footer class="policy-actions during-footer"><button type="button" class="outline-button" data-cancel>Cancel</button><button type="submit" class="primary-button">Save checkpoint</button></footer></form>`;
    dialog.querySelector('[data-close]').onclick = () => this.close();
    const field = name => dialog.querySelector(`[name="${name}"]`);
    dialog.querySelector('[data-session]').textContent = `${event.name} · ${event.date}`;
    field('enabled').checked = checkpoint?.enabled === true;
    field('label').value = checkpoint?.label || 'Mid-event check';
    const time = value => Number.isFinite(duringTime(value)) ? new Date(duringTime(value) + 8 * 3600000).toISOString().slice(11, 16) : '';
    field('opens').value = time(checkpoint?.opensAt); field('closes').value = time(checkpoint?.closesAt);
    const locked = checkpoint?.enabled && Date.now() >= duringTime(checkpoint.opensAt);
    const update = () => { for (const name of ['label','opens','closes']) { field(name).disabled = locked || !field('enabled').checked; field(name).required = field('enabled').checked; } };
    field('enabled').onchange = update; update();
    if (locked) {
      field('enabled').disabled = true; dialog.querySelector('[type="submit"]').disabled = true;
      dialog.querySelector('[data-status]').textContent = 'This checkpoint has started. Settings are locked.';
    }
    dialog.querySelector('[data-cancel]').onclick = () => this.close();
    dialog.addEventListener('cancel', e => { if (this.busy) e.preventDefault(); else this.close(); });
    dialog.querySelector('form').onsubmit = async submit => {
      submit.preventDefault(); if (this.busy || locked) return;
      const enabled = field('enabled').checked;
      const body = { eventId, enabled, revision: checkpoint?.id || '', ...(enabled ? {
        label: field('label').value.trim(), opensAt: Date.parse(`${event.date}T${field('opens').value}:00+08:00`), closesAt: Date.parse(`${event.date}T${field('closes').value}:00+08:00`)
      } : {}) };
      this.busy = true;
      for (const button of dialog.querySelectorAll('button')) button.disabled = true;
      dialog.querySelector('[data-status]').textContent = 'Saving checkpoint…';
      try {
        this.api ||= new PasswordResetApi();
        const result = await this.api.call('/v1/admin/during-attendance', this.getUser(), body);
        event.duringAttendance = result.checkpoint; this.onSaved?.();
        this.busy = false; this.close(); this.notify('During attendance saved', enabled ? 'Students with a saved check-in can confirm during the selected window.' : 'During attendance is off for this session.');
      } catch (error) { dialog.querySelector('[data-status]').textContent = error.message; }
      finally { this.busy = false; for (const button of dialog.querySelectorAll('button')) button.disabled = false; }
    };
    this.dialog = dialog; this.document.body.append(dialog); dialog.showModal();
  }
  close() { if (this.busy) return; this.dialog?.close(); this.dialog?.remove(); this.dialog = null; }
  dispose() { this.document.removeEventListener('click', this.onClick); this.dialog?.close(); this.dialog?.remove(); this.dialog = null; }
}
