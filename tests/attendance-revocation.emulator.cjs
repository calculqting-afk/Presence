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
  for(const [uid,role] of [['revstudent','student'],['revhead','head_admin'],['revadmin','attendance_admin'],['revmanager','student_manager']])await commit([['students/'+uid,{uid,accountId:uid,active:true,role,section:'2A'}]]);
  const id='revstudent_revevent',path='attendance/'+id;
  const original={studentUid:'revstudent',studentId:'REV1',eventId:'revevent',eventName:'Revocation test',eventDate:'2020-10-01',status:'completed',arrivalStatus:'present',checkedInAt:new Date('2020-10-01T10:00:00+08:00'),checkedOutAt:new Date('2020-10-01T10:00:00+08:00')};
  await commit([[path,original],['fines/rev-existing',{studentUid:'revstudent',reason:'Existing fine',status:'Pending'}]]);
  const make=(actor,operation='revop1')=>{
    const data={attendanceId:id,studentUid:'revstudent',eventId:'revevent',original,status:'revoked',operation,revokedBy:actor,revokedAt:SERVER,reason:'Verified erroneous attendance entry'};
    const activity=activityRecord({action:'attendance-revoked',actorUid:actor,subjectUid:'revstudent',subjectId:'REV1',subjectName:'Test student',eventId:'revevent',eventName:original.eventName,reason:data.reason,before:activitySnapshot('attendance',original),after:null,createdAt:SERVER});
    return [['attendanceRevocations/'+id,data],['attendanceRevocations/'+id+'/history/'+operation,data],['activityLogs/revocation_'+operation,activity],[path,null]];
  };
  await commit([[path,null]],'revadmin',false);
  for(const actor of ['revstudent','revmanager'])await commit(make(actor),actor,false);
  const entries=make('revhead');
  await commit(entries.filter((entry,index)=>index!==1),'revhead',false);
  await commit(entries.filter((entry,index)=>index!==2),'revhead',false);
  await commit(entries.slice(0,3),'revhead',false);
  const tampered=make('revhead');tampered[0][1]={...tampered[0][1],original:{...original,studentId:'FORGED'}};
  await commit(tampered,'revhead',false);
  await commit(entries,'revhead');
  const read=async (target,actor='owner')=>fetch(base+'/'+target,{headers:{Authorization:'Bearer '+(actor==='owner'?actor:token(actor))}});
  assert.equal((await read(path)).status,404);
  assert.equal((await read('fines/rev-existing')).ok,true);
  assert.equal((await read('attendanceRevocations/'+id,'revstudent')).ok,true);
  assert.equal((await read('attendanceRevocations/'+id,'revmanager')).ok,true);
  assert.equal((await read('attendanceRevocations/'+id,'revother')).ok,false);
  await commit([['attendanceRevocations/'+id+'/history/revop1',{...entries[1][1],reason:'Overwrite archived history'}]],superUid,false);
  await commit([['attendanceRevocations/'+id+'/history/revop1',null]],superUid,false);
  await commit(entries,'revhead',false);
  // A new legitimate active record can be revoked later without losing the first history entry.
  await commit([[path,{...original,status:'checked-in'}]]);
  const next=make('revadmin','revop2');for(const row of next.slice(0,2))row[1]={...row[1],original:{...original,status:'checked-in'}};
  next[2][1]={...next[2][1],before:activitySnapshot('attendance',{...original,status:'checked-in'})};
  await commit(next,'revadmin');
  assert.equal((await read('attendanceRevocations/'+id+'/history/revop1')).ok,true);
  assert.equal((await read('attendanceRevocations/'+id+'/history/revop2')).ok,true);
  console.log('Attendance revocation Rules passed: authorized atomic archive/history/activity/delete; tampering, unaudited removal and unauthorized revocation denied; repeat history and existing fines preserved.');
})().catch(error=>{console.error(error);process.exitCode=1;});
