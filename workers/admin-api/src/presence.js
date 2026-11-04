import { SafeError } from './firebase.js';
import { ResetService, isSuperAuthority } from './service.js';

export const PRESENCE_TTL_MS = 11 * 60 * 1000;

/** D1 owns ephemeral online status; Firestore continues to own device authority. */
export class PresenceService {
  constructor(sql, now = () => Date.now()) { Object.assign(this, { sql, now }); }

  async syncAuthority(uid, active) {
    // Firestore updateTime orders concurrent login/logout mirrors. A delayed
    // request cannot restore a session that a newer transaction has ended.
    if (!active?._updateTime) throw new SafeError(503, 'Device authority could not be synchronized. Retry.');
    await this.sql.prepare(`INSERT INTO presence_authority (uid, session_id, revision) VALUES (?1, ?2, ?3)
      ON CONFLICT(uid) DO UPDATE SET session_id=excluded.session_id, revision=excluded.revision
      WHERE excluded.revision > presence_authority.revision`)
      .bind(uid, active.sessionId || null, active._updateTime.replace(/(?:\.(\d+))?Z$/, (_, fraction = '') => '.' + fraction.padEnd(9, '0') + 'Z')).run();
  }

  async heartbeat(claims, body) {
    if (Object.keys(body).some(key => key !== 'online') || typeof body.online !== 'boolean') throw new SafeError(400, 'Invalid online status.');
    if (!claims.presenceSession) throw new SafeError(401, 'Sign in again to synchronize online status.');
    const now = this.now();
    // Authority is checked inside the same SQL statement as the write. Clients
    // cannot choose another UID, timestamp or device session, including at logout.
    await this.sql.prepare(`INSERT INTO live_presence (uid, session_id, online, last_seen)
      SELECT uid, session_id, ?3, ?4 FROM presence_authority WHERE uid=?1 AND session_id=?2
      ON CONFLICT(uid) DO UPDATE SET session_id=excluded.session_id, online=excluded.online, last_seen=excluded.last_seen
      WHERE live_presence.session_id != excluded.session_id OR live_presence.online != excluded.online
        OR live_presence.last_seen <= excluded.last_seen - 30000`)
      .bind(claims.sub, claims.presenceSession, body.online ? 1 : 0, now).run();
    // Never claim a stale device is current just because an upsert changed zero rows.
    const active = await this.sql.prepare('SELECT session_id FROM presence_authority WHERE uid=?1').bind(claims.sub).first();
    if (active?.session_id !== claims.presenceSession) throw new SafeError(401, 'Your session was transferred or ended. Sign in again.');
    return { recorded: true };
  }

  async list(claims, body, firebase) {
    if (Object.keys(body).length) throw new SafeError(400, 'Invalid directory request.');
    const [user, profile] = await Promise.all([
      new ResetService(firebase).authenticate(claims), firebase.get('students/' + claims.sub)
    ]);
    if (!isSuperAuthority(claims, user) && !(profile?.active === true && ['head_admin', 'student_manager'].includes(profile.role))) {
      throw new SafeError(403, 'Student directory access is required.');
    }
    const { results } = await this.sql.prepare(`SELECT p.uid, p.session_id, p.online, p.last_seen
      FROM live_presence p JOIN presence_authority a ON a.uid=p.uid AND a.session_id=p.session_id
      WHERE p.last_seen >= ?1 LIMIT 2000`).bind(this.now() - PRESENCE_TTL_MS).all();
    return { sessions: results.map(row => ({ studentUid: row.uid, accountSessionId: row.session_id,
      online: row.online === 1, lastSeen: row.last_seen })), ttlMs: PRESENCE_TTL_MS };
  }
}
