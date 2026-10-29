// Dummy accounts and local emulator only.
const assert = require('node:assert/strict');
const project = 'demo-presence-audience', host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(host || '')) throw Error('Local emulator required');
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const superUid = '8uEjAk72BLWKjvnQJEatBdeVAi02';
function token(uid, age) {
  const now = Math.floor(Date.now() / 1000);
  return [Buffer.from('{"alg":"none"}').toString('base64url'), Buffer.from(JSON.stringify({
    sub: uid, user_id: uid, superAdmin: uid === '8uEjAk72BLWKjvnQJEatBdeVAi02', aud: project, iss: `https://securetoken.google.com/${project}`,
    iat: now, exp: now + 3600, ...(age === null ? {} : { auth_time: now - age }), firebase: { sign_in_provider: 'password' }
  })).toString('base64url'), ''].join('.');
}
async function seed(path, fields) {
  const response = await fetch(base + '/' + path, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  assert.equal(response.ok, true, await response.text());
}
async function remove(path, uid, age, allowed) {
  const response = await fetch(base + '/' + path, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token(uid, age) } });
  assert.equal(response.ok, allowed, path + ': ' + await response.text());
}
(async () => {
  const fields = { uid: { stringValue: 'recent-target' }, active: { booleanValue: true }, role: { stringValue: 'student' }, accountId: { stringValue: 'recent-target' } };
  for (const path of ['students/recent-target', 'events/recent-target', 'fines/recent-target', 'attendance/recent-target']) {
    await seed(path, fields);
    for (const age of [600, 300, -60, null]) await remove(path, superUid, age, false);
    await remove(path, 'recent-ordinary-student', 0, false);
    await remove(path, superUid, 0, true);
  }
  // A freshly issued token with old auth_time must not count as reauthentication.
  await seed('students/recent-role-target', { ...fields, uid: { stringValue: 'recent-role-target' } });
  for (const age of [600, 300, -60, null]) {
    const response = await fetch(base + '/students/recent-role-target?updateMask.fieldPaths=role&updateMask.fieldPaths=roleUpdatedAt&updateMask.fieldPaths=roleUpdatedBy', {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + token(superUid, age), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { role: { stringValue: 'head_admin' }, roleUpdatedAt: { timestampValue: new Date().toISOString() }, roleUpdatedBy: { stringValue: superUid } } })
    });
    assert.equal(response.ok, false, await response.text());
  }
  console.log('Recent-login Rules passed: expired, boundary, future, missing and unauthorized tokens denied; fresh Super Admin deletions allowed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
