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
  await commit([['students/time-student',{uid:'time-student',accountId:'TIME1',active:true,role:'student',section:'2A'}],['students/time-admin',{uid:'time-admin',accountId:'TIMEADMIN',active:true,role:'attendance_admin',section:'2A'}]]);
  const date='2020-10-01', start=new Date('2020-10-01T10:13:00+08:00');
  const event={name:'Time validation',type:'Assembly',date,timeIn:'07:00',timeOut:'11:00',checkInCutoff:'09:00',checkOutCutoff:'12:00',location:'Hall',audience:'All students',description:'',requiresGeofence:false,openAt:new Date(date+'T07:00:00+08:00'),checkInClosesAt:new Date(date+'T09:00:00+08:00'),closeAt:new Date(date+'T11:00:00+08:00'),checkOutClosesAt:new Date(date+'T12:00:00+08:00'),attendanceRoster:{'time-student':'2A'}};
  await commit([['events/time-event',event]]);
  const record={studentUid:'time-student',studentId:'TIME1',eventId:'time-event',eventName:event.name,eventType:event.type,eventDescription:'',eventDate:date,timeIn:event.timeIn,timeOut:event.timeOut,location:event.location,audience:event.audience,attendedAt:start,checkedInAt:start,checkedOutAt:new Date(+start+30000),arrivalStatus:'present',status:'completed',recordSource:'admin-corrected',correctionId:'time-audit',correctedBy:'time-admin',correctedAt:SERVER,correctionReason:'Verified against event staff log'};
  const entries=after=>[['attendance/time-student_time-event',after],['attendance/time-student_time-event/corrections/time-audit',{before:null,after,by:'time-admin',at:SERVER,reason:after.correctionReason}]];
  await commit(entries({...record,checkedOutAt:start}),'time-admin',false);
  await commit(entries({...record,checkedOutAt:new Date(+start-1)}),'time-admin',false);
  await commit(entries({...record,checkedInAt:new Date('2020-10-02T10:13:00+08:00'),attendedAt:new Date('2020-10-02T10:13:00+08:00'),checkedOutAt:new Date('2020-10-02T10:14:00+08:00')}),'time-admin',false);
  await commit(entries({...record,checkedOutAt:new Date('2020-10-02T00:00:00+08:00')}),'time-admin',false);
  await commit(entries(record),'time-admin');
  const today=new Date(now+8*3600000).toISOString().slice(0,10);
  const live={...event,date:today,openAt:new Date(now-3600000),checkInClosesAt:new Date(now-1800000),closeAt:new Date(now-60000),checkOutClosesAt:new Date(now+3600000)};
  await commit([['events/time-live',live]]);
  const regular={...record,eventId:'time-live',eventDate:today,status:'checked-in',attendedAt:new Date(now+60000),checkedInAt:new Date(now+60000)};
  for(const field of ['checkedOutAt','recordSource','correctionId','correctedBy','correctedAt','correctionReason'])delete regular[field];
  await commit([['attendance/time-student_time-live',regular]]);
  await commit([['attendance/time-student_time-live',{status:'completed',checkedOutAt:SERVER},['status','checkedOutAt']]],'time-student',false);
  await commit([['attendance/time-student_time-live',{...regular,attendedAt:new Date(now-30000),checkedInAt:new Date(now-30000)}]]);
  await commit([['attendance/time-student_time-live',{status:'completed',checkedOutAt:SERVER},['status','checkedOutAt']]],'time-student');
  console.log('Attendance time Rules passed: equal/reversed and wrong-day corrections rejected; sub-minute correction and regular checkout accepted; future check-in cannot be checked out.');
})().catch(error=>{console.error(error);process.exitCode=1;});
