import {SafeError} from './firebase.js';
import {ResetService,isSuperAuthority,authHasSuperAdmin} from './service.js';
const key=id=>id.toLowerCase(),email=id=>key(id)+'@students.presence.local';
const safeUid=uid=>typeof uid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(uid);
const name=profile=>[profile?.firstName,profile?.middleName,profile?.lastName].filter(Boolean).join(' ');
const clean=data=>Object.fromEntries(Object.entries(data||{}).filter(([field])=>field!=='_updateTime'));
export async function correctionOperation(oldId,newId) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key(oldId)+'\n'+key(newId))))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export class StudentIdService {
  constructor(db,secret,now=()=>Date.now()) {Object.assign(this,{db,secret,now});}
  async authorize(claims,recent=false) {
    const user=await new ResetService(this.db,this.now).authenticate(claims,recent);
    const profile=await this.db.get('students/'+claims.sub);
    const superAdmin=isSuperAuthority(claims,user);
    if(!superAdmin && !(profile?.active===true&&profile.role==='head_admin'))throw new SafeError(403,'Only Super Admin and Head Admin can correct Student IDs.');
    const admin=superAdmin?await this.db.get('adminProfiles/'+claims.sub):null;
    return admin?.displayName||name(profile)||user.displayName||(superAdmin?'Super Admin':'Head Admin');
  }
  target(uid,actor) {if(!safeUid(uid)||uid===actor)throw new SafeError(400,'Select an ordinary student account.');}
  ordinary(profile) {return profile?.active===true&&(!profile.role||profile.role==='student');}
  async status(claims,body) {
    await this.authorize(claims);this.target(body.studentUid,claims.sub);
    const profile=await this.db.get('students/'+body.studentUid);
    if(!this.ordinary(profile))throw new SafeError(403,'Only active ordinary student accounts can be corrected.');
    const lock=await this.db.get('studentIdCorrectionLocks/'+body.studentUid);
    const journal=lock?await this.db.get('studentIdCorrections/'+lock.operation):null;
    return {currentId:profile.accountId,pending:journal&&journal.status!=='completed'?{oldId:journal.oldId,newId:journal.newId,reason:journal.reason||'Resume interrupted Student ID correction',operationId:lock.operation}:null};
  }
  parse(body) {
    if(!safeUid(body.studentUid)||!['oldId','newId'].every(field=>typeof body[field]==='string'&&/^[A-Za-z0-9._-]{1,64}$/.test(body[field])) || key(body.oldId)===key(body.newId))throw new SafeError(400,'Enter different valid Student IDs using 1–64 letters, numbers, dots, underscores or dashes.');
    if(typeof body.reason!=='string'||body.reason.trim().length<5||body.reason.length>500)throw new SafeError(400,'Enter a correction reason of 5–500 characters.');
    return {...body,reason:body.reason.trim()};
  }
  async proof(data,verify) {
    if(typeof this.secret!=='string'||this.secret.length<32)throw new SafeError(503,'Student ID preview signing is not configured.');
    const signingKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(this.secret),{name:'HMAC',hash:'SHA-256'},false,[verify?'verify':'sign']);
    const bytes=new TextEncoder().encode(data);
    if(verify)return crypto.subtle.verify('HMAC',signingKey,Uint8Array.from(verify.match(/.{2}/g)||[],part=>parseInt(part,16)),bytes);
    return [...new Uint8Array(await crypto.subtle.sign('HMAC',signingKey,bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
  }
  async check(get,plan,{completed=false}={}) {
    const {studentUid:uid,oldId,newId,operation}=plan;
    const profile=await get('students/'+uid),oldIndex=await get('studentIds/'+key(oldId)),newIndex=await get('studentIds/'+key(newId));
    const oldRequest=await get('registrationRequests/'+key(oldId)),newRequest=await get('registrationRequests/'+key(newId));
    const lock=await get('studentIdCorrectionLocks/'+uid),journal=await get('studentIdCorrections/'+operation),reset=await get('passwordResets/'+uid);
    if(!this.ordinary(profile)||profile.uid&&profile.uid!==uid)throw new SafeError(409,'Student profile is inactive, privileged or mismatched.');
    if(profile.passwordResetRequired===true||(reset?.leaseUntil||0)>this.now())throw new SafeError(409,'Finish the pending password reset before correcting this ID.');
    if(lock&&lock.operation!==operation)throw new SafeError(409,'Another ID correction is pending. Reopen Correct Student ID and resume it first.');
    if(journal&&(journal.uid!==uid||key(journal.oldId)!==key(oldId)||key(journal.newId)!==key(newId)||!['reserved','completed'].includes(journal.status)))throw new SafeError(409,'Correction journal needs administrator review.');
    if(journal?.status==='completed'&&completed) {
      if(profile.accountId!==newId||profile.accountIdKey!==key(newId)||profile.authEmail!==email(newId)||newIndex?.uid!==uid||oldIndex||oldRequest||(newRequest&&(newRequest.uid!==uid||newRequest.status!=='approved')))throw new SafeError(409,'Completed correction needs administrator review.');
      return {profile,journal,done:true};
    }
    if(key(profile.accountId||'')!==key(oldId)||(profile.accountIdKey&&profile.accountIdKey!==key(oldId))||(profile.authEmail&&profile.authEmail.toLowerCase()!==email(oldId)))throw new SafeError(409,'The current Student ID changed. Reopen the correction.');
    if(oldIndex&&oldIndex.uid!==uid)throw new SafeError(409,'The old ID index belongs to another account.');
    if(newIndex&&!(journal&&newIndex.uid===uid&&newIndex.correctionOperation===operation))throw new SafeError(409,'The new Student ID is already registered or reserved.');
    if(newRequest)throw new SafeError(409,'The new ID has a registration request. Review it first.');
    if(oldRequest&&(oldRequest.uid!==uid||oldRequest.status!=='approved'))throw new SafeError(409,'The old registration request does not match an approved student account.');
    for(const [field,value] of [['accountIdKey',key(newId)],['accountId',newId],['accountIdKey',key(oldId)],['accountId',oldId]]) {
      const matches=await get.matches(field,value);
      if(matches.some(match=>match!==uid))throw new SafeError(409,'A Student ID is duplicated in the directory. Administrator review is required.');
    }
    return {profile,journal,lock,oldIndex,newIndex,oldRequest};
  }
  async authTarget(plan,resume) {
    const user=await this.db.user(plan.studentUid),owner=await this.db.userByEmail(email(plan.newId));
    if(authHasSuperAdmin(user))throw new SafeError(403,'Super Admin accounts cannot be corrected here.');
    if(!user||user.disabled||![email(plan.oldId),...(resume?[email(plan.newId)]:[])].includes(user.email?.toLowerCase()))throw new SafeError(409,'The student login does not match this correction.');
    if(owner&&owner.localId!==plan.studentUid)throw new SafeError(409,'The new login ID already belongs to another account.');
    return user;
  }
  async preview(claims,input) {
    await this.authorize(claims);const plan=this.parse(input);this.target(plan.studentUid,claims.sub);
    plan.operation=await correctionOperation(plan.oldId,plan.newId);let state;
    await this.db.transaction(async get=>{state=await this.check(get,plan,{completed:true});return [];});
    const user=await this.authTarget(plan,Boolean(state.journal));
    if(state.done&&user.email?.toLowerCase()!==email(plan.newId))throw new SafeError(409,'Completed correction has a login mismatch. Administrator review is required.');
    const payload=JSON.stringify({actor:claims.sub,studentUid:plan.studentUid,oldId:plan.oldId,newId:plan.newId,reason:plan.reason,operation:plan.operation,
      revision:state.profile._updateTime||'',expires:this.now()+300000});
    return {studentName:name(state.profile),oldId:plan.oldId,newId:plan.newId,operationId:plan.operation,resume:Boolean(state.journal&&!state.done),completed:Boolean(state.done),
      preview:payload,signature:await this.proof(payload)};
  }
  async execute(claims,body) {
    const actorName=await this.authorize(claims,true);
    if(typeof body.preview!=='string'||body.preview.length>2500||!(/^[a-f0-9]{64}$/.test(body.signature||''))||!await this.proof(body.preview,body.signature))throw new SafeError(400,'Preview the correction again.');
    let plan;try{plan=JSON.parse(body.preview);}catch{throw new SafeError(400,'Preview the correction again.');}
    this.parse(plan);this.target(plan.studentUid,claims.sub);
    if(plan.actor!==claims.sub||!Number.isFinite(plan.expires)||plan.expires<this.now()||plan.expires>this.now()+300000||plan.operation!==await correctionOperation(plan.oldId,plan.newId)||body.confirmId!==plan.newId)throw new SafeError(400,'The preview expired or confirmation does not match. Preview again.');
    const db=this.db,path='studentIdCorrections/'+plan.operation,lockPath='studentIdCorrectionLocks/'+plan.studentUid;
    const auditPath='auditLogs/student-id_'+plan.operation;const now=this.now(),lease=crypto.randomUUID();let done=false;
    await this.authTarget(plan,true);
    await db.transaction(async get=>{
      const state=await this.check(get,plan,{completed:true});done=Boolean(state.done);
      if(done)return [];
      if(state.profile._updateTime!==plan.revision)throw new SafeError(409,'The profile changed since preview. Preview again.');
      if((state.lock?.leaseUntil||0)>now)throw new SafeError(409,'A correction is in progress. Wait two minutes, then preview and resume.');
      const limit=await get('studentIdCorrectionLimits/'+claims.sub);const fresh=limit&&now-limit.windowStart<900000;
      if(fresh&&limit.count>=5)throw new SafeError(429,'Correction limit reached. Wait fifteen minutes.');
      const audit=await get(auditPath);
      return [db.write(path,{uid:plan.studentUid,oldId:plan.oldId,newId:plan.newId,reason:state.journal?.reason||plan.reason,actor:state.journal?.actor||claims.sub,status:'reserved',createdAt:state.journal?.createdAt||new Date(now)}),
        db.write(lockPath,{operation:plan.operation,lease,leaseUntil:now+120000}),
        db.write('studentIds/'+key(plan.newId),{studentId:plan.newId,uid:plan.studentUid,correctionPending:true,correctionOperation:plan.operation,createdAt:new Date(now)}),
        ...(!audit?[db.write(auditPath,{action:'student-id-corrected',studentUid:plan.studentUid,studentId:plan.oldId,studentName:name(state.profile),
          actorUid:claims.sub,actorName,reason:plan.reason,before:{accountId:plan.oldId},after:{accountId:plan.newId},status:'started',createdAt:new Date(now)},{exists:false})]:[]),
        db.write('studentIdCorrectionLimits/'+claims.sub,{windowStart:fresh?limit.windowStart:now,count:fresh?limit.count+1:1})];
    });
    if(!done) {
      try {
        const user=await this.authTarget(plan,true);
        if(user.email.toLowerCase()===email(plan.oldId))await db.changeEmail(plan.studentUid,email(plan.newId));
        await db.transaction(async get=>{
          const state=await this.check(get,plan);
          if(state.lock?.lease!==lease)throw new SafeError(409,'Correction lease changed.');
          if(state.profile._updateTime!==plan.revision)throw new SafeError(409,'The profile changed during correction.');
          return [db.write('students/'+plan.studentUid,{accountId:plan.newId,accountIdKey:key(plan.newId),authEmail:email(plan.newId),updatedAt:new Date(this.now())},{merge:true,exists:true}),
            db.write('studentIds/'+key(plan.newId),{studentId:plan.newId,uid:plan.studentUid,createdAt:new Date(this.now())}),
            ...(state.oldIndex?[db.remove('studentIds/'+key(plan.oldId))]:[]),
            ...(state.oldRequest?[db.write('registrationRequests/'+key(plan.newId),{...clean(state.oldRequest),accountId:plan.newId,accountIdKey:key(plan.newId),updatedAt:new Date(this.now())},{exists:false}),db.remove('registrationRequests/'+key(plan.oldId))]:[]),
            db.write(path,{status:'completed',completedAt:new Date(this.now())},{merge:true,exists:true}),db.remove(lockPath),
            db.write(auditPath,{status:'completed',completedAt:new Date(this.now()),completedBy:claims.sub},{merge:true,exists:true})];
        });
      } catch {throw new SafeError(503,'Correction is incomplete or unconfirmed. Do not change either ID manually. Wait two minutes, then reopen Correct Student ID to preview and resume the same correction.');}
    }
    const user=await db.user(plan.studentUid);let state;
    await db.transaction(async get=>{state=await this.check(get,plan,{completed:true});return [];});
    if(!state.done||user?.email?.toLowerCase()!==email(plan.newId))throw new SafeError(503,'Final verification is incomplete. Reopen this correction to resume verification.');
    return {completed:true,oldId:plan.oldId,newId:plan.newId,studentUid:plan.studentUid};
  }
}
