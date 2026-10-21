// Trusted local terminal tool. Never serve this file or its credentials to clients.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const PROJECT = 'presence-a873f';
function parse(args) {
  const options = {};
  for (let i=0;i<args.length;i++) {
    const flag=args[i];
    if (['--help','--dry-run'].includes(flag)) options[flag.slice(2)]=true;
    else if (['--old','--new'].includes(flag) && args[i+1] && !args[i+1].startsWith('--')) options[flag.slice(2)]=args[++i];
    else throw Error('Unknown or incomplete option: '+flag);
  }
  if (options.help) return options;
  for (const field of ['old','new']) {
    options[field]=String(options[field]||'').trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(options[field])) throw Error('Use --old and --new with valid Student IDs (1–64 letters, numbers, periods, underscores or dashes).');
  }
  if (options.old.toLowerCase()===options.new.toLowerCase()) throw Error('Old and new IDs must be different, ignoring case.');
  return options;
}
const key = id => id.toLowerCase();
const email = id => key(id)+'@students.presence.local';
const operationId = (oldId,newId) => crypto.createHash('sha256').update(key(oldId)+'\n'+key(newId)).digest('hex');

class StudentIdCorrection {
  constructor({ db, auth, timestamp, actor }) { Object.assign(this,{db,auth,timestamp,actor}); }
  async find(oldId) {
    const index=await this.db.doc('studentIds/'+key(oldId)).get();
    const matches=new Set(index.exists && index.data().uid ? [index.data().uid] : []);
    for (const [field,value] of [['accountIdKey',key(oldId)],['accountId',oldId]]) {
      const result=await this.db.collection('students').where(field,'==',value).limit(2).get();
      result.docs.forEach(doc=>matches.add(doc.id));
    }
    if (matches.size!==1) throw Error('Old ID is missing or ambiguous. Review the student profile and ID index manually.');
    return [...matches][0];
  }
  async prepare(oldId,newId) {
    const journal=this.db.doc('studentIdCorrections/'+operationId(oldId,newId));
    const previous=await journal.get();
    const uid=previous.exists ? previous.data().uid : await this.find(oldId);
    if (!uid || uid.includes('/')) throw Error('Invalid student UID.');
    const profile=await this.db.doc('students/'+uid).get();
    const user=await this.auth.getUser(uid);
    if (!profile.exists || profile.data().active!==true || user.disabled) throw Error('An active student profile and Authentication account are required.');
    const data=profile.data();
    if (data.role && data.role!=='student' && data.role!=='viewer') throw Error('This tool only corrects student accounts.');
    if (!previous.exists && (key(data.accountId||'')!==key(oldId) || user.email?.toLowerCase()!==email(oldId)
      || (data.authEmail && data.authEmail.toLowerCase()!==email(oldId)))) throw Error('Profile/login mismatch. Review the existing Authentication address before proceeding.');
    if (previous.exists && !['reserved','completed'].includes(previous.data().status)) throw Error('Unexpected correction state. Manual review required.');
    try {
      const owner=await this.auth.getUserByEmail(email(newId));
      if (owner.uid!==uid) throw Error('New login address already belongs to another account.');
    } catch (error) { if (error.code!=='auth/user-not-found') throw error; }
    const plan={uid,oldId,newId,journal,profile:data,user,resume:previous.exists};
    if (previous.data()?.status==='completed') { await this.verify(plan); return {...plan,completed:true}; }
    // Preview uses exactly the same collision checks as the reservation transaction.
    await this.db.runTransaction(async tx=>{await this.check(tx,plan);});
    return plan;
  }
  async check(tx,plan) {
    const {uid,oldId,newId,journal}=plan;
    const refs={profile:this.db.doc('students/'+uid),oldIndex:this.db.doc('studentIds/'+key(oldId)),newIndex:this.db.doc('studentIds/'+key(newId)),oldRequest:this.db.doc('registrationRequests/'+key(oldId)),newRequest:this.db.doc('registrationRequests/'+key(newId)),lock:this.db.doc('studentIdCorrectionLocks/'+uid)};
    const docs={};
    for (const [name,ref] of Object.entries(refs)) docs[name]=await tx.get(ref);
    const existing=await tx.get(journal);
    const profile=docs.profile.data();
    if (!profile || key(profile.accountId||'')!==key(oldId) || profile.active!==true
      || (profile.role && !['student','viewer'].includes(profile.role))
      || (profile.authEmail && profile.authEmail.toLowerCase()!==email(oldId))) throw Error('Student profile changed. Stop and review the account.');
    if (docs.lock.exists && docs.lock.data().operation!==journal.id) throw Error('Another ID correction is in progress for this student.');
    if (docs.oldIndex.exists && docs.oldIndex.data().uid!==uid) throw Error('Old ID index belongs to a different account.');
    if (docs.newIndex.exists && !(existing.exists && docs.newIndex.data().uid===uid && docs.newIndex.data().correctionOperation===journal.id)) throw Error('New Student ID is already reserved or registered.');
    if (docs.newRequest.exists) throw Error('New ID has a registration request. Review it before correcting the ID.');
    if (docs.oldRequest.exists && (docs.oldRequest.data().uid!==uid || docs.oldRequest.data().status!=='approved')) throw Error('Old registration request is not approved for this UID. Only registered students are supported.');
    for (const [field,value] of [['accountIdKey',key(newId)],['accountId',newId]]) {
      const matches=await tx.get(this.db.collection('students').where(field,'==',value).limit(2));
      if (matches.docs.some(doc=>doc.id!==uid)) throw Error('New Student ID is used by another student profile.');
    }
    return {refs,docs,existing};
  }
  async execute(plan) {
    const {uid,oldId,newId,journal}=plan;
    await this.db.runTransaction(async tx=>{
      const {refs,existing}=await this.check(tx,plan);
      if (!existing.exists) tx.create(journal,{uid,oldId,newId,actor:this.actor,status:'reserved',createdAt:this.timestamp()});
      tx.set(refs.newIndex,{studentId:newId,uid,correctionPending:true,correctionOperation:journal.id,createdAt:this.timestamp()});
      tx.set(refs.lock,{operation:journal.id});
    });
    // Auth and Firestore cannot commit atomically. Retain the reservation and
    // journal on failure; rerunning the identical command resumes safely.
    let user=await this.auth.getUser(uid);
    if (user.disabled) throw Error('Authentication account is disabled.');
    if (user.email?.toLowerCase()===email(oldId)) user=await this.auth.updateUser(uid,{email:email(newId)});
    else if (user.email?.toLowerCase()!==email(newId)) throw Error('Authentication address changed unexpectedly. Manual review required.');
    await this.db.runTransaction(async tx=>{
      const state=await tx.get(journal);
      if (state.data()?.status==='completed') return;
      const {refs,docs}=await this.check(tx,plan);
      tx.update(refs.profile,{accountId:newId,accountIdKey:key(newId),authEmail:email(newId),updatedAt:this.timestamp()});
      tx.set(refs.newIndex,{studentId:newId,uid,createdAt:this.timestamp()});
      if (docs.oldIndex.exists) tx.delete(refs.oldIndex);
      if (docs.oldRequest.exists) {
        tx.create(refs.newRequest,{...docs.oldRequest.data(),accountId:newId,accountIdKey:key(newId),updatedAt:this.timestamp()});
        tx.delete(refs.oldRequest);
      }
      tx.update(journal,{status:'completed',completedAt:this.timestamp()});
      tx.delete(refs.lock);
    });
    await this.verify(plan);
  }
  async verify({uid,newId,oldId,journal}) {
    const [user,profile,index,oldIndex,state]=await Promise.all([this.auth.getUser(uid),this.db.doc('students/'+uid).get(),this.db.doc('studentIds/'+key(newId)).get(),this.db.doc('studentIds/'+key(oldId)).get(),journal.get()]);
    if (user.email?.toLowerCase()!==email(newId) || profile.data()?.accountId!==newId || profile.data()?.authEmail!==email(newId)
      || index.data()?.uid!==uid || oldIndex.exists || state.data()?.status!=='completed') throw Error('Final verification incomplete. Review the correction journal and rerun this command.');
  }
}

async function main(args=process.argv.slice(2)) {
  const options=parse(args);
  if (options.help) { console.log('Usage: node tools/correct-student-id.cjs --old OLD_ID --new NEW_ID [--dry-run]\nUses PRESENCE_SERVICE_ACCOUNT_KEY or .android-tools/student-id-helper.config.json. Rerun the identical command to resume an interrupted correction.');return; }
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw Error('Unset emulator variables before running this production helper to avoid mixing live Authentication with emulator data.');
  const configPath=path.resolve(__dirname,'../.android-tools/student-id-helper.config.json');
  const localConfig=!process.env.PRESENCE_SERVICE_ACCOUNT_KEY && fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath,'utf8')) : {};
  const keyPath=process.env.PRESENCE_SERVICE_ACCOUNT_KEY || localConfig.serviceAccountPath;
  if (!keyPath) throw Error('Set PRESENCE_SERVICE_ACCOUNT_KEY or configure .android-tools/student-id-helper.config.json with serviceAccountPath. See docs/CORRECT-STUDENT-ID.md.');
  const credential=JSON.parse(fs.readFileSync(path.resolve(keyPath),'utf8'));
  if (credential.project_id!==PROJECT) throw Error('Service-account key must belong to '+PROJECT);
  const requireAdmin=createRequire(path.resolve(__dirname,'../functions/package.json'));
  const {initializeApp,cert}=requireAdmin('firebase-admin/app');
  const {getAuth}=requireAdmin('firebase-admin/auth');
  const {getFirestore,FieldValue}=requireAdmin('firebase-admin/firestore');
  const app=initializeApp({credential:cert(credential),projectId:PROJECT},'student-id-correction');
  const service=new StudentIdCorrection({db:getFirestore(app),auth:getAuth(app),timestamp:()=>FieldValue.serverTimestamp(),actor:credential.client_email});
  const plan=await service.prepare(options.old,options.new);
  console.log(`Student: ${[plan.profile.firstName,plan.profile.middleName,plan.profile.lastName].filter(Boolean).join(' ')}\nUID: ${plan.uid}\nStudent ID: ${plan.oldId} -> ${plan.newId}\nJournal: ${plan.journal.path}`);
  if (plan.completed) { console.log('Already completed; current login/profile/index verified.');return; }
  if (options['dry-run']) {console.log('Preview complete. No writes performed.');return;}
  const prompt=require('node:readline/promises').createInterface({input:process.stdin,output:process.stdout});
  try {
    const expected=`CHANGE ${plan.oldId} TO ${plan.newId}`;
    if ((await prompt.question(`Type ${expected} to confirm: `))!==expected) {console.log('Cancelled. No writes performed.');return;}
  } finally {prompt.close();}
  try {await service.execute(plan);}
  catch(error){console.error('Correction may be partially applied. Do not edit/delete its reservation or journal. Rerun the identical command to resume after resolving the error.');throw error;}
  console.log('Correction complete and verified. Student can sign out and log in with the new ID and existing password. UID and historical records were preserved.');
}
module.exports={parse,StudentIdCorrection,operationId};
if(require.main===module)main().catch(error=>{console.error('Correction stopped: '+error.message);process.exitCode=1;});
