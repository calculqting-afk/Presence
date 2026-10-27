import { EventAudiencePolicy } from '../../../assets/js/controllers/EventAudiencePolicy.js';
import { AttendanceViews } from '../../../assets/js/controllers/AttendanceViews.js';

export const SHARDS = 32;
export const NEVER = 8640000000000000;
const minute = 60000;
export function milestones(event, publishedAt) {
  const open = AttendanceViews.time(event, 'openAt'), checkout = AttendanceViews.time(event, 'closeAt');
  const close = AttendanceViews.time(event, 'checkOutClosesAt');
  const late = event.checkInClosesAt?.getTime?.() ?? (event.date && event.checkInCutoff ? +new Date(`${event.date}T${event.checkInCutoff}:00+08:00`) : checkout);
  if (![open, checkout, close, late].every(Number.isFinite) || open >= close || checkout >= close || late <= open || late > close) return [];
  const items = [
    ['published', publishedAt, Math.min(open, publishedAt + 10 * minute)],
    ['checkin-soon', open - 10 * minute, open], ['checkin-open', open, Math.min(late, open + 3 * minute)],
    ...[10,5].map(n=>[`ontime-${n}`, late - n * minute, late]),
    ['ontime-ended', late, Math.min(close, late + 3 * minute)],
    ['checkout-open', checkout, Math.min(close, checkout + 3 * minute)],
    ...[10,5].map(n=>[`closing-${n}`, close - n * minute, close]),
    ['closed', close, close + 3 * minute]
  ];
  return items.filter(([kind, at, expiry]) => Number.isFinite(at) && at < expiry &&
    (kind === 'published' ? publishedAt < open : !kind.startsWith('ontime-') || kind === 'ontime-ended' || at > open) &&
    (!kind.startsWith('closing-') || at > open)).map(([kind, at, expiresAt])=>({kind,at,expiresAt}));
}
export function eligible(student, event, record, kind, now) {
  if (student?.active !== true || student.passwordResetRequired === true || student.mustChangePassword === true) return false;
  const checkedIn = Boolean(record?.checkedInAt || record?.attendedAt);
  const completed = Boolean(record?.checkedOutAt || record?.status === 'completed');
  if (completed) return false;
  const assigned = EventAudiencePolicy.canAttend(student,event);
  if (!assigned && !checkedIn) return false;
  if (kind === 'checkout-open') return checkedIn;
  if (kind.startsWith('checkin-') || kind.startsWith('ontime-')) return !checkedIn && assigned && !event.checkoutOnlyReopened;
  if (kind === 'published') return assigned && !event.checkoutOnlyReopened && now < AttendanceViews.time(event,'openAt');
  if (event.checkoutOnlyReopened && !checkedIn) return false;
  return true;
}
export function message(event, record, kind, now) {
  const name = String(event.name || 'Attendance session').slice(0,140);
  const checkedIn = Boolean(record?.checkedInAt || record?.attendedAt);
  const remaining = field => Math.max(1,Math.ceil((AttendanceViews.time(event,field)-now)/minute));
  let title, detail;
  if (kind==='published') { title='New event published';detail='Open Presence to view your attendance schedule.'; }
  else if (kind==='checkin-soon') { title='Attendance starts soon';detail=`Check-in opens in about ${remaining('openAt')} minutes.`; }
  else if (kind==='checkin-open') { title='Check-in is now open';detail='Open Presence to check in.'; }
  else if (kind.startsWith('ontime-') && kind!=='ontime-ended') { title='On-time check-in ends soon';const late=event.checkInClosesAt?.getTime?.() ?? +new Date(`${event.date}T${event.checkInCutoff}:00+08:00`); detail=`About ${Math.max(1,Math.ceil((late-now)/minute))} minutes before the late threshold. Check the current schedule in Presence.`; }
  else if (kind==='ontime-ended') { title='On-time check-in has ended';detail='You can still check in as Late until the final attendance cutoff.'; }
  else if (kind==='checkout-open') { title='Check-out is now open';detail='Open Presence to complete your check-out.'; }
  else if (kind==='closed') { title='Attendance session closed';detail=checkedIn?'Your check-out is not recorded. Review your attendance in Presence.':'Your check-in is not recorded. Review your attendance in Presence.'; }
  else { title='Attendance closes soon';detail=`About ${remaining('checkOutClosesAt')} minutes remaining. ${checkedIn?'Complete your check-out.':'Check in before attendance closes; late arrivals are allowed.'}`; }
  return {title,body:`${name}: ${detail}`};
}
export function revisionData(event) {
  return JSON.stringify([event.name,event.date,event.timeIn,event.timeOut,event.checkInCutoff,event.checkOutCutoff,
    ...['openAt','closeAt','checkOutClosesAt'].map(field=>AttendanceViews.time(event,field)),
    event.checkInClosesAt?.getTime?.(),event.rosterVersion,event.audienceSections,event.attendanceRoster,event.checkoutOnlyReopened]);
}
