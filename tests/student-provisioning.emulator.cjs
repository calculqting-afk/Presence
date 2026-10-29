// Only runs on a local demo emulator. Does not access production credentials/data.
const assert = require('node:assert/strict');
const project = 'demo-presence-audience', host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) throw Error('Local emulator required');
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const SERVER = Symbol('server');
const token = uid => [Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: uid, user_id: uid, superAdmin: uid === '8uEjAk72BLWKjvnQJEatBdeVAi02', email: `${uid}@example.test`, aud: project, iss: `https://securetoken.google.com/${project}`, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, firebase: { sign_in_provider: 'password' } })).toString('base64url'), ''].join('.');
function encode(value, field, transforms) {
  if (value === SERVER) { transforms.push({ fieldPath: field, setToServerValue: 'REQUEST_TIME' }); return; }
  if (typeof value === 'boolean') return { booleanValue: value };
  return { stringValue: String(value) };
}
function write(path, data, mask) {
  const transforms=[], fields={};
  for (const [key,value] of Object.entries(data)) { const encoded=encode(value,key,transforms); if(encoded)fields[key]=encoded; }
  return { update: { name: `projects/${project}/databases/(default)/documents/${path}`, fields }, ...(transforms.length ? {updateTransforms:transforms}:{}), ...(mask?{updateMask:{fieldPaths:mask}}:{}) };
}
async function commit(writes, uid, allowed=true) {
  const response=await fetch(base+':commit',{method:'POST',headers:{Authorization:`Bearer ${uid==='owner'?'owner':token(uid)}`,'Content-Type':'application/json'},body:JSON.stringify({writes})});
  assert.equal(response.ok,allowed,await response.text());
}
const profile = id => ({ uid:id,accountId:id,accountIdKey:id,authEmail:`${id}@example.test`,firstName:'Test',lastName:'Student',birthday:'2005-01-01',section:'2A',course:'BS Info Tech',active:true,role:'student',mustChangePassword:true,createdAt:SERVER,updatedAt:SERVER });
(async()=>{
  for(const [uid,role] of [['head','head_admin'],['manager','student_manager'],['attendance','attendance_admin'],['student','student']]) await commit([write('students/'+uid,{accountId:uid,active:true,role})],'owner');
  const superUid='8uEjAk72BLWKjvnQJEatBdeVAi02';
  for(const actor of [superUid,'head','manager']) {
    const id='created-'+actor;
    await commit([write('students/'+id,profile(id)),write('studentIds/'+id,{studentId:id,uid:id,createdAt:SERVER})],actor);
    const legacy=profile('legacy-'+actor);delete legacy.role;
    await commit([write('students/'+legacy.uid,legacy)],actor);
    for(const role of ['head_admin','attendance_admin','student_manager']) await commit([write('students/deny-'+actor+'-'+role,{...profile('denied'),role})],actor,false);
    await commit([write('students/deny-metadata-'+actor,{...profile('denied'),roleUpdatedAt:SERVER,roleUpdatedBy:actor})],actor,false);
  }
  for(const actor of ['student','attendance','unknown']) await commit([write('students/deny-'+actor,profile('denied'))],actor,false);
  for(const actor of [superUid,'head']) {
    const id='approved-'+actor,request={uid:id,accountId:id,accountIdKey:id,birthday:'2005-01-01',firstName:'Test',lastName:'Student',course:'BS Info Tech',section:'2A',status:'pending',requestedAt:SERVER,updatedAt:SERVER};
    await commit([write('registrationRequests/'+id,request)],'owner');
    await commit([write('students/'+id,profile(id)),write('studentIds/'+id,{studentId:id,uid:id,createdAt:SERVER}),write('registrationRequests/'+id,{status:'approved',reviewedBy:actor,reviewedAt:SERVER,updatedAt:SERVER},['status','reviewedBy','reviewedAt','updatedAt'])],actor);
    const saved=await fetch(base+'/registrationRequests/'+id,{headers:{Authorization:'Bearer owner'}}).then(r=>r.json());
    assert.equal(saved.fields.status.stringValue,'approved');
  }
  for (const gender of ['', 'Male', 'Female', 'invalid']) {
    const id = 'gender-' + (gender || 'blank');
    await commit([write('students/'+id, { ...profile(id), gender })], 'head', gender !== 'invalid');
    const request = { uid:id, accountId:id, accountIdKey:id, birthday:'2005-01-01', firstName:'Test', lastName:'Student', course:'BS Info Tech', section:'2A', gender, status:'pending', requestedAt:SERVER, updatedAt:SERVER };
    await commit([write('registrationRequests/'+id, request)], id, gender !== 'invalid');
  }
  await commit([write('students/gender-self',profile('gender-self'))], 'owner');
  await commit([write('students/gender-self',{gender:'Female',updatedAt:SERVER},['gender','updatedAt'])], 'gender-self');
  await commit([write('students/gender-self',{gender:'invalid',updatedAt:SERVER},['gender','updatedAt'])], 'gender-self',false);
  await commit([write('students/gender-self',{gender:'Male',updatedAt:SERVER},['gender','updatedAt'])], 'student',false);
  await commit([write('students/gender-self',{gender:'Male',updatedAt:SERVER},['gender','updatedAt'])], 'manager');
  await commit([write('registrationRequests/gender-reapply',{uid:'gender-reapply',accountId:'gender-reapply',accountIdKey:'gender-reapply',birthday:'2005-01-01',firstName:'Test',lastName:'Student',course:'BS Info Tech',section:'2A',status:'declined',requestedAt:SERVER,updatedAt:SERVER})], 'owner');
  await commit([write('registrationRequests/gender-reapply',{gender:'invalid',status:'pending',updatedAt:SERVER},['gender','status','updatedAt'])], 'gender-reapply',false);
  await commit([write('registrationRequests/gender-reapply',{gender:'Female',status:'pending',updatedAt:SERVER},['gender','status','updatedAt'])], 'gender-reapply');
  console.log('Student provisioning and gender Rules passed: creation/approval/legacy, self and manager edits, registration/reapplication, invalid values and unauthorized edits.');
})().catch(error=>{console.error(error.message);process.exitCode=1});
