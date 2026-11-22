// Local demo emulator only. Never uses real accounts or service credentials.
const assert=require('node:assert/strict');
const project='demo-presence-audience',host=process.env.FIRESTORE_EMULATOR_HOST;
if(!/^127\.0\.0\.1:\d+$/.test(host||''))throw Error('Local emulator required');
const base=`http://${host}/v1/projects/${project}/databases/(default)/documents`,SERVER=Symbol('server'),now=Date.now(),superUid='8uEjAk72BLWKjvnQJEatBdeVAi02';
const token=(uid,grant=uid===superUid)=>[Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:uid,user_id:uid,superAdmin:grant,email:uid+'@example.test',aud:project,iss:`https://securetoken.google.com/${project}`,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600,auth_time:Math.floor(now/1000),firebase:{sign_in_provider:'password'}})).toString('base64url'),''].join('.');
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
  await commit([['superAdminAccounts/'+superUid,{active:true}]]);
  for(const [uid,role] of [['privstudent','student'],['privhead','head_admin'],['privattendance','attendance_admin'],['privmanager','student_manager'],['privfake','super_admin']])await commit([['students/'+uid,{uid,accountId:uid,role,active:true,section:'2A'}]]);
  await commit([['adminProfiles/'+superUid,{displayName:'Private admin',email:'private@example.test'}],['auditLogs/privacy',{actorUid:superUid,reason:'Private audit'}],['activityLogs/privacy',{actorUid:superUid,reason:'Private activity'}]]);
  const read=async(path,uid,allowed)=>{const r=await fetch(base+'/'+path,{headers:{Authorization:'Bearer '+token(uid)}});assert.equal(r.ok,allowed,path+' '+uid);await r.body?.cancel();};
  for(const uid of ['privstudent','privhead','privattendance','privmanager','privfake']){
    for(const target of ['adminProfiles/'+superUid,'auditLogs/privacy','activityLogs/privacy'])await read(target,uid,false);
  }
  for(const target of ['adminProfiles/'+superUid,'auditLogs/privacy','activityLogs/privacy'])await read(target,superUid,true);
  for (const [uid,grant,allowed] of [[superUid,false,false],['different-server-assigned-admin',true,true],['privstudent',false,false]]) {
    const r=await fetch(base+'/auditLogs/privacy',{headers:{Authorization:'Bearer '+token(uid,grant)}});
    assert.equal(r.ok,allowed,'Authority comes from the signed claim, not a pinned UID');await r.body?.cancel();
  }
  await commit([['superAdminAccounts/privstudent',{active:true}]],'privstudent',false);
  await commit([['superAdminAccounts/'+superUid,null]],superUid,false);
  await read('students/privhead','privstudent',false);await read('students/privstudent','privstudent',true);
  for(const uid of ['privstudent','privfake']){
    const r=await fetch(base+':runQuery',{method:'POST',headers:{Authorization:'Bearer '+token(uid),'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId:'students'}]}})});assert.equal(r.ok,false,'Student or forged super_admin role cannot list directory');await r.body?.cancel();
    await commit([['adminProfiles/'+superUid,{displayName:'Forged'}]],uid,false);
    await commit([['students/privstudent',{role:'head_admin'},['role']]],uid,false);
  }
  const profile={uid:'not-the-pinned-uid',accountId:'not-pinned',accountIdKey:'not-pinned',authEmail:'not-pinned@students.presence.local',firstName:'Test',lastName:'Person',birthday:'2005-01-01',section:'2A',course:'BS Info Tech',active:true,role:'student',mustChangePassword:true,createdAt:SERVER,updatedAt:SERVER};
  await commit([['students/'+superUid,profile]],'privhead',false);
  await commit([['students/uid-disguised',{...profile,uid:superUid}]],'privhead',false);
  console.log('Admin privacy Rules passed: server-issued claims protect admin/audit records; students cannot list other profiles, forge roles or shadow the protected account.');
})().catch(error=>{console.error(error);process.exitCode=1;});
