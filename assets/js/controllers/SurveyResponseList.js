// Search/sort only loaded pages; never fetches an unbounded response collection.
export class SurveyResponseList {
  constructor() { this.filters = { search: '', section: 'all', status: 'all', sort: 'newest' }; }
  section(row, event) { return event?.attendanceRoster?.[row.studentUid] || 'Unknown'; }
  sections(rows, event) { return [...new Set(rows.map(row => this.section(row, event)))].sort(); }
  apply(rows, event) {
    const { search, section, status, sort } = this.filters;
    const term = search.trim().toLowerCase();
    const result = rows.filter(row => (!term || [row.studentName, row.studentId, row.studentUid, this.section(row, event)].join(' ').toLowerCase().includes(term))
      && (section === 'all' || this.section(row, event) === section) && (status === 'all' || row.status === status));
    const time = value => (value?.toMillis?.() ?? new Date(value).getTime()) || 0;
    const compare = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
    return result.sort((a, b) => (sort === 'name' ? compare(a.studentName, b.studentName)
      : sort === 'id' ? compare(a.studentId, b.studentId)
      : sort === 'section' ? compare(this.section(a, event), this.section(b, event)) || compare(a.studentName, b.studentName)
      : time(b.updatedAt) - time(a.updatedAt)) || compare(a.studentUid, b.studentUid));
  }
}
