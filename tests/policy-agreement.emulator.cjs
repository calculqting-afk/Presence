// Only runs against the local demo emulator, with invented users and records.
const assert = require('node:assert/strict');
const project = 'demo-presence-audience', host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(host || '')) throw Error('Local emulator required');
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const SERVER = Symbol('server');
const token = uid => [Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: uid, user_id: uid, aud: project, iss: `https://securetoken.google.com/${project}`, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, firebase: { sign_in_provider: 'password' } })).toString('base64url'), ''].join('.');
const headers = uid => ({ 'Content-Type': 'application/json', ...(uid ? { Authorization: 'Bearer ' + token(uid) } : {}) });
const path = (uid, version = '2026-11-01-v1') => `policyAcceptances/${uid}/versions/${version}`;
const receipt = uid => ({ uid, version: '2026-11-01-v1', termsAccepted: true, privacyAcknowledged: true, acceptedAt: SERVER });
async function write(uid, target, data, allowed, remove = false) {
  const transforms = [], fields = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === SERVER) transforms.push({ fieldPath: key, setToServerValue: 'REQUEST_TIME' });
    else fields[key] = typeof value === 'boolean' ? { booleanValue: value } : value instanceof Date ? { timestampValue: value.toISOString() } : { stringValue: value };
  }
  const name = `projects/${project}/databases/(default)/documents/${target}`;
  const result = await fetch(base + ':commit', { method: 'POST', headers: headers(uid), body: JSON.stringify({ writes: [remove ? { delete: name } : { update: { name, fields }, updateTransforms: transforms }] }) });
  assert.equal(result.ok, allowed, `${target}: ${await result.text()}`);
}
(async () => {
  await write('policy-student', path('policy-student'), receipt('policy-student'), true);
  assert.equal((await fetch(base + '/' + path('policy-student'), { headers: headers('policy-student') })).status, 200);
  for (const uid of ['policy-other', null]) {
    assert.equal((await fetch(base + '/' + path('policy-student'), { headers: headers(uid) })).status, 403);
    await write(uid, path('policy-stranger'), receipt('policy-stranger'), false);
  }
  await write('policy-student', path('policy-student'), receipt('policy-student'), false);
  await write('policy-student', path('policy-student'), {}, false, true);
  for (const [id, changes] of [['uid', { uid: 'forged' }], ['false', { termsAccepted: false }], ['notice', { privacyAcknowledged: false }], ['clock', { acceptedAt: new Date('2020-01-01') }], ['extra', { role: 'super_admin' }]]) {
    const uid = 'policy-' + id; await write(uid, path(uid), { ...receipt(uid), ...changes }, false);
  }
  await write('policy-old', path('policy-old', 'old'), { ...receipt('policy-old'), version: 'old' }, false);
  const listing = await fetch(base + '/policyAcceptances/policy-student/versions', { headers: headers('policy-student') });
  assert.equal(listing.status, 403);
  console.log('Policy Rules passed: own current-version create/get, server timestamp, immutable receipts, no cross-user access, no list, no forged fields or historical acceptance.');
})().catch(error => { console.error(error); process.exitCode = 1; });
