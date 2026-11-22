import { SafeError } from './firebase.js';
import { ResetService, isSuperAuthority } from './service.js';
import { requireActiveDevice } from './device-session.js';
import { AttendanceSecurityService } from './attendance-security.js';
import { DuringAttendancePolicy, duringTime } from '../../../assets/js/core/attendance/DuringAttendancePolicy.js';
import { EventAudiencePolicy } from '../../../assets/js/controllers/events/EventAudiencePolicy.js';
import { GeofenceBoundary } from '../../../assets/js/controllers/location/GeofenceBoundary.js';
import { attendanceLocationIssue } from '../../../assets/js/controllers/location/DeviceLocationService.js';
import { PolicyAgreementPolicy } from '../../../assets/js/core/accounts/PolicyAgreementPolicy.js';

export function requireDuring(event, record, now, uid, eventId) {
  if (!event?.duringAttendance?.enabled || !DuringAttendancePolicy.validWindow(event, event.duringAttendance)
    || now < duringTime(event.duringAttendance.opensAt) || now >= duringTime(event.duringAttendance.closesAt)) throw new SafeError(409, 'During attendance is not open for this session.');
  const checkedIn = duringTime(record?.checkedInAt);
  if (!Number.isFinite(checkedIn) || record.checkedOutAt || record.status !== 'checked-in'
    || record.studentUid !== uid || record.eventId !== eventId || record.eventDate !== event.date
    || checkedIn > now || new Date(checkedIn + 8 * 3600000).toISOString().slice(0, 10) !== event.date) throw new SafeError(409, 'A saved check-in without checkout is required for During attendance.');
}

export class DuringAttendanceService {
  constructor(db, now = () => Date.now()) { Object.assign(this, { db, now }); }
  validBody(body, fields) {
    if (Object.keys(body).some(key => !fields.includes(key)) || !/^[A-Za-z0-9_-]{1,128}$/.test(body.eventId || '')) throw new SafeError(400, 'Choose a valid attendance session.');
  }
  async configure(claims, body) {
    this.validBody(body, ['eventId', 'enabled', 'label', 'opensAt', 'closesAt', 'revision']);
    if (typeof body.enabled !== 'boolean' || typeof body.revision !== 'string') throw new SafeError(400, 'Refresh the session before saving.');
    const user = await new ResetService(this.db, this.now).authenticate(claims);
    await requireActiveDevice(this.db, claims);
    let checkpoint;
    await this.db.transaction(async get => {
      const profile = await get('students/' + claims.sub), active = await get('accountSessions/' + claims.sub);
      if (active && active.sessionId !== claims.presenceSession) throw new SafeError(401, 'Sign in again.');
      if (!isSuperAuthority(claims, user) && !(profile?.active === true && !profile.mustChangePassword && !profile.passwordResetRequired && ['head_admin', 'attendance_admin'].includes(profile.role))) throw new SafeError(403, 'Attendance management permission is required.');
      const event = await get('events/' + body.eventId), now = this.now(), previous = event?.duringAttendance;
      if (!event || !(now < duringTime(event.closeAt))) throw new SafeError(409, 'Choose an upcoming or ongoing session before checkout opens.');
      if ((previous?.id || '') !== body.revision) throw new SafeError(409, 'The checkpoint changed. Close and reopen its settings.');
      if (previous?.enabled && now >= duringTime(previous.opensAt)) throw new SafeError(409, 'This checkpoint has started. Its settings are locked to preserve records.');
      checkpoint = { id: crypto.randomUUID(), enabled: body.enabled };
      if (body.enabled) {
        if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 80
          || !Number.isFinite(body.opensAt) || !Number.isFinite(body.closesAt)) throw new SafeError(400, 'Enter a label and valid opening and closing times.');
        Object.assign(checkpoint, { label: body.label.trim(), opensAt: new Date(body.opensAt), closesAt: new Date(body.closesAt) });
        if (body.opensAt < now || !DuringAttendancePolicy.validWindow(event, checkpoint)) throw new SafeError(400, 'The checkpoint must open in the future, within this session, and close before checkout opens.');
      }
      return [this.db.write('events/' + body.eventId, { duringAttendance: checkpoint, updatedAt: new Date(now) }, { merge: true, exists: true }),
        this.db.write('eventPushOutbox/' + body.eventId, { eventId: body.eventId, pending: true, requestedAt: new Date(now) }),
        this.db.write('activityLogs/during_' + checkpoint.id, { action: 'during-attendance-configured', actorUid: claims.sub, eventId: body.eventId, eventName: event.name,
          reason: body.enabled ? 'During attendance enabled' : 'During attendance disabled', before: previous || null, after: checkpoint, createdAt: new Date(now) }, { exists: false })];
    });
    return { saved: true, checkpoint };
  }
  async confirm(claims, body) {
    this.validBody(body, ['eventId', 'checkpointId', 'location', 'sampledAt']);
    await new ResetService(this.db, this.now).authenticate(claims);
    await requireActiveDevice(this.db, claims);
    let existing = false, confirmedAt;
    await this.db.transaction(async get => {
      const security = new AttendanceSecurityService(this.db, this.now), profile = await security.student(claims, get);
      if (!['student', 'viewer'].includes(profile.role || 'student')) throw new SafeError(403, 'A student account is required.');
      const active = await get('accountSessions/' + claims.sub);
      if (active && active.sessionId !== claims.presenceSession) throw new SafeError(401, 'Sign in again.');
      const event = await get('events/' + body.eventId), path = 'attendance/' + claims.sub + '_' + body.eventId, record = await get(path), now = this.now();
      requireDuring(event, record, now, claims.sub, body.eventId);
      if (event.duringAttendance.id !== body.checkpointId) throw new SafeError(409, 'The checkpoint changed. Refresh before confirming.');
      if (!EventAudiencePolicy.canAttend({ ...profile, uid: claims.sub }, event)) throw new SafeError(403, 'You are not assigned to this session.');
      const agreement = await get(PolicyAgreementPolicy.path(claims.sub).join('/'));
      if (!PolicyAgreementPolicy.accepted(agreement, claims.sub)) throw new SafeError(403, PolicyAgreementPolicy.message);
      if (record.duringAttendance?.confirmedAt) { existing = true; confirmedAt = record.duringAttendance.confirmedAt; return []; }
      if ((await get('faceRegistrations/' + claims.sub))?.registered !== true) throw new SafeError(403, 'Register your face before confirming attendance, or ask an administrator to scan your QR.');
      if (event.requiresGeofence) {
        const issue = attendanceLocationIssue(body.location, body.sampledAt, now);
        if (issue) throw new SafeError(400, issue);
        if (!Number.isFinite(body.location?.latitude) || Math.abs(body.location.latitude) > 90
          || !Number.isFinite(body.location?.longitude) || Math.abs(body.location.longitude) > 180) throw new SafeError(400, 'A valid GPS position is required.');
        const area = await get('eventGeofences/' + body.eventId);
        if (!area?.enabled) throw new SafeError(409, 'The attendance area needs administrator review.');
        let inside;
        try { inside = GeofenceBoundary.create(area).evaluate(body.location, Math.min(body.location.accuracy, 20)).inside; } catch { throw new SafeError(400, 'A valid attendance area and GPS reading are required.'); }
        if (!inside) throw new SafeError(403, 'Move inside the attendance area, or ask an administrator to scan your QR.');
      }
      confirmedAt = new Date(now);
      return [this.db.write(path, { duringAttendance: { checkpointId: body.checkpointId, confirmedAt, method: 'student', label: event.duringAttendance.label } }, { merge: true, exists: true })];
    });
    return { saved: !existing, existing, confirmedAt, serverNow: this.now() };
  }
}
