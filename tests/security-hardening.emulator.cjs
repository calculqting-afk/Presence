// Local dummy accounts only. No production credentials or documents.
const assert = require('node:assert/strict');
const project='demo-presence-audience',host=process.env.FIRESTORE_EMULATOR_HOST;
if(!host || !/^127\.0\.0\.1:\d+$/.test(host))throw Error('Local emulator required');
const base=`http://${host}/v1/projects/${project}/databases/(default)/documents`,now=Date.now();
const server=Symbol('server'),uid='secure-student';
const token=who=>[Buffer.from(JSON.stringify({alg:'none'})).toString('base64url'),Buffer.from(JSON.stringify({sub:who,user_id:who,aud:project,iss:`https://securetoken.google.com/${project}`,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600,auth_time:Math.floor(now/1000),presenceSession:'secure-session',presenceAuthTime:Math.floor(now/1000),firebase:{sign_in_provider:'custom'}})).toString('base64url'),''].join('.');
function encode(data,transforms,field=''){
  if(data===server){transforms.push({fieldPath:field,setToServerValue:'REQUEST_TIME'});return;}
  if(data instanceof Date)return {timestampValue:data.toISOString()};
  if(Array.isArray(data))return {arrayValue:{values:data.map(value=>encode(value,transforms))}};
  if(data&&typeof data==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,encode(value,transforms,field?`${field}.${key}`:key)]).filter(([,value])=>value))}};
  if(typeof data==='number')return Number.isInteger(data)?{integerValue:String(data)}:{doubleValue:data};
  if(typeof data==='boolean')return {booleanValue:data};return {stringValue:data};
}
async function write(path,data,who='owner',allowed=true,mask){
  const transforms=[],fields=encode(data,transforms).mapValue.fields;
  const response=await fetch(base+':commit',{method:'POST',headers:{Authorization:'Bearer '+(who==='owner'?who:token(who)),'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:{name:`projects/${project}/databases/(default)/documents/${path}`,fields},...(mask?{updateMask:{fieldPaths:mask}}:{}),...(transforms.length?{updateTransforms:transforms}:{})}]})});
  assert.equal(response.ok,allowed,path+' '+await response.text());
}
async function read(path,who,allowed){const response=await fetch(base+'/'+path,{headers:{Authorization:'Bearer '+token(who)}});assert.equal(response.ok,allowed,path);await response.body?.cancel();}
(async()=>{
  const profile={uid,accountId:'SECURE-STUDENT',accountIdKey:'secure-student',firstName:'Dummy',lastName:'Student',birthday:'2005-01-01',course:'BS Info Tech',section:'2A',active:true,role:'student',passwordResetRequired:false,passwordResetValidAfter:Math.floor(now/1000)-3600,createdAt:new Date(now-86400000)};
  await write('accountSessions/'+uid,{sessionId:'secure-session'});await write('students/'+uid,profile);await write('students/secure-manager',{active:true,role:'student_manager'});
  const pending={uid,accountId:'SAFE-ID',accountIdKey:'safe-id',birthday:'2005-01-01',firstName:'Dummy',lastName:'Student',course:'BS Info Tech',section:'2A',status:'pending',requestedAt:server,updatedAt:server};
  await write('registrationRequests/safe-id',pending,uid,true);
  const injected='x"><img src=x onerror=alert(1)>';
  await write('registrationRequests/'+injected,{...pending,accountId:injected,accountIdKey:injected},uid,false);
  await write('registrationRequests/wrong-key',{...pending,accountIdKey:'wrong-key'},uid,false);
  await write('students/'+uid,{mustChangePassword:true},'owner',true,['mustChangePassword']);
  await write('students/'+uid,{mustChangePassword:false,updatedAt:server},uid,false,['mustChangePassword','updatedAt']);
  await write('students/'+uid,{mustChangePassword:false},'owner',true,['mustChangePassword']);
  await write('faceRegistrations/'+uid,{registered:true},uid,false);
  await write('faceRegistrations/'+uid,{registered:true,driveFileId:'forged'},uid,false);
  await write('faceRegistrations/'+uid,{registered:true,confirmationSource:'server-upload'});
  await write('faceRegistrations/'+uid,{registered:true,driveFileId:'replaced'},uid,false);
  await write('students/'+uid,{course:'BS Comp Sci',section:'2B'},uid,true,['course','section']);
  await write('studentIds/secure-other',{studentId:'secure-other',uid:'other'});
  await read('studentIds/secure-other',uid,false);await read('studentIds/secure-other','secure-manager',true);
  const indexList=await fetch(base+'/studentIds',{headers:{Authorization:'Bearer '+token(uid)}});assert.equal(indexList.ok,false);await indexList.body?.cancel();
  const event={name:'Secure attendance',type:'Assembly',description:'Dummy event',date:new Date(now+8*3600000).toISOString().slice(0,10),timeIn:'07:00',timeOut:'11:00',location:'Hall',audience:'Selected sections',audienceSections:['2A','2B'],rosterCapturedAt:new Date(now-86400000),requiresGeofence:true,openAt:new Date(now-60000),checkInClosesAt:new Date(now+60000),closeAt:new Date(now-1000),checkOutClosesAt:new Date(now+3600000),attendanceRoster:{[uid]:'2B'}};
  const area={type:'circle',enabled:true,latitude:10,longitude:124,radiusMeters:50};
  await write('events/security-event',event);await write('eventGeofences/security-event',area);
  const location={latitude:10,longitude:124,accuracy:5,distanceMeters:0};
  const record={studentUid:uid,studentId:profile.accountId,eventId:'security-event',eventName:event.name,eventType:event.type,eventDescription:event.description,eventDate:event.date,timeIn:event.timeIn,timeOut:event.timeOut,location:event.location,audience:event.audience,status:'checked-in',arrivalStatus:'present',checkedInAt:server,attendedAt:server,checkInLocation:location};
  const path='attendance/'+uid+'_security-event',proofPath='attendanceLocationProofs/'+uid+'_security-event_in';
  const proof={sessionId:'secure-session',studentUid:uid,eventId:'security-event',action:'in',location,geofence:area,issuedAt:new Date(now-1000),expiresAt:new Date(now+29000)};
  await write(path,record,uid,false);await write(proofPath,proof,uid,false);
  await write(proofPath,{...proof,expiresAt:new Date(now-1)});await write(path,record,uid,false);
  await write(proofPath,{...proof,location:{...location,latitude:11}});await write(path,record,uid,false);
  await write(proofPath,{...proof,geofence:{...area,radiusMeters:50000}});await write(path,record,uid,false);
  await write(proofPath,{...proof,expiresAt:new Date(now+3600000)});await write(path,record,uid,false);
  const invalidLocation={...location,accuracy:-1};
  await write(proofPath,{...proof,location:invalidLocation});
  await write(path,{...record,checkInLocation:invalidLocation},uid,false);
  for(const field of ['latitude','longitude','distanceMeters']) {
    const missingLocation={...location};delete missingLocation[field];
    await write(proofPath,{...proof,location:missingLocation});
    await write(path,{...record,checkInLocation:missingLocation},uid,false);
  }
  await write(proofPath,proof);
  for(const field of ['studentUid','studentId','eventId','eventName','eventType','eventDescription','eventDate','timeIn','timeOut','location','audience','status','arrivalStatus']) {
    const missingField={...record};delete missingField[field];
    await write(path,missingField,uid,false);
  }
  await write(proofPath,proof);await read(proofPath,uid,false);
  await write(path,{...record,qrCheckedInBy:'forged-admin'},uid,false);
  await write(path,{...record,recordSource:'admin-qr',qrCheckedInBy:uid},uid,false);
  await write('attendanceQrLimits/issue_'+uid,{count:0},uid,false);
  await write('auditLogs/attendance-qr_forged',{action:'attendance-qr-check-in'},uid,false);
  await write(path,record,uid,true);
  await write(path,record,uid,false); // duplicate cannot replace the saved check-in
  const checkout={checkedOutAt:server,status:'completed',checkOutLocation:location};
  await write(path,checkout,uid,false,['checkedOutAt','status','checkOutLocation']);
  await write('events/security-late',{...event,lateAfterAt:new Date(now-1000)});
  await write('eventGeofences/security-late',area);
  await write('attendanceLocationProofs/'+uid+'_security-late_in',{...proof,eventId:'security-late'});
  await write('attendance/'+uid+'_security-late',{...record,eventId:'security-late',arrivalStatus:'present'},uid,false);
  await write('attendance/'+uid+'_security-late',{...record,eventId:'security-late',arrivalStatus:'late'},uid,true);
  await write('attendanceLocationProofs/'+uid+'_security-event_out',{...proof,action:'out'});
  await write(path,checkout,uid,true,['checkedOutAt','status','checkOutLocation']);
  await write(path,checkout,uid,false,['checkedOutAt','status','checkOutLocation']);
  // Server-owned QR provenance survives ordinary self-service checkout and
  // cannot be forged or modified by a student.
  const qrRecord={...record,checkedInAt:new Date(now-10000),attendedAt:new Date(now-10000),recordSource:'admin-qr',qrCheckedInBy:'scanner-admin'};
  delete qrRecord.checkInLocation;
  await write(path,qrRecord);
  await write(path,{...checkout,qrCheckedInBy:uid},uid,false,['checkedOutAt','status','checkOutLocation','qrCheckedInBy']);
  await write(path,checkout,uid,true,['checkedOutAt','status','checkOutLocation']);
  await write('students/fine-head',{active:true,role:'head_admin'});
  const fine={studentUid:uid,studentId:'SECURE-STUDENT',studentName:'Dummy Student',eventId:'missed',eventName:'Original session',serviceMinutes:30,reason:'Verified absence',status:'Pending',assignmentHistory:[]};
  await write('fines/locked-test',fine);
  await write('fines/locked-test',{...fine,serviceMinutes:60},'fine-head',true);
  await write('fines/locked-test',{...fine,eventId:'other'},'fine-head',false);
  await write('fines/locked-test',{...fine,studentUid:'other'},'fine-head',false);
  await write('fines/locked-test',{...fine,eventName:'Changed session'},'fine-head',false);
  const survey={eventId:'security-event',enabled:true,revision:1,locationMode:'start-only',opensAt:new Date(now-60000),closesAt:new Date(now+3600000),createdAt:new Date(now-60000),createdBy:'fine-head',updatedAt:new Date(now-60000),questions:Array.from({length:20},(_,i)=>({id:'q'+i,text:'Agenda '+i,type:'choice',choices:['Yes','No']}))};
  await write('eventSurveys/security-event',survey);
  await write('eventSurveys/security-event',{enabled:false,archived:true,updatedAt:server},'fine-head',true,['enabled','archived','updatedAt']);
  await write('events/security-event',{surveyArchived:true,updatedAt:server},'fine-head',true,['surveyArchived','updatedAt']);
  await write('eventSurveys/security-event',{questions:[]},'fine-head',false,['questions']);
  await write('eventSurveys/security-event',{enabled:true,updatedAt:server},'fine-head',false,['enabled','updatedAt']);
  console.log('Security hardening Rules passed: server-owned face status, private ID index, academic self-edits retained, location proof forgery/expiry/mismatch rejected, authorized check-in/checkout accepted once.');
})().catch(error=>{console.error(error);process.exitCode=1;});
