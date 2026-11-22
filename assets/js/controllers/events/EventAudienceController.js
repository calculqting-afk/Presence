import { EventAudiencePolicy } from './EventAudiencePolicy.js';

export class EventAudienceController {
  constructor({ document, scope }) {
    this.select = document.querySelector('#eventAudience');
    this.group = document.querySelector('#eventSectionChoices');
    this.boxes = [...document.querySelectorAll('[data-event-section]')];
    scope.listen(this.select, 'change', () => this.render());
    this.render();
  }
  render() { if (this.group) this.group.hidden = this.select.value !== 'Selected sections'; }
  read() {
    if (this.select.value === 'All students') return [...EventAudiencePolicy.sections];
    if (this.select.value.startsWith('Section ')) return [this.select.value.slice(8)];
    return this.boxes.filter(box => box.checked).map(box => box.value);
  }
  set(event = { audience: 'All students' }) {
    const sections = EventAudiencePolicy.selected(event);
    this.select.value = sections.length === 8 ? 'All students' : 'Selected sections';
    this.boxes.forEach(box => { box.checked = sections.length !== 8 && sections.includes(box.value); });
    this.render();
  }
}
