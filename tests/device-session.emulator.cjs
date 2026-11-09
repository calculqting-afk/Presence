// Local emulator only: no real users, service accounts or production data.
const assert=require('node:assert/strict');
const host=process.env.FIRESTORE_EMULATOR_HOST,project='demo-presence-audience';
if(!/^127\.0\.0\.1:\d+$/.test(host||''))throw Error('Local emulator required');
const base=`http://${host}/v1/projects/${project}/databases/(default)/documents`,now=Math.floor(Date.now()/1000);
const uid='device-dummy',old='11111111-1111-4111-8111-111111111111',next='22222222-2222-4222-8222-222222222222';
const jwt=(id,extra={})=>[Buffer.from('{"alg":"none"}').toString('base64url'),Buffer.from(JSON.stringify({sub:id,user_id:id,aud:project,iss:`https://securetoken.google.com/${project}`,iat:now,exp:now+3600,auth_time:now,firebase:{sign_in_provider:'password'},...extra})).toString('base64url'),''].join('.');
const headers=token=>({'Content-Type':'application/json',Authorization:'Bearer '+token});
const encode=value=>value===null?{nullValue:null}:typeof value==='boolean'?{booleanValue:value}:typeof value==='number'?{integerValue:String(value)}:value instanceof Date?{timestampValue:value.toISOString()}:{stringValue:value};
async function write(path,data,token='owner',allowed=true){const result=await fetch(base+':commit',{method:'POST',headers:headers(token),body:JSON.stringify({writes:[{update:{name:`projects/${project}/databases/(default)/documents/${path}`,fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,encode(v)]))}}]})});assert.equal(result.ok,allowed,path+' '+await result.text());}
async function read(path,token,allowed){const result=await fetch(base+'/'+path,{headers:headers(token)});assert.equal(result.ok,allowed,path+' '+await result.text());}
(async()=>{
 await write('students/'+uid,{uid,active:true,role:'student',firstName:'Dummy',lastName:'Student',mustChangePassword:false});
 await write('events/device-demo',{name:'Dummy event'});
 await write('attendance/'+uid+'_device-demo',{studentUid:uid,eventId:'device-demo',status:'checked-in',checkedInAt:new Date(Date.now()-60000)});
 const legacy=jwt(uid),current=jwt(uid,{presenceSession:old}),displaced=jwt(uid,{presenceSession:next});
 await read('events/device-demo',legacy,true); // rollout compatibility before enrollment
 await write('accountSessions/'+uid,{sessionId:old});
 await read('accountSessions/'+uid,legacy,true); // own lock bootstrap only
 await read('accountSessions/'+uid,jwt('stranger'),false);
 const heartbeat = { studentUid:uid, sessionId:uid+'_tab', accountSessionId:old, online:true, status:'online', lastSeen:new Date() };
 await write('presenceSessions/'+uid+'_tab',heartbeat,current,true);
 await write('presenceSessions/'+uid+'_tab',{...heartbeat,accountSessionId:next},current,false);
 await write('students/device-manager',{active:true,role:'student_manager'});
 await read('accountSessions',jwt('device-manager'),true);
 await read('accountSessions',current,false);
 await write('accountSessions/'+uid,{sessionId:next},jwt('device-manager'),false);
 await write('accountSessions/'+uid,{sessionId:next},current,false);
 await read('events/device-demo',legacy,false);await read('events/device-demo',current,true);
 await read('attendance/'+uid+'_device-demo',current,true);
 await write('accountSessions/'+uid,{sessionId:next});
 await read('events/device-demo',current,false);await read('attendance/'+uid+'_device-demo',current,false);
 await read('events/device-demo',displaced,true);
 await write('attendance/'+uid+'_device-demo',{studentUid:uid,eventId:'device-demo',status:'completed',checkedOutAt:new Date()},current,false);
 await write('accountSessions/'+uid,{sessionId:null});await read('events/device-demo',displaced,false);
 // Even a signed Super Admin token needs the enrolled active session.
 await write('accountSessions/device-admin',{sessionId:next});
 await read('events/device-demo',jwt('device-admin',{superAdmin:true,presenceSession:old}),false);
 await read('events/device-demo',jwt('device-admin',{superAdmin:true,presenceSession:next}),true);
 // Password sign-in alone does not regain an enrolled device's write authority.
 const setupUid='first-login-device-dummy';
 const setup={uid:setupUid,active:true,role:'student',firstName:'Dummy',lastName:'Student',mustChangePassword:true};
 await write('students/'+setupUid,setup);await write('accountSessions/'+setupUid,{sessionId:old});
 const completed={...setup,mustChangePassword:false,updatedAt:new Date()};
 await write('students/'+setupUid,completed,jwt(setupUid),false);
 await write('students/'+setupUid,completed,jwt(setupUid,{presenceSession:old,presenceAuthTime:now,firebase:{sign_in_provider:'custom'}}),true);
 console.log('Device session Rules passed: immutable server lock, active-token access, old-token/attendance denial, release, Super Admin enforcement, safe legacy rollout.');
})().catch(error=>{console.error(error);process.exitCode=1;});
