import { SafeError } from './firebase.js';
import { ResetService, isSuperAuthority } from './service.js';

// This projection deliberately excludes birthday, phone, hometown, reset data,
// face descriptors and credentials. Read the selected full profile from Firestore.
export const DIRECTORY_FIELDS = ['accountId', 'accountIdKey', 'firstName', 'middleName', 'lastName',
  'course', 'section', 'gender', 'email', 'role', 'active', 'photoDataUrl', 'createdAt'];
const revision = value => value.replace(/(?:\.(\d+))?Z$/, (_, part = '') => '.' + part.padEnd(9, '0') + 'Z');

export class DirectoryService {
  constructor(sql, firebase, now = () => Date.now()) { Object.assign(this, { sql, firebase, now }); }

  async authorize(claims) {
    const [user, profile] = await Promise.all([
      new ResetService(this.firebase).authenticate(claims), this.firebase.get('students/' + claims.sub)
    ]);
    if (!isSuperAuthority(claims, user) && !(profile?.active === true && ['head_admin', 'student_manager'].includes(profile.role))) {
      throw new SafeError(403, 'Student directory access is required.');
    }
  }

  project(document) {
    const fields = Object.fromEntries(DIRECTORY_FIELDS.filter(field => document[field] !== undefined).map(field => [field, document[field]]));
    // Large inline photos stay on the on-demand profile; initials keep directory
    // lists small enough for the free Worker/D1 request and memory limits.
    if (typeof fields.photoDataUrl === 'string' && fields.photoDataUrl.length > 32768) delete fields.photoDataUrl;
    return { uid: document.uid, payload: JSON.stringify({ uid: document.uid, ...fields }),
      revision: revision(document._updateTime) };
  }

  async save(documents) {
    if (!documents.length) return;
    const chunks = []; let chunk = [], size = 0;
    for (const document of documents) {
      const projected = this.project(document), bytes = new TextEncoder().encode(JSON.stringify(projected)).length;
      if (size + bytes > 1000000 && chunk.length) { chunks.push(chunk); chunk = []; size = 0; }
      chunk.push(projected); size += bytes;
    }
    if (chunk.length) chunks.push(chunk);
    if (chunks.length > 35) throw new SafeError(503, 'Directory is too large for a free-plan refresh.');
    for (const records of chunks) await this.sql.prepare(`INSERT INTO student_directory (uid, payload, revision, touched_at)
      SELECT json_extract(value,'$.uid'), json_extract(value,'$.payload'), json_extract(value,'$.revision'), ?2
      FROM json_each(?1) WHERE true
      ON CONFLICT(uid) DO UPDATE SET payload=excluded.payload, revision=excluded.revision, touched_at=excluded.touched_at
      WHERE excluded.revision > student_directory.revision`)
      .bind(JSON.stringify(records), this.now()).run();
  }

  async syncOne(claims, body) {
    if (Object.keys(body).some(key => key !== 'studentUid') || !/^[A-Za-z0-9_-]{1,128}$/.test(body.studentUid || '')) throw new SafeError(400, 'Invalid student.');
    if (claims.sub !== body.studentUid) await this.authorize(claims);
    else await new ResetService(this.firebase).authenticate(claims);
    // Only a UID is accepted. Profile values always come from trusted Firestore reads.
    const document = await this.firebase.directoryStudent(body.studentUid, DIRECTORY_FIELDS);
    if (document) await this.save([document]);
    else await this.sql.prepare('DELETE FROM student_directory WHERE uid=?1').bind(body.studentUid).run();
    return { synced: true };
  }

  async list(claims, body) {
    if (Object.keys(body).some(key => key !== 'refresh') || body.refresh !== undefined && typeof body.refresh !== 'boolean') throw new SafeError(400, 'Invalid directory request.');
    await this.authorize(claims);
    const now = this.now(), state = await this.sql.prepare('SELECT * FROM directory_sync WHERE id=1').first();
    if (!state) throw new SafeError(503, 'Directory migration is not ready.');
    if (body.refresh || now - state.checked_at >= 60000) await this.refresh(state, body.refresh === true);
    const current = await this.sql.prepare('SELECT * FROM directory_sync WHERE id=1').first();
    if (!current.full_at) throw new SafeError(503, 'Directory is preparing. Retry shortly.');
    const { results } = await this.sql.prepare('SELECT payload FROM student_directory ORDER BY uid LIMIT 5001').all();
    if (results.length > 5000) throw new SafeError(503, 'Directory needs server pagination before adding more students.');
    return { students: results.map(row => JSON.parse(row.payload)), checkedAt: current.checked_at,
      stale: current.lease_until > this.now() || this.now() - current.checked_at >= 60000 };
  }

  async refresh(state, fullRequested) {
    const now = this.now(), owner = crypto.randomUUID();
    // One cross-isolate lease prevents several browsers repeating the same scan.
    const lock = await this.sql.prepare(`UPDATE directory_sync SET lease_owner=?1, lease_until=?2
      WHERE id=1 AND lease_until <= ?3`).bind(owner, now + 120000, now).run();
    if (!(lock.meta?.changes ?? lock.changes)) return;
    try {
      const full = !state.watermark || now - state.full_at >= 3600000 || fullRequested && now - state.full_at >= 60000;
      const result = await this.firebase.directoryChanges(full ? null : state.watermark, DIRECTORY_FIELDS);
      await this.save(result.documents);
      // Hourly reconciliation also removes deletions and changes made by old APKs
      // without updatedAt. Manual Refresh explicitly requests this full check.
      if (full) await this.sql.prepare(`DELETE FROM student_directory WHERE touched_at < ?2
        AND uid NOT IN (SELECT json_extract(value,'$.uid') FROM json_each(?1))`)
        .bind(JSON.stringify(result.documents.map(item => ({ uid: item.uid }))), now).run();
      await this.sql.prepare(`UPDATE directory_sync SET checked_at=?1, full_at=?2, watermark=?3,
        lease_owner=NULL, lease_until=0 WHERE id=1 AND lease_owner=?4`)
        .bind(now, full ? now : state.full_at, result.readTime, owner).run();
    } catch (error) {
      await this.sql.prepare('UPDATE directory_sync SET lease_owner=NULL, lease_until=?1 WHERE id=1 AND lease_owner=?2')
        .bind(this.now() + 60000, owner).run();
      if (!state.full_at) throw error;
    } finally {
      await this.sql.prepare('UPDATE directory_sync SET lease_owner=NULL, lease_until=0 WHERE id=1 AND lease_owner=?1').bind(owner).run();
    }
  }
}
