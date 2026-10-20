// Run ONLY against a local demo-project emulator; never uses Firebase credentials.
const assert = require('node:assert/strict');
const project = 'demo-presence-audience', host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) throw new Error('A local Firestore emulator is required.');
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const SERVER = { server: true }, now = Date.now(), date = offset => new Date(now + offset);
const token = uid => [Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: uid, user_id: uid, email: `${uid}@example.test`, aud: project, iss: `https://securetoken.google.com/${project}`, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600, auth_time: Math.floor(now / 1000), firebase: { sign_in_provider: 'password' } })).toString('base64url'), ''].join('.');
function value(data, transforms, prefix = '') {
  if (data === SERVER) { transforms.push({ fieldPath: prefix, setToServerValue: 'REQUEST_TIME' }); return undefined; }
  if (data instanceof Date) return { timestampValue: data.toISOString() };
  if (Array.isArray(data)) return { arrayValue: { values: data.map(item => value(item, transforms)) } };
  if (data && typeof data === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(data).map(([key, child]) => [key, value(child, transforms, prefix ? `${prefix}.\`${key}\`` : `\`${key}\``)]).filter(([, child]) => child)) } };
  if (typeof data === 'boolean') return { booleanValue: data };
  if (typeof data === 'number') return Number.isInteger(data) ? { integerValue: String(data) } : { doubleValue: data };
  return { stringValue: data || '' };
}
async function write(path, data, auth = 'owner', success = true) {
  const transforms = [], fields = value(data, transforms).mapValue.fields;
  const result = await fetch(`${base}:commit`, { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ writes: [{ update: { name: `projects/${project}/databases/(default)/documents/${path}`, fields }, ...(transforms.length ? { updateTransforms: transforms } : {}) }] }) });
  const body = await result.json(); assert.equal(result.ok, success, `${path}: ${JSON.stringify(body)}`); return body;
}
async function read(path, auth) { const response = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${auth}` } }); assert.equal(response.ok, true, await response.text()); }
async function raw(path) { return fetch(`${base}/${path}`,{headers:{Authorization:'Bearer owner'}}).then(response=>response.json()); }
async function checkout(uid,eventId,success=true){
  const saved=await raw(`attendance/${uid}_${eventId}`);
  const response=await fetch(`${base}:commit`,{method:'POST',headers:{Authorization:`Bearer ${token(uid)}`,'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:{name:saved.name,fields:{...saved.fields,status:{stringValue:'completed'}}},updateTransforms:[{fieldPath:'checkedOutAt',setToServerValue:'REQUEST_TIME'}]}]})});
  assert.equal(response.ok,success,await response.text());
}
async function batchSave(id, event, geofence, auth, mask, success = true) {
  const writes = [[`events/${id}`, event], [`eventGeofences/${id}`, geofence]].map(([path, data], index) => {
    const transforms = [], fields = value(data, transforms).mapValue.fields;
    return { update: { name: `projects/${project}/databases/(default)/documents/${path}`, fields },
      ...(index === 0 && mask ? { updateMask: { fieldPaths: mask } } : {}),
      ...(transforms.length ? { updateTransforms: transforms } : {}) };
  });
  const result = await fetch(`${base}:commit`, { method:'POST', headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:JSON.stringify({writes}) });
  assert.equal(result.ok, success, await result.text());
}
async function sessionPair(id, morning, afternoon, geofence, auth, success = true) {
  const writes = [[`events/${id}`,morning],[`events/${id}_afternoon`,afternoon],[`eventGeofences/${id}`,geofence],[`eventGeofences/${id}_afternoon`,geofence]].map(([path,data])=> {
    const transforms=[],fields=value(data,transforms).mapValue.fields;
    return {update:{name:`projects/${project}/databases/(default)/documents/${path}`,fields},...(transforms.length?{updateTransforms:transforms}:{})};
  });
  const result=await fetch(`${base}:commit`,{method:'POST',headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:JSON.stringify({writes})});
  assert.equal(result.ok,success,await result.text());
}
const original = {
  name: 'Audience test', type: 'Assembly', date: '2026-10-20', location: 'Hall', timeIn: '07:00', checkInCutoff: '09:00', timeOut: '11:00', checkOutCutoff: '12:10',
  audience: 'All students', description: '', requiresGeofence: false, openAt: date(-3600000), checkInClosesAt: date(-1800000), closeAt: date(-300000), checkOutClosesAt: date(3600000),
  attendanceRoster: { a: '2A' }, rosterCapturedAt: date(-86400000), createdAt: date(-86400000), updatedAt: date(-86400000)
};
const attendance = (uid, event) => ({ studentUid: uid, studentId: uid.toUpperCase(), eventId: 'event', eventName: event.name, eventType: event.type, eventDescription: event.description, eventDate: event.date, timeIn: event.timeIn, timeOut: event.timeOut, location: event.location, audience: event.audience, status: 'checked-in', arrivalStatus: 'late', checkedInAt: SERVER, attendedAt: SERVER });
(async () => {
  for (const [uid, section, role] of [['a','2A','student'],['b','2B','student'],['c','1A','student'],['head','2A','head_admin'],['manager','2A','attendance_admin']]) {
    await write(`students/${uid}`, { accountId: uid.toUpperCase(), section, active: true, ...(uid === 'a' ? {} : { role }), createdAt: date(-864000000) });
    await write(`faceRegistrations/${uid}`, { registered: true });
  }
  await write('events/event', original);
  await write('attendance/b_event', attendance('b', original), token('b'), false);
  const multi = { ...original, audience: 'Selected sections', audienceSections: ['2A','2B'], attendanceRoster: { a:'2A',b:'2B' }, rosterCapturedAt: SERVER, sectionAssignedAt: { '2A': original.rosterCapturedAt, '2B': SERVER }, rosterVersion: 1 };
  await write('events/event', multi, token('head'));
  await read('events/event', token('c'));
  await write('attendance/c_event', attendance('c', multi), token('c'), false);
  await write('attendance/a_event', attendance('a', multi), token('a'));
  await write('attendance/b_event', attendance('b', multi), token('b'));
  const smaller = { ...multi, audience:'Section 2A', audienceSections:['2A'], attendanceRoster:{a:'2A'}, sectionAssignedAt:{'2A':original.rosterCapturedAt}, rosterVersion:2, rosterCapturedAt:SERVER };
  await write('events/event', smaller, token('head'));
  const saved = await fetch(`${base}/attendance/b_event`, { headers:{Authorization:'Bearer owner'} }).then(response=>response.json());
  const out = { ...saved.fields, checkedOutAt:{timestampValue:date(0).toISOString()}, status:{stringValue:'completed'} };
  const result = await fetch(`${base}:commit`, { method:'POST',headers:{Authorization:`Bearer ${token('b')}`,'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:{name:saved.name,fields:out},updateTransforms:[{fieldPath:'checkedOutAt',setToServerValue:'REQUEST_TIME'}]}]}) });
  assert.equal(result.ok,true,await result.text());
  await write('events/event', { ...smaller, rosterVersion:1 }, token('head'), false);
  await write('events/event', { ...smaller, rosterVersion:3 }, token('a'), false);
  await write('events/event', { ...smaller, audienceSections:['2A','9Z'], rosterVersion:3 }, token('head'), false);
  const all = { ...smaller, audience:'All students',audienceSections:[],attendanceRoster:{a:'2A',b:'2B',c:'1A',head:'2A',manager:'2A'},sectionAssignedAt:Object.fromEntries(['1A','1B','2A','2B','3A','3B','4A','4B'].map(section=>[section,section==='2A'?original.rosterCapturedAt:SERVER])),rosterVersion:3 };
  await write('events/event', all, token('manager'));
  const polygon = { enabled:true, type:'polygon', address:'Campus', vertices:[{latitude:10,longitude:124},{latitude:10.001,longitude:124},{latitude:10.002,longitude:124.001},{latitude:10.001,longitude:124.002},{latitude:10,longitude:124.001}] };
  const superAdmin = token('8uEjAk72BLWKjvnQJEatBdeVAi02');
  await batchSave('polygon', {...all,requiresGeofence:true,createdAt:SERVER,createdBy:'8uEjAk72BLWKjvnQJEatBdeVAi02',rosterVersion:1}, polygon, superAdmin);
  // A recursive map merge leaves old section keys behind and must be rejected.
  const shrink = {...smaller,requiresGeofence:true,rosterVersion:2};
  const leafMask = Object.keys(shrink).filter(key=>!['attendanceRoster','sectionAssignedAt','rosterCapturedAt'].includes(key)).map(key=>`\`${key}\``).concat(['attendanceRoster.a','sectionAssignedAt.`2A`']);
  await batchSave('polygon', shrink, polygon, superAdmin, leafMask, false);
  // Top-level mergeFields replace both maps while preserving creation metadata.
  const mask = Object.keys(shrink).filter(key=>shrink[key]!==SERVER).map(key=>`\`${key}\``);
  await batchSave('polygon', shrink, polygon, superAdmin, mask);
  const stored = await fetch(`${base}/events/polygon`, {headers:{Authorization:'Bearer owner'}}).then(response=>response.json());
  assert.deepEqual(Object.keys(stored.fields.attendanceRoster.mapValue.fields), ['a']);
  assert.deepEqual(Object.keys(stored.fields.sectionAssignedAt.mapValue.fields), ['2A']);
  assert.equal(stored.fields.createdBy.stringValue,'8uEjAk72BLWKjvnQJEatBdeVAi02');
  await write('attendance/c_event', attendance('c',all),token('c'));
  await write('events/event', { ...all,sectionAssignedAt:{...all.sectionAssignedAt,'1A':date(9999999)},rosterVersion:4 },token('head'),false);
  await write('events/closed', { ...original, openAt:date(-7200000), checkInClosesAt:date(-5400000), closeAt:date(-3600000), checkOutClosesAt:date(-1800000) });
  await write('events/closed', { ...multi, openAt:date(-7200000), checkInClosesAt:date(-5400000), closeAt:date(-3600000), checkOutClosesAt:date(-1800000) }, token('head'), false);
  const morning = {...all,rosterVersion:1,rosterCapturedAt:SERVER,requiresGeofence:true,sessionPeriod:'morning',sessionGroupId:'sessions',sessionBaseName:'Session test',name:'Session test — Morning'};
  const afternoon = {...morning,sessionPeriod:'afternoon',name:'Session test — Afternoon',timeIn:'13:00',checkInCutoff:'14:00',timeOut:'16:00',checkOutCutoff:'17:00',
    openAt:date(7200000),checkInClosesAt:date(10800000),closeAt:date(14400000),checkOutClosesAt:date(18000000)};
  await sessionPair('sessions',morning,afternoon,polygon,superAdmin);
  const polygon10={...polygon,vertices:[...polygon.vertices,{latitude:10.0001,longitude:124},{latitude:10.0002,longitude:124},{latitude:10.0003,longitude:124},{latitude:10.0004,longitude:124},{latitude:10.0005,longitude:124}]};
  await sessionPair('sessions',{...morning,rosterVersion:2},{...afternoon,rosterVersion:2},polygon10,superAdmin);
  await read('events/sessions_afternoon',token('a'));
  await write('events/sessions',{...morning,rosterVersion:3,date:'2026-10-21'},superAdmin,false);
  await write('events/sessions',{...morning,rosterVersion:3,sessionGroupId:'changed'},superAdmin,false);
  await write('events/sessions_afternoon',{...afternoon,rosterVersion:3,date:'2026-10-21'},superAdmin,false);
  await write('events/sessions_afternoon',{...afternoon,rosterVersion:3,openAt:date(1000)},superAdmin,false);
  const noMetadata={...morning,rosterVersion:3}; delete noMetadata.sessionPeriod;delete noMetadata.sessionGroupId;delete noMetadata.sessionBaseName;
  await write('events/sessions',noMetadata,superAdmin,false);
  // Student cannot submit the afternoon early, and needs no morning record to attend it later.
  await write('attendance/a_sessions_afternoon',{...attendance('a',afternoon),eventId:'sessions_afternoon'},token('a'),false);
  const afternoonOpen={...afternoon,requiresGeofence:false,openAt:date(-3600000),checkInClosesAt:date(-1800000),closeAt:date(-300000),checkOutClosesAt:date(3600000)};
  await write('events/sessions_afternoon',afternoonOpen);
  await write('attendance/a_sessions_afternoon',{...attendance('a',afternoonOpen),eventId:'sessions_afternoon'},token('a'));
  const missingMorning=await fetch(`${base}/attendance/a_sessions`,{headers:{Authorization:'Bearer owner'}});
  assert.equal(missingMorning.status,404);
  // Attendance Admin can publish the same four-document, all-section bundle.
  await sessionPair('manager_sessions',{...morning,sessionGroupId:'manager_sessions'},{...afternoon,sessionGroupId:'manager_sessions'},polygon10,token('manager'));
  await sessionPair('manager_sessions',{...morning,rosterVersion:2,sessionGroupId:'manager_sessions'},{...afternoon,rosterVersion:2,sessionGroupId:'manager_sessions'},polygon10,token('manager'));
  await sessionPair('invalid_sessions',{...morning,sessionGroupId:'invalid_sessions'},{...afternoon,sessionGroupId:'invalid_sessions',openAt:date(1000)},polygon,superAdmin,false);
  const absentPair=await fetch(`${base}/events/invalid_sessions`,{headers:{Authorization:'Bearer owner'}});
  assert.equal(absentPair.status,404,'an invalid afternoon must not publish the morning either');
  const solo={...afternoon,sessionGroupId:'solo',rosterVersion:1,requiresGeofence:false};
  await write('events/solo',solo,token('manager'));
  await write('attendance/a_solo',{...attendance('a',solo),eventId:'solo'},token('a'),false);
  const noExtraSession=await fetch(`${base}/events/solo_afternoon`,{headers:{Authorization:'Bearer owner'}});
  assert.equal(noExtraSession.status,404,'afternoon-only must not require a morning or extra session');
  const futureMorning={...solo,sessionGroupId:'switch',sessionPeriod:'morning'};
  await write('events/switch',futureMorning,token('manager'));
  await write('events/switch',{...futureMorning,sessionPeriod:'afternoon',rosterVersion:2},token('manager'));
  await write('events/solo',{...solo,...afternoonOpen,sessionGroupId:'solo',rosterVersion:2});
  await write('events/solo',{...solo,...afternoonOpen,sessionGroupId:'solo',sessionPeriod:'morning',rosterVersion:3},token('manager'),false);
  const live={...all,sessionPeriod:'afternoon',sessionGroupId:'live',sessionBaseName:'Live editing',rosterVersion:1,requiresGeofence:false};
  await write('events/live',live,token('manager'));
  await write('attendance/a_live',{...attendance('a',live),eventId:'live'},token('a'));
  const beforeEdit=await raw('attendance/a_live');
  const extended={...live,checkInCutoff:'15:00',timeOut:'16:00',checkOutCutoff:'18:00',checkInClosesAt:date(1800000),closeAt:date(3600000),checkOutClosesAt:date(7200000),rosterVersion:2};
  await write('events/live',extended,token('manager'));
  assert.deepEqual((await raw('attendance/a_live')).fields,beforeEdit.fields,'schedule edit must preserve existing timestamps, arrival and lifecycle status');
  await write('attendance/b_live',{...attendance('b',extended),eventId:'live',arrivalStatus:'present'},token('b'));
  await checkout('a','live',false);
  await write('events/live',{...extended,rosterVersion:3},token('a'),false);
  await write('students/inactiveManager',{role:'attendance_admin',active:false});
  await write('students/studentManager',{role:'student_manager',active:true});
  for(const uid of ['inactiveManager','studentManager','noProfile']) await write('events/live',{...extended,rosterVersion:3},token(uid),false);
  await write('events/live',{...extended,rosterVersion:3,date:'2026-10-21'},token('manager'),false);
  const shortened={...extended,checkInClosesAt:date(-1800000),closeAt:date(-300000),rosterVersion:3};
  await write('events/live',shortened,token('head'));
  await checkout('a','live');
  const aAfter=await raw('attendance/a_live'),bAfter=await raw('attendance/b_live');
  assert.deepEqual(aAfter.fields.checkedInAt,beforeEdit.fields.checkedInAt);
  assert.equal(aAfter.fields.arrivalStatus.stringValue,'late');assert.equal(aAfter.fields.status.stringValue,'completed');
  assert.equal(bAfter.fields.arrivalStatus.stringValue,'present','a newer cutoff edit must not reclassify a previously on-time student');
  const closedSchedule={...original,openAt:date(-7200000),checkInClosesAt:date(-5400000),closeAt:date(-3600000),checkOutClosesAt:date(-1800000)};
  await write('events/closed',{...closedSchedule,timeIn:'06:00',openAt:date(-9000000)},token('head'),false);
  await write('events/closed',{...closedSchedule,description:'Metadata still editable'},token('head'));
  const wideCircle={enabled:true,type:'circle',latitude:10,longitude:124,radiusMeters:100000,address:'Wide circle test'};
  await write('eventGeofences/large_circle',wideCircle,token('manager'));
  assert.equal((await raw('eventGeofences/large_circle')).fields.radiusMeters.integerValue,'100000');
  await write('eventGeofences/large_circle',{...wideCircle,radiusMeters:100001},token('manager'),false);
  await write('eventGeofences/large_circle',{...wideCircle,radiusMeters:0},superAdmin,false);
  await write('eventGeofences/large_circle',wideCircle,token('a'),false);
  console.log('Circle rules passed: 100,000 m accepted for attendance admins; larger/zero radii and student edits denied.');
  console.log('Live schedule rules passed: authorized ongoing edits accepted, future actions use new cutoffs, recorded timestamps/statuses preserved, closed dates/schedules and student edits denied.');
  console.log('Afternoon-only rules passed: standalone creation, no extra session, early submission denied, mode changes limited to unopened root sessions.');
  console.log('Session rules passed: atomic morning/afternoon polygon bundle, independent attendance, early check-in denied, opened schedules/identity/overlap protected, Attendance Admin authorized.');
  console.log('Firestore emulator passed: legacy mismatch denied, live multi-section update accepted, view-only read allowed/write denied, assigned check-ins accepted, removed participant checkout accepted, stale revisions/invalid sections/student edits/closed roster edits denied.');
})().catch(error=>{console.error(error);process.exitCode=1;});
