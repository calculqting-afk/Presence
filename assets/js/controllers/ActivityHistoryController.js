import {collection,query,orderBy,limit,startAfter,where,Timestamp,getDocsFromServer,doc,getDocFromServer} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import {ControllerScope} from '../core/ControllerScope.js';
import {ACTIVITY_ACTIONS} from './ActivityRecordPolicy.js';
const millis=value=>value?.toMillis?.()??value?.toDate?.()?.getTime?.()??(value instanceof Date?+value:0);
export function normalizeActivity(record,id,source) {
  return {id:`${source}:${id}`,action:record.action,actorUid:record.actorUid||'',actorName:record.actorName||'',subjectUid:record.subjectUid||record.studentUid||'',
    subjectId:record.subjectId||record.studentId||'',subjectName:record.subjectName||record.studentName||'',eventId:record.eventId||'',eventName:record.eventName||'',
    reason:record.reason||'',before:record.before,after:record.after,createdAt:millis(record.createdAt),status:record.status||'recorded'};
}
export function filterActivity(rows,{admin='',subject='',action=''}={},names=new Map()) {
  const a=admin.trim().toLowerCase(),s=subject.trim().toLowerCase();
  return rows.filter(row=>ACTIVITY_ACTIONS[row.action]&&(!action||row.action===action)&&
    (!a||`${row.actorName} ${names.get(row.actorUid)||''} ${row.actorUid}`.toLowerCase().includes(a))&&
    (!s||`${row.subjectName} ${row.subjectUid} ${row.subjectId} ${row.eventName} ${row.eventId} ${row.before?.accountId||''} ${row.after?.accountId||''}`.toLowerCase().includes(s)));
}
export class ActivityHistoryController {
  constructor({document=globalThis.document,window=globalThis.window,db,can,getActorName}){Object.assign(this,{document,window,db,can,getActorName});this.scope=new ControllerScope();this.names=new Map();this.rows=[];this.generation=0;}
  initialize(){
    if(!this.can('viewActivityHistory')||!this.scope.initialize())return;
    this.root=this.document.querySelector('#adminActivityHistory');
    this.field=selector=>this.root.querySelector('[data-activity-'+selector+']');
    for(const [value,label] of Object.entries(ACTIVITY_ACTIONS)){const option=this.document.createElement('option');option.value=value;option.textContent=label;this.field('action').append(option);}
    this.scope.listen(this.root.querySelector('form'),'submit',event=>{event.preventDefault();void this.reload();});
    for(const name of ['admin','subject','action'])this.scope.listen(this.field(name),'input',()=>this.render());
    this.scope.listen(this.field('refresh'),'click',()=>void this.reload());this.scope.listen(this.field('more'),'click',()=>void this.load());
    this.scope.listen(this.field('clear'),'click',()=>{this.root.querySelector('form').reset();void this.reload();});
    this.scope.listen(this.window,'presence:viewchange',event=>{if(event.detail.viewName==='activity-history'&&!this.loaded)void this.reload();});
  }
  async reload(){
    const from=this.field('from').value,to=this.field('to').value;
    if(from&&to&&from>to){this.field('status').textContent='Choose an end date on or after the start date.';return;}
    this.generation++;this.busy=false;this.rows=[];this.sources=['activityLogs','auditLogs'].map(name=>({name,cursor:null,more:true}));this.loaded=true;
    this.dates={from,to};await this.load();
  }
  async load(){
    if(this.busy||!this.can('viewActivityHistory')||!this.scope.initialized)return;
    this.busy=true;const generation=this.generation;this.field('more').disabled=true;this.field('status').textContent='Loading recorded activity…';
    try{
      for(const source of this.sources.filter(item=>item.more)){
        const constraints=[orderBy('createdAt','desc'),limit(50)];
        if(source.cursor)constraints.push(startAfter(source.cursor));
        if(this.dates.from)constraints.push(where('createdAt','>=',Timestamp.fromDate(new Date(this.dates.from+'T00:00:00+08:00'))));
        if(this.dates.to)constraints.push(where('createdAt','<=',Timestamp.fromDate(new Date(this.dates.to+'T23:59:59.999+08:00'))));
        const snapshot=await getDocsFromServer(query(collection(this.db,source.name),...constraints));
        if(generation!==this.generation||!this.scope.initialized)return;
        source.cursor=snapshot.docs.at(-1)||source.cursor;source.more=snapshot.docs.length===50;
        for(const item of snapshot.docs)this.rows.push(normalizeActivity(item.data(),item.id,source.name));
      }
      for(const uid of [...new Set(this.rows.map(row=>row.actorUid).filter(Boolean))]){
        if(this.names.has(uid))continue;
        let label=this.getActorName?.(uid);
        try{if(!label){
          const admin=await getDocFromServer(doc(this.db,'adminProfiles',uid));
          if(admin.exists())label=admin.data().displayName;
          if(!label){const student=await getDocFromServer(doc(this.db,'students',uid));if(student.exists())label=[student.data().firstName,student.data().middleName,student.data().lastName].filter(Boolean).join(' ');}
        }}catch{/* Keep activity visible when a former reviewer's profile is unavailable. */}
        if(generation!==this.generation||!this.scope.initialized)return;
        this.names.set(uid,label||'Administrator');
      }
      this.rows.sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));this.render();
    }catch(error){if(generation===this.generation)this.field('status').textContent='Activity could not be fully loaded. Check your connection and refresh; existing entries are retained.';}
    finally{if(generation===this.generation){this.busy=false;this.field('more').disabled=false;this.field('more').hidden=!this.sources.some(item=>item.more);}}
  }
  render(){
    if(!this.scope.initialized)return;
    const rows=filterActivity(this.rows,{admin:this.field('admin').value,subject:this.field('subject').value,action:this.field('action').value},this.names);
    this.field('list').replaceChildren();
    const text=(tag,value)=>{const node=this.document.createElement(tag);node.textContent=value;return node;};
    const display=value=>{const time=millis(value);return time?new Date(time).toLocaleString('en-PH',{timeZone:'Asia/Manila'}):value===null?'Not recorded':Array.isArray(value)?value.join(', '):String(value??'');};
    const allowed=action=>action==='student-id-corrected'?['accountId']:action==='role-changed'?['role']:['attendance-corrected','arrival-recalculated'].includes(action)?['checkedInAt','checkedOutAt','arrivalStatus','status']:action.startsWith('event-')?['name','date','timeIn','checkInCutoff','timeOut','checkOutCutoff','location','audience','audienceSections','description']:[];
    for(const row of rows){
      const card=text('article','');card.className='activity-history-card';
      const head=text('div','');head.className='activity-history-card-head';head.append(text('strong',ACTIVITY_ACTIONS[row.action]),text('small',new Date(row.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'})));card.append(head);
      card.append(text('p',`${row.actorName||this.names.get(row.actorUid)||'Administrator'} · ${row.subjectName||row.subjectId||row.eventName||'Administrative action'}${row.subjectName&&row.subjectId?' · '+row.subjectId:''}`));
      card.append(text('p','Reason: '+(row.reason||'Not recorded in this older entry.')));
      if(row.status!=='recorded')card.append(text('small','State: '+row.status.replaceAll('-',' ')));
      const fields=allowed(row.action).filter(field=>display(row.before?.[field])!==display(row.after?.[field]));
      if(fields.length){const details=text('details','');details.append(text('summary','View changes'));const list=text('dl','');list.className='activity-history-changes';
        for(const field of fields){list.append(text('dt',field),text('dd',`${row.before?display(row.before[field]):'Not previously recorded'} → ${display(row.after?.[field])}`));}details.append(list);card.append(details);}
      this.field('list').append(card);
    }
    if(!rows.length)this.field('list').append(text('p','No matching activity in the loaded records.'));
    this.field('status').textContent=`${rows.length} matching actions in ${this.rows.length} loaded entries. Search applies to loaded entries; load older activity to search further.`;
  }
  dispose(){this.generation++;this.scope.dispose();this.rows=[];this.names.clear();}
}
