// Demo-only Rules verification. Never uses production credentials.
const assert=require('node:assert/strict');
const host=process.env.FIRESTORE_EMULATOR_HOST;
if(!/^127\.0\.0\.1:\d+$/.test(host||''))throw Error('Local emulator required');
const project='demo-presence-audience',base=`http://${host}/v1/projects/${project}/databases/(default)/documents`;
const token=uid=>[Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify({sub:uid,user_id:uid,superAdmin:uid==='8uEjAk72BLWKjvnQJEatBdeVAi02',email:uid+'@example.test',aud:project,iss:`https://securetoken.google.com/${project}`,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,auth_time:201,firebase:{sign_in_provider:'password'}})).toString('base64url'),''].join('.');
const field=value=>typeof value==='boolean'?{booleanValue:value}:{stringValue:value};
const write=(path,data)=>({update:{name:`projects/${project}/databases/(default)/documents/${path}`,fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,field(v)]))}});
async function commit(writes,actor='owner',allowed=true){const r=await fetch(base+':commit',{method:'POST',headers:{Authorization:'Bearer '+(actor==='owner'?'owner':token(actor)),'Content-Type':'application/json'},body:JSON.stringify({writes})});assert.equal(r.ok,allowed,await r.text());}
const outbox=(id,extra={})=>({...write('eventPushOutbox/'+id,{eventId:id,pending:true,...extra}),updateTransforms:[{fieldPath:'requestedAt',setToServerValue:'REQUEST_TIME'}]});
(async()=>{
  await commit([write('students/push-head',{active:true,role:'head_admin'}),write('students/push-attendance',{active:true,role:'attendance_admin'}),write('students/push-manager',{active:true,role:'student_manager'}),write('students/push-student',{active:true,role:'student'}),write('events/push-event',{name:'Test event'})]);
  for(const actor of ['push-head','push-attendance'])await commit([outbox('push-event')],actor,true);
  for(const actor of ['push-manager','push-student'])await commit([outbox('push-event')],actor,false);
  await commit([outbox('missing-event')],'push-head',false);
  await commit([outbox('push-event',{token:'not-allowed'})],'push-head',false);
  for(const collection of ['pushDevices','pushJobs','pushSchedules','pushDeliveries','pushRegistrationLimits']){
    await commit([write(collection+'/private',{active:true})]);
    for(const actor of ['push-head','push-student']){
      const response=await fetch(base+'/'+collection+'/private',{headers:{Authorization:'Bearer '+token(actor)}});assert.equal(response.status,403);
      await commit([write(collection+'/private',{active:false})],actor,false);
    }
  }
  console.log('Push outbox permissions and private token/job Rules passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
