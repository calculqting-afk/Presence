const test = require('node:test'), assert = require('node:assert/strict');
const now = Date.parse('2026-10-29T04:00:00Z');
async function fixture() {
  const { AttendanceSecurityService } = await import('../workers/admin-api/src/attendance-security.js');
  const store = new Map([
    ['students/student', { active: true, role: 'student', section: '2A' }],
    ['events/event', { requiresGeofence: true, openAt: new Date(now-60000), closeAt: new Date(now-1000), checkOutClosesAt: new Date(now+60000) }],
    ['eventGeofences/event', { enabled: true, type: 'circle', latitude: 10, longitude: 124, radiusMeters: 50, _updateTime: 'version' }]
  ]), writes = [];
  const db = {
    user: async () => ({ disabled: false, validSince: '0' }),
    write: (path, data, options) => ({ path, data, options }),
    transaction: async fn => {
      const changes = await fn(async path => store.get(path));
      for (const item of changes) { writes.push(item); store.set(item.path, item.data); }
    }
  };
  return { service: new AttendanceSecurityService(db, () => now), store, writes,
    claims: { sub: 'student', auth_time: now/1000-100 }, body: { eventId: 'event', action: 'in', location: { latitude: 10, longitude: 124, accuracy: 5, distanceMeters: 0 } } };
}
test('GPS proof uses server geometry, current boundary, exact location and a 30-second deadline', async () => {
  const f=await fixture(); await f.service.location(f.claims,f.body);
  const proof=f.store.get('attendanceLocationProofs/student_event_in');
  assert.equal(proof.studentUid,'student');assert.equal(proof.expiresAt.getTime(),now+30000);
  assert.deepEqual(proof.location,f.body.location);assert.equal(proof.geofence._updateTime,undefined);
  assert.equal(f.writes.length,2);
});
test('GPS rejects forged outside positions, large accuracy allowance, invalid coordinates, stale sessions and closed windows',async()=>{
  for(const location of [{latitude:11,longitude:124,accuracy:100000,distanceMeters:0},{latitude:NaN,longitude:124,accuracy:0},{latitude:10,longitude:124,accuracy:-1}]) {
    const f=await fixture();await assert.rejects(f.service.location(f.claims,{...f.body,location}));assert.equal(f.writes.length,0);
  }
  for(const patch of [{active:false},{passwordResetRequired:true},{passwordResetValidAfter:now/1000}]){
    const f=await fixture();Object.assign(f.store.get('students/student'),patch);await assert.rejects(f.service.location(f.claims,f.body),/unrestricted/);
  }
  const f=await fixture();f.store.get('events/event').checkOutClosesAt=new Date(now-1);await assert.rejects(f.service.location(f.claims,f.body),/closed/);
});
test('GPS validates polygon topology and membership on the server and enforces actor rate limits',async()=>{
  const f=await fixture();f.store.set('eventGeofences/event',{enabled:true,type:'polygon',vertices:[{latitude:10,longitude:124},{latitude:10,longitude:124.001},{latitude:10.001,longitude:124.001},{latitude:10.001,longitude:124}]});
  await f.service.location(f.claims,f.body);
  await assert.rejects(f.service.location(f.claims,{...f.body,location:{latitude:10.005,longitude:124.005,accuracy:1}}),/outside/);
  f.store.set('attendanceLocationLimits/student',{windowStart:now,count:20});await assert.rejects(f.service.location(f.claims,f.body),/Too many/);
  f.store.get('eventGeofences/event').vertices=[{latitude:10,longitude:124}];await assert.rejects(f.service.location(f.claims,f.body),/review/);
});
test('face acknowledgement requires the server secret, an active owner and a saved-file reference; replacements denied',async()=>{
  const f=await fixture(),secret='x'.repeat(48),body={fileId:'saved-file-123456',fileName:'Face.jpg'};
  await assert.rejects(f.service.face(f.claims,body,'wrong',secret),/Server upload/);
  await assert.rejects(f.service.face(f.claims,body,secret,undefined),/setup/);
  await assert.rejects(f.service.face(f.claims,{fileId:'bad'},secret,secret),/saved photo/);
  assert.equal(f.writes.length,0);await f.service.face(f.claims,body,secret,secret);
  assert.equal(f.store.get('faceRegistrations/student').confirmationSource,'server-upload');
  assert.ok(!JSON.stringify(f.writes).includes(secret));
  await assert.rejects(f.service.face(f.claims,body,secret,secret),/already registered/);
});
test('location proof rejects unassigned students but preserves checkout for a removed participant with an existing check-in',async()=>{
  const f=await fixture();f.store.get('events/event').attendanceRoster={other:'2A'};
  await assert.rejects(f.service.location(f.claims,f.body),/not assigned/);
  await assert.rejects(f.service.location(f.claims,{...f.body,action:'out'}),/not assigned/);
  f.store.set('attendance/student_event',{studentUid:'student',eventId:'event',status:'checked-in',checkedInAt:new Date(now-10000)});
  await f.service.location(f.claims,{...f.body,action:'out'});
  assert.ok(f.store.has('attendanceLocationProofs/student_event_out'));
});
test('cache configuration uses memory and attempts legacy IndexedDB cleanup without removing academic self edits',()=>{
  const fs=require('node:fs'),config=fs.readFileSync('config/firebase-config.js','utf8');
  assert.match(config,/localCache: memoryLocalCache\(\)/);assert.match(config,/await clearIndexedDbPersistence\(db\)/);
  assert.ok(!config.includes('persistentLocalCache'));
  const rules=fs.readFileSync('firestore.rules','utf8');assert.match(rules,/"course", "section", "email", "phone"/);
});
