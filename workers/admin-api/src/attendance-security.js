import { SafeError, digest } from './firebase.js';
import { ResetService } from './service.js';
import { GeofenceBoundary } from '../../../assets/js/controllers/GeofenceBoundary.js';
import { EventAudiencePolicy } from '../../../assets/js/controllers/EventAudiencePolicy.js';

const clean = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== '_updateTime'));
export class AttendanceSecurityService {
  constructor(db, now = () => Date.now()) { Object.assign(this, { db, now }); }
  async student(claims, get) {
    const profile = await get('students/' + claims.sub);
    if (!profile || profile.active !== true || profile.passwordResetRequired === true
      || claims.auth_time <= (profile.passwordResetValidAfter ?? -1)) throw new SafeError(403, 'An active, unrestricted student account is required.');
    return profile;
  }
  async location(claims, body) {
    if (typeof body.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.eventId) || !['in', 'out'].includes(body.action)) throw new SafeError(400, 'Choose a valid event and attendance action.');
    const point = body.location;
    if (!point || Object.keys(point).some(key => !['latitude','longitude','accuracy','distanceMeters'].includes(key))
      || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180
      || !Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 100000
      || ('distanceMeters' in point && (!Number.isFinite(point.distanceMeters) || point.distanceMeters < 0))) throw new SafeError(400, 'A valid GPS position is required.');
    await new ResetService(this.db, this.now).authenticate(claims);
    await this.db.transaction(async get => {
      const profile = await this.student(claims, get);
      const event = await get('events/' + body.eventId), area = await get('eventGeofences/' + body.eventId);
      const saved = body.action === 'out' ? await get('attendance/' + claims.sub + '_' + body.eventId) : null;
      const limit = await get('attendanceLocationLimits/' + claims.sub), now = this.now();
      if (!event || event.requiresGeofence !== true || !area || area.enabled !== true) throw new SafeError(409, 'The event attendance area is unavailable. Refresh and try again.');
      if (!EventAudiencePolicy.canAttend({ ...profile, uid: claims.sub }, event)
        && !(body.action === 'out' && saved?.studentUid === claims.sub && saved.eventId === body.eventId && saved.status === 'checked-in' && saved.checkedInAt && !saved.checkedOutAt)) throw new SafeError(403, 'You are not assigned to this event.');
      const open = new Date(body.action === 'in' ? event.openAt : event.closeAt).getTime(), close = new Date(event.checkOutClosesAt).getTime();
      if (!Number.isFinite(open) || !Number.isFinite(close) || now < open || now > close) throw new SafeError(403, 'The attendance window is closed.');
      let result;
      try { result = GeofenceBoundary.create(area).evaluate(point, Math.min(point.accuracy, 20)); }
      catch { throw new SafeError(409, 'The attendance boundary needs administrator review.'); }
      if (!result.inside) throw new SafeError(403, 'You are outside the attendance area.');
      const fresh = limit && now - limit.windowStart < 60000, count = fresh ? limit.count : 0;
      if (count >= 20) throw new SafeError(429, 'Too many location checks. Wait one minute.');
      return [this.db.write('attendanceLocationProofs/' + claims.sub + '_' + body.eventId + '_' + body.action, {
        studentUid: claims.sub, eventId: body.eventId, action: body.action, location: point,
        geofence: clean(area), issuedAt: new Date(now), expiresAt: new Date(now + 30000)
      }), this.db.write('attendanceLocationLimits/' + claims.sub, { windowStart: fresh ? limit.windowStart : now, count: count + 1 })];
    });
    return { verified: true, validForSeconds: 30 };
  }
  async face(claims, body, providedSecret, configuredSecret) {
    if (typeof configuredSecret !== 'string' || configuredSecret.length < 32) throw new SafeError(503, 'Face confirmation is awaiting server setup.');
    if (typeof providedSecret !== 'string' || providedSecret.length > 256 || await digest(providedSecret) !== await digest(configuredSecret)) throw new SafeError(403, 'Server upload confirmation required.');
    if (typeof body.fileId !== 'string' || !/^[A-Za-z0-9_-]{10,180}$/.test(body.fileId)
      || typeof body.fileName !== 'string' || !body.fileName || body.fileName.length > 250) throw new SafeError(400, 'A saved photo reference is required.');
    await new ResetService(this.db, this.now).authenticate(claims);
    await this.db.transaction(async get => {
      await this.student(claims, get);
      const previous = await get('faceRegistrations/' + claims.sub);
      if (previous) throw new SafeError(409, 'A face photo is already registered. Ask an administrator to reset it.');
      return [this.db.write('faceRegistrations/' + claims.sub, {
        registered: true, storageProvider: 'Google Drive', driveFileId: body.fileId,
        driveFileName: body.fileName, registeredAt: new Date(this.now()), confirmationSource: 'server-upload'
      }, { exists: false })];
    });
    return { registered: true };
  }
}
