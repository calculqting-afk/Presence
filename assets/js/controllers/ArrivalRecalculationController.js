import {collection,doc,query,where,getDocsFromServer,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import {activityRecord,activitySnapshot} from './ActivityRecordPolicy.js';
import {requirePermission} from '../core/permissions.js';

export function arrivalTime(value){return value?.toMillis?.()??value?.toDate?.()?.getTime?.()??value?.getTime?.()??NaN;}
export function recalculatedArrival(record,cutoff){
  const time=arrivalTime(record.checkedInAt||record.attendedAt),end=arrivalTime(cutoff);
  if(record.recordSource==='admin-corrected'||record.correctionId||record.correctedBy||record.correctedAt)return null;
  if(!['present','late'].includes(record.arrivalStatus)||!Number.isFinite(time)||!Number.isFinite(end))return null;
  return time<=end?'present':'late';
}
// Each acknowledged transaction changes one label and its immutable activity
// entry together. Original times, completion status, locations and fines stay intact.
export class ArrivalRecalculationController {
  constructor({db,getUser,getRole,getStudents,confirmation,transaction=runTransaction,load=getDocsFromServer}){Object.assign(this,{db,getUser,getRole,getStudents,confirmation,transaction,load});}
  async preview(sessions){
    requirePermission(this.getRole(),'correctAttendance');
    const plans=[];
    for(const {id,event} of sessions){
      const snapshot=await this.load(query(collection(this.db,'attendance'),where('eventId','==',id)));
      const changes=[];let protectedCount=0;
      for(const item of snapshot.docs){
        const before=item.data(),after=recalculatedArrival(before,event.checkInClosesAt);
        if(before.recordSource==='admin-corrected'||before.correctionId||before.correctedBy||before.correctedAt)protectedCount++;
        if(after&&after!==before.arrivalStatus)changes.push({id:item.id,studentUid:before.studentUid,studentId:before.studentId,before:before.arrivalStatus,after,checkedInAt:arrivalTime(before.checkedInAt||before.attendedAt)});
      }
      plans.push({id,name:event.name,cutoff:arrivalTime(event.checkInClosesAt),changes,protectedCount});
    }
    const changes=plans.flatMap(plan=>plan.changes.map(change=>({...change,eventName:plan.name}))),protectedCount=plans.reduce((n,plan)=>n+plan.protectedCount,0);
    const present=changes.filter(change=>change.after==='present').length,late=changes.length-present;
    const students=new Map(this.getStudents().map(student=>[student.uid,student]));
    const schedules=plans.map(plan=>`${plan.name}: on time through ${new Date(plan.cutoff).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'})}`).join('; ');
    const accepted=await this.confirmation.open(true,{title:'Recalculate saved arrival labels?',label:'Save and recalculate',
      message:`${schedules}. ${present} Late → Present; ${late} Present → Late. ${protectedCount} manually corrected records are protected. Original check-in/out times and completion status stay unchanged. Existing fines require separate review. Cancel saves nothing.`,
      items:changes.map(change=>{const student=students.get(change.studentUid),name=student?[student.firstName,student.middleName,student.lastName].filter(Boolean).join(' '):change.studentUid;
        return `${name} · ${student?.accountId||change.studentId} · ${change.eventName} · ${new Date(change.checkedInAt).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'})} · ${change.before==='late'?'Late':'Present'} → ${change.after==='late'?'Late':'Present'}`;})});
    return accepted?plans:null;
  }
  async apply(plans,reason,onProgress=()=>{}){
    requirePermission(this.getRole(),'correctAttendance');
    if(typeof reason!=='string'||reason.trim().length<5||reason.length>1000)throw Error('A reason of 5–1000 characters is required.');
    const result={updated:0,skipped:0,failed:0,total:plans.reduce((n,p)=>n+p.changes.length,0)};
    for(const plan of plans)for(const change of plan.changes){
      // Stable across Firestore transaction retries; successful replay sees the
      // already-updated arrival and creates no duplicate activity entry.
      const activity=doc(collection(this.db,'activityLogs')),operation=activity.id;
      const audit=doc(this.db,'activityLogs','arrival_'+operation);
      try{
        const saved=await this.transaction(this.db,async tx=>{
          const eventSnap=await tx.get(doc(this.db,'events',plan.id));
          if(!eventSnap.exists()||arrivalTime(eventSnap.data().checkInClosesAt)!==plan.cutoff)throw Error('The event cutoff changed. Preview again.');
          const reference=doc(this.db,'attendance',change.id),snapshot=await tx.get(reference);
          if(!snapshot.exists())return false;
          const before=snapshot.data(),after=recalculatedArrival(before,eventSnap.data().checkInClosesAt);
          if(before.eventId!==plan.id||before.studentUid!==change.studentUid||arrivalTime(before.checkedInAt||before.attendedAt)!==change.checkedInAt||before.arrivalStatus!==change.before||after!==change.after)return false;
          const user=this.getUser();
          const student=this.getStudents().find(item=>item.uid===before.studentUid);
          tx.update(reference,{arrivalStatus:after,arrivalRecalculatedAt:serverTimestamp(),arrivalRecalculatedBy:user.uid,arrivalRecalculationId:operation,arrivalRecalculationReason:reason.trim()});
          tx.set(audit,activityRecord({action:'arrival-recalculated',actorUid:user.uid,subjectUid:before.studentUid,subjectId:before.studentId,subjectName:student?[student.firstName,student.middleName,student.lastName].filter(Boolean).join(' '):'',eventId:plan.id,eventName:eventSnap.data().name,
            reason:reason.trim(),before:activitySnapshot('attendance',before),after:activitySnapshot('attendance',{...before,arrivalStatus:after}),createdAt:serverTimestamp()}));
          return true;
        });
        result[saved?'updated':'skipped']++;
      }catch{result.failed++;}
      onProgress({...result});
    }
    return result;
  }
}
