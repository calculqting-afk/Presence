const test=require('node:test'),assert=require('node:assert/strict');
globalThis.crypto ||= require('node:crypto').webcrypto;
async function fixture(){
 const {DuringAttendanceService}=await import('../../workers/admin-api/src/during-attendance.js');
 const {PolicyAgreementPolicy:Policy}=await import('../../assets/js/core/accounts/PolicyAgreementPolicy.js');
 let now=Date.parse('2026-11-17T10:00:00+08:00');
 const store=new Map([
  ['students/student',{active:true,role:'student',accountId:'123',section:'2A'}],
  ['students/admin',{active:true,role:'attendance_admin'}],
  ['accountSessions/student',{sessionId:'s'}],['accountSessions/admin',{sessionId:'a'}],
  [Policy.path('student').join('/'),Policy.receipt('student',new Date(now))],
  ['faceRegistrations/student',{registered:true}],
  ['events/event',{name:'Event',date:'2026-11-17',openAt:new Date(now-3600000),closeAt:new Date(now+3600000),checkOutClosesAt:new Date(now+7200000),attendanceRoster:{student:'2A'},audienceSections:['2A']}],
  ['attendance/student_event',{studentUid:'student',eventId:'event',eventDate:'2026-11-17',status:'checked-in',arrivalStatus:'late',checkedInAt:new Date(now-60000)}]
 ]),writes=[];
 const db={get:async path=>structuredClone(store.get(path)||null),user:async()=>({disabled:false,validSince:'0'}),write:(path,data,options={})=>({path,data,options}),
  transaction:async fn=>{const changes=await fn(db.get);for(const change of changes){if(change.options.exists!==undefined)assert.equal(store.has(change.path),change.options.exists);writes.push(change);store.set(change.path,{...(change.options.merge?store.get(change.path):{}),...change.data});}}};
 const admin={sub:'admin',auth_time:now/1000,presenceSession:'a'},student={sub:'student',auth_time:now/1000,presenceSession:'s'};
 const service=new DuringAttendanceService(db,()=>now);
 const body={eventId:'event',enabled:true,label:'Mid-event',opensAt:now+60000,closesAt:now+600000,revision:''};
 const enable=async()=>{const result=await service.configure(admin,body);now+=60000;return {eventId:'event',checkpointId:result.checkpoint.id};};
 return {store,writes,db,service,admin,student,body,enable,now:()=>now,advance:ms=>now+=ms};
}
test('During is off by default; one checkpoint is configured per session without changing attendance',async()=>{
 const f=await fixture(),before=structuredClone(f.store.get('attendance/student_event'));
 assert.equal(f.store.get('events/event').duringAttendance,undefined);
 const result=await f.service.configure(f.admin,f.body);
 assert.equal(result.checkpoint.enabled,true);assert.deepEqual(f.store.get('attendance/student_event'),before);
 assert.equal(f.writes.length,3);assert.equal(f.store.get('eventPushOutbox/event').pending,true);
 await assert.rejects(f.service.configure(f.admin,f.body),/changed/);
 const revision=result.checkpoint.id;
 await f.service.configure(f.admin,{eventId:'event',enabled:false,revision});
 assert.equal(f.store.get('events/event').duringAttendance.enabled,false);
});
test('checkpoint configuration rejects staff without permission, past times, bad session bounds, and edits once open',async()=>{
 for(const update of [{opensAt:0},{closesAt:Infinity},{label:''},{opensAt:Date.parse('2026-11-17T08:00:00+08:00')},{closesAt:Date.parse('2026-11-17T12:00:00+08:00')},{enabled:'true'},{studentUid:'other'}]){
  const f=await fixture();await assert.rejects(f.service.configure(f.admin,{...f.body,...update}));assert.equal(f.writes.length,0);
 }
 const f=await fixture();f.store.get('students/admin').role='student_manager';await assert.rejects(f.service.configure(f.admin,f.body),/permission/);assert.equal(f.writes.length,0);
 f.store.get('students/admin').role='attendance_admin';const config=await f.service.configure(f.admin,f.body);f.advance(60000);
 await assert.rejects(f.service.configure(f.admin,{eventId:'event',enabled:false,revision:config.checkpoint.id}),/locked/);
});
test('student During confirmation is idempotent and preserves check-in, arrival, checkout and fines',async()=>{
 const f=await fixture(),body=await f.enable(),before=structuredClone(f.store.get('attendance/student_event'));
 const result=await f.service.confirm(f.student,body);assert.equal(result.saved,true);
 const saved=f.store.get('attendance/student_event');assert.deepEqual(saved.checkedInAt,before.checkedInAt);assert.equal(saved.arrivalStatus,'late');assert.equal(saved.status,'checked-in');assert.equal(saved.checkedOutAt,undefined);
 const count=f.writes.length;assert.equal((await f.service.confirm(f.student,body)).existing,true);assert.equal(f.writes.length,count);
 assert.equal(f.writes.some(item=>item.path.startsWith('fines/')),false);
});
test('During rejects missing check-in, checkout-only, completed, wrong session, face/account restrictions and expired windows',async()=>{
 for(const mutate of [f=>f.store.delete('attendance/student_event'),f=>f.store.get('attendance/student_event').status='checkout-only',f=>f.store.get('attendance/student_event').checkedOutAt=new Date(f.now()),f=>f.store.get('attendance/student_event').eventId='other',f=>f.store.get('students/student').mustChangePassword=true,f=>f.store.get('faceRegistrations/student').registered=false,f=>f.store.get('accountSessions/student').sessionId='changed',f=>f.store.get('events/event').attendanceRoster={},f=>f.advance(600000)]){
  const f=await fixture(),body=await f.enable();mutate(f);const count=f.writes.length;
  await assert.rejects(f.service.confirm(f.student,body));assert.equal(f.writes.length,count);
 }
});
test('During GPS checks freshness, precision and the server boundary; QR fallback remains a separate authorized flow',async()=>{
 const f=await fixture(),body=await f.enable();f.store.get('events/event').requiresGeofence=true;
 f.store.set('eventGeofences/event',{enabled:true,type:'circle',latitude:10,longitude:124,radiusMeters:50});
 for(const extra of [{},{sampledAt:f.now()-31000,location:{latitude:10,longitude:124,accuracy:5}},{sampledAt:f.now(),location:{latitude:10,longitude:124,accuracy:500}},{sampledAt:f.now(),location:{latitude:11,longitude:124,accuracy:5}}])await assert.rejects(f.service.confirm(f.student,{...body,...extra}));
 await f.service.confirm(f.student,{...body,sampledAt:f.now(),location:{latitude:10,longitude:124,accuracy:5}});
 assert.equal(f.store.get('attendance/student_event').duringAttendance.method,'student');
});
test('During status distinguishes confirmed, missed review and not required without treating disabled sessions as missing',async()=>{
 const {DuringAttendancePolicy:P}=await import('../../assets/js/core/attendance/DuringAttendancePolicy.js');
 const f=await fixture(),record=f.store.get('attendance/student_event');
 assert.equal(P.state(f.store.get('events/event'),record,f.now()),'not-required');await f.service.configure(f.admin,f.body);
 const event=f.store.get('events/event');
 assert.equal(P.state(event,record,f.now()),'scheduled');f.advance(60000);assert.equal(P.state(event,record,f.now()),'open');
 f.advance(600000);assert.equal(P.state(event,record,f.now()),'missed');assert.equal(P.state(event,{...record,checkedOutAt:new Date(f.now()-1200000)},f.now()),'not-required');
 assert.equal(P.state(event,{...record,checkedInAt:new Date(f.now()+1)},f.now()),'not-required');
 assert.equal(P.state({}, {...record,duringAttendance:{confirmedAt:new Date()}},f.now()),'confirmed');
});

test('open checkpoint asks students to check in first while leaving confirmation eligibility unchanged',async()=>{
 const {DuringAttendancePolicy:P,duringStatusMarkup}=await import('../../assets/js/core/attendance/DuringAttendancePolicy.js');
 const f=await fixture();await f.enable();const event=f.store.get('events/event'),now=f.now();
 assert.equal(P.label(event,null,now),'Check in first');
 assert.match(duringStatusMarkup(event,null,String,now),/During: Check in first/);
 assert.equal(P.state(event,null,now),'not-required','no check-in still cannot confirm During attendance');
 assert.equal(P.label(event,f.store.get('attendance/student_event'),now),'Open');
 assert.equal(P.label(event,{checkedOutAt:new Date(now)},now),'Not required');
 assert.equal(P.label({},null,now),'Not required');
 assert.equal(P.label(event,null,now-1),'Scheduled');
 assert.equal(P.label(event,null,event.duringAttendance.closesAt.getTime()),'Not required');
});

test('event schedule edits keep enabled checkpoints in the session and preserve started confirmations',async()=>{
 const {EventSessionPolicy:E}=await import('../../assets/js/controllers/events/EventSessionPolicy.js');
 const {DuringAttendancePolicy:P}=await import('../../assets/js/core/attendance/DuringAttendancePolicy.js');
 const f=await fixture();await f.service.configure(f.admin,f.body);const event=f.store.get('events/event');
 const shrink={...event,closeAt:new Date(f.body.closesAt-1)};
 assert.throws(()=>E.assertSchedule(shrink,event,new Date(f.now())),/Adjust or disable/);
 assert.throws(()=>E.assertSchedule({...event,openAt:new Date(f.body.opensAt+1)},event,new Date(f.now())),/exclude/);
 assert.throws(()=>E.assertSchedule({...event,date:'2030-01-01'},event,new Date(f.now())),/checkpoint/);
 assert.doesNotThrow(()=>E.assertSchedule({...event,closeAt:new Date(f.body.closesAt+60000)},event,new Date(f.now())));
 f.advance(60000);assert.throws(()=>E.assertSchedule(shrink,event,new Date(f.now())),/has started/);
 assert.equal(P.state(shrink,f.store.get('attendance/student_event'),f.now()),'unavailable');
 assert.equal(P.label(shrink,null,f.now()),'Schedule needs review');
 assert.equal(P.state(shrink,{duringAttendance:{confirmedAt:new Date(f.now())}},f.now()),'confirmed');
 const disabled={...event,duringAttendance:{enabled:false}};
 assert.doesNotThrow(()=>E.assertSchedule({...disabled,closeAt:shrink.closeAt},disabled,new Date(f.now())));
});
test('During push milestones target checked-in students only and stop on confirmation or disabled configuration',async()=>{
 const {milestones,eligible,message,revisionData}=await import('../../workers/notifications/src/policy.js');
 const f=await fixture(),body=await f.enable(),event=f.store.get('events/event'),record=f.store.get('attendance/student_event'),student={...f.store.get('students/student'),uid:'student'};
 event.checkInClosesAt=new Date(f.now()+1000);
 assert.ok(milestones(event,f.now()-60000).some(item=>item.kind==='during-open'));
 assert.equal(eligible(student,event,record,'during-open',f.now()),true);
 assert.match(message(event,record,'during-open',f.now()).title,/During/);
 assert.equal(eligible(student,event,null,'during-open',f.now()),false);
 await f.service.confirm(f.student,body);assert.equal(eligible(student,event,f.store.get('attendance/student_event'),'during-open',f.now()),false);
 const revision=revisionData(event);event.duringAttendance={...event.duringAttendance,enabled:false};assert.notEqual(revisionData(event),revision);assert.equal(milestones(event,f.now()).some(item=>item.kind==='during-open'),false);
});
