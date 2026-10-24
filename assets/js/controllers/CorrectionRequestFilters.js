// Client-side filtering only; year() supplies display text, not a filter.
export class CorrectionRequestFilters {
  static year(section) { return String(section || '').trim().match(/^([1-4])/)?.[1] || ''; }
  static matches(request, student, { status = 'all', search = '', section = '' } = {}) {
    const currentSection = String(student?.section || '').trim();
    const haystack = [student?.firstName, student?.middleName, student?.lastName, student?.accountId, student?.email, request.studentUid].filter(Boolean).join(' ').toLowerCase();
    return (status === 'all' || request.status === status)
      && (!section || currentSection === section)
      && String(search).toLowerCase().trim().split(/\s+/).filter(Boolean).every(term => haystack.includes(term));
  }
}
