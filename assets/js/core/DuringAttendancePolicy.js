export const duringTime = value => value?.toMillis?.() ?? value?.getTime?.() ?? (typeof value === 'number' ? value : Date.parse(value));

// A checkpoint is supplementary: it never changes arrival, completion, or fines.
export class DuringAttendancePolicy {
  static state(event, record, now = Date.now()) {
    const checkpoint = event?.duringAttendance;
    if (record?.duringAttendance?.confirmedAt) return 'confirmed';
    if (!checkpoint?.enabled) return 'not-required';
    if (!this.validWindow(event, checkpoint)) return 'unavailable';
    const start = duringTime(checkpoint.opensAt), end = duringTime(checkpoint.closesAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'not-required';
    if (now < start) return 'scheduled';
    if (!record?.checkedInAt || duringTime(record.checkedInAt) > end
      || (record.checkedOutAt && duringTime(record.checkedOutAt) <= start)) return 'not-required';
    if (now >= end) return 'missed';
    if (record.checkedOutAt) return 'not-required';
    return 'open';
  }
  static label(event, record, now = Date.now()) {
    const state = this.state(event, record, now);
    const checkpoint = event?.duringAttendance;
    if (state === 'not-required' && !record?.checkedInAt && !record?.checkedOutAt && checkpoint?.enabled
      && now >= duringTime(checkpoint.opensAt) && now < duringTime(checkpoint.closesAt)) return 'Check in first';
    return { confirmed: 'Confirmed', 'not-required': 'Not required', unavailable: 'Schedule needs review', scheduled: 'Scheduled', open: 'Open', missed: 'Missed · review' }[state];
  }
  static validWindow(event, checkpoint) {
    const start = duringTime(checkpoint?.opensAt), end = duringTime(checkpoint?.closesAt);
    return Number.isFinite(start) && Number.isFinite(end) && start < end
      && start >= duringTime(event.openAt) && end <= duringTime(event.closeAt);
  }
}

export function duringStatusMarkup(event, record, escapeHtml, now = Date.now()) {
  if (!event?.duringAttendance?.enabled && !record?.duringAttendance?.confirmedAt) return '';
  const state = DuringAttendancePolicy.state(event, record, now);
  const color = state === 'confirmed' ? 'green' : state === 'missed' ? 'orange' : 'blue';
  const remaining = state === 'open' ? ` · ${Math.max(1, Math.ceil((duringTime(event.duringAttendance.closesAt) - now) / 60000))} min remaining` : '';
  return `<p class="during-attendance-status"><span class="badge ${color}">During: ${escapeHtml(DuringAttendancePolicy.label(event, record, now))}${remaining}</span></p>`;
}
