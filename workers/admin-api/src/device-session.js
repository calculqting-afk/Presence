import { SafeError, digest } from './firebase.js';

export const sessionAuthTime = claims => claims.firebase?.sign_in_provider === 'custom' ? claims.presenceAuthTime : claims.auth_time;
export async function requireActiveDevice(db, claims) {
  const active = await db.get('accountSessions/' + claims.sub);
  // Accounts enroll on the updated client. Existing, unenrolled sessions keep working.
  if (active && (!claims.presenceSession || active.sessionId !== claims.presenceSession)) throw new SafeError(401, 'Your session was transferred or ended. Sign in again.');
}
export class DeviceSessionService {
  constructor(db, now = () => Date.now()) { Object.assign(this, { db, now }); }
  async account(claims) {
    const user = await this.db.user(claims.sub);
    if (!user || user.disabled || !Number.isFinite(sessionAuthTime(claims)) || sessionAuthTime(claims) < Number(user.validSince || 0)) throw new SafeError(401, 'Sign in again to continue.');
    let superAdmin = false;
    try { superAdmin = JSON.parse(user.customAttributes || '{}').superAdmin === true; } catch {}
    const profile = await this.db.get('students/' + claims.sub);
    if (!superAdmin && (profile?.active !== true || !['student', 'viewer', 'head_admin', 'attendance_admin', 'student_manager'].includes(profile.role || 'student'))) throw new SafeError(403, 'An active account is required.');
    return user;
  }
  async status(claims) {
    await this.account(claims);
    const active = await this.db.get('accountSessions/' + claims.sub);
    return { enrolled: Boolean(active), active: Boolean(active?.sessionId), current: Boolean(active?.sessionId && active.sessionId === claims.presenceSession) };
  }
  async acquire(claims, body) {
    await this.account(claims);
    const now = this.now(), authTime = sessionAuthTime(claims);
    // Only a fresh password login can claim/transfer a device. Refreshing a custom
    // token must not manufacture a recent password confirmation.
    if (claims.firebase?.sign_in_provider !== 'password' || now / 1000 - authTime >= 300 || authTime > now / 1000) throw new SafeError(401, 'Enter your password again to start or transfer a session.');
    if (typeof body.deviceId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.deviceId) || Object.keys(body).some(key => !['deviceId', 'transferRevision'].includes(key))
      || body.transferRevision !== undefined && (typeof body.transferRevision !== 'string' || !/^[a-f0-9-]{36}$/.test(body.transferRevision))) throw new SafeError(400, 'Invalid device session request.');
    const deviceHash = await digest(claims.sub + ':' + body.deviceId);
    let sessionId = crypto.randomUUID();
    let conflict;
    await this.db.transaction(async get => {
      const active = await get('accountSessions/' + claims.sub), limit = await get('accountSessionLimits/' + claims.sub);
      if (body.transferRevision && active?.sessionId !== body.transferRevision) throw new SafeError(409, 'The active device changed. Check again before transferring.');
      if (active?.sessionId && active.deviceHash !== deviceHash && body.transferRevision !== active.sessionId) {
        conflict = active.sessionId; return [];
      }
      if (active?.sessionId && active.deviceHash === deviceHash) { sessionId = active.sessionId; return []; }
      const fresh = limit && now - limit.windowStart < 900000;
      if (fresh && limit.count >= 10) throw new SafeError(429, 'Too many device changes. Wait fifteen minutes and retry.');
      return [this.db.write('accountSessions/' + claims.sub, { sessionId, deviceHash, startedAt: new Date(now) }),
        this.db.write('accountSessionLimits/' + claims.sub, { windowStart: fresh ? limit.windowStart : now, count: fresh ? limit.count + 1 : 1 }),
        this.db.write('auditLogs/device-session_' + sessionId, { action: active?.sessionId && active.deviceHash !== deviceHash ? 'device-session-transferred' : 'device-session-started', actorUid: claims.sub, createdAt: new Date(now) }, { exists: false })];
    });
    if (conflict) return { transferRequired: true, revision: conflict };
    return { customToken: await this.db.customToken(claims.sub, { presenceSession: sessionId, presenceAuthTime: authTime }) };
  }
  async release(claims) {
    await this.account(claims);
    await this.db.transaction(async get => {
      const active = await get('accountSessions/' + claims.sub);
      return active && claims.presenceSession && active.sessionId === claims.presenceSession
        ? [this.db.write('accountSessions/' + claims.sub, { sessionId: null, endedAt: new Date(this.now()) }, { merge: true })] : [];
    });
    return { released: true };
  }
}
