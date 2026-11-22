// Local demo emulator only. No production credentials are used.
const assert = require('node:assert/strict');
const project = 'demo-presence-audience', host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) throw Error('A local Firestore emulator is required.');
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`, SERVER = Symbol('server'), now = Date.now();
const token = uid => [Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: uid, user_id: uid, superAdmin: uid === '8uEjAk72BLWKjvnQJEatBdeVAi02', email: `${uid}@example.test`, aud: project, iss: `https://securetoken.google.com/${project}`, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600, auth_time: Math.floor(now / 1000), firebase: { sign_in_provider: 'password' } })).toString('base64url'), ''].join('.');
function value(data, transforms, prefix = '') {
  if (data === SERVER) { transforms.push({ fieldPath: prefix, setToServerValue: 'REQUEST_TIME' }); return undefined; }
  if (data === null) return { nullValue: null };
  if (data instanceof Date) return { timestampValue: data.toISOString() };
  if (data?.wireTimestamp) return { timestampValue: data.wireTimestamp };
  if (Array.isArray(data)) return { arrayValue: { values: data.map(item => value(item, transforms)) } };
  if (typeof data === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(data).map(([key, child]) => [key, value(child, transforms, prefix ? `${prefix}.\`${key}\`` : `\`${key}\``)]).filter(([, child]) => child)) } };
  if (typeof data === 'boolean') return { booleanValue: data };
  if (typeof data === 'number') return { integerValue: String(data) };
  return { stringValue: data };
}
const decode = data => 'timestampValue' in data ? { wireTimestamp: data.timestampValue } : 'nullValue' in data ? null : 'mapValue' in data ? Object.fromEntries(Object.entries(data.mapValue.fields || {}).map(([key, child]) => [key, decode(child)])) : 'arrayValue' in data ? (data.arrayValue.values || []).map(decode) : data.stringValue ?? data.booleanValue ?? Number(data.integerValue);
let checks = 0;
async function commit(entries, user = 'owner', success = true) {
  const writes = entries.map(([path, data]) => {
    const transforms = [], fields = value(data, transforms).mapValue.fields;
    return { update: { name: `projects/${project}/databases/(default)/documents/${path}`, fields }, ...(transforms.length ? { updateTransforms: transforms } : {}) };
  });
  const response = await fetch(`${base}:commit`, { method: 'POST', headers: { Authorization: `Bearer ${user === 'owner' ? user : token(user)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }) });
  assert.equal(response.ok, success, `${entries[0][0]}: ${await response.text()}`); checks++;
}
async function get(path, user = 'owner', success = true) {
  const response = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${user === 'owner' ? user : token(user)}` } });
  const data = await response.json(); assert.equal(response.ok, success, JSON.stringify(data)); checks++;
  return data.fields ? decode({ mapValue: { fields: data.fields } }) : null;
}
const closed = { name: 'Request test', type: 'Assembly', date: new Date(now + 8*3600000).toISOString().slice(0,10), location: 'Hall', timeIn: '07:00', checkInCutoff: '09:00', timeOut: '11:00', checkOutCutoff: '12:00', audience: 'Selected sections', audienceSections: ['2A'], description: '', requiresGeofence: false, openAt: new Date(now - 7200000), checkInClosesAt: new Date(now - 6000000), closeAt: new Date(now - 4000000), checkOutClosesAt: new Date(now - 3600000), attendanceRoster: { reqstudent: '2A' }, rosterCapturedAt: new Date(now - 86400000) };
const submitted = (eventId, overrides = {}) => ({ studentUid: 'reqstudent', eventId, kind: 'missed-check-in', reason: 'I participated; please verify the staff log.', status: 'pending', submittedAt: SERVER, ...overrides });
const superUid = '8uEjAk72BLWKjvnQJEatBdeVAi02';
const reviewerNames = { reqhead: 'Head Reviewer', reqadmin: 'Attendance Reviewer', [superUid]: 'Test Super Admin' };
const history = (action, by, reason, correctionId = '') => ({ action, by, ...(action === 'submitted' ? {} : { byName: reviewerNames[by] || 'Administrator' }), at: SERVER, reason, correctionId });
const requestEntries = (eventId, overrides = {}) => {
  const data = submitted(eventId, overrides), path = `attendanceCorrectionRequests/reqstudent_${eventId}`;
  return [[path, data], [`${path}/history/submitted`, history('submitted', data.studentUid, data.reason)]];
};
async function decisionEntries(eventId, reviewer, status = 'declined', correctionId = '') {
  const path = `attendanceCorrectionRequests/reqstudent_${eventId}`, before = await get(path), reason = 'Verified the staff participation log.';
  return [[path, { ...before, status, reviewedBy: reviewer, reviewedByName: reviewerNames[reviewer] || 'Administrator', reviewedAt: SERVER, decisionReason: reason, correctionId }], [`${path}/history/decision`, history(status, reviewer, reason, correctionId)]];
}
function correctionEntries(eventId, reviewer, reason = 'Verified the staff participation log.', correctionId = 'audit1') {
  const after = { studentUid: 'reqstudent', studentId: 'REQ123', eventId, eventName: closed.name, eventType: closed.type, eventDescription: closed.description, eventDate: closed.date, timeIn: closed.timeIn, timeOut: closed.timeOut, location: closed.location, audience: closed.audience, attendedAt: new Date(now - 7200000), checkedInAt: new Date(now - 7200000), checkedOutAt: new Date(now - 4000000), status: 'completed', arrivalStatus: 'present', recordSource: 'admin-corrected', correctedBy: reviewer, correctedAt: SERVER, correctionReason: reason, correctionId };
  return [[`attendance/reqstudent_${eventId}`, after], [`attendance/reqstudent_${eventId}/corrections/${correctionId}`, { before: null, after, by: reviewer, at: SERVER, reason }]];
}
(async () => {
  for (const [uid, role] of [['reqstudent', 'student'], ['reqother', 'student'], ['reqhead', 'head_admin'], ['reqadmin', 'attendance_admin'], ['reqmanager', 'student_manager']])
    await commit([[`students/${uid}`, { uid, accountId: uid === 'reqstudent' ? 'REQ123' : uid, active: true, role, section: '2A', ...(reviewerNames[uid] ? { firstName: reviewerNames[uid].split(' ')[0], middleName: '', lastName: 'Reviewer' } : {}) }]]);
  await commit([[`adminProfiles/${superUid}`, { displayName: 'Test Super Admin' }]]);
  for (const id of ['morning_req', 'afternoon_req', 'invalid_req', 'decline_req', 'approve_req', 'adminapprove_req', 'super_req', 'open_req'])
    await commit([[`events/${id}`, { ...closed, ...(id === 'open_req' ? { checkOutClosesAt: new Date(now + 3600000) } : {}) }]]);
  await commit(requestEntries('morning_req'), 'reqstudent');
  await get('attendanceCorrectionRequests/reqstudent_morning_req', 'reqstudent');
  await get('attendanceCorrectionRequests/reqstudent_morning_req', 'reqother', false);
  await get('attendanceCorrectionRequests/reqstudent_morning_req', 'reqmanager', false);
  await get('attendanceCorrectionRequests/reqstudent_morning_req', 'reqadmin');
  await commit(requestEntries('morning_req'), 'reqstudent', false); // duplicate is an update
  await commit(requestEntries('afternoon_req'), 'reqstudent');
  await commit(requestEntries('open_req'), 'reqstudent', false);
  await commit(requestEntries('invalid_req'), 'reqother', false);
  await commit([requestEntries('invalid_req')[0]], 'reqstudent', false); // history required
  for (const patch of [{ reason: 'bad' }, { reason: 'x'.repeat(1001) }, { kind: 'approve' }, { status: 'approved' }, { reviewedBy: 'reqstudent' }, { studentUid: 'reqother' }])
    await commit(requestEntries('invalid_req', patch), 'reqstudent', false);
  const own = await get('attendanceCorrectionRequests/reqstudent_morning_req');
  await commit([['attendanceCorrectionRequests/reqstudent_morning_req', { ...own, reason: 'Changed original reason' }]], 'reqstudent', false);
  await commit(requestEntries('decline_req'), 'reqstudent');
  await commit(await decisionEntries('decline_req', 'reqstudent'), 'reqstudent', false);
  await commit(await decisionEntries('decline_req', 'reqmanager'), 'reqmanager', false);
  await commit((await decisionEntries('decline_req', 'reqhead')).slice(0, 1), 'reqhead', false);
  const forgedName = await decisionEntries('decline_req', 'reqhead');
  forgedName[0][1].reviewedByName = 'Another admin'; forgedName[1][1].byName = 'Another admin';
  await commit(forgedName, 'reqhead', false);
  await commit(await decisionEntries('decline_req', 'reqhead'), 'reqhead');
  await get('attendanceCorrectionRequests/reqstudent_decline_req/history/decision', 'reqstudent');
  await commit(await decisionEntries('decline_req', 'reqhead'), 'reqhead', false);
  await commit(requestEntries('approve_req'), 'reqstudent');
  const approve = await decisionEntries('approve_req', 'reqhead', 'approved', 'audit1');
  await commit(approve, 'reqhead', false); // cannot approve without correcting attendance
  await commit([...approve, correctionEntries('approve_req', 'reqhead')[0]], 'reqhead', false); // audit required
  await commit([...approve, ...correctionEntries('approve_req', 'reqhead', 'A mismatched review reason')], 'reqhead', false);
  await commit([...approve, ...correctionEntries('approve_req', 'reqhead')], 'reqhead');
  assert.equal((await get('attendanceCorrectionRequests/reqstudent_approve_req', 'reqstudent')).status, 'approved');
  assert.equal((await get('attendance/reqstudent_approve_req', 'reqstudent')).status, 'completed');
  await commit(requestEntries('adminapprove_req'), 'reqstudent');
  await commit([...(await decisionEntries('adminapprove_req', 'reqadmin', 'approved', 'audit1')), ...correctionEntries('adminapprove_req', 'reqadmin')], 'reqadmin');
  assert.equal((await get('attendanceCorrectionRequests/reqstudent_adminapprove_req', 'reqstudent')).reviewedByName, 'Attendance Reviewer');
  await commit(requestEntries('super_req'), 'reqstudent');
  await commit(await decisionEntries('super_req', superUid), superUid);
  assert.equal((await get('attendanceCorrectionRequests/reqstudent_super_req', 'reqstudent')).reviewedByName, 'Test Super Admin');
  await commit([['attendanceCorrectionRequests/reqstudent_approve_req/history/decision', history('declined', 'reqhead', 'Overwrite history')]], 'reqhead', false);
  // A student's queries must be constrained to that student, not all requests.
  for (const [uid, ownOnly, success] of [['reqstudent', true, true], ['reqstudent', false, false], ['reqadmin', false, true], ['reqmanager', false, false]]) {
    const structuredQuery = { from: [{ collectionId: 'attendanceCorrectionRequests' }], ...(ownOnly ? { where: { fieldFilter: { field: { fieldPath: 'studentUid' }, op: 'EQUAL', value: { stringValue: uid } } } } : {}) };
    const response = await fetch(`${base}:runQuery`, { method: 'POST', headers: { Authorization: `Bearer ${token(uid)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery }) });
    assert.equal(response.ok, success, await response.text()); checks++;
  }
  console.log(`Correction-request Rules passed ${checks} checks: ownership, closed sessions, duplicate prevention, atomic audited approvals, role restrictions, immutable decisions/history and scoped queries.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
