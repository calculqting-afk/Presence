const test = require('node:test'), assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto'); globalThis.crypto ||= webcrypto;

test('logout waits for confirmed server release and surfaces failure without refreshing the token', async () => {
 const { DeviceSessionController } = await import('../assets/js/controllers/DeviceSessionController.js');
 const events=[], window={dispatchEvent:event=>events.push(event.type)}, user={uid:'student'};
 let finish, ended=false;
 const api={call:(path,actor,body,options)=>{
   assert.equal(path,'/v1/session/release');assert.equal(actor,user);
   assert.deepEqual(options,{forceRefresh:false});
   return new Promise(resolve=>{finish=resolve;});
 }};
 const pending=DeviceSessionController.release(user,{api,window}).then(()=>{ended=true;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(ended,false);
 finish({released:true});await pending;assert.equal(ended,true);
 await assert.rejects(DeviceSessionController.release(user,{window,api:{call:async()=>{throw Error('offline');}}}),/offline/);
 assert.equal(events.at(-1),'presence:device-signout-failed');
 await assert.rejects(DeviceSessionController.release(user,{window,api:{call:async()=>({released:false})}}),/could not be ended/);
});

test('Firebase diagnostics identify failing operations without exposing account data or credentials', async () => {
 const { FirebaseGateway } = await import('../workers/admin-api/src/firebase.js');
 const logs = [], original = console.error;
 console.error = message => logs.push(JSON.parse(message));
 try {
  const gateway = new FirebaseGateway(JSON.stringify({project_id:'presence-a873f',client_email:'presence-password-reset@presence-a873f.iam.gserviceaccount.com'}), async () => Response.json({error:{status:'PERMISSION_DENIED',message:'Permission datastore.entities.get denied for private-student-id token=private-secret'}},{status:403}));
  gateway.access = async () => 'private-secret';
  await assert.rejects(gateway.get('students/private-student-id'), /Firebase operation failed/);
  assert.deepEqual(logs[0], {event:'firebase-request-failed',service:'firestore.googleapis.com',operation:':get',httpStatus:403,status:'PERMISSION_DENIED',permission:'datastore.entities.get'});
  assert.doesNotMatch(JSON.stringify(logs), /private-student-id|private-secret/);
  gateway.fetcher = async () => Response.json({error:{status:'RESOURCE_EXHAUSTED'}},{status:429});
  await assert.rejects(gateway.get('students/private-student-id'), /capacity is temporarily exhausted/);
 } finally { console.error = original; }
});
async function fixture() {
  const { DeviceSessionService, requireActiveDevice, sessionAuthTime } = await import('../workers/admin-api/src/device-session.js');
  const store = new Map([['students/student', { active: true, role: 'student' }]]), signed=[];
  const users = new Map([['student', { localId: 'student', validSince: '0' }]]);
  let now=1000000;
  const db={ get:async path=>store.get(path)||null, user:async uid=>users.get(uid),
    write:(path,data,options={})=>({path,data,options}),
    customToken:async(uid,claims)=>{signed.push({uid,claims});return 'test-token-'+claims.presenceSession;},
    transaction:async fn=>{const writes=await fn(async path=>structuredClone(store.get(path)||null));for(const w of writes)store.set(w.path,{...(w.options.merge?store.get(w.path):{}),...w.data});}
  };
  return { service:new DeviceSessionService(db,()=>now), requireActiveDevice,sessionAuthTime,db,store,users,signed,
    claims:{sub:'student',auth_time:1000,firebase:{sign_in_provider:'password'}},
    a:{deviceId:'11111111-1111-4111-8111-111111111111'}, b:{deviceId:'22222222-2222-4222-8222-222222222222'},advance(ms){now+=ms;} };
}
test('first device enrolls; another device cannot displace it without explicit matching confirmation',async()=>{
 const f=await fixture();await f.service.acquire(f.claims,f.a);
 const first=f.store.get('accountSessions/student').sessionId;
 const old={...f.claims,presenceSession:first};await f.requireActiveDevice(f.db,old);
 const count=f.store.size,signs=f.signed.length;
 const denied=await f.service.acquire(f.claims,f.b);
 assert.deepEqual(denied,{transferRequired:true,revision:first});assert.equal(f.store.size,count);assert.equal(f.signed.length,signs);
 await f.requireActiveDevice(f.db,old);
 const transfer=await f.service.acquire(f.claims,{...f.b,transferRevision:first});assert.ok(transfer.customToken);
 const second=f.store.get('accountSessions/student').sessionId;assert.notEqual(first,second);
 await assert.rejects(f.requireActiveDevice(f.db,old),/transferred/);
 await assert.rejects(f.requireActiveDevice(f.db,f.claims),/transferred/);
 await f.requireActiveDevice(f.db,{...f.claims,presenceSession:second});
 assert.equal([...f.store.values()].filter(v=>v.action==='device-session-transferred').length,1);
});
test('same browser tabs reuse the lock; stale confirmations and old-device logout cannot revoke the winner',async()=>{
 const f=await fixture();await f.service.acquire(f.claims,f.a);const first=f.store.get('accountSessions/student').sessionId;
 await f.service.acquire(f.claims,f.a);assert.equal(f.store.get('accountSessions/student').sessionId,first);
 await f.service.acquire(f.claims,{...f.b,transferRevision:first});const second=f.store.get('accountSessions/student').sessionId;
 await assert.rejects(f.service.acquire(f.claims,{...f.a,transferRevision:first}),/changed/);
 await f.service.release({...f.claims,presenceSession:first});assert.equal(f.store.get('accountSessions/student').sessionId,second);
 await f.service.release({...f.claims,presenceSession:second});assert.equal(f.store.get('accountSessions/student').sessionId,null);
 await assert.rejects(f.requireActiveDevice(f.db,{...f.claims,presenceSession:second}),/ended/);
});
test('expired/revoked/custom-token sessions cannot mint a fresh device session or renew password recency',async()=>{
 const f=await fixture();
 await assert.rejects(f.service.acquire({...f.claims,auth_time:1},f.a),/password again/);
 const custom={...f.claims,auth_time:1000,presenceAuthTime:1,firebase:{sign_in_provider:'custom'}};
 assert.equal(f.sessionAuthTime(custom),1);await assert.rejects(f.service.acquire(custom,f.a),/password again/);
 f.users.get('student').validSince='1001';await assert.rejects(f.service.acquire(f.claims,f.a),/Sign in again/);
 assert.equal(f.signed.length,0);
});
test('unsupported, inactive and forged requests are rejected; status never returns tokens or installation IDs',async()=>{
 const f=await fixture();
 await assert.rejects(f.service.acquire(f.claims,{...f.a,sessionId:'forged'}),/Invalid/);
 f.store.get('students/student').active=false;await assert.rejects(f.service.acquire(f.claims,f.a),/active account/);
 f.store.get('students/student').active=true;await f.service.acquire(f.claims,f.a);
 const result=await f.service.status(f.claims);assert.deepEqual(result,{enrolled:true,active:true,current:false});
});

test('client cancellation leaves the current device untouched; confirmation binds only the returned signed token',async()=>{
 const { DeviceSessionController }=await import('../assets/js/controllers/DeviceSessionController.js');
 const calls=[],data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};
 const user={uid:'student',getIdTokenResult:async()=>({claims:{firebase:{sign_in_provider:'password'}}})};
 const api={call:async(path,who,body)=>{calls.push({path,body});if(path.endsWith('/status'))return {active:true,current:false};return body.transferRevision?{customToken:'signed-token'}:{transferRequired:true,revision:'11111111-1111-4111-8111-111111111111'};}};
 let signs=0;
 const client=new DeviceSessionController({window:{localStorage:storage},document:{},api,authentication:{},signIn:async(_,token)=>{assert.equal(token,'signed-token');signs++;return {user};}});
 client.confirmTransfer=async()=>false;
 await assert.rejects(client.bind(user,{allowTransfer:true}),/cancelled/);assert.equal(signs,0);assert.equal(calls.length,1);
 calls.length=0;client.confirmTransfer=async()=>true;await client.bind(user,{allowTransfer:true});
 assert.equal(signs,1);assert.equal(calls.length,2);assert.equal(calls[1].body.transferRevision,'11111111-1111-4111-8111-111111111111');
});

test('fresh password login acquires directly while restored sessions refresh authority once', async () => {
 const { DeviceSessionController }=await import('../assets/js/controllers/DeviceSessionController.js');
 const refreshes=[],calls=[],storage=new Map();
 const user={uid:'student',getIdTokenResult:async force=>{refreshes.push(force);return {claims:{firebase:{sign_in_provider:'password'}}};}};
 const signedUser={uid:'student'};
 const client=new DeviceSessionController({document:{},window:{localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}},authentication:{},
  api:{call:async(path,_user,_body,options)=>{calls.push({path,options});return {customToken:'signed-token'};}},signIn:async()=>({user:signedUser})});
 assert.equal(await client.bind(user),signedUser);
 assert.deepEqual(calls,[{path:'/v1/session/acquire',options:{forceRefresh:false}}]);
 assert.deepEqual(refreshes,[undefined]);
 calls.length=0;refreshes.length=0;
 user.getIdTokenResult=async force=>{refreshes.push(force);return {claims:{presenceSession:'current',firebase:{sign_in_provider:'custom'}}};};
 client.api.call=async(path,_user,_body,options)=>{calls.push({path,options});return {current:true};};
 assert.equal(await client.bind(user),user);
 assert.deepEqual(refreshes,[undefined,true]);
 assert.deepEqual(calls,[{path:'/v1/session/status',options:{forceRefresh:false}}]);
});

test('session status overlaps independent reads but still rejects a revoked account', async () => {
 const { DeviceSessionService }=await import('../workers/admin-api/src/device-session.js');
 const started=[],pending=new Map();
 const wait=key=>{started.push(key);return new Promise(resolve=>pending.set(key,resolve));};
 const service=new DeviceSessionService({user:()=>wait('auth'),get:path=>wait(path)});
 const status=service.status({sub:'student',auth_time:1000});
 assert.deepEqual(started,['auth','students/student','accountSessions/student']);
 pending.get('auth')({validSince:'1001'});pending.get('students/student')({active:true,role:'student'});pending.get('accountSessions/student')({sessionId:'current'});
 await assert.rejects(status,/Sign in again/);
});

test('parallel backend reads share one authorization exchange and failed exchanges can retry', async () => {
 const { FirebaseGateway }=await import('../workers/admin-api/src/firebase.js');
 const gateway=new FirebaseGateway(JSON.stringify({project_id:'presence-a873f',client_email:'presence-password-reset@presence-a873f.iam.gserviceaccount.com',private_key_id:crypto.randomUUID()}));
 let count=0,complete;
 gateway.authorize=()=>{count++;return new Promise(resolve=>{complete=resolve;});};
 const first=gateway.access(),second=gateway.access(),third=gateway.access();
 assert.equal(count,1);complete('opaque-token');assert.deepEqual(await Promise.all([first,second,third]),['opaque-token','opaque-token','opaque-token']);
 gateway.authorize=async()=>{count++;throw Error('temporary outage');};
 await assert.rejects(gateway.access(),/temporary outage/);
 gateway.authorize=async()=>{count++;return 'recovered-token';};
 assert.equal(await gateway.access(),'recovered-token');assert.equal(count,3);
});
test('displaced refresh-token sessions cannot silently reclaim a device on reload',async()=>{
 const { DeviceSessionController }=await import('../assets/js/controllers/DeviceSessionController.js');
 let calls=0;
 const client=new DeviceSessionController({document:{},window:{},api:{call:async()=>{calls++;return {current:false};}}});
 const user={getIdTokenResult:async()=>({claims:{presenceSession:'old',firebase:{sign_in_provider:'custom'}}})};
 await assert.rejects(client.bind(user),/transferred or ended/);assert.equal(calls,1);
});

test('custom session token is signed for Firebase, keeps password authentication time and grants no role itself',async()=>{
 const { FirebaseGateway }=await import('../workers/admin-api/src/firebase.js');
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const privateKey=Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64');
 const gateway=new FirebaseGateway(JSON.stringify({project_id:'presence-a873f',client_email:'presence-password-reset@presence-a873f.iam.gserviceaccount.com',private_key:privateKey}));
 const token=await gateway.customToken('student',{presenceSession:'signed-session',presenceAuthTime:1000});
 const [header,payload,signature]=token.split('.');const body=JSON.parse(Buffer.from(payload,'base64url'));
 assert.equal(body.uid,'student');assert.equal(body.claims.presenceSession,'signed-session');assert.equal(body.claims.presenceAuthTime,1000);
 assert.equal(body.claims.superAdmin,undefined);assert.equal(body.exp-body.iat,300);
 assert.equal(body.aud,'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
 assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pair.publicKey,Buffer.from(signature,'base64url'),Buffer.from(header+'.'+payload)),true);
});
