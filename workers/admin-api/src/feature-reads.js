import { SafeError, digest } from './firebase.js';
import { ResetService, isSuperAuthority } from './service.js';
import { hasPermission } from '../../../assets/js/core/permissions.js';
import { ACTIVITY_ACTIONS } from '../../../assets/js/controllers/ActivityRecordPolicy.js';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const activityFields = ['action', 'actorUid', 'actorName', 'subjectUid', 'studentUid', 'subjectId', 'studentId', 'subjectName', 'studentName', 'eventId', 'eventName', 'reason', 'createdAt', 'status'];
const changeFields = ['accountId', 'role', 'checkedInAt', 'checkedOutAt', 'arrivalStatus', 'status', 'name', 'date', 'timeIn', 'checkInCutoff', 'timeOut', 'checkOutCutoff', 'location', 'audience', 'audienceSections', 'description'];
const responseFields = ['studentUid', 'studentId', 'studentName', 'eventId', 'surveyRevision', 'answers', 'answerCount', 'status', 'startedAt', 'updatedAt', 'startEvidence', 'finishEvidence', 'reviewReason', 'reviewIssue', 'reviewStage', 'reviewRequestedAt', 'reviewDecision', 'reviewNote', 'reviewedBy', 'reviewedAt', 'reviewAuditId'];

export class FeatureReadsService {
  constructor(sql, firebase, now = () => Date.now()) { Object.assign(this, { sql, firebase, now }); }

  async actor(claims) {
    const [user, profile] = await Promise.all([new ResetService(this.firebase).authenticate(claims), this.firebase.get('students/' + claims.sub)]);
    const superAdmin = isSuperAuthority(claims, user);
    if (!superAdmin && (!profile || profile.active !== true || profile.passwordResetRequired === true)) throw new SafeError(403, 'An active account is required.');
    const role = ['head_admin', 'attendance_admin', 'student_manager', 'viewer'].includes(profile?.role) ? profile.role : 'student';
    return { profile: { ...profile, uid: claims.sub }, role: superAdmin ? 'super_admin' : role };
  }

  async cached(group, parameters, ttl, read) {
    const key = group + ':' + await digest(JSON.stringify(parameters));
    const row = await this.sql.prepare('SELECT * FROM feature_reads WHERE cache_key=?1').bind(key).first();
    if (row?.payload && row.expires_at > this.now()) return JSON.parse(row.payload);
    const owner = crypto.randomUUID(), now = this.now();
    const lease = await this.sql.prepare(`INSERT INTO feature_reads(cache_key,group_key,lease_until,lease_owner) VALUES(?1,?2,?3,?4)
      ON CONFLICT(cache_key) DO UPDATE SET lease_until=excluded.lease_until,lease_owner=excluded.lease_owner
      WHERE feature_reads.lease_until<=?5 AND feature_reads.expires_at<=?5`).bind(key, group, now + 30000, owner, now).run();
    if (!lease.meta?.changes && !lease.changes) throw new SafeError(409, 'This page is syncing. Try again in a moment.');
    try {
      const result = await read(), payload = JSON.stringify(result);
      if (new TextEncoder().encode(payload).length > 1000000) throw new SafeError(503, 'This page is too large. Narrow the date range.');
      await this.sql.prepare('UPDATE feature_reads SET payload=?1,expires_at=?2,lease_until=0 WHERE cache_key=?3 AND lease_owner=?4')
        .bind(payload, this.now() + ttl, key, owner).run();
      return result;
    } finally {
      await this.sql.prepare('UPDATE feature_reads SET lease_until=0 WHERE cache_key=?1 AND lease_owner=?2').bind(key, owner).run();
    }
  }

  cursor(value) {
    if (value === undefined || value === null) return null;
    if (!value || typeof value !== 'object' || !id(value.id) || typeof value.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value.time) || !Number.isFinite(Date.parse(value.time))) throw new SafeError(400, 'Invalid page cursor.');
    return { id: value.id, time: value.time };
  }

  async activity(claims, body) {
    const actor = await this.actor(claims);
    if (!hasPermission(actor.role, 'viewActivityHistory')) throw new SafeError(403, 'Activity History access is required.');
    if (Object.keys(body).some(key => !['source', 'from', 'to', 'cursor'].includes(key)) || !['activityLogs', 'auditLogs'].includes(body.source)) throw new SafeError(400, 'Invalid activity request.');
    for (const key of ['from', 'to']) if (body[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(body[key]) || !Number.isFinite(Date.parse(body[key])))) throw new SafeError(400, 'Invalid activity date.');
    if (body.from && body.to && body.from > body.to) throw new SafeError(400, 'Invalid date range.');
    const parameters = { source: body.source, from: body.from || '', to: body.to || '', cursor: this.cursor(body.cursor) };
    return this.cached('activity', parameters, 300000, async () => {
      const page = await this.firebase.featurePage(body.source, 'createdAt', { ...parameters, fields: [...activityFields, 'before', 'after'], size: 50 });
      return { ...page, rows: page.rows.filter(row => ACTIVITY_ACTIONS[row.action]).map(row => ({ id: row.id, ...pick(row, activityFields), before: row.before ? pick(row.before, changeFields) : null, after: row.after ? pick(row.after, changeFields) : null })) };
    });
  }

  async survey(claims, body) {
    if (Object.keys(body).some(key => !['eventId', 'operation', 'cursor'].includes(key)) || !id(body.eventId) || !['responses', 'invalidate'].includes(body.operation)) throw new SafeError(400, 'Invalid survey request.');
    const actor = await this.actor(claims), manager = hasPermission(actor.role, 'manageSurveys');
    if (!manager) throw new SafeError(403, 'Survey management access is required.');
    const group = 'survey:' + body.eventId;
    if (body.operation === 'invalidate') {
      // Only managers invalidate shared pages. Students never cause repeated full
      // response scans; their own progress is read directly through owner Rules.
      if (!manager) throw new SafeError(403, 'Survey management access is required.');
      await this.sql.prepare('DELETE FROM feature_reads WHERE group_key=?1').bind(group).run();
      return { invalidated: true };
    }
    const cursor = this.cursor(body.cursor);
    return this.cached(group, { operation: body.operation, cursor }, 60000, async () => {
      const page = await this.firebase.featurePage('eventSurveys/' + body.eventId + '/responses', 'updatedAt', { cursor, size: 25, fields: responseFields });
      return { ...page, rows: page.rows.map(row => ({ id: row.id, ...pick(row, responseFields) })) };
    });
  }
}
