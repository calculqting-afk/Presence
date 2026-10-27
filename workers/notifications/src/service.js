import { digest, SafeError } from '../../admin-api/src/firebase.js';
import { milestones, revisionData, eligible, message, SHARDS, NEVER } from './policy.js';
const safeId = value => typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export class PushService {
  constructor(db, now=()=>Date.now()) { this.db=db;this.now=now; }
  async member(claims) {
    const [user,profile]=await Promise.all([this.db.user(claims.sub),this.db.get('students/'+claims.sub)]);
    if (!user || user.disabled || profile?.active!==true || profile.passwordResetRequired===true || profile.mustChangePassword===true ||
      claims.auth_time < Number(user.validSince||0) || (profile.passwordResetValidAfter && claims.auth_time<=profile.passwordResetValidAfter)) throw new SafeError(403,'An active student session is required.');
    return profile;
  }
  async device(claims,body,remove=false) {
    if (!safeId(body.installationId) || typeof body.token!=='string' || !/^[A-Za-z0-9_:.-]{20,4096}$/.test(body.token)) throw new SafeError(400,'Invalid device registration.');
    if (!remove) await this.member(claims);
    const id=await digest(body.token), path='pushDevices/'+id, now=this.now();
    await this.db.transaction(async get=>{
      const previous=await get(path), limit=remove?null:await get('pushRegistrationLimits/'+claims.sub);
      if (remove && previous?.uid!==claims.sub) return [];
      const fresh=limit && now-limit.windowStart<900000;
      if(!remove&&fresh&&limit.count>=20)throw new SafeError(429,'Wait before registering more devices.');
      // Fixed installation IDs prevent a token refresh from leaving an old
      // registration under another user. Native unregister also deletes the token.
      return [this.db.write(path,{uid:claims.sub,token:body.token,installationId:body.installationId,
        shard:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(id[0])%SHARDS,
        active:!remove,authTime:claims.auth_time,expiresAt:remove?0:now+30*86400000,updatedAt:now}),
        ...(!remove?[this.db.write('pushRegistrationLimits/'+claims.sub,{windowStart:fresh?limit.windowStart:now,count:fresh?limit.count+1:1})]:[])];
    });
    return {registered:!remove};
  }
  async syncEvent(eventId) {
    if (!safeId(eventId)) return;
    const db=this.db, now=this.now();
    await db.transaction(async get=>{
      const outbox=await get('eventPushOutbox/'+eventId), event=await get('events/'+eventId), previous=await get('pushSchedules/'+eventId);
      if (!outbox?.pending) return [];
      if (!event) return [db.write('eventPushOutbox/'+eventId,{pending:false},{merge:true})];
      const revision=await digest(revisionData(event));
      const publishedAt=previous?.publishedAt || Math.min(now,event.createdAt?.getTime?.() || now);
      const writes=[db.write('pushSchedules/'+eventId,{revision,publishedAt,updatedAt:now}),db.write('eventPushOutbox/'+eventId,{pending:false},{merge:true})];
      if (previous?.revision===revision) return writes;
      for(const item of milestones(event,publishedAt)) {
        // No historical replay. Updates replace future milestones only; a
        // changed event's old revision is rejected again at delivery time.
        if (item.expiresAt<=now || (item.at<now && item.kind!=='published')) continue;
        if (item.kind==='published' && previous) continue;
        const id=await digest(`${eventId}:${revision}:${item.kind}`);
        writes.push(db.write('pushJobs/'+id,{eventId,revision,...item,dueAt:item.at,createdAt:now}));
      }
      return writes;
    });
  }
  async runJob(jobId,dispatch) {
    if (!safeId(jobId)) return;
    let job; const now=this.now(),db=this.db;
    await db.transaction(async get=>{
      job=await get('pushJobs/'+jobId);
      if (!job || job.dueAt>now) {job=null;return [];}
      if (job.expiresAt<=now) {job=null;return [db.write('pushJobs/'+jobId,{dueAt:NEVER,state:'expired'},{merge:true})];}
      return [db.write('pushJobs/'+jobId,{dueAt:now+90000},{merge:true})];
    });
    if (!job) return;
    const results=await Promise.allSettled(Array.from({length:SHARDS},(_,shard)=>dispatch(jobId,shard)));
    if (results.every(result=>result.status==='fulfilled' && result.value===true)) await db.commit([db.write('pushJobs/'+jobId,{dueAt:NEVER,state:'completed'},{merge:true})]);
  }
  async deliver(jobId,shard,continuePage,depth=0) {
    if (!safeId(jobId) || !Number.isInteger(shard) || shard<0 || shard>=SHARDS || depth>12) return false;
    const db=this.db, now=this.now(), path=`pushDeliveries/${jobId}_${shard}`;
    const job=await db.get('pushJobs/'+jobId);
    if (!job || job.expiresAt<=now) return true;
    const event=await db.get('events/'+job.eventId);
    if (!event || await digest(revisionData(event))!==job.revision) return true;
    let cursor, lease;
    await db.transaction(async get=>{
      const previous=await get(path);
      if (previous?.done) {lease='done';return [];}
      if (previous?.leaseUntil>now) return [];
      cursor=previous?.cursor;lease=crypto.randomUUID();
      return [db.write(path,{lease,leaseUntil:now+60000},{merge:true})];
    });
    if (lease==='done') return true;
    if (!lease) return false;
    const devices=await db.query('pushDevices',[['shard','EQUAL',shard]],{limit:25,after:cursor});
    const active=devices.filter(device=>device.active && device.expiresAt>now && safeId(device.uid));
    const records=await db.batchGet(active.flatMap(device=>['students/'+device.uid,`attendance/${device.uid}_${job.eventId}`]));
    const invalid=[];
    const outcomes=await Promise.allSettled(active.map(async device=>{
      const student=records.get('students/'+device.uid),record=records.get(`attendance/${device.uid}_${job.eventId}`);
      if (student?.passwordResetValidAfter && device.authTime<=student.passwordResetValidAfter) return;
      if (!eligible({...student,uid:device.uid},event,record,job.kind,this.now()) || this.now()>=job.expiresAt) return;
      const tag=await digest(device.uid+':'+jobId);
      const status=await db.send(device.token,message(event,record,job.kind,this.now()),{presenceAttendance:'true',eventId:job.eventId,kind:job.kind,
        key:jobId,recipientUid:device.uid,expiresAt:String(job.expiresAt)},tag,job.expiresAt);
      if (status==='unregistered') invalid.push(device);
    }));
    // Preserve cursor after uncertain failures. Android uses a stable tag to
    // replace, rather than stack, any retried notification.
    const failed=outcomes.some(result=>result.status==='rejected');
    const done=devices.length<25;
    await db.transaction(async get=>{
      const current=await get(path);
      if(current?.lease!==lease) throw new SafeError(409,'Delivery lease changed.');
      // Compare the token before deactivating; it may have been registered again.
      const stale=[];for(const device of invalid) { const latest=await get('pushDevices/'+device.id);if(latest?.updatedAt===device.updatedAt) stale.push(device); }
      return [db.write(path,{leaseUntil:0,...(!failed?{done,cursor:devices.at(-1)?.id||cursor||''}:{})},{merge:true}),
        ...stale.map(device=>db.write('pushDevices/'+device.id,{active:false},{merge:true}))];
    });
    if (failed) return false;
    if (done) return true;
    return continuePage(jobId,shard,depth+1);
  }
  async tick(rpc) {
    const outbox=await this.db.query('eventPushOutbox',[['pending','EQUAL',true]],{limit:4});
    await Promise.allSettled(outbox.map(item=>rpc.syncEvent(item.id)));
    const jobs=await this.db.query('pushJobs',[['dueAt','LESS_THAN_OR_EQUAL',this.now()]],{order:'dueAt',limit:4});
    await Promise.allSettled(jobs.map(item=>rpc.runJob(item.id)));
  }
}
