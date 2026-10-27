const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
globalThis.crypto ||= webcrypto;
const operationId = '11111111-1111-4111-8111-111111111111';
test('browser fetch keeps its global receiver for reset and password completion', async()=>{
  const { PasswordResetApi } = await import('../assets/js/controllers/PasswordResetApi.js');
  const originalFetch = globalThis.fetch, calls = [];
  try {
    globalThis.fetch = async function(url, options) {
      assert.equal(this, globalThis, 'Browser fetch requires the Window receiver');
      calls.push({url, options});
      return Response.json({ok:true});
    };
    const api = new PasswordResetApi();
    const user = {getIdToken:async force=>{assert.equal(force,true);return 'test-token';}};
    await api.reset(user, 'student', 'Testing reset');
    await api.complete(user, 'New-personal-password');
    assert.equal(calls.length,2);
    assert.ok(calls[0].url.endsWith('/v1/admin/password-reset'));
    assert.ok(calls[1].url.endsWith('/v1/student/password-change'));
    assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');
  } finally { globalThis.fetch = originalFetch; }
});
test('Firebase gateway keeps the runtime fetch receiver for server requests', async()=>{
  const { FirebaseGateway } = await import('../workers/admin-api/src/firebase.js');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async function() {
      assert.equal(this, globalThis, 'Worker fetch requires its global receiver');
      return Response.json({users:[{localId:'student'}]});
    };
    const gateway = new FirebaseGateway(JSON.stringify({project_id:'presence-a873f',client_email:'presence-password-reset@presence-a873f.iam.gserviceaccount.com'}));
    gateway.access = async()=> 'test-access-token';
    assert.equal((await gateway.user('student')).localId,'student');
  } finally { globalThis.fetch = originalFetch; }
});
async function fixture() {
  const { ResetService } = await import('../workers/admin-api/src/service.js');
  let now = Date.parse('2026-10-27T08:00:00Z'), failPassword = false, failFinalize = false;
  const store = new Map([['students/head', { active:true,role:'head_admin',firstName:'Head',lastName:'Admin' }], ['students/manager',{active:true,role:'student_manager'}], ['students/student',{active:true,role:'student',accountId:'s',authEmail:'s@students.presence.local',birthday:'2005-01-01'}]]);
  const users = new Map(['head','student','manager'].map(uid => [uid,{localId:uid,email:uid==='student'?'s@students.presence.local':uid+'@example.test',validSince:'0'}]));
  const passwords = [];
  const db = {
    user: async uid => users.get(uid), write:(path,data,options={})=>({path,data,options}),
    password:async(uid,value,validSince)=>{if(failPassword)throw Error('SECRET upstream error'); passwords.push({uid,value});users.get(uid).validSince=String(validSince);},
    transaction:async fn=>{const writes=await fn(async path=>structuredClone(store.get(path)||null));if(failFinalize&&writes.some(w=>w.data.state==='ready'))throw Error('network');for(const {path,data,options} of writes){if(options.exists===false&&store.has(path))throw Error('conflict');store.set(path,{...(options.merge?store.get(path):{}),...data});}}
  };
  const service = new ResetService(db,()=>now), claims = uid=>({sub:uid,auth_time:Math.floor(now/1000)});
  return {service,db,store,users,passwords,claims,advance(ms){now+=ms;},failPassword(){failPassword=true;},failFinalize(){failFinalize=true;},body:{studentUid:'student',operationId,reason:'Student forgot password'}};
}
test('admin reset creates locked profile and password-free audit, then protected completion releases it', async()=>{
  const f=await fixture(), result=await f.service.reset(f.claims('head'),f.body);
  assert.ok(result.temporaryPassword.length>=24);
  assert.equal(f.store.get('students/student').passwordResetRequired,true);
  assert.equal(f.store.get('students/student').mustChangePassword,true);
  const saved=JSON.stringify([...f.store]);assert.ok(!saved.includes(result.temporaryPassword));assert.ok(saved.includes('Head Admin'));
  await assert.rejects(f.service.complete(f.claims('student'),{newPassword:'Personal!password123'}),/Sign in again/);
  f.advance(2000);
  await assert.rejects(f.service.complete(f.claims('student'),{newPassword:result.temporaryPassword}),/different/);
  await assert.rejects(f.service.complete(f.claims('student'),{newPassword:'01012005'}),/birthday/);
  await assert.rejects(f.service.complete(f.claims('student'),{newPassword:'short'}),/8–128/);
  f.advance(2000);
  const changed=await f.service.complete(f.claims('student'),{newPassword:'Personal!password123'});
  assert.equal(f.store.get('students/student').passwordResetRequired,false);
  assert.equal(f.store.get('students/student').mustChangePassword,false);
  assert.equal(f.store.get('passwordResets/student').state,'resolved');
  assert.equal(f.store.get('auditLogs/password-reset_'+operationId).status,'student-changed-password');
  assert.ok(changed.signInAfter>f.store.get('students/student').passwordResetValidAfter);
  assert.ok(!JSON.stringify([...f.store]).includes('Personal!password123'));
});
test('reset denies ordinary students/managers, stale/disabled tokens, privileged targets and mismatched logins', async()=>{
  for(const uid of ['student','manager']){const f=await fixture();await assert.rejects(f.service.reset(f.claims(uid),f.body),/Only/);assert.equal(f.passwords.length,0);}
  const f=await fixture();await assert.rejects(f.service.reset({...f.claims('head'),auth_time:1},f.body),/Confirm/);
  f.users.get('head').validSince=String(f.claims('head').auth_time+1);await assert.rejects(f.service.reset(f.claims('head'),f.body),/Sign in/);
  f.users.get('head').validSince='0';f.store.get('students/student').role='attendance_admin';await assert.rejects(f.service.reset(f.claims('head'),f.body),/ordinary/);
  f.store.get('students/student').role='student';f.users.get('student').email='wrong@example.test';await assert.rejects(f.service.reset(f.claims('head'),f.body),/matching/);
  f.users.get('student').disabled=true;await assert.rejects(f.service.reset(f.claims('head'),f.body),/active/);
});
test('reset replay, concurrent lease, actor rate limit and uncertain failures never return a password or unlock', async()=>{
  let f=await fixture();await f.service.reset(f.claims('head'),f.body);await assert.rejects(f.service.reset(f.claims('head'),f.body),/already/);
  await assert.rejects(f.service.reset(f.claims('head'),{...f.body,operationId:crypto.randomUUID()}),/minute/);
  f=await fixture();f.failPassword();await assert.rejects(f.service.reset(f.claims('head'),f.body),/unconfirmed/);assert.equal(f.store.get('students/student').passwordResetRequired,true);
  await assert.rejects(f.service.reset(f.claims('head'),{...f.body,operationId:crypto.randomUUID()}),/in progress/);
  f=await fixture();f.failFinalize();await assert.rejects(f.service.reset(f.claims('head'),f.body),/unconfirmed/);assert.equal(f.passwords.length,1);assert.equal(f.store.get('students/student').passwordResetRequired,true);
  f=await fixture();f.store.set('passwordResetLimits/head',{windowStart:Date.parse('2026-10-27T08:00:00Z'),count:5});await assert.rejects(f.service.reset(f.claims('head'),f.body),/limit/);
});
test('Worker is fail-closed, restricts origins, validates JSON size and never exposes internal errors', async()=>{
  const {handler}=await import('../workers/admin-api/src/index.js');let called=0;
  const run=handler({verify:async()=>{called++;throw Error('PRIVATE KEY SECRET');}});
  const env={RESET_ENABLED:'true',ALLOWED_ORIGINS:'https://localhost',FIREBASE_SERVICE_ACCOUNT:'secret'};
  const request=(headers={},body='{}')=>new Request('https://worker.test/v1/admin/password-reset',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
  assert.equal((await run(request(),env)).status,401);assert.equal(called,0);
  assert.equal((await run(request({Origin:'https://evil.test',Authorization:'Bearer x'}),env)).status,403);
  const error=await run(request({Origin:'https://localhost',Authorization:'Bearer x'}),env);assert.equal(error.status,503);assert.equal(error.headers.get('Cache-Control'),'no-store');assert.ok(!(await error.text()).includes('PRIVATE'));
  assert.equal((await run(request({Authorization:'Bearer x'},'x'.repeat(4097)),env)).status,413);
  assert.equal((await run(request({Authorization:'Bearer x'},'bad'),env)).status,400);
  assert.equal((await run(request(),{...env,RESET_ENABLED:'false'})).status,503);
});
test('Firebase token verifier checks RSA signature, project, expiry and key ID', async()=>{
  const {verifyToken}=await import('../workers/admin-api/src/firebase.js');
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='reset-test-key';
  const now=Date.now(), claims={sub:'student',aud:'presence-a873f',iss:'https://securetoken.google.com/presence-a873f',iat:Math.floor(now/1000),auth_time:Math.floor(now/1000),exp:Math.floor(now/1000)+3600};
  const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const sign=async payload=>{const text=encode({alg:'RS256',kid:jwk.kid})+'.'+encode(payload);return text+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(text))).toString('base64url');};
  const fetcher=async()=>Response.json({keys:[jwk]});
  assert.equal((await verifyToken(await sign(claims),fetcher,now)).sub,'student');
  await assert.rejects(verifyToken(await sign({...claims,aud:'other-project'}),fetcher,now),/Sign in/);
  await assert.rejects(verifyToken(await sign({...claims,exp:1}),fetcher,now),/Sign in/);
  const token=await sign(claims);await assert.rejects(verifyToken(token.slice(0,token.lastIndexOf('.')+1)+'AAAA',fetcher,now),/Sign in/);
});
