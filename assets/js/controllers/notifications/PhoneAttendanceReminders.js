// One serialized queue shared by dashboard reconciliation, logout, and login.
// Own only attendance notifications; never cancel other feature notifications.
let owner = null, queue = Promise.resolve();
const plugin = () => globalThis.PresenceNative?.isNative ? globalThis.PresenceNative.localNotifications : null;
export const supportsPhoneReminders = () => Boolean(plugin());
export function activatePhoneReminders(uid) { owner = uid; }
export function replacePhoneReminders(uid, reminders) {
  const run = async () => {
    const native = plugin();
    if (!native || (uid && owner !== uid)) return;
    const desired = uid && !globalThis.PresenceNative?.pushActive ? reminders.slice(0, 60) : [];
    const pending = (await native.getPending()).notifications.filter(item => item.extra?.presenceAttendance === true);
    const keys = new Set(desired.map(item => item.key));
    const obsolete = pending.filter(item => !keys.has(item.extra.key));
    if (obsolete.length) await native.cancel({ notifications: obsolete.map(({ id }) => ({ id })) });
    // Also remove already-delivered alerts after completion/logout/schedule changes.
    const delivered = (await native.getDeliveredNotifications()).notifications.filter(item => item.extra?.presenceAttendance === true && !keys.has(item.extra.key));
    if (delivered.length) await native.removeDeliveredNotifications({ notifications: delivered });
    if (!desired.length || owner !== uid) return;
    if ((await native.checkPermissions()).display !== 'granted') return 'permission-denied';
    const existing = new Set(pending.filter(item => !obsolete.includes(item)).map(item => item.extra.key));
    const used = new Set((await native.getPending()).notifications.map(item => item.id));
    let id = 1400000000;
    const notifications = desired.filter(item => !existing.has(item.key) && item.at > Date.now()).map(item => {
      while (used.has(id)) id++;
      used.add(id);
      const action = item.action === 'checkout' ? 'Checkout' : 'Check-in';
      return { id: id++, title: item.kind === 'opening' ? `${action} opening reminder` : `${action} cutoff reminder`, body: item.body, channelId: 'attendance-reminders',
        smallIcon: 'ic_stat_attendance', isExactNotification: false, schedule: { at: new Date(item.at) },
        extra: { presenceAttendance: true, key: item.key, eventId: item.eventId, kind: item.kind || 'cutoff' } };
    });
    if (notifications.length && owner === uid) {
      await native.createChannel({ id: 'attendance-reminders', name: 'Attendance reminders', description: 'Upcoming attendance cutoffs', importance: 4, vibration: true });
      await native.schedule({ notifications });
    }
    return 'synced';
  };
  queue = queue.catch(() => {}).then(run);
  return queue;
}
export function clearPhoneReminders() { owner = null; return replacePhoneReminders(null, []); }
export async function requestPhoneReminders() { return (await plugin()?.requestPermissions())?.display === 'granted'; }
export async function phoneReminderPermission() { return (await plugin()?.checkPermissions())?.display || 'unavailable'; }
