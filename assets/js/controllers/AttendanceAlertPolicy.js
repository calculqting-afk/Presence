import { EventAudiencePolicy } from './EventAudiencePolicy.js';
import { AttendanceViews } from './AttendanceViews.js';

// Check-in remains possible (as Late) until the final checkout cutoff.
export class AttendanceAlertPolicy {
  static reminders({ student, events = [], attendance = [], ready = false }, now = Date.now()) {
    if (!ready || !student?.uid || student.active !== true) return [];
    const records = new Map(attendance.map(record => [record.eventId, record]));
    return events.flatMap(event => {
      const record = records.get(event.id);
      const checkedIn = Boolean(record?.checkedInAt || record?.attendedAt);
      if (record?.checkedOutAt || record?.status === 'completed') return [];
      if (!checkedIn && (event.checkoutOnlyReopened || !EventAudiencePolicy.canAttend(student, event))) return [];
      const close = AttendanceViews.time(event, 'checkOutClosesAt');
      const open = AttendanceViews.time(event, checkedIn ? 'closeAt' : 'openAt');
      if (![close, open].every(Number.isFinite) || close <= now || open >= close) return [];
      const action = checkedIn ? 'checkout' : 'check-in';
      const label = checkedIn ? 'Checkout' : 'Check-in';
      const formatTime = time => new Date(time).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
      const opening = { key: `${student.uid}:${event.id}:${action}:opens:${open}:${close}`,
        kind: 'opening', eventId: event.id, action, open, close, at: open,
        expiresAt: Math.min(open + 2 * 60000, close), title: `${label} is open`,
        body: `${event.name || 'Attendance session'}: ${label.toLowerCase()} opens ${formatTime(open)} (Philippine time). Open Presence to ${checkedIn ? 'check out' : 'check in'} and verify the latest schedule.` };
      const closing = [10, 5].map(minutes => ({
        key: `${student.uid}:${event.id}:${action}:${close}:${minutes}`,
        kind: 'cutoff', eventId: event.id, action, minutes, close, open, at: close - minutes * 60000, expiresAt: close,
        title: `${checkedIn ? 'Checkout' : 'Check-in'} closes soon`,
        body: `${event.name || 'Attendance session'}: ${checkedIn ? 'checkout' : 'check-in (late arrivals allowed)'} cutoff ${new Date(close).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })} (Philippine time). Reminder scheduled ${minutes} minutes before; check the latest schedule in Presence.`
      })).filter(reminder => reminder.at > open);
      return [...(opening.expiresAt > now ? [opening] : []), ...closing];
    }).sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  }
}
