const test=require('node:test');
const assert=require('node:assert/strict');
const {parse,StudentIdCorrection}=require('../tools/correct-student-id.cjs');
function fixture(){
 const data=new Map([
  ['students/u1',{uid:'u1',accountId:'25100044-1',accountIdKey:'25100044-1',authEmail:'25100044-1@students.presence.local',firstName:'Test',active:true,mustChangePassword:false}],
  ['studentIds/25100044-1',{uid:'u1',studentId:'25100044-1'}],
  ['registrationRequests/25100044-1',{uid:'u1',accountId:'25100044-1',status:'approved'}],
  ['attendance/u1_event',{studentUid:'u1',studentId:'25100044-1',checkedInAt:123}],
 ]);
 const users=new Map([['u1',{uid:'u1',email:'25100044-1@students.presence.local',disabled:false}]]);
 let failFinalize=false,updates=0;
 const snap=p=>({id:p.split('/').pop(),exists:data.has(p),data:()=>structuredClone(data.get(p))});
 const db={doc:p=>({path:p,id:p.split('/').pop(),get:async()=>snap(p)}),collection:p=>({where:(field,op,value)=>({collection:p,field,value,limit(){return this;},async get(){return query(this);}})}),async runTransaction(fn){
  const writes=[];
  const tx={get:async ref=>ref.collection?query(ref):snap(ref.path),create:(r,d)=>writes.push(['create',r.path,d]),set:(r,d)=>writes.push(['set',r.path,d]),update:(r,d)=>writes.push(['update',r.path,d]),delete:r=>writes.push(['delete',r.path])};
  await fn(tx);
  if(failFinalize && writes.some(([op,p])=>op==='update'&&p==='students/u1'))throw Error('Injected Firestore failure');
  for(const [op,p,d] of writes){if(op==='delete')data.delete(p);else data.set(p,op==='update'?{...data.get(p),...d}:structuredClone(d));}
 }};
 function query(q){const docs=[...data.keys()].filter(p=>p.startsWith(q.collection+'/')&&data.get(p)[q.field]===q.value).slice(0,2).map(snap);return {docs,size:docs.length};}
 const auth={async getUser(uid){if(!users.has(uid))throw Object.assign(Error('missing'),{code:'auth/user-not-found'});return {...users.get(uid)};},async getUserByEmail(email){const user=[...users.values()].find(u=>u.email===email);if(!user)throw Object.assign(Error('missing'),{code:'auth/user-not-found'});return {...user};},async updateUser(uid,patch){assert.deepEqual(Object.keys(patch),['email']);updates++;Object.assign(users.get(uid),patch);return {...users.get(uid)};}};
 const service=new StudentIdCorrection({db,auth,timestamp:()=>123456,actor:'local-admin'});
 return {data,users,service,setFail:v=>{failFinalize=v;},updates:()=>updates};
}
const oldId='25100044-1',newId='2510004-1';
test('correction changes Auth login and indexes, preserves UID/password flags and history, and is idempotent',async()=>{
 const f=fixture(),history=structuredClone(f.data.get('attendance/u1_event'));
 const plan=await f.service.prepare(oldId,newId);
 assert.equal(f.updates(),0,'preview performs no Auth writes');assert.equal(f.data.has('studentIds/'+newId),false);
 await f.service.execute(plan);
 assert.equal(f.users.get('u1').email,newId+'@students.presence.local');
 assert.equal(f.data.get('students/u1').accountId,newId);assert.equal(f.data.get('students/u1').mustChangePassword,false);
 assert.equal(f.data.has('studentIds/'+oldId),false);assert.equal(f.data.get('studentIds/'+newId).uid,'u1');
 assert.equal(f.data.get('registrationRequests/'+newId).accountIdKey,newId);assert.equal(f.data.has('registrationRequests/'+oldId),false);
 assert.deepEqual(f.data.get('attendance/u1_event'),history);
 assert.equal((await f.service.prepare(oldId,newId)).completed,true);assert.equal(f.updates(),1);
});
test('recovery resumes after Auth changed but Firestore finalization failed',async()=>{
 const f=fixture();f.setFail(true);
 await assert.rejects(f.service.execute(await f.service.prepare(oldId,newId)),/Injected/);
 assert.equal(f.users.get('u1').email,newId+'@students.presence.local');
 assert.equal(f.data.get('students/u1').accountId,oldId);assert.equal(f.data.get('studentIds/'+newId).correctionPending,true);
 f.setFail(false);await f.service.execute(await f.service.prepare(oldId,newId));
 assert.equal(f.data.get('students/u1').accountId,newId);assert.equal(f.updates(),1);
 assert.equal(f.data.has('studentIdCorrectionLocks/u1'),false);
});
test('duplicates, pending requests, staff and mismatched old logins fail before Auth writes',async()=>{
 for(const kind of ['index','auth','profile','request','staff','mismatch']){
  const f=fixture();
  if(kind==='index')f.data.set('studentIds/'+newId,{uid:'other'});
  if(kind==='auth')f.users.set('other',{uid:'other',email:newId+'@students.presence.local'});
  if(kind==='profile')f.data.set('students/other',{accountIdKey:newId});
  if(kind==='request')f.data.set('registrationRequests/'+newId,{uid:'other',status:'pending'});
  if(kind==='staff')f.data.get('students/u1').role='head_admin';
  if(kind==='mismatch')f.users.get('u1').email='other@example.test';
  await assert.rejects(f.service.prepare(oldId,newId));assert.equal(f.updates(),0,kind);
 }
});
test('confirmation plan is rechecked against changes and conflicting corrections',async()=>{
 const f=fixture(),plan=await f.service.prepare(oldId,newId);
 f.data.set('studentIds/'+newId,{uid:'other'});
 await assert.rejects(f.service.execute(plan));assert.equal(f.updates(),0);
 const g=fixture();g.data.set('studentIdCorrectionLocks/u1',{operation:'other'});
 await assert.rejects(g.service.prepare(oldId,newId),/Another/);
});
test('CLI validates IDs and supports help without credentials',()=>{
 assert.equal(parse(['--help']).help,true);
 assert.equal(parse(['--old',oldId,'--new',newId,'--dry-run'])['dry-run'],true);
 for(const args of [[],['--old','A','--new','a'],['--old','a/b','--new','c'],['--old',oldId,'--new',newId,'--yes']])assert.throws(()=>parse(args));
});
