import { EventSessionPolicy } from './EventSessionPolicy.js';

export class EventSessionController {
  constructor({ document, scope }) {
    this.document = document;
    scope.mount(document.querySelector('#eventTimeIn').closest('.field'), 'beforebegin', '<div class="field full"><strong>Morning attendance</strong><small>Each session has its own attendance record. Schedules lock once the session opens.</small></div>');
    scope.mount(document.querySelector('#eventAudience').closest('.field'), 'beforebegin', `<div class="field full"><label><input id="eventAfternoonEnabled" type="checkbox"> Enable afternoon attendance (optional)</label><small id="eventSessionHelp">Students complete the morning and afternoon separately. Existing attendance cards keep their current layout.</small></div><fieldset id="eventAfternoonFields" class="field full" hidden><legend>Afternoon attendance</legend><div class="form-grid">${[['TimeIn','Check-in opens'],['CheckInCutoff','Check-in cutoff'],['TimeOut','Check-out opens'],['CheckOutCutoff','Checkout cutoff']].map(([key,label])=>`<div class="field"><label for="eventAfternoon${key}">${label}</label><input id="eventAfternoon${key}" type="time"></div>`).join('')}</div></fieldset>`);
    scope.listen(document.querySelector('#eventAfternoonEnabled'), 'change', () => this.render());
    this.set();
  }
  fields(prefix) { return ['TimeIn','CheckInCutoff','TimeOut','CheckOutCutoff'].map(key=>this.document.querySelector(`#event${prefix}${key}`)); }
  render() {
    const enabled = this.document.querySelector('#eventAfternoonEnabled').checked;
    this.document.querySelector('#eventAfternoonFields').hidden = !enabled;
    for (const field of this.fields('Afternoon')) field.required = enabled;
  }
  set(primary, afternoon) {
    this.afternoonVersion = afternoon?.rosterVersion;
    const toggle = this.document.querySelector('#eventAfternoonEnabled');
    toggle.checked = Boolean(afternoon); toggle.disabled = Boolean(afternoon);
    this.document.querySelector('#eventSessionHelp').textContent = afternoon
      ? 'Published sessions are kept to preserve attendance. Both sessions use these participant groups and this location; closed-session groups cannot change.'
      : 'Afternoon is optional. Add it before its check-in opens; students complete each session separately.';
    for (const field of this.fields('')) field.disabled = EventSessionPolicy.opened(primary);
    for (const [index, field] of this.fields('Afternoon').entries()) {
      field.value = afternoon?.[['timeIn','checkInCutoff','timeOut','checkOutCutoff'][index]] || '';
      field.disabled = EventSessionPolicy.opened(afternoon);
    }
    this.document.querySelector('#eventDate').disabled = EventSessionPolicy.opened(primary) || EventSessionPolicy.opened(afternoon);
    this.render();
  }
  read() { return { enabled: this.document.querySelector('#eventAfternoonEnabled').checked, times: this.fields('Afternoon').map(field=>field.value) }; }
}
