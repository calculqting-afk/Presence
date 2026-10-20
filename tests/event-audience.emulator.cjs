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
const original = {
  name: 'Audience test', type: 'Assembly', date: '2026-10-20', location: 'Hall', timeIn: '07:00', checkInCutoff: '09:00', timeOut: '11:00', checkOutCutoff: '12:10',
  audience: 'All students', description: '', requiresGeofence: false, openAt: date(-3600000), checkInClosesAt: date(-1800000), closeAt: date(-300000), checkOutClosesAt: date(3600000),
  attendanceRoster: { a: '2A' }, rosterCapturedAt: date(-86400000), createdAt: date(-86400000), updatedAt: date(-86400000)
};
const attendance = (uid, event) => ({ studentUid: uid, studentId: uid.toUpperCase(), eventId: 'event', eventName: event.name, eventType: event.type, eventDescription: event.description, eventDate: event.date, timeIn: event.timeIn, timeOut: event.timeOut, location: event.location, audience: event.audience, status: 'checked-in', arrivalStatus: 'late', checkedInAt: SERVER, attendedAt: SERVER });
(async () => {
  for (const [uid, section, role] of [['a','2A','student'],['b','2B','student'],['c','1A','student'],['head','2A','head_admin'],['manager','2A','attendance_admin']]) {
    await write(`students/${uid}`, { accountId: uid.toUpperCase(), section, active: true, role, createdAt: date(-864000000) });
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
  console.log('Firestore emulator passed: legacy mismatch denied, live multi-section update accepted, view-only read allowed/write denied, assigned check-ins accepted, removed participant checkout accepted, stale revisions/invalid sections/student edits/closed roster edits denied.');
})().catch(error=>{console.error(error);process.exitCode=1;});
