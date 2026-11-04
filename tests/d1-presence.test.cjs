const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

async function fixture() {
  const { PresenceService } = await import('../workers/admin-api/src/presence.js');
  const database = new DatabaseSync(':memory:');
  database.exec(fs.readFileSync('workers/admin-api/migrations/0001_presence.sql', 'utf8'));
  let now = 1800000000000;
  const sql = { prepare: source => {
    const stmt = database.prepare(source); let values = [];
    // D1 binds ordered ?NNN positions; node:sqlite exposes them as named keys.
    const parameters = () => Object.fromEntries(values.map((value, index) => ['?' + (index + 1), value]));
    const wrapper = { bind: (...args) => { values = args; return wrapper; },
      run: async () => stmt.run(parameters()), first: async () => stmt.get(parameters()),
      all: async () => ({ results: stmt.all(parameters()) }) };
    return wrapper;
  } };
  const service = new PresenceService(sql, () => now);
  const claims = { sub: 'student', presenceSession: 'device-one' };
  const active = { sessionId: 'device-one', _updateTime: '2026-11-03T00:00:00.123Z' };
  return { service, claims, active, sql, database, advance: ms => { now += ms; } };
}

test('D1 heartbeats use server time, reject forged fields and stop after transfer/logout', async () => {
  const f = await fixture();
  await f.service.syncAuthority('student', f.active);
  await f.service.heartbeat(f.claims, { online: true });
  assert.equal(f.database.prepare('SELECT online FROM live_presence').get().online, 1);
  await assert.rejects(f.service.heartbeat(f.claims, { online: true, studentUid: 'victim' }), /Invalid/);
  await assert.rejects(f.service.heartbeat({ sub: 'victim', presenceSession: 'device-one' }, { online: true }), /transferred/);
  await f.service.syncAuthority('student', { sessionId: 'device-two', _updateTime: '2026-11-03T00:00:00.123000001Z' });
  await f.service.syncAuthority('student', f.active); // Delayed old login cannot win.
  await assert.rejects(f.service.heartbeat(f.claims, { online: false }), /transferred/);
  await f.service.heartbeat({ ...f.claims, presenceSession: 'device-two' }, { online: true });
  await f.service.syncAuthority('student', { sessionId: null, _updateTime: '2026-11-03T00:00:01.000Z' });
  await assert.rejects(f.service.heartbeat({ ...f.claims, presenceSession: 'device-two' }, { online: true }), /transferred/);
  f.database.close();
});

test('only current authorized student managers can list bounded, unexpired D1 status', async () => {
  const f = await fixture(); await f.service.syncAuthority('student', f.active);
  await f.service.heartbeat(f.claims, { online: true });
  const firebase = { user: async () => ({ validSince: '0' }), get: async () => ({ active: true, role: 'student' }) };
  const actor = { sub: 'admin', auth_time: 1790000000 };
  await assert.rejects(f.service.list(actor, {}, firebase), /directory access/);
  firebase.get = async () => ({ active: true, role: 'student_manager' });
  assert.equal((await f.service.list(actor, {}, firebase)).sessions.length, 1);
  f.advance(660001);
  assert.equal((await f.service.list(actor, {}, firebase)).sessions.length, 0);
  f.database.close();
});

test('Worker heartbeat requires a signed identity and never creates a Firebase gateway', async () => {
  const { handler } = await import('../workers/admin-api/src/index.js');
  const f = await fixture(); await f.service.syncAuthority('student', f.active);
  const app = handler({ verify: async () => f.claims, gateway: () => { throw Error('Unexpected Firestore access'); } });
  const env = { PRESENCE_ENABLED: 'true', PRESENCE_DB: f.sql };
  const request = token => new Request('https://api.test/v1/presence/heartbeat', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer signed-token' } : {}) }, body: JSON.stringify({ online: true }) });
  assert.equal((await app(request(false), env)).status, 401);
  assert.equal((await app(request(true), env)).status, 200);
  assert.equal((await app(request(true), { ...env, PRESENCE_ENABLED: 'false' })).status, 503);
  f.database.close();
});

test('650 students update only their own status row and SQL suppresses repeated focus writes', async () => {
  const f = await fixture();
  for (let i = 0; i < 650; i++) {
    const sub = 'student' + i;
    await f.service.syncAuthority(sub, f.active);
    await f.service.heartbeat({ sub, presenceSession: 'device-one' }, { online: true });
  }
  assert.equal(f.database.prepare('SELECT count(*) AS total FROM live_presence').get().total, 650);
  const before = f.database.prepare('SELECT total_changes() AS total').get().total;
  await f.service.heartbeat({ sub: 'student1', presenceSession: 'device-one' }, { online: true });
  assert.equal(f.database.prepare('SELECT total_changes() AS total').get().total, before);
  f.database.close();
});

test('client enrolls once, throttles focus heartbeats, and logout never writes Firestore', async () => {
  const { PresenceClient, PRESENCE_HEARTBEAT_MS } = await import('../assets/js/controllers/PresenceClient.js');
  const { endPresenceSession } = await import('../assets/js/core/PresenceSession.js');
  const calls = [], user = { uid: 'student' };
  const client = new PresenceClient({ call: async (path, actor, body) => {
    assert.equal(actor, user); calls.push({ path, body });
    return path.endsWith('/status') ? { current: true } : { recorded: true };
  } });
  assert.equal(PRESENCE_HEARTBEAT_MS, 300000);
  await client.write(user, true); await client.write(user, true);
  assert.equal(calls.length, 2); // One enrollment and one heartbeat, no repeated focus write.
  let finish; const state = { presenceSessionId: 'student_tab', presenceWrite: new Promise(resolve => { finish = resolve; }) };
  const pending = endPresenceSession({ presence: client, user, state, window: { clearInterval() {} },
    write: () => assert.fail('D1 logout must not write Firestore') });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 2);
  finish(); await pending;
  assert.equal(calls.at(-1).body.online, false);
  assert.equal(state.studentLoggedOut, true);
});
