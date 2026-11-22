// One shared policy for visibility-independent attendance assignment.
export class EventAudiencePolicy {
  static sections = Object.freeze(['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B']);
  static date(value) { return value?.toDate?.() || (value instanceof Date ? value : null); }
  static selected(event) {
    if (Array.isArray(event.audienceSections)) return event.audienceSections.length ? event.audienceSections : this.sections;
    return !event.audience || event.audience === 'All students' ? this.sections : [event.audience.replace(/^Section /, '')];
  }
  static label(event) { const sections = this.selected(event); return sections.length === 8 ? 'All students' : `Sections ${sections.join(', ')}`; }
  static matches(student, event) { return this.selected(event).includes(student.section); }
  static canAttend(student, event) {
    if (!student || student.active === false) return false;
    if (event.attendanceRoster) {
      if (Object.hasOwn(event.attendanceRoster, student.uid)) {
        return !Array.isArray(event.audienceSections) || this.selected(event).includes(event.attendanceRoster[student.uid]);
      }
      const joined = this.date(student.createdAt), captured = this.date(event.rosterCapturedAt);
      return Boolean(joined && captured && joined >= captured && this.matches(student, event));
    }
    return this.matches(student, event);
  }
  static addedAfterOpening(student, event) {
    if (!Array.isArray(event.audienceSections)) return false;
    const section = event.attendanceRoster?.[student.uid] ?? student.section;
    const assigned = this.date(event.sectionAssignedAt?.[section]), opened = this.date(event.openAt);
    return Boolean(opened && ((assigned && assigned > opened) || (this.date(student.createdAt) > opened)));
  }
  static assignment(students, sections, previous, { now = new Date(), timestamp }) {
    const selected = [...new Set(sections)].sort();
    if (!selected.length || selected.some(section => !this.sections.includes(section))) throw new Error('Select at least one valid section.');
    if (previous && this.date(previous.checkOutClosesAt) && this.date(previous.checkOutClosesAt) <= now) throw new Error('Closed-event participant groups cannot be changed.');
    const roster = Object.fromEntries(students.filter(student => student.active !== false && selected.includes(student.section)).map(student => [student.uid, student.section]));
    if (Object.keys(roster).length > 5000) throw new Error('Select fewer sections: the event supports up to 5,000 participants.');
    // A legacy event may already have mismatched audience text. Trust its saved
    // roster when deciding which groups are genuinely new, not that text.
    const oldSections = previous ? (Array.isArray(previous.audienceSections) ? this.selected(previous) : previous.attendanceRoster ? Object.values(previous.attendanceRoster) : []) : [];
    const sectionAssignedAt = Object.fromEntries(selected.map(section => [section, oldSections.includes(section)
      ? previous.sectionAssignedAt?.[section] || previous.rosterCapturedAt || timestamp() : timestamp()]));
    return { audienceSections: selected.length === 8 ? [] : selected,
      audience: selected.length === 8 ? 'All students' : selected.length === 1 ? `Section ${selected[0]}` : 'Selected sections',
      attendanceRoster: roster, rosterCapturedAt: timestamp(), sectionAssignedAt, rosterVersion: (previous?.rosterVersion || 0) + 1 };
  }
}
