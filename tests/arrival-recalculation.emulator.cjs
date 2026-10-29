// Local demo emulator only. Never uses real accounts or service credentials.
const assert=require('node:assert/strict');
const project='demo-presence-audience',host=process.env.FIRESTORE_EMULATOR_HOST;
if(!/^127\.0\.0\.1:\d+$/.test(host||''))throw Error('Local emulator required');
const base=`http://${host}/v1/projects/${project}/databases/(default)/documents`,SERVER=Symbol('server'),now=Date.now(),superUid='8uEjAk72BLWKjvnQJEatBdeVAi02';
const token=uid=>[Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:uid,user_id:uid,superAdmin:uid==='8uEjAk72BLWKjvnQJEatBdeVAi02',email:uid+'@example.test',aud:project,iss:`https://securetoken.google.com/${project}`,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600,auth_time:Math.floor(now/1000),firebase:{sign_in_provider:'password'}})).toString('base64url'),''].join('.');
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
  for(const [uid,role] of [['arrivalstudent','student'],['arrivalhead','head_admin'],['arrivaladmin','attendance_admin'],['arrivalmanager','student_manager']])await commit([['students/'+uid,{uid,accountId:uid,active:true,role,section:'2A',firstName:'Test',lastName:'Student'}]]);
  const oldCutoff=new Date(now-5400000),newCutoff=new Date(now-4800000),checkedIn=new Date(now-5100000);
  const event={name:'Cutoff test',type:'Assembly',date:new Date(now + 8*3600000).toISOString().slice(0,10),timeIn:'13:00',checkInCutoff:'15:00',timeOut:'16:00',checkOutCutoff:'17:00',location:'Hall',audience:'All students',description:'',requiresGeofence:false,
    openAt:new Date(now-7200000),checkInClosesAt:oldCutoff,closeAt:new Date(now-3600000),checkOutClosesAt:new Date(now-1800000),updatedAt:new Date(now-86400000),attendanceRoster:{arrivalstudent:'2A'},rosterCapturedAt:new Date(now-86400000)};
  const changed={...event,checkInCutoff:'15:10',checkInClosesAt:newCutoff,updatedAt:SERVER};
  await commit([['events/arrivalclosed',event]]);
  const eventLog=activityRecord({action:'event-updated',actorUid:'arrivalhead',eventId:'arrivalclosed',eventName:event.name,reason:'Extend late cutoff by ten minutes',before:activitySnapshot('event',event),after:activitySnapshot('event',changed),createdAt:SERVER});
  await commit([['events/arrivalclosed',changed],['activityLogs/arrivalcutoffevent',eventLog]],'arrivalhead');
  // A closed cutoff may be extended, not shortened or moved beyond checkout opens.
  await commit([['events/arrivalclosed',{...changed,checkInClosesAt:oldCutoff}]],'arrivalhead',false);
  await commit([['events/arrivalclosed',{...changed,checkInClosesAt:new Date(now-1000000)}]],'arrivalhead',false);
  await commit([['events/arrivalclosed',{...changed,timeIn:'12:00',openAt:new Date(now-9000000)}]],'arrivalhead',false);
  const record={studentUid:'arrivalstudent',studentId:'arrivalstudent',eventId:'arrivalclosed',eventName:event.name,eventType:event.type,eventDescription:'',eventDate:event.date,timeIn:event.timeIn,timeOut:event.timeOut,location:event.location,audience:event.audience,
    attendedAt:checkedIn,checkedInAt:checkedIn,checkedOutAt:new Date(now-3500000),arrivalStatus:'late',status:'completed'};
  const path='attendance/arrivalstudent_arrivalclosed';await commit([[path,record]]);
  const patch={arrivalStatus:'present',arrivalRecalculatedAt:SERVER,arrivalRecalculatedBy:'arrivaladmin',arrivalRecalculationId:'testarrival',arrivalRecalculationReason:'Extended the check-in cutoff'};
  const after={...record,...patch};
  const audit=activityRecord({action:'arrival-recalculated',actorUid:'arrivaladmin',subjectUid:record.studentUid,subjectId:record.studentId,eventId:record.eventId,eventName:event.name,reason:patch.arrivalRecalculationReason,before:activitySnapshot('attendance',record),after:activitySnapshot('attendance',after),createdAt:SERVER});
  const entries=[[path,patch,Object.keys(patch)],['activityLogs/arrival_testarrival',audit]];
  await commit([entries[0]],'arrivaladmin',false);
  await commit(entries,'arrivalstudent',false);await commit(entries,'arrivalmanager',false);
  await commit([[path,{...patch,checkedInAt:new Date(now-5200000)},[...Object.keys(patch),'checkedInAt']],entries[1]],'arrivaladmin',false);
  await commit([entries[0],['activityLogs/arrival_testarrival',{...audit,actorUid:'arrivalhead'}]],'arrivaladmin',false);
  await commit(entries,'arrivaladmin');
  const saved=await fetch(base+'/'+path,{headers:{Authorization:'Bearer owner'}}).then(response=>response.json());
  assert.equal(saved.fields.checkedInAt.timestampValue,checkedIn.toISOString());assert.equal(saved.fields.checkedOutAt.timestampValue,record.checkedOutAt.toISOString());assert.equal(saved.fields.status.stringValue,'completed');
  await commit([['activityLogs/arrival_testarrival',{...audit,reason:'Rewrite history'}]],superUid,false);
  // No valid audit can manufacture a different, incorrect arrival label.
  const wrongPatch={...patch,arrivalStatus:'late',arrivalRecalculationId:'wrong'};
  await commit([[path,wrongPatch,Object.keys(wrongPatch)],['activityLogs/arrival_wrong',{...audit,before:activitySnapshot('attendance',after),after:activitySnapshot('attendance',{...after,arrivalStatus:'late'})}]],'arrivaladmin',false);
  // A manual attendance decision remains protected even from Super Admin recalculation.
  await commit([[path,{...record,recordSource:'admin-corrected',correctionId:'manual',correctedBy:'arrivaladmin'}]]);
  await commit(entries,'arrivaladmin',false);
  // Ordinary checkout still accepts recalculated records and preserves markers.
  await commit([['events/arrivalopen',{...event,checkInCutoff:'15:10',checkInClosesAt:newCutoff,checkOutClosesAt:new Date(now+3600000)}]]);
  const openRecord={...after,eventId:'arrivalopen',status:'checked-in',arrivalRecalculatedAt:new Date(now-500)};delete openRecord.checkedOutAt;
  await commit([['attendance/arrivalstudent_arrivalopen',openRecord]]);
  await commit([['attendance/arrivalstudent_arrivalopen',{status:'completed',checkedOutAt:SERVER},['status','checkedOutAt']]],'arrivalstudent');
  console.log('Arrival recalculation Rules passed: closed cutoff extension, atomic immutable audit, exact labels, original timestamps preserved, manual/unauthorized/tampered writes rejected, and student checkout retained.');
})().catch(error=>{console.error(error);process.exitCode=1;});
