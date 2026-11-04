const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

async function fixture() {
  const { DirectoryService } = await import('../workers/admin-api/src/directory.js');
  const database = new DatabaseSync(':memory:');
  database.exec(fs.readFileSync('workers/admin-api/migrations/0002_directory.sql', 'utf8'));
  const sql = { prepare: source => {
    const stmt = database.prepare(source); let values = [];
    const parameters = () => Object.fromEntries(values.map((value, index) => ['?' + (index + 1), value]));
    const wrapper = { bind: (...args) => { values = args; return wrapper; }, run: async () => stmt.run(parameters()),
      first: async () => stmt.get(parameters()), all: async () => ({ results: stmt.all(parameters()) }) };
    return wrapper;
  } };
  let now = Date.parse('2026-11-03T10:00:00Z'), role = 'student_manager';
  const documents = new Map(), scans = [];
  const firebase = {
    user: async () => ({ validSince: '0' }), get: async () => ({ active: true, role }),
    directoryStudent: async uid => documents.get(uid),
    directoryChanges: async since => {
      scans.push(since);
      return { documents: [...documents.values()].filter(doc => !since || doc._updateTime >= since), readTime: new Date(now).toISOString() };
    }
  };
  const service = new DirectoryService(sql, firebase, () => now);
  const actor = { sub: 'manager', auth_time: 1790000000 };
  const put = (uid, fields = {}) => documents.set(uid, { uid, firstName: 'Student', accountId: uid,
    active: true, role: 'student', createdAt: new Date(now), _updateTime: new Date(now).toISOString(), ...fields });
  return { service, actor, database, firebase, documents, scans, put, advance: ms => { now += ms; }, role: value => { role = value; } };
}

test('650-row directory is seeded once and repeat browsers use D1; deltas update only changed profiles', async () => {
  const f = await fixture();
  for (let i = 0; i < 650; i++) f.put('student' + i);
  assert.equal((await f.service.list(f.actor, {})).students.length, 650);
  assert.equal((await f.service.list(f.actor, {})).students.length, 650);
  assert.equal(f.scans.length, 1);
  f.advance(61000); f.put('student1', { firstName: 'Updated' });
  const listing = await f.service.list(f.actor, {});
  assert.ok(f.scans[1]); assert.equal(listing.students.find(row => row.uid === 'student1').firstName, 'Updated');
  assert.equal(f.database.prepare('SELECT count(*) AS total FROM student_directory').get().total, 650);
  f.database.close();
});

test('directory omits confidential fields and stale cached roles cannot grant access', async () => {
  const f = await fixture(); f.put('student', { birthday: '2000-01-01', phone: 'private', hometown: 'private',
    password: 'private', passwordResetRequired: true, faceDescriptor: [1, 2] });
  const listing = await f.service.list(f.actor, {});
  for (const field of ['birthday', 'phone', 'hometown', 'password', 'passwordResetRequired', 'faceDescriptor']) assert.equal(listing.students[0][field], undefined);
  f.role('student'); await assert.rejects(f.service.list(f.actor, {}), /directory access/);
  await assert.rejects(f.service.syncOne(f.actor, { studentUid: 'student' }), /directory access/);
  await assert.rejects(f.service.syncOne({ ...f.actor, sub: 'student' }, { studentUid: 'student', role: 'head_admin' }), /Invalid student/);
  f.database.close();
});

test('self profile synchronization trusts only server data; old refreshes cannot overwrite a corrected ID', async () => {
  const f = await fixture(); f.put('student');
  const old = { ...f.documents.get('student') };
  await f.service.list(f.actor, {});
  f.advance(1000); f.put('student', { accountId: 'corrected' });
  await f.service.syncOne({ ...f.actor, sub: 'student' }, { studentUid: 'student' });
  await f.service.save([old]);
  assert.equal((await f.service.list(f.actor, {})).students[0].accountId, 'corrected');
  f.documents.delete('student'); await f.service.syncOne(f.actor, { studentUid: 'student' });
  assert.equal((await f.service.list(f.actor, {})).students.length, 0);
  f.database.close();
});

test('hourly reconciliation removes legacy deletions; unavailable Firestore retains marked-stale cached rows', async () => {
  const f = await fixture(); f.put('student'); await f.service.list(f.actor, {});
  f.advance(3600001); f.documents.delete('student');
  assert.equal((await f.service.list(f.actor, {})).students.length, 0);
  f.put('student'); await f.service.syncOne(f.actor, { studentUid: 'student' });
  f.advance(61000); f.firebase.directoryChanges = async () => { throw Error('quota'); };
  const result = await f.service.list(f.actor, {});
  assert.equal(result.stale, true); assert.equal(result.students.length, 1);
  f.database.close();
});

test('concurrent refreshes share a D1 lease and do not repeat the Firestore scan', async () => {
  const f = await fixture(); f.put('student'); await f.service.list(f.actor, {}); f.advance(61000);
  let finish; const original = f.firebase.directoryChanges;
  f.firebase.directoryChanges = async since => { const result = await original(since); await new Promise(resolve => { finish = resolve; }); return result; };
  const pending = f.service.list(f.actor, {});
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const concurrent = await f.service.list(f.actor, {});
  assert.equal(concurrent.stale, true); assert.equal(f.scans.length, 2);
  finish(); await pending; f.database.close();
});

test('Firestore directory query projects basic fields and uses updatedAt/roleUpdatedAt deltas', async () => {
  const { FirebaseGateway } = await import('../workers/admin-api/src/firebase.js');
  const gateway = new FirebaseGateway(JSON.stringify({ project_id: 'presence-a873f', client_email: 'presence-password-reset@presence-a873f.iam.gserviceaccount.com' }));
  let body;
  gateway.call = async (_url, value) => { body = value; return [{ readTime: '2026-11-03T10:00:00Z' }]; };
  await gateway.directoryChanges('2026-11-03T09:00:00Z', ['accountId']);
  assert.deepEqual(body.structuredQuery.select.fields, [{ fieldPath: 'accountId' }]);
  assert.deepEqual(body.structuredQuery.where.compositeFilter.filters.map(item => item.fieldFilter.field.fieldPath), ['updatedAt', 'roleUpdatedAt']);
});
