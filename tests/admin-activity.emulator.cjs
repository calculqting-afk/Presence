// Local demo emulator only. Never uses real accounts or service credentials.
const assert=require('node:assert/strict');
const project='demo-presence-audience',host=process.env.FIRESTORE_EMULATOR_HOST;
if(!/^127\.0\.0\.1:\d+$/.test(host||''))throw Error('Local emulator required');
const base=`http://${host}/v1/projects/${project}/databases/(default)/documents`,SERVER=Symbol('server'),now=Date.now(),superUid='8uEjAk72BLWKjvnQJEatBdeVAi02';
const token=uid=>[Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:uid,user_id:uid,email:uid+'@example.test',aud:project,iss:`https://securetoken.google.com/${project}`,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600,auth_time:Math.floor(now/1000),firebase:{sign_in_provider:'password'}})).toString('base64url'),''].join('.');
function encode(data,transforms,prefix=''){
  if(data===SERVER){transforms.push({fieldPath:prefix,setToServerValue:'REQUEST_TIME'});return;}
  if(data===null)return {nullValue:null};if(data instanceof Date)return {timestampValue:data.toISOString()};
  if(Array.isArray(data))return {arrayValue:{values:data.map(item=>encode(item,transforms))}};
  if(typeof data==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(data).map(([key,item])=>[key,encode(item,transforms,prefix?`${prefix}.\`${key}\``:`\`${key}\``)]).filter(([,item])=>item))}};
  if(typeof data==='boolean')return {booleanValue:data};if(typeof data==='number')return {integerValue:String(data)};return {stringValue:data};
}
async function commit(entries,uid='owner',allowed=true){
  const writes=entries.map(([path,data,mask])=>{if(data===null)return {delete:`projects/${project}/databases/(default)/documents/${path}`};const transforms=[],fields=encode(data,transforms).mapValue.fields;
    return {update:{name:`projects/${project}/databases/(default)/documents/${path}`,fields},...(mask?{updateMask:{fieldPaths:mask}}:{}),...(transforms.length?{updateTransforms:transforms}:{})};});
  const response=await fetch(base+':commit',{method:'POST',headers:{Authorization:'Bearer '+(uid==='owner'?uid:token(uid)),'Content-Type':'application/json'},body:JSON.stringify({writes})});
  assert.equal(response.ok,allowed,`${entries[0][0]} ${await response.text()}`);
}
(async()=>{
  const {activityRecord,activitySnapshot}=await import('../assets/js/controllers/ActivityRecordPolicy.js');
  for(const [uid,role] of [['loghead','head_admin'],['logattendance','attendance_admin'],['logmanager','student_manager'],['logstudent','student']])await commit([['students/'+uid,{uid,accountId:uid,active:true,role,section:'2A',firstName:'Test',lastName:'Student'}]]);
  const event={name:'Audit test',type:'Assembly',date:'2026-10-28',timeIn:'07:00',checkInCutoff:'09:00',timeOut:'11:00',checkOutCutoff:'12:00',location:'Hall',audience:'All students',description:'',requiresGeofence:false,
    openAt:new Date(now+3600000),checkInClosesAt:new Date(now+7200000),closeAt:new Date(now+10800000),checkOutClosesAt:new Date(now+14400000),updatedAt:SERVER,attendanceRoster:{logstudent:'2A'},rosterCapturedAt:SERVER};
  const log=activityRecord({action:'event-created',actorUid:'loghead',eventId:'logevent',eventName:event.name,reason:'Publish verified schedule',before:null,after:activitySnapshot('event',event),createdAt:SERVER});
  await commit([['events/logevent',event],['activityLogs/eventcreated',log]],'loghead');
  const pair=[];
  for(const id of ['pairmorning','pairafternoon'])pair.push(['events/'+id,event],['eventGeofences/'+id,{enabled:false}],['eventPushOutbox/'+id,{eventId:id,pending:true,requestedAt:SERVER}],['activityLogs/'+id,{...log,eventId:id}]);
  await commit(pair,'loghead');
  for(const patch of [{actorUid:'somebody-else'},{after:{...log.after,name:'Fake title'}},{createdAt:new Date(now-1000)},{password:'never-store-this'}])await commit([['activityLogs/forged', {...log,...patch}]],'loghead',false);
  await commit([['activityLogs/forged',{...log,eventId:'missing'}]],'loghead',false);
  await commit([['activityLogs/eventcreated',{...log,reason:'Overwrite immutable log'}]],superUid,false);
  await commit([['activityLogs/eventcreated',null]],superUid,false);
  const updated={...event,name:'Corrected title'};
  // The stored event has a server timestamp, but the compared snapshot excludes it.
  await commit([['events/logevent',updated],['activityLogs/eventupdated',activityRecord({...log,action:'event-updated',eventName:updated.name,before:activitySnapshot('event',event),after:activitySnapshot('event',updated)})]],'loghead');
  const roleLog=activityRecord({action:'role-changed',actorUid:superUid,subjectUid:'logstudent',subjectId:'logstudent',subjectName:'Test Student',reason:'Assign verified attendance duty',before:{role:'student'},after:{role:'attendance_admin'},createdAt:SERVER});
  await commit([['students/logstudent',{role:'attendance_admin',roleUpdatedAt:SERVER,roleUpdatedBy:superUid},['role','roleUpdatedAt','roleUpdatedBy']],['activityLogs/role',roleLog]],superUid);
  await commit([['activityLogs/fakerole',{...roleLog,actorUid:'loghead'}]],'loghead',false);
  const closed={...event,openAt:new Date(now-7200000),checkInClosesAt:new Date(now-6000000),closeAt:new Date(now-4000000),checkOutClosesAt:new Date(now-3600000),rosterCapturedAt:new Date(now-86400000)};
  await commit([['events/logclosed',closed]]);
  const after={studentUid:'logstudent',studentId:'logstudent',eventId:'logclosed',eventName:event.name,eventType:event.type,eventDescription:'',eventDate:event.date,timeIn:event.timeIn,timeOut:event.timeOut,location:event.location,audience:event.audience,
    attendedAt:new Date(now-7200000),checkedInAt:new Date(now-7200000),checkedOutAt:new Date(now-4000000),arrivalStatus:'present',status:'completed',recordSource:'admin-corrected',correctionId:'logcorrection',correctedBy:'logattendance',correctedAt:SERVER,correctionReason:'Verified the attendance register'};
  const attendanceLog=activityRecord({action:'attendance-corrected',actorUid:'logattendance',subjectUid:'logstudent',subjectId:'logstudent',subjectName:'Test Student',eventId:'logclosed',eventName:event.name,reason:after.correctionReason,before:null,after:activitySnapshot('attendance',after),createdAt:SERVER});
  await commit([['attendance/logstudent_logclosed',after],['attendance/logstudent_logclosed/corrections/logcorrection',{before:null,after,by:'logattendance',at:SERVER,reason:after.correctionReason}],['activityLogs/attendance_logcorrection',attendanceLog]],'logattendance');
  for(const uid of ['loghead','logattendance','logmanager']){const response=await fetch(base+'/activityLogs/eventcreated',{headers:{Authorization:'Bearer '+token(uid)}});assert.equal(response.ok,false,'History is Super Admin only');}
  const response=await fetch(base+'/activityLogs/eventcreated',{headers:{Authorization:'Bearer '+token(superUid)}});assert.equal(response.ok,true);
  await commit([['students/logstudent',{accountId:'tampered'},['accountId']]],superUid,false);
  await commit([['studentIds/logstudent',{uid:'logstudent'}],['studentIdCorrectionLocks/logstudent',{operation:'pending',leaseUntil:now+120000}]]);
  await commit([['students/logstudent',{firstName:'Changed'},['firstName']]],superUid,false);
  await commit([['studentIds/logstudent',null]],superUid,false);
  for(const collection of ['studentIdCorrections','studentIdCorrectionLocks','studentIdCorrectionLimits'])await commit([[collection+'/forged',{uid:'logstudent'}]],superUid,false);
  console.log('Activity and ID Rules passed: atomic event/role/attendance logs, actor/snapshot validation, private immutable history, protected login fields and correction locks.');
})().catch(error=>{console.error(error);process.exitCode=1;});
