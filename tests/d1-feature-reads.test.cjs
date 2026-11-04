const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

async function fixture() {
  const { FeatureReadsService } = await import('../workers/admin-api/src/feature-reads.js');
  const database = new DatabaseSync(':memory:');
  database.exec(fs.readFileSync('workers/admin-api/migrations/0003_feature_reads.sql', 'utf8'));
  const sql = { prepare: source => {
    const statement = database.prepare(source); let values = [];
    const parameters = () => Object.fromEntries(values.map((value, index) => ['?' + (index + 1), value]));
    const wrapper = { bind: (...args) => { values = args; return wrapper; },
      run: async () => statement.run(parameters()), first: async () => statement.get(parameters()) };
    return wrapper;
  } };
  let now = Date.parse('2026-11-04T01:00:00Z'), sourceReads = 0, authReads = 0;
  const user = { customAttributes: '{"superAdmin":true}', validSince: '0' };
  const profile = { active: true, role: 'student', uid: 'actor', section: '2A' };
  const config = { revision: 1, enabled: true, questions: [{ id: 'q0', text: 'Agenda?' }], privateKey: 'must not return' };
  const firebase = {
    user: async () => { authReads++; return user; },
    get: async path => path.startsWith('students/') ? profile : path.startsWith('events/') ? { audience: 'All students' } : (sourceReads++, config),
    featurePage: async () => { sourceReads++; return { rows: [{ id: 'log', action: 'role-changed', actorUid: 'actor', createdAt: new Date(now), before: { role: 'student', password: 'secret' }, after: { role: 'viewer', privateKey: 'secret' }, password: 'secret' }], cursor: null, more: false }; }
  };
  const service = new FeatureReadsService(sql, firebase, () => now);
  const claims = { sub: 'actor', auth_time: 1790000000, superAdmin: true };
  return { service, claims, user, profile, config, firebase, database, sql,
    advance: ms => { now += ms; }, sourceReads: () => sourceReads, authReads: () => authReads };
}

test('Activity History shares projected pages in D1, refreshes on expiry, and rechecks authority on every hit', async () => {
  const f = await fixture(), request = { source: 'activityLogs' };
  const first = await f.service.activity(f.claims, request);
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].password, undefined);
  assert.equal(first.rows[0].before.password, undefined);
  assert.equal(first.rows[0].after.privateKey, undefined);
  await f.service.activity(f.claims, request);
  assert.equal(f.sourceReads(), 1); assert.equal(f.authReads(), 2);
  f.advance(300001); await f.service.activity(f.claims, request);
  assert.equal(f.sourceReads(), 2);
  f.user.customAttributes = '{}'; f.profile.role = 'super_admin';
  await assert.rejects(f.service.activity(f.claims, request), /Activity History access/);
  f.database.close();
});

test('students and inactive managers cannot retrieve survey response pages, even on cache hits', async () => {
  const f = await fixture(), student = { ...f.claims, superAdmin: false };
  const request = { eventId: 'event1', operation: 'responses' };
  await f.service.survey(f.claims, request); await f.service.survey(f.claims, request);
  assert.equal(f.sourceReads(), 1);
  await assert.rejects(f.service.survey(student, request), /management access/);
  await assert.rejects(f.service.survey(student, { ...request, operation: 'invalidate' }), /management access/);
  f.user.disabled = true;
  await assert.rejects(f.service.survey(f.claims, request), /Sign in again/);
  f.database.close();
});

test('manager invalidation removes every cached survey page, with no client-supplied data accepted', async () => {
  const f = await fixture();
  await f.service.survey(f.claims, { eventId: 'event1', operation: 'responses', cursor: { id: 'previous', time: '2026-11-04T00:00:00Z' } });
  await f.service.survey(f.claims, { eventId: 'event1', operation: 'responses' });
  assert.equal(f.database.prepare('SELECT count(*) AS n FROM feature_reads').get().n, 2);
  await f.service.survey(f.claims, { eventId: 'event1', operation: 'invalidate' });
  assert.equal(f.database.prepare('SELECT count(*) AS n FROM feature_reads').get().n, 0);
  await assert.rejects(f.service.survey(f.claims, { eventId: '../students', operation: 'config' }), /Invalid survey/);
  await assert.rejects(f.service.activity(f.claims, { source: 'students' }), /Invalid activity/);
  await assert.rejects(f.service.activity(f.claims, { source: 'auditLogs', cursor: { id: 'x', time: 'bad' } }), /Invalid page/);
  f.database.close();
});

test('concurrent cache misses acquire one shared lease; source failure never caches an empty success', async () => {
  const f = await fixture(); let resolve;
  f.firebase.featurePage = () => new Promise(done => { resolve = done; });
  const first = f.service.activity(f.claims, { source: 'activityLogs' });
  while (!resolve) await new Promise(done => setImmediate(done));
  await assert.rejects(f.service.activity(f.claims, { source: 'activityLogs' }), /syncing/);
  resolve({ rows: [], more: false, cursor: null }); await first;
  f.advance(300001);
  f.firebase.featurePage = async () => { throw Error('quota'); };
  await assert.rejects(f.service.activity(f.claims, { source: 'activityLogs' }), /quota/);
  f.firebase.featurePage = async () => ({ rows: [], more: false, cursor: null });
  await f.service.activity(f.claims, { source: 'activityLogs' });
  f.database.close();
});

test('Firestore source pagination retains nanosecond timestamps and deterministic document tie breaking', async () => {
  const { FirebaseGateway } = await import('../workers/admin-api/src/firebase.js');
  const gateway = Object.create(FirebaseGateway.prototype); gateway.base = 'https://firestore.googleapis.com/v1/projects/presence-a873f/databases/(default)/documents';
  let sent;
  gateway.call = async (url, body) => { sent = { url, body }; return [{ document: { name: 'projects/presence-a873f/databases/(default)/documents/auditLogs/a', fields: { createdAt: { timestampValue: '2026-11-04T01:00:00.123456789Z' } } } }]; };
  const cursor = { id: 'a', time: '2026-11-04T01:00:00.123456789Z' };
  const page = await gateway.featurePage('auditLogs', 'createdAt', { cursor, fields: ['createdAt'], size: 50 });
  assert.equal(page.cursor.time, cursor.time);
  assert.equal(sent.body.structuredQuery.startAt.values[0].timestampValue, cursor.time);
  assert.equal(sent.body.structuredQuery.orderBy[1].field.fieldPath, '__name__');
  assert.equal(sent.body.structuredQuery.startAt.before, false);
});


test('API hydration restores timestamps while leaving timestamp-shaped answer text untouched', async () => {
  const { hydrateFeature } = await import('../assets/js/controllers/FeatureReadClient.js');
  const iso = '2026-11-04T01:00:00.000Z';
  const row = hydrateFeature({ updatedAt: iso, answers: { q0: { value: iso, answeredAt: iso } } });
  assert.equal(row.updatedAt.toMillis(), Date.parse(iso));
  assert.equal(row.answers.q0.answeredAt.toDate().toISOString(), iso);
  assert.equal(row.answers.q0.value, iso);
});
