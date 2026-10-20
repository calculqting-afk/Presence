// Presentation-only ordering: never substitutes checkout/update time for arrival.
export class AttendanceSort {
  static milliseconds(value) {
    if (value == null) return NaN;
    try {
      const time = value.toMillis?.() ?? value.toDate?.()?.getTime?.()
        ?? value.getTime?.() ?? (typeof value === 'number' ? value
          : typeof value.seconds === 'number' ? value.seconds * 1000 + (value.nanoseconds || 0) / 1e6 : NaN);
      return Number.isFinite(time) ? time : NaN;
    } catch { return NaN; }
  }
  static checkIn(record) {
    const time = this.milliseconds(record.checkedInAt);
    return Number.isFinite(time) ? time : this.milliseconds(record.attendedAt);
  }
  static compare(a, b, { sort = 'check-in-desc', time = record => this.checkIn(record), name, key }) {
    const fallback = () => name(a).localeCompare(name(b)) || key(a).localeCompare(key(b));
    if (['check-in-desc', 'check-in-asc', 'no-check-in'].includes(sort)) {
      const first = time(a), second = time(b);
      const hasFirst = Number.isFinite(first), hasSecond = Number.isFinite(second);
      if (hasFirst !== hasSecond) return (hasFirst ? -1 : 1) * (sort === 'no-check-in' ? -1 : 1);
      if (hasFirst && first !== second) return (sort === 'check-in-asc' ? 1 : -1) * (first - second);
      return fallback();
    }
    return (sort.endsWith('-desc') ? -1 : 1) * name(a).localeCompare(name(b)) || key(a).localeCompare(key(b));
  }
}
