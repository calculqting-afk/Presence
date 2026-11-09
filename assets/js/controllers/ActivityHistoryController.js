import { FeatureReadClient } from './FeatureReadClient.js';
import {doc,getDocFromServer} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
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
const changeLabels = {
  accountId: 'Student ID', role: 'Role', checkedInAt: 'Check-in time', checkedOutAt: 'Check-out time',
  arrivalStatus: 'Arrival', status: 'Attendance status', name: 'Event name', date: 'Event date',
  timeIn: 'Check-in opens', checkInCutoff: 'Check-in cutoff', timeOut: 'Check-out opens',
  checkOutCutoff: 'Check-out cutoff', location: 'Location', audience: 'Audience',
  audienceSections: 'Sections', description: 'Description'
};
function displayChange(field, value) {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'All sections';
  if (['checkedInAt', 'checkedOutAt'].includes(field)) {
    const time = millis(value) || (typeof value === 'string' ? Date.parse(value) : 0);
    return time ? new Date(time).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : 'Not recorded';
  }
  if (['timeIn', 'checkInCutoff', 'timeOut', 'checkOutCutoff'].includes(field) && /^\d{2}:\d{2}$/.test(value)) {
    const [hours, minutes] = value.split(':').map(Number);
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
  }
  if (field === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value + 'T00:00:00+08:00');
    return Number.isFinite(+date) ? date.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }) : String(value);
  }
  const labels = { present: 'On time', late: 'Late', absent: 'Absent', 'checked-in': 'Checked in', completed: 'Completed', 'checkout-only': 'Check-out only',
    student: 'Student', head_admin: 'Head Admin', attendance_admin: 'Attendance Admin', student_manager: 'Student Manager', super_admin: 'Super Admin' };
  return ['role', 'status', 'arrivalStatus'].includes(field) ? labels[value] || String(value).replaceAll('-', ' ') : String(value);
}
export function activityChanges(row) {
  const fields = row.action === 'student-id-corrected' ? ['accountId'] : row.action === 'role-changed' ? ['role']
    : ['attendance-revoked', 'attendance-corrected', 'arrival-recalculated'].includes(row.action) ? ['checkedInAt', 'checkedOutAt', 'arrivalStatus', 'status']
      : row.action.startsWith('event-') ? ['name', 'date', 'timeIn', 'checkInCutoff', 'timeOut', 'checkOutCutoff', 'location', 'audience', 'audienceSections', 'description'] : [];
  return fields.filter(field => displayChange(field, row.before?.[field]) !== displayChange(field, row.after?.[field])).map(field => ({
    label: changeLabels[field], before: row.before ? displayChange(field, row.before[field]) : 'Not previously recorded',
    after: row.action === 'attendance-revoked' && !row.after ? 'Removed' : displayChange(field, row.after?.[field])
  }));
}
export class ActivityHistoryController {
  constructor({document=globalThis.document,window=globalThis.window,db,can,getActorName,getUser,reader=new FeatureReadClient(getUser)}){Object.assign(this,{document,window,db,can,getActorName,reader});this.scope=new ControllerScope();this.names=new Map();this.rows=[];this.generation=0;}
  initialize(){
    if(!this.can('viewActivityHistory')||!this.scope.initialize())return;
    this.root=this.document.querySelector('#adminActivityHistory');
    this.field=selector=>this.root.querySelector('[data-activity-'+selector+']');
    for(const [value,label] of Object.entries(ACTIVITY_ACTIONS)){const option=this.document.createElement('option');option.value=value;option.textContent=label;this.field('action').append(option);}
    this.scope.listen(this.root.querySelector('form'),'submit',event=>{event.preventDefault();void this.reload();});
    for(const name of ['admin','subject','action'])this.scope.listen(this.field(name),'input',()=>this.render());
    this.scope.listen(this.field('refresh'),'click',()=>void this.reload());this.scope.listen(this.field('more'),'click',()=>void this.load());
    this.scope.listen(this.field('clear'),'click',()=>{this.root.querySelector('form').reset();void this.reload();});
    this.active=false;
    const update=()=>{
      if(!this.active||this.document.hidden){if(this.busy){this.generation++;this.busy=false;this.loaded=false;}return;}
      if(!this.loaded)void this.reload();
    };
    this.scope.listen(this.window,'presence:viewchange',event=>{this.active=event.detail.viewName==='activity-history';update();});
    this.scope.listen(this.document,'visibilitychange',update);
  }
  async reload(){
    const from=this.field('from').value,to=this.field('to').value;
    if(from&&to&&from>to){this.field('status').textContent='Choose an end date on or after the start date.';return;}
    this.generation++;this.busy=false;this.rows=[];this.sources=['activityLogs','auditLogs'].map(name=>({name,cursor:null,more:true}));this.loaded=true;
    this.dates={from,to};await this.load();
  }
  async load(){
    if(this.busy||!this.active||this.document.hidden||!this.can('viewActivityHistory')||!this.scope.initialized)return;
    this.busy=true;const generation=this.generation;this.field('more').disabled=true;this.field('status').textContent='Loading recorded activity…';
    try{
      for(const source of this.sources.filter(item=>item.more)){
        const page=await this.reader.activity({source:source.name,from:this.dates.from,to:this.dates.to,cursor:source.cursor});
        if(generation!==this.generation||!this.scope.initialized)return;
        source.cursor=page.cursor;source.more=page.more;
        for(const item of page.rows)this.rows.push(normalizeActivity(item,item.id,source.name));
      }
      for(const uid of [...new Set(this.rows.map(row=>row.actorUid).filter(Boolean))]){
        if(this.names.has(uid))continue;
        let label=this.getActorName?.(uid);
        try{if(!label){
          const admin=await getDocFromServer(doc(this.db,'adminProfiles',uid));
          if(generation!==this.generation||!this.scope.initialized)return;
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
    for(const row of rows){
      const card=text('article','');card.className='activity-history-card';
      const head=text('div','');head.className='activity-history-card-head';
      const time=text('time',row.createdAt ? new Date(row.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : 'Date unavailable');
      if(row.createdAt)time.setAttribute('datetime',new Date(row.createdAt).toISOString());
      head.append(text('strong',ACTIVITY_ACTIONS[row.action]),time);card.append(head);
      const meta=text('dl','');meta.className='activity-history-meta';
      const fact=(label,value)=>{const item=text('div','');item.append(text('dt',label),text('dd',value));meta.append(item);};
      fact('Admin',row.actorName||this.names.get(row.actorUid)||'Administrator');
      if(row.subjectName||row.subjectId)fact('Student',`${row.subjectName||'Student'}${row.subjectId?' · '+row.subjectId:''}`);
      if(row.eventName)fact('Event',row.eventName);
      card.append(meta);
      const reason=text('p','');reason.className='activity-history-reason';reason.append(text('span','Reason'),text('span',row.reason||'No reason recorded.'));card.append(reason);
      if(row.status!=='recorded')card.append(text('small','State: '+row.status.replaceAll('-',' ')));
      const changes=activityChanges(row);
      if(changes.length){
        const details=text('details','');details.append(text('summary',`View changes (${changes.length})`));
        const table=text('table','');table.className='activity-history-changes';table.setAttribute('aria-label','Before and after changes');
        const heading=text('thead',''),headingRow=text('tr','');
        for(const label of ['Field','Before','After']){const cell=text('th',label);cell.setAttribute('scope','col');headingRow.append(cell);}heading.append(headingRow);table.append(heading);
        const body=text('tbody','');
        for(const change of changes){const line=text('tr',''),label=text('th',change.label);label.setAttribute('scope','row');line.append(label);
          for(const [key,title] of [['before','Before'],['after','After']]){const cell=text('td',change[key]);cell.setAttribute('data-label',title);line.append(cell);}body.append(line);}
        table.append(body);details.append(table);card.append(details);
      }
      this.field('list').append(card);
    }
    if(!rows.length)this.field('list').append(text('p','No matching activity in the loaded records.'));
    this.field('status').textContent=`${rows.length} ${rows.length===1?'action':'actions'} · ${this.rows.length} entries loaded`;
  }
  dispose(){this.generation++;this.scope.dispose();this.rows=[];this.names.clear();}
}
