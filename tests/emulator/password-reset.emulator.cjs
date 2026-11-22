// Local demo Firestore only. No production credentials or accounts.
const assert = require('node:assert/strict');
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(host || '')) throw Error('Local emulator required');
const project = 'demo-presence-audience', base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const token = (uid, authTime = 201) => [Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:uid,user_id:uid,superAdmin:uid==='8uEjAk72BLWKjvnQJEatBdeVAi02',email:uid+'@example.test',aud:project,iss:`https://securetoken.google.com/${project}`,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,auth_time:authTime,firebase:{sign_in_provider:'password'}})).toString('base64url'),''].join('.');
const field = value => typeof value === 'boolean' ? {booleanValue:value} : typeof value === 'number' ? {integerValue:String(value)} : {stringValue:value};
async function write(path, data, uid = 'owner', allowed = true, authTime = 201) {
  const response = await fetch(base+':commit',{method:'POST',headers:{Authorization:'Bearer '+(uid==='owner'?'owner':token(uid,authTime)),'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:{name:`projects/${project}/databases/(default)/documents/${path}`,fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,field(v)]))},updateMask:{fieldPaths:Object.keys(data)}}]})});
  assert.equal(response.ok,allowed,await response.text());
}
(async()=>{
  const uid='reset-rules-student', path='students/'+uid;
  const profile={uid,accountId:'test-id',accountIdKey:'test-id',authEmail:'test-id@students.presence.local',firstName:'Test',lastName:'Student',section:'2A',active:true,role:'student',mustChangePassword:true,passwordResetRequired:true,passwordResetValidAfter:200};
  await write(path,profile);
  const get=await fetch(base+'/'+path,{headers:{Authorization:'Bearer '+token(uid)}});assert.equal(get.ok,true,'Locked student must read own login profile');
  await write(path,{firstName:'Changed'},uid,false);
  await write(path,{mustChangePassword:false},uid,false);
  await write(path,{passwordResetRequired:false},uid,false);
  await write('students/reset-rules-manager',{active:true,role:'student_manager'});
  await write('students/reset-rules-head',{active:true,role:'head_admin'});
  for(const actor of ['reset-rules-manager','reset-rules-head']) {
    await write(path,{passwordResetRequired:false},actor,false);
    await write(path,{passwordResetValidAfter:0},actor,false);
  }
  await write(path,{role:'head_admin',roleUpdatedBy:'8uEjAk72BLWKjvnQJEatBdeVAi02'},'8uEjAk72BLWKjvnQJEatBdeVAi02',false);
  await write(path,{passwordResetRequired:false,mustChangePassword:false});
  await write(path,{firstName:'Old session'},uid,false,200);
  await write(path,{firstName:'Fresh session'},uid,true,201);
  for(const collection of ['passwordResets','passwordResetLimits','auditLogs']) await write(collection+'/forged',{state:'ready'},uid,false);
  console.log('Reset Rules passed: login profile readable; locked/old sessions, forged clear flags, manager/head unlocks and private ledger writes rejected; fresh session allowed.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
