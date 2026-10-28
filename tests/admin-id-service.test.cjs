const test=require('node:test'),assert=require('node:assert/strict');
globalThis.crypto ||= require('node:crypto').webcrypto;
async function fixture(){
  const {StudentIdService}=await import('../workers/admin-api/src/student-id.js');
  let now=Date.parse('2026-10-28T08:00:00Z'),failFinal=false,changes=0;
  const profile={uid:'student',accountId:'25100044-1',accountIdKey:'25100044-1',authEmail:'25100044-1@students.presence.local',active:true,role:'student',firstName:'Test',lastName:'Student',_updateTime:'revision-1',faceData:'preserve',email:'student@example.test'};
  const store=new Map([['students/student',profile],['students/head',{active:true,role:'head_admin',firstName:'Test',lastName:'Admin'}],['studentIds/25100044-1',{uid:'student'}],['registrationRequests/25100044-1',{uid:'student',status:'approved',accountId:'25100044-1',requestedAt:new Date(now-1000)}],['attendance/student_event',{status:'completed'}],['fines/fine',{studentUid:'student',amount:10}]]);
  const users=new Map([['head',{localId:'head',email:'head@example.test',validSince:'0'}],['student',{localId:'student',email:profile.authEmail,passwordHash:'unchanged-password-hash',validSince:'0'}],['manager',{localId:'manager',email:'manager@example.test',validSince:'0'}]]);
  const db={get:async path=>structuredClone(store.get(path)||null),user:async uid=>structuredClone(users.get(uid)||null),
    userByEmail:async email=>structuredClone([...users.values()].find(user=>user.email===email)||null),
    changeEmail:async(uid,email)=>{changes++;users.get(uid).email=email;},
    write:(path,data,options={})=>({path,data,options}),remove:path=>({path,remove:true}),
    transaction:async fn=>{
      const get=path=>db.get(path);get.matches=async(field,value)=>[...store].filter(([path,data])=>path.startsWith('students/')&&data[field]===value).map(([path])=>path.split('/')[1]);
      const writes=await fn(get);
      if(failFinal&&writes.some(w=>w.path==='students/student'))throw Error('Final commit unavailable');
      for(const w of writes){if(w.options?.exists===false&&store.has(w.path))throw Error('Already exists');}
      for(const w of writes){if(w.remove)store.delete(w.path);else store.set(w.path,{...(w.options.merge?store.get(w.path):{}),...structuredClone(w.data)});}
    }};
  const service=new StudentIdService(db,'test-preview-signing-secret-long-enough',()=>now);
  const claims=uid=>({sub:uid,auth_time:Math.floor(now/1000)}),body={studentUid:'student',oldId:'25100044-1',newId:'2510004-1',reason:'Remove accidentally repeated digit'};
  const preview=()=>service.preview(claims('head'),body);
  const confirm=plan=>service.execute(claims('head'),{preview:plan.preview,signature:plan.signature,confirmId:body.newId});
  return {service,db,store,users,body,claims,preview,confirm,changes:()=>changes,advance:ms=>now+=ms,failFinal:value=>failFinal=value};
}
test('ID preview makes no writes; confirmation changes only the login and ID indexes, preserving records/password',async()=>{
  const f=await fixture(),original=JSON.stringify([...f.store]),p=await f.preview();
  assert.equal(JSON.stringify([...f.store]),original);assert.equal(f.changes(),0);assert.equal(p.resume,false);
  await f.confirm(p);assert.equal(f.changes(),1);
  const profile=f.store.get('students/student');assert.equal(profile.accountId,f.body.newId);assert.equal(profile.faceData,'preserve');assert.equal(profile.email,'student@example.test');
  assert.equal(f.users.get('student').passwordHash,'unchanged-password-hash');assert.equal(f.store.get('attendance/student_event').status,'completed');assert.equal(f.store.get('fines/fine').amount,10);
  assert.equal(f.store.has('studentIds/'+f.body.oldId),false);assert.equal(f.store.get('studentIds/'+f.body.newId).uid,'student');
  assert.equal(f.store.has('registrationRequests/'+f.body.oldId),false);assert.equal(f.store.get('registrationRequests/'+f.body.newId).status,'approved');
  assert.equal(f.store.has('studentIdCorrectionLocks/student'),false);
  const audit=[...f.store].find(([path])=>path.startsWith('auditLogs/'))[1];assert.equal(audit.status,'completed');assert.equal(audit.actorName,'Test Admin');assert.ok(!JSON.stringify(audit).includes('passwordHash'));
  await f.confirm(p);assert.equal(f.changes(),1,'Repeated confirmation is idempotent');
});
test('ID correction rejects unauthorized roles, privileged targets, duplicates and pending password resets',async()=>{
  for(const actor of ['student','manager']){const f=await fixture();await assert.rejects(f.service.preview(f.claims(actor),f.body),/Only/);}
  for(const mutate of [
    f=>f.store.get('students/student').role='attendance_admin',
    f=>f.store.get('students/student').active=false,
    f=>f.store.get('students/student').passwordResetRequired=true,
    f=>f.store.set('passwordResets/student',{leaseUntil:Date.now()+86400000}),
    f=>f.store.set('studentIds/'+f.body.newId,{uid:'another'}),
    f=>f.store.set('students/another',{accountIdKey:f.body.newId}),
    f=>f.users.set('another',{localId:'another',email:f.body.newId+'@students.presence.local'}),
    f=>f.store.set('registrationRequests/'+f.body.newId,{uid:'another',status:'pending'})
  ]){const f=await fixture();mutate(f);await assert.rejects(f.preview());assert.equal(f.changes(),0);}
});
test('signed previews reject tampering, expiry, stale profiles, wrong confirmation and stale authentication',async()=>{
  const f=await fixture(),p=await f.preview();
  await assert.rejects(f.confirm({...p,preview:p.preview.replace('2510004-1','evil')}),/Preview/);
  await assert.rejects(f.service.execute(f.claims('head'),{...p,confirmId:'wrong'}),/confirmation/);
  await assert.rejects(f.service.execute({...f.claims('head'),auth_time:1},{...p,confirmId:f.body.newId}),/Confirm/);
  f.store.get('students/student')._updateTime='new-revision';await assert.rejects(f.confirm(p),/profile changed/);
  f.advance(300001);await assert.rejects(f.confirm(p),/expired/);assert.equal(f.changes(),0);
});
test('interrupted finalization keeps both reservations, rejects concurrent retry, then resumes without resetting password',async()=>{
  const f=await fixture(),p=await f.preview();f.failFinal(true);
  await assert.rejects(f.confirm(p),/incomplete/);assert.equal(f.changes(),1);assert.equal(f.store.get('students/student').accountId,f.body.oldId);
  assert.ok(f.store.has('studentIds/'+f.body.oldId));assert.ok(f.store.has('studentIds/'+f.body.newId));
  const during=await f.preview();assert.equal(during.resume,true);await assert.rejects(f.confirm(during),/in progress/);
  f.advance(120001);f.failFinal(false);await f.confirm(await f.preview());assert.equal(f.changes(),1);assert.equal(f.users.get('student').passwordHash,'unchanged-password-hash');
});
test('password reset refuses an ID correction lock',async()=>{
  const f=await fixture();const {ResetService}=await import('../workers/admin-api/src/service.js');
  f.store.set('studentIdCorrectionLocks/student',{operation:'pending'});
  await assert.rejects(new ResetService(f.db,()=>f.claims('head').auth_time*1000).reset(f.claims('head'),{studentUid:'student',operationId:crypto.randomUUID(),reason:'Verified reset request'}),/ID correction/);
});
test('Firestore codec preserves nested registration values and Auth email update never includes a password',async()=>{
  const {encode,decode,FirebaseGateway}=await import('../workers/admin-api/src/firebase.js');
  const value={at:new Date('2026-10-28T00:00:00Z'),items:['a',null,true,{value:2}]};assert.deepEqual(decode(encode(value)),value);
  const calls=[],gateway=new FirebaseGateway(JSON.stringify({project_id:'presence-a873f',client_email:'presence-password-reset@presence-a873f.iam.gserviceaccount.com'}),async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({});});
  gateway.access=async()=> 'test';await gateway.changeEmail('student','new@students.presence.local');
  assert.deepEqual(calls,[{localId:'student',email:'new@students.presence.local',returnSecureToken:false}]);
});
