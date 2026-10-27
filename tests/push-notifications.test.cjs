const test=require('node:test');const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');globalThis.crypto ||= webcrypto;
const time=value=>new Date(`2026-11-01T${value}:00+08:00`);
const event=()=>({id:'morning',name:'Intramurals — Morning',date:'2026-11-01',timeIn:'07:00',timeOut:'11:00',checkInCutoff:'09:00',checkOutCutoff:'12:00',
  openAt:time('07:00'),closeAt:time('11:00'),checkInClosesAt:time('09:00'),checkOutClosesAt:time('12:00'),audienceSections:['2A'],attendanceRoster:{student:'2A'},rosterVersion:1});
async function fixture() {
  const {PushService}=await import('../workers/notifications/src/service.js');
  let now=+time('06:00');const store=new Map(),sent=[];
  const db={get:async path=>structuredClone(store.get(path)||null),user:async uid=>({localId:uid,validSince:0}),
    write:(path,data,options={})=>({path,data,options}),
    commit:async writes=>{for(const {path,data,options} of writes)store.set(path,{...(options.merge?store.get(path):{}),...data});},
    transaction:async fn=>db.commit(await fn(db.get)),
    query:async(collection,filters,{after,limit=25}={})=>[...store].filter(([path,data])=>path.startsWith(collection+'/')&&filters.every(([key,op,value])=>op==='EQUAL'?data[key]===value:data[key]<=value))
      .map(([path,data])=>({...structuredClone(data),id:path.split('/').at(-1)})).filter(item=>!after||item.id>after).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,limit),
    batchGet:async paths=>new Map(paths.map(path=>[path,structuredClone(store.get(path)||null)])),send:async(...args)=>{sent.push(args);return 'sent';}};
  store.set('students/student',{active:true,section:'2A',role:'student'});
  store.set('events/morning',event());store.set('eventPushOutbox/morning',{pending:true});
  const service=new PushService(db,()=>now);return {store,db,service,sent,setNow(value){now=value;}};
}
test('push milestones distinguish late threshold from final closure, and morning/afternoon schedules stay independent',async()=>{
  const {milestones,eligible,message}=await import('../workers/notifications/src/policy.js');
  const e=event(),list=milestones(e,+time('06:00'));
  assert.equal(list.length,10);assert.equal(list.find(i=>i.kind==='checkin-soon').at,+time('06:50'));
  assert.equal(list.find(i=>i.kind==='ontime-5').at,+time('08:55'));
  assert.equal(list.find(i=>i.kind==='checkout-open').at,+time('11:00'));
  assert.equal(list.find(i=>i.kind==='closed').at,+time('12:00'));
  const student={uid:'student',active:true,section:'2A'};
  assert.equal(eligible(student,e,null,'checkin-open',+time('07:00')),true);
  assert.equal(eligible({...student,uid:'outsider',section:'1A'},e,null,'checkin-open',+time('07:00')),false);
  assert.equal(eligible(student,e,{checkedInAt:time('07:00')},'checkin-open',+time('07:00')),false);
  assert.equal(eligible(student,e,null,'checkout-open',+time('11:00')),false);
  assert.equal(eligible({...student,uid:'removed',section:'1A'},e,{checkedInAt:time('07:00')},'checkout-open',+time('11:00')),true);
  assert.equal(eligible(student,e,{checkedOutAt:time('11:01')},'closing-5',+time('11:55')),false);
  assert.equal(eligible({...student,passwordResetRequired:true},e,null,'checkin-open',+time('07:00')),false);
  assert.match(message(e,null,'ontime-ended',+time('09:00')).body,/still check in as Late/);
  assert.match(message(e,null,'closing-10',+time('11:53')).body,/7 minutes/);
  const afternoon={...e,id:'afternoon',name:'Intramurals — Afternoon',timeIn:'13:00',openAt:time('13:00'),checkInClosesAt:time('14:00'),closeAt:time('16:00'),checkOutClosesAt:time('17:00')};
  assert.equal(milestones(afternoon,+time('06:00')).find(i=>i.kind==='closed').at,+time('17:00'));
});
test('event sync is idempotent, edits invalidate old jobs and never replay past milestones or duplicate publication',async()=>{
  const f=await fixture();await f.service.syncEvent('morning');
  assert.equal(f.store.get('eventPushOutbox/morning').pending,false);
  assert.equal([...f.store.keys()].filter(k=>k.startsWith('pushJobs/')).length,10);
  f.store.set('eventPushOutbox/morning',{pending:true});await f.service.syncEvent('morning');
  assert.equal([...f.store.keys()].filter(k=>k.startsWith('pushJobs/')).length,10);
  f.setNow(+time('10:00'));f.store.get('events/morning').checkOutClosesAt=time('12:30');
  f.store.get('events/morning').checkOutCutoff='12:30';f.store.set('eventPushOutbox/morning',{pending:true});
  await f.service.syncEvent('morning');
  assert.equal([...f.store.values()].filter(v=>v.kind==='published').length,1);
  const published=[...f.store].find(([,v])=>v.kind==='published')[0].split('/')[1];
  assert.equal(await f.service.deliver(published,0,()=>false),true);assert.equal(f.sent.length,0);
});
test('device registration authenticates current profile, bounds input/rate, and cannot unregister another student token',async()=>{
  const f=await fixture(),claims={sub:'student',auth_time:200},body={token:'token_'.repeat(8),installationId:'install-one'};
  assert.equal((await f.service.device(claims,body)).registered,true);
  const device=[...f.store].find(([k])=>k.startsWith('pushDevices/'));
  assert.ok(device[1].shard>=0&&device[1].shard<32);
  await f.service.device({sub:'other'},body,true);assert.equal(f.store.get(device[0]).active,true);
  await f.service.device(claims,body,true);assert.equal(f.store.get(device[0]).active,false);
  await assert.rejects(f.service.device(claims,{...body,token:'bad'}),/Invalid/);
  f.store.get('students/student').passwordResetRequired=true;
  await assert.rejects(f.service.device(claims,body),/active student/);
  f.store.get('students/student').passwordResetRequired=false;f.store.set('pushRegistrationLimits/student',{count:20,windowStart:+time('06:00')});
  await assert.rejects(f.service.device(claims,body),/Wait/);
});
test('delivery checks current eligibility, revocation and attendance; retry tags are stable and completed shards never resend',async()=>{
  const f=await fixture();await f.service.syncEvent('morning');
  const [path,job]=[...f.store].find(([,v])=>v.kind==='checkin-open');const id=path.split('/')[1];f.setNow(job.at);
  f.store.set('pushDevices/device',{uid:'student',token:'private-fcm-token',active:true,authTime:200,shard:0,expiresAt:job.expiresAt+100000,updatedAt:1});
  assert.equal(await f.service.deliver(id,0,()=>false),true);assert.equal(f.sent.length,1);
  assert.equal(await f.service.deliver(id,0,()=>false),true);assert.equal(f.sent.length,1);
  assert.equal(f.sent[0][2].recipientUid,'student');assert.ok(!JSON.stringify([...f.store].filter(([k])=>!k.startsWith('pushDevices'))).includes('private-fcm-token'));
  f.store.delete('pushDeliveries/'+id+'_0');f.store.set('attendance/student_morning',{checkedInAt:time('07:00')});
  await f.service.deliver(id,0,()=>false);assert.equal(f.sent.length,1);
  f.store.delete('pushDeliveries/'+id+'_0');f.store.delete('attendance/student_morning');f.store.get('students/student').passwordResetValidAfter=201;
  await f.service.deliver(id,0,()=>false);assert.equal(f.sent.length,1);
});
test('expired jobs, deleted events, delivery leases and failed sends do not claim successful delivery',async()=>{
  const f=await fixture();await f.service.syncEvent('morning');
  const [path,job]=[...f.store].find(([,v])=>v.kind==='checkin-open');const id=path.split('/')[1];f.setNow(job.at);
  f.store.set('pushDeliveries/'+id+'_0',{leaseUntil:job.at+60000});assert.equal(await f.service.deliver(id,0,()=>false),false);
  f.store.delete('pushDeliveries/'+id+'_0');f.store.set('pushDevices/device',{uid:'student',token:'token',active:true,authTime:200,shard:0,expiresAt:job.expiresAt+100000});
  f.db.send=async()=>{throw Error('network')};assert.equal(await f.service.deliver(id,0,()=>false),false);
  assert.notEqual(f.store.get('pushDeliveries/'+id+'_0').done,true);
  f.setNow(job.expiresAt+1);let dispatches=0;await f.service.runJob(id,()=>{dispatches++;return true;});assert.equal(dispatches,0);
  assert.equal(f.store.get(path).state,'expired');
});
test('push HTTP endpoint blocks unauthenticated sends, unknown origins, disabled service and oversized bodies',async()=>{
  const {endpoint}=await import('../workers/notifications/src/http.js');let registrations=0;
  const handle=endpoint({verify:async()=>({sub:'student'}),service:()=>({device:async()=>{registrations++;return {registered:true};}})});
  const env={PUSH_ENABLED:'true',ALLOWED_ORIGINS:'https://localhost'};
  const request=(body='{}',headers={})=>new Request('https://push.test/v1/device/register',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
  assert.equal((await handle(request(),env)).status,401);
  assert.equal((await handle(request('{}',{Authorization:'Bearer test',Origin:'https://bad.test'}),env)).status,403);
  assert.equal((await handle(request('x'.repeat(6001),{Authorization:'Bearer test'}),env)).status,413);
  assert.equal((await handle(request('{}',{Authorization:'Bearer test'}),{...env,PUSH_ENABLED:'false'})).status,503);
  assert.equal((await handle(new Request('https://push.test/v1/send'),env)).status,404);
  assert.equal((await handle(request('{}',{Authorization:'Bearer test'}),env)).status,200);assert.equal(registrations,1);
});
test('native push cancels legacy alarms only after successful binding; website stays permission-free; taps and logout are scoped to owner',async()=>{
  const {PushAttendanceNotifications,stopAttendancePush}=await import('../assets/js/controllers/PushAttendanceNotifications.js');
  const callbacks={},calls=[],storage=new Map();let user={uid:'student',getIdToken:async()=> 'test-token'};
  const push={addListener:async(name,fn)=>{callbacks[name]=fn;return {remove:async()=>{}};},createChannel:async()=>{},checkPermissions:async()=>({receive:'granted'}),register:async()=>{},unregister:async()=>calls.push('unregister'),removeAllDeliveredNotifications:async()=>{}};
  const native={isNative:true,pushNotifications:push,localNotifications:{getPending:async()=>({notifications:[{id:1,extra:{presenceAttendance:true}},{id:2}]}),cancel:async value=>calls.push(value.notifications)}};
  const opened=[],toasts=[];const controller=new PushAttendanceNotifications({native,getUser:()=>user,getStudent:()=>({active:true}),onOpen:id=>opened.push(id),notify:(...args)=>toasts.push(args),
    window:{addEventListener(){},removeEventListener(){}},storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},fetcher:async()=>Response.json({registered:true})});
  await controller.initialize();controller.token='token';await controller.bind();assert.equal(native.pushActive,true);assert.deepEqual(calls[0],[{id:1}]);
  const notice={title:'Attendance',body:'Open',data:{presenceAttendance:'true',recipientUid:'student',eventId:'event',key:'key',expiresAt:String(Date.now()+60000)}};
  callbacks.pushNotificationReceived(notice);callbacks.pushNotificationReceived(notice);assert.equal(toasts.length,1);
  callbacks.pushNotificationActionPerformed({notification:notice});assert.deepEqual(opened,['event']);
  user={uid:'other'};callbacks.pushNotificationReceived({...notice,data:{...notice.data,key:'other'}});assert.equal(toasts.length,1);
  await stopAttendancePush();assert.equal(native.pushActive,false);assert.ok(calls.includes('unregister'));
  const web=new PushAttendanceNotifications({native:{isNative:false},getUser:()=>user,getStudent:()=>({}),notify(){},onOpen(){}});await web.initialize();assert.equal(web.initialized,undefined);
});
test('Firebase push REST adapter decodes rosters/timestamps, masks batch reads and bounds FCM delivery TTL',async()=>{
  const {PushGateway}=await import('../workers/notifications/src/firebase.js');
  const calls=[];let response;
  const db=new PushGateway(JSON.stringify({project_id:'presence-a873f',client_email:'presence-notifications@presence-a873f.iam.gserviceaccount.com'}),async(url,options)=>{calls.push({url,body:options.body&&JSON.parse(options.body)});return Response.json(response);});
  db.access=async()=> 'test-access-token';
  response={name:'projects/presence-a873f/databases/(default)/documents/events/event',fields:{openAt:{timestampValue:'2026-11-01T00:00:00Z'},attendanceRoster:{mapValue:{fields:{student:{stringValue:'2A'}}}},audienceSections:{arrayValue:{values:[{stringValue:'2A'}]}}}};
  const e=await db.get('events/event');assert.equal(e.openAt instanceof Date,true);assert.equal(e.attendanceRoster.student,'2A');assert.deepEqual(e.audienceSections,['2A']);
  response=[{found:{name:'projects/presence-a873f/databases/(default)/documents/students/student',fields:{active:{booleanValue:true}}}}];
  assert.equal((await db.batchGet(['students/student'])).get('students/student').active,true);
  assert.ok(!calls.at(-1).body.mask.fieldPaths.includes('photoDataUrl'));
  response={name:'test-message'};assert.equal(await db.send('token',{title:'Test',body:'Body'},{eventId:'event'},'stable-tag',Date.now()+60000),'sent');
  assert.equal(calls.at(-1).body.message.android.notification.tag,'stable-tag');assert.match(calls.at(-1).body.message.android.ttl,/^\d+s$/);
  const count=calls.length;assert.equal(await db.send('token',{}, {},'tag',Date.now()-1),'expired');assert.equal(calls.length,count);
});
