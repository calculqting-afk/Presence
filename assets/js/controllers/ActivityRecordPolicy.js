export const ACTIVITY_ACTIONS=Object.freeze({'event-created':'Event created','event-updated':'Event updated','role-changed':'Role changed',
  'attendance-revoked':'Attendance revoked','attendance-corrected':'Attendance corrected','arrival-recalculated':'Arrival recalculated','student-password-reset':'Password reset','student-id-corrected':'Student ID corrected'});
export function activitySnapshot(kind,data) {
  if(!data)return null;
  if(kind==='event')return {...Object.fromEntries(['name','date','timeIn','checkInCutoff','timeOut','checkOutCutoff','location','audience','description'].map(field=>[field,data[field]||''])),audienceSections:data.audienceSections||[]};
  if(kind==='role')return {role:data.role||'student'};
  return {checkedInAt:data.checkedInAt||data.attendedAt||null,checkedOutAt:data.checkedOutAt||null,arrivalStatus:data.arrivalStatus||'',status:data.status||''};
}
export function activityRecord({action,actorUid,subjectUid='',subjectId='',subjectName='',eventId='',eventName='',reason,before,after,createdAt}) {
  return {action,actorUid,subjectUid,subjectId,subjectName,eventId,eventName,reason,before,after,createdAt};
}
