import { SafeError, digest, temporaryPassword } from './firebase.js';
import { StudentPasswordPolicy } from '../../../assets/js/core/StudentPasswordPolicy.js';

export const SUPER_UID = '8uEjAk72BLWKjvnQJEatBdeVAi02';
const targetAllowed = profile => profile?.active === true && (!profile.role || profile.role === 'student');
export class ResetService {
  constructor(db, now = () => Date.now()) { this.db = db; this.now = now; }
  async authenticate(claims, recent = false) {
    const user = await this.db.user(claims.sub);
    if (!user || user.disabled || claims.auth_time < Number(user.validSince || 0)) throw new SafeError(401, 'Sign in again to continue.');
    if (recent && this.now() / 1000 - claims.auth_time > 300) throw new SafeError(401, 'Confirm your admin password again.');
    return user;
  }
  async reset(claims, body) {
    if (typeof body.studentUid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.studentUid) || !/^[a-f0-9-]{36}$/.test(body.operationId || '')
      || typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 500) throw new SafeError(400, 'Select a student and enter a reason of 5–500 characters.');
    const actor = await this.authenticate(claims, true), uid = body.studentUid;
    if (uid === claims.sub || uid === SUPER_UID) throw new SafeError(403, 'Only ordinary student accounts can be reset here.');
    const target = await this.db.user(uid);
    if (!target || target.disabled) throw new SafeError(400, 'An active student login account is required.');
    const now = this.now(), password = temporaryPassword(), hash = await digest(body.operationId + ':' + password);
    const ledgerPath = 'passwordResets/' + uid, auditPath = 'auditLogs/password-reset_' + body.operationId;
    let actorName;
    await this.db.transaction(async get => {
      const actorProfile = await get('students/' + claims.sub), profile = await get('students/' + uid);
      const ledger = await get(ledgerPath), limit = await get('passwordResetLimits/' + claims.sub), audit = await get(auditPath);
      if (claims.sub !== SUPER_UID && !(actorProfile?.active === true && actorProfile.role === 'head_admin')) throw new SafeError(403, 'Only Super Admin and Head Admin can reset student passwords.');
      if (!targetAllowed(profile) || (profile.uid && profile.uid !== uid) || target.email !== (profile.authEmail || `${profile.accountIdKey || String(profile.accountId || '').toLowerCase()}@students.presence.local`)) throw new SafeError(403, 'Only a matching ordinary student account can be reset.');
      if (audit) throw new SafeError(409, 'This reset request was already processed. Its temporary password cannot be retrieved.');
      if ((ledger?.leaseUntil || 0) > now) throw new SafeError(409, 'A password operation is in progress. Wait two minutes before retrying.');
      if (ledger && now - ledger.startedAt < 60000) throw new SafeError(429, 'Wait one minute before resetting this account again.');
      const fresh = limit && now - limit.windowStart < 900000, count = fresh ? limit.count : 0;
      if (count >= 5) throw new SafeError(429, 'Reset limit reached. Wait fifteen minutes.');
      actorName = [actorProfile?.firstName, actorProfile?.middleName, actorProfile?.lastName].filter(Boolean).join(' ') || actor.displayName || 'Super Admin';
      return [this.db.write('students/' + uid, { passwordResetRequired: true, mustChangePassword: true, passwordResetValidAfter: Math.floor(now / 1000), updatedAt: new Date(now) }, { merge: true, exists: true }),
        this.db.write(ledgerPath, { operationId: body.operationId, state: 'resetting', actorUid: claims.sub, startedAt: now, leaseUntil: now + 120000, temporaryHash: hash }),
        this.db.write(auditPath, { action: 'student-password-reset', studentUid: uid, studentId: profile.accountId || '', actorUid: claims.sub, actorName, reason: body.reason.trim(), status: 'started', createdAt: new Date(now) }, { exists: false }),
        this.db.write('passwordResetLimits/' + claims.sub, { windowStart: fresh ? limit.windowStart : now, count: count + 1 })];
    });
    try {
      await this.db.password(uid, password, Math.floor(now / 1000));
      await this.db.transaction(async get => {
        const ledger = await get(ledgerPath);
        if (ledger?.operationId !== body.operationId || ledger.state !== 'resetting') throw new SafeError(409, 'Reset state changed.');
        return [this.db.write(ledgerPath, { state: 'ready', leaseUntil: 0 }, { merge: true, exists: true }),
          this.db.write(auditPath, { status: 'temporary-issued', updatedAt: new Date(this.now()) }, { merge: true, exists: true })];
      });
    } catch {
      // Never clear the profile lock after an uncertain Auth/network failure.
      // A later reset issues a fresh password; no password can be recovered.
      throw new SafeError(503, 'Reset is incomplete or unconfirmed. The student remains restricted. Wait two minutes, then issue a new reset; do not reuse this request.');
    }
    return { temporaryPassword: password, operationId: body.operationId, requiresPasswordChange: true };
  }
  async complete(claims, body) {
    await this.authenticate(claims);
    const uid = claims.sub, now = this.now(); let operationId;
    const ledgerPath = 'passwordResets/' + uid;
    await this.db.transaction(async get => {
      const profile = await get('students/' + uid), ledger = await get(ledgerPath);
      if (!targetAllowed(profile) || profile.passwordResetRequired !== true || !ledger || !['ready', 'completing'].includes(ledger.state)) throw new SafeError(409, 'There is no completed admin reset awaiting a new password.');
      if (claims.auth_time <= profile.passwordResetValidAfter) throw new SafeError(401, 'Sign in again with your temporary password before changing it.');
      if (ledger.leaseUntil > now) throw new SafeError(409, 'A password change is in progress. Wait two minutes before retrying.');
      const error = StudentPasswordPolicy.newPasswordError(body.newPassword, profile);
      if (error) throw new SafeError(400, error);
      if (await digest(ledger.operationId + ':' + body.newPassword) === ledger.temporaryHash) throw new SafeError(400, 'Choose a different password from the temporary password.');
      operationId = ledger.operationId;
      return [this.db.write(ledgerPath, { state: 'completing', leaseUntil: now + 120000 }, { merge: true, exists: true })];
    });
    try {
      // New sessions must be authenticated in a later second than all old ones.
      const validAfter = Math.floor(this.now() / 1000);
      await this.db.password(uid, body.newPassword, validAfter);
      await this.db.transaction(async get => {
        const ledger = await get(ledgerPath), profile = await get('students/' + uid);
        if (ledger?.operationId !== operationId || ledger.state !== 'completing' || !targetAllowed(profile)) throw new SafeError(409, 'Account state changed.');
        return [this.db.write('students/' + uid, { passwordResetRequired: false, mustChangePassword: false, passwordResetValidAfter: validAfter, updatedAt: new Date(this.now()) }, { merge: true, exists: true }),
          this.db.write(ledgerPath, { state: 'resolved', leaseUntil: 0, completedAt: this.now() }, { merge: true, exists: true }),
          this.db.write('auditLogs/password-reset_' + operationId, { status: 'student-changed-password', completedAt: new Date(this.now()) }, { merge: true, exists: true })];
      });
      return { requiresSignIn: true, signInAfter: validAfter + 1 };
    } catch { throw new SafeError(503, 'Password change is unconfirmed. Your chosen password may already be active. Sign in again, wait two minutes and retry if still restricted.'); }
  }
}
