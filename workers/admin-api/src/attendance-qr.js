import { SafeError, digest } from './firebase.js';
import { ResetService, isSuperAuthority } from './service.js';
import { requireActiveDevice, sessionAuthTime } from './device-session.js';
import { EventAudiencePolicy } from '../../../assets/js/controllers/EventAudiencePolicy.js';
import { PolicyAgreementPolicy } from '../../../assets/js/core/PolicyAgreementPolicy.js';

const TTL = 30 * 60 * 1000;
const bytes = value => new TextEncoder().encode(value);
const encode = value => btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const name = profile => [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ');
const validEvent = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);

// Authenticated encryption keeps student identifiers and device authority out of
// QR contents. This key is purpose-separated from ID correction preview tokens.
export class AttendanceQrService {
  constructor(db, secret, now = () => Date.now()) { Object.assign(this, { db, secret, now }); }
  async key() {
    if (typeof this.secret !== 'string' || this.secret.length < 32) throw new SafeError(503, 'Attendance QR is awaiting backend setup.');
    return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', bytes('presence-attendance-qr-v1:' + this.secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async seal(payload) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.key(), bytes(JSON.stringify(payload)));
    return 'presence-qr1.' + encode(iv) + '.' + encode(new Uint8Array(encrypted));
  }
  async open(token, kind) {
    try {
      if (typeof token !== 'string' || token.length > 2500 || !/^presence-qr1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw Error();
      const [, iv, encrypted] = token.split('.');
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, await this.key(), decode(encrypted));
      const data = JSON.parse(new TextDecoder().decode(plain));
      if (data.kind !== kind || !Number.isFinite(data.exp) || data.exp <= this.now() || data.iat > this.now() || data.exp - data.iat > (kind === 'student' ? TTL : 120000)) throw Error();
      return data;
    } catch (error) {
      if (error instanceof SafeError) throw error;
      throw new SafeError(400, 'This QR or confirmation has expired or is invalid. Ask the student to refresh their QR.');
    }
  }
  student(profile, authTime) {
    if (!Number.isFinite(authTime) || profile?.active !== true || profile.mustChangePassword === true || profile.passwordResetRequired === true
      || authTime <= (profile.passwordResetValidAfter ?? -1) || !profile.accountId) throw new SafeError(403, 'An active student account with password setup completed is required.');
  }
  window(event, action) {
    const now = this.now(), start = +new Date(action === 'in' ? event?.openAt : event?.closeAt), end = +new Date(event?.checkOutClosesAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || now < start || now > end
      || (action === 'in' && event.checkoutOnlyReopened === true)) throw new SafeError(409, 'The selected attendance window is closed.');
  }
  async issue(claims, body) {
    if (Object.keys(body).some(key => key !== 'eventId') || !validEvent(body.eventId)) throw new SafeError(400, 'Choose a current event session.');
    await new ResetService(this.db, this.now).authenticate(claims);
    let token, expiresAt;
    await this.db.transaction(async get => {
      const profile = await (get.qrStudent ? get.qrStudent(claims.sub) : get('students/' + claims.sub)), event = await get('events/' + body.eventId);
      const active = await get('accountSessions/' + claims.sub), limit = await get('attendanceQrLimits/issue_' + claims.sub);
      const agreement = await get(PolicyAgreementPolicy.path(claims.sub).join('/'));
      this.student(profile, sessionAuthTime(claims));
      if (!PolicyAgreementPolicy.accepted(agreement, claims.sub)) throw new SafeError(403, PolicyAgreementPolicy.message);
      if (!claims.presenceSession || active?.sessionId !== claims.presenceSession) throw new SafeError(401, 'Sign in again to display your attendance QR.');
      if (event?.checkoutOnlyReopened === true) {
        const record = await get('attendance/' + claims.sub + '_' + body.eventId);
        if (!record?.checkedInAt || record.status !== 'checked-in') throw new SafeError(409, 'A saved check-in is required for this reopened checkout.');
        this.window(event, 'out');
      } else this.window(event, 'in');
      if (!EventAudiencePolicy.canAttend({ ...profile, uid: claims.sub }, event)) throw new SafeError(403, 'You are not assigned to this event.');
      const now = this.now(), fresh = limit && now - limit.windowStart < 60000, count = fresh ? limit.count : 0;
      if (count >= 10) throw new SafeError(429, 'Wait one minute before generating another QR.');
      expiresAt = Math.min(now + TTL, +new Date(event.checkOutClosesAt));
      token = await this.seal({ kind: 'student', uid: claims.sub, eventId: body.eventId, session: active.sessionId, authTime: sessionAuthTime(claims), iat: now, exp: expiresAt });
      return [this.db.write('attendanceQrLimits/issue_' + claims.sub, { windowStart: fresh ? limit.windowStart : now, count: count + 1 })];
    });
    return { token, expiresAt, serverNow: this.now() };
  }
  async actor(claims) {
    const user = await new ResetService(this.db, this.now).authenticate(claims);
    const profile = await this.db.get('students/' + claims.sub);
    if (!isSuperAuthority(claims, user) && !(profile?.active === true && ['head_admin', 'attendance_admin'].includes(profile.role))) throw new SafeError(403, 'Only Super Admin, Head Admin and Attendance Admin can scan attendance.');
    return { user, profile };
  }
  async validate(get, claims, qr, eventId, action, actor) {
    const profile = await (get.qrStudent ? get.qrStudent(qr.uid) : get('students/' + qr.uid)), event = await get('events/' + eventId);
    const studentSession = await get('accountSessions/' + qr.uid), actorSession = await get('accountSessions/' + claims.sub);
    const actorProfile = await get('students/' + claims.sub), record = await get('attendance/' + qr.uid + '_' + eventId);
    const agreement = await get(PolicyAgreementPolicy.path(qr.uid).join('/'));
    this.student(profile, qr.authTime);
    if (!PolicyAgreementPolicy.accepted(agreement, qr.uid)) throw new SafeError(403, PolicyAgreementPolicy.message);
    if (qr.uid === claims.sub || qr.eventId !== eventId) throw new SafeError(403, 'This QR belongs to another event or cannot be scanned by its owner.');
    if (studentSession?.sessionId !== qr.session || !claims.presenceSession || actorSession?.sessionId !== claims.presenceSession) throw new SafeError(401, 'The student or scanner session changed. Sign in and scan again.');
    if (!isSuperAuthority(claims, actor.user) && !(actorProfile?.active === true && ['head_admin', 'attendance_admin'].includes(actorProfile.role))) throw new SafeError(403, 'Attendance scanning permission is required.');
    this.window(event, action);
    if (!EventAudiencePolicy.canAttend({ ...profile, uid: qr.uid }, event)) throw new SafeError(403, 'This student is not assigned to the selected session.');
    if (action === 'in' && record && !record.checkedInAt) throw new SafeError(409, 'A checkout-only record already exists. Use an audited attendance correction to add the missing check-in.');
    if (action === 'out' && (!record?.checkedInAt || record.status !== 'checked-in') && !record?.checkedOutAt) throw new SafeError(409, 'A valid check-in is required before checkout.');
    const existing = action === 'in' ? Boolean(record) : Boolean(record?.checkedOutAt);
    if (action === 'out' && !existing && !(+new Date(record.checkedInAt) < this.now())) throw new SafeError(409, 'Checkout must be later than check-in.');
    if (action === 'out' && !existing && (record.studentUid !== qr.uid || record.eventId !== eventId
      || record.eventDate !== event.date || new Date(+new Date(record.checkedInAt) + 8 * 3600000).toISOString().slice(0, 10) !== event.date)) {
      throw new SafeError(409, 'The saved check-in needs an audited correction before checkout.');
    }
    return { profile, event, record, existing, actorProfile };
  }
  async scan(claims, body, confirm = false) {
    if (Object.keys(body).some(key => !['eventId', 'action', 'token', 'confirmation'].includes(key)) || !validEvent(body.eventId) || !['in', 'out'].includes(body.action)) throw new SafeError(400, 'Choose an event and Check-in or Check-out.');
    const actor = await this.actor(claims);
    await requireActiveDevice(this.db, claims);
    let qr, confirmation;
    if (confirm) {
      confirmation = await this.open(body.confirmation, 'confirmation');
      if (confirmation.actor !== claims.sub || confirmation.eventId !== body.eventId || confirmation.action !== body.action) throw new SafeError(403, 'Scan again for this event and action.');
      qr = confirmation.qr;
      if (qr.exp <= this.now()) throw new SafeError(400, 'The student QR expired. Scan the refreshed QR.');
    } else qr = await this.open(body.token, 'student');
    const studentUser = await this.db.user(qr.uid);
    if (!studentUser || studentUser.disabled || qr.authTime < Number(studentUser.validSince || 0)) throw new SafeError(403, 'The student login is no longer active.');
    let result;
    await this.db.transaction(async get => {
      const { profile, event, record, existing, actorProfile } = await this.validate(get, claims, qr, body.eventId, body.action, actor);
      const limitPath = 'attendanceQrLimits/scan_' + claims.sub, limit = await get(limitPath), now = this.now();
      const fresh = limit && now - limit.windowStart < 60000, count = fresh ? limit.count : 0;
      if (count >= 120) throw new SafeError(429, 'Too many scans. Wait one minute.');
      const writes = [this.db.write(limitPath, { windowStart: fresh ? limit.windowStart : now, count: count + 1 })];
      if (confirm && (confirmation.profileRevision !== profile._updateTime || confirmation.eventRevision !== event._updateTime)) throw new SafeError(409, 'Student or event details changed. Scan again before confirming.');
      result = { existing, serverNow: now, student: { uid: qr.uid, name: name(profile), studentId: profile.accountId, course: profile.course || '', section: profile.section || '', photo: profile.photoDataUrl || '' }, event: { id: body.eventId, name: event.name, date: event.date }, action: body.action };
      if (!confirm && !existing) {
        result.expiresAt = Math.min(qr.exp, now + 120000);
        result.confirmation = await this.seal({ kind: 'confirmation', actor: claims.sub, qr, eventId: body.eventId, action: body.action, profileRevision: profile._updateTime || '', eventRevision: event._updateTime || '', iat: now, exp: result.expiresAt });
      }
      if (!confirm || existing) return writes;
      const checked = new Date(now), id = qr.uid + '_' + body.eventId;
      const payload = body.action === 'in' ? {
        studentUid: qr.uid, studentId: profile.accountId, eventId: body.eventId, eventName: event.name, eventType: event.type || 'School Event', eventDescription: event.description || '', eventDate: event.date,
        timeIn: event.timeIn, timeOut: event.timeOut, location: event.location || '', audience: event.audience || 'All students', attendedAt: checked, checkedInAt: checked, status: 'checked-in',
        arrivalStatus: now < +new Date(event.lateAfterAt || event.checkInClosesAt) ? 'present' : 'late'
      } : { checkedOutAt: checked, status: 'completed' };
      Object.assign(payload, body.action === 'in' ? { recordSource: 'admin-qr', qrCheckedInBy: claims.sub } : { qrCheckedOutBy: claims.sub });
      const auditId = 'attendance-qr_' + await digest(id + ':' + body.action);
      const audit = await get('auditLogs/' + auditId);
      if (audit) throw new SafeError(409, 'This QR attendance action was already processed. Ask an Attendance Manager to review it.');
      writes.push(this.db.write('attendance/' + id, payload, { merge: body.action === 'out', exists: body.action === 'out' }),
        this.db.write('auditLogs/' + auditId, { action: body.action === 'in' ? 'attendance-qr-check-in' : 'attendance-qr-check-out', actorUid: claims.sub, actorName: name(actorProfile || {}) || actor.user.displayName || 'Administrator', studentUid: qr.uid, studentId: profile.accountId, studentName: name(profile), eventId: body.eventId, eventName: event.name, createdAt: checked, method: 'admin-qr', before: record ? { status: record.status } : null, after: { status: payload.status, ...('arrivalStatus' in payload ? { arrivalStatus: payload.arrivalStatus } : {}) } }, { exists: false }));
      result.saved = true;
      return writes;
    });
    return result;
  }
}
