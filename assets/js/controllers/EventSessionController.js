import { EventSessionPolicy } from './EventSessionPolicy.js';

export class EventSessionController {
  constructor({ document, scope }) {
    this.document = document;
    scope.mount(document.querySelector('#eventTimeIn').closest('.field'), 'beforebegin', '<div class="field full"><label for="eventAttendanceMode">Enable attendance</label><select id="eventAttendanceMode"><option value="morning">Morning only</option><option value="afternoon">Afternoon only</option><option value="both">Both — Morning and Afternoon</option></select><small id="eventSessionHelp"></small></div><div class="field full"><strong id="eventPrimarySessionTitle">Morning attendance</strong><small>Each session has its own attendance record. You can edit ongoing time windows with confirmation. Recorded attendance is preserved. Finished sessions can reopen checkout by extending only its cutoff on the same date; a saved check-in is required.</small></div>');
    scope.mount(document.querySelector('#eventAudience').closest('.field'), 'beforebegin', `<fieldset id="eventAfternoonFields" class="field full" hidden><legend>Afternoon attendance</legend><div class="form-grid">${[['TimeIn','Check-in opens'],['CheckInCutoff','Check-in cutoff'],['TimeOut','Check-out opens'],['CheckOutCutoff','Checkout cutoff']].map(([key,label])=>`<div class="field"><label for="eventAfternoon${key}">${label}</label><input id="eventAfternoon${key}" type="time"></div>`).join('')}</div></fieldset>`);
    scope.listen(document.querySelector('#eventAttendanceMode'), 'change', () => this.render());
    this.set();
  }
  fields(prefix) { return ['TimeIn','CheckInCutoff','TimeOut','CheckOutCutoff'].map(key=>this.document.querySelector(`#event${prefix}${key}`)); }
  render() {
    const mode = this.document.querySelector('#eventAttendanceMode').value;
    const enabled = mode === 'both';
    this.document.querySelector('#eventPrimarySessionTitle').textContent = mode === 'afternoon' ? 'Afternoon attendance' : 'Morning attendance';
    this.document.querySelector('#eventAfternoonFields').hidden = !enabled;
    for (const field of this.fields('Afternoon')) field.required = enabled;
  }
  set(primary, afternoon) {
    this.afternoonVersion = afternoon?.rosterVersion;
    const toggle = this.document.querySelector('#eventAttendanceMode');
    toggle.value = afternoon ? 'both' : primary ? EventSessionPolicy.period(primary) : 'morning';
    toggle.disabled = Boolean(afternoon);
    const opened = EventSessionPolicy.opened(primary), period = primary && EventSessionPolicy.period(primary);
    for (const mode of ['morning', 'afternoon', 'both']) this.document.querySelector(`#eventAttendanceMode option[value="${mode}"]`).disabled = opened && (period === 'afternoon' ? mode !== 'afternoon' : mode === 'afternoon');
    this.document.querySelector('#eventSessionHelp').textContent = afternoon
      ? 'Published sessions are kept to preserve attendance. Both sessions use these participant groups and this location; closed-session groups cannot change.'
      : 'Choose Morning only, Afternoon only, or Both. Both requires separate check-in and checkout for each session.';
    const closed = event => Boolean(event?.checkOutClosesAt && EventSessionPolicy.opened({openAt:event.checkOutClosesAt}));
    for (const [index, field] of this.fields('').entries()) field.disabled = index !== 3 && (closed(primary) || primary?.checkoutOnlyReopened === true);
    for (const [index, field] of this.fields('Afternoon').entries()) {
      field.value = afternoon?.[['timeIn','checkInCutoff','timeOut','checkOutCutoff'][index]] || '';
      field.disabled = index !== 3 && (closed(afternoon) || afternoon?.checkoutOnlyReopened === true);
    }
    this.document.querySelector('#eventDate').disabled = EventSessionPolicy.opened(primary) || EventSessionPolicy.opened(afternoon);
    this.render();
  }
  read() { const mode = this.document.querySelector('#eventAttendanceMode').value; return { mode, enabled: mode === 'both', times: this.fields('Afternoon').map(field=>field.value) }; }
}
