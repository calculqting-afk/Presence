const test = require('node:test');
const assert = require('node:assert/strict');
const stamp = ms => ({ toDate: () => new Date(ms) });
const students = [{ uid:'a',section:'2A',active:true,createdAt:stamp(10) },{uid:'b',section:'2B',active:true,createdAt:stamp(10)},{uid:'c',section:'1A',active:true,createdAt:stamp(10)},{uid:'inactive',section:'2B',active:false}];
const original = { id:'event',name:'Assembly',date:'2026-10-20',audience:'Section 2A',openAt:stamp(500),checkOutClosesAt:stamp(2000),attendanceRoster:{a:'2A'},rosterCapturedAt:stamp(100) };
async function policy() { return (await import('../assets/js/controllers/EventAudiencePolicy.js')).EventAudiencePolicy; }
test('multiple selected sections authorize assigned students but not view-only students', async () => {
  const Policy = await policy();
  const fields = Policy.assignment(students,['2B','2A'],original,{now:new Date(1000),timestamp:()=>stamp(1000)});
  assert.deepEqual(fields.audienceSections,['2A','2B']); assert.equal(fields.audience,'Selected sections');
  assert.deepEqual(fields.attendanceRoster,{a:'2A',b:'2B'});
  const event = {...original,...fields};
  assert.equal(Policy.canAttend(students[0],event),true); assert.equal(Policy.canAttend(students[1],event),true); assert.equal(Policy.canAttend(students[2],event),false);
  assert.equal(Policy.label(event),'Sections 2A, 2B'); assert.equal(fields.rosterVersion,1);
  assert.deepEqual(original.attendanceRoster,{a:'2A'});
});
test('repairing a legacy All-students label with a 2A-only roster marks 2B as newly assigned', async () => {
  const Policy = await policy(), previous={...original,audience:'All students'};
  const fields=Policy.assignment(students,[...Policy.sections],previous,{now:new Date(1000),timestamp:()=>stamp(1000)}), event={...previous,...fields};
  assert.deepEqual(fields.audienceSections,[]); assert.equal(fields.audience,'All students'); assert.equal(Policy.canAttend(students[1],event),true);
  assert.equal(Policy.addedAfterOpening(students[0],event),false); assert.equal(Policy.addedAfterOpening(students[1],event),true);
});
test('retained sections keep their original assignment time; removed/readded sections get a new one', async () => {
  const Policy=await policy();
  const multi={...original,...Policy.assignment(students,['2A','2B'],original,{now:new Date(1000),timestamp:()=>stamp(1000)})};
  const retained={...multi,...Policy.assignment(students,['2A','2B'],multi,{now:new Date(1200),timestamp:()=>stamp(1200)})};
  assert.equal(+Policy.date(retained.sectionAssignedAt['2B']),1000);
  const removed={...retained,...Policy.assignment(students,['2A'],retained,{now:new Date(1300),timestamp:()=>stamp(1300)})};
  assert.equal(Policy.canAttend(students[1],removed),false);
  const readded={...removed,...Policy.assignment(students,['2A','2B'],removed,{now:new Date(1400),timestamp:()=>stamp(1400)})};
  assert.equal(+Policy.date(readded.sectionAssignedAt['2B']),1400); assert.equal(readded.rosterVersion,4);
});
test('empty/invalid groups and closed-event changes are rejected', async () => {
  const Policy=await policy(), options={now:new Date(1000),timestamp:()=>stamp(1000)};
  assert.throws(()=>Policy.assignment(students,[],original,options),/at least one/);
  assert.throws(()=>Policy.assignment(students,['9Z'],original,options),/valid section/);
  assert.throws(()=>Policy.assignment(students,['2A'],{...original,checkOutClosesAt:stamp(999)},options),/Closed/);
  const created=Policy.assignment(students,['2A'],null,options); assert.equal(created.rosterVersion,1);
});
test('late-added groups are unverified rather than absences in summaries and projections; real attendance survives removal', async () => {
  const Policy=await policy(); const event={...original,...Policy.assignment(students,['2A','2B'],original,{now:new Date(1000),timestamp:()=>stamp(1000)})};
  const { AttendanceSummaryService }=await import('../assets/js/controllers/AttendanceSummaryService.js');
  const { AttendanceRecordProjectionService }=await import('../assets/js/controllers/AttendanceRecordProjectionService.js');
  const summary=new AttendanceSummaryService({closeDate:()=>new Date(1500),checkoutCloseDate:()=>new Date(2000),now:()=>new Date(3000)});
  assert.equal(summary.eligibility(students[0],event),'eligible'); assert.equal(summary.eligibility(students[1],event),'provisional'); assert.equal(summary.eligibility(students[2],event),'excluded');
  const result=summary.summarize(students[1],[event],[]); assert.equal(result.absences.length,0); assert.equal(result.unverified.length,1);
  const projection=new AttendanceRecordProjectionService({getEvents:()=>[event],getStudents:()=>students,checkoutCloseDate:()=>new Date(2000),now:()=>new Date(3000)});
  assert.deepEqual(projection.project([],{status:'absent'}).map(row=>row.studentUid),['a']);
  assert.deepEqual(projection.project([],{status:'review'}).map(row=>row.studentUid),['b']);
  const actual={studentUid:'b',eventId:'event',checkedInAt:stamp(1100)};
  assert.equal(projection.project([actual]).filter(row=>row.studentUid==='b').length,1);
});
test('report and analytics policy mark late additions for review while excluding unassigned sections', async () => {
  const Policy=await policy(); const event={...original,...Policy.assignment(students,['2A','2B'],original,{now:new Date(1000),timestamp:()=>stamp(1000)})};
  const { AttendanceSummaryService }=await import('../assets/js/controllers/AttendanceSummaryService.js');
  const { AttendanceReportService }=await import('../assets/js/controllers/AttendanceReportService.js');
  const summary=new AttendanceSummaryService({closeDate:()=>new Date(1500),checkoutCloseDate:()=>new Date(2000),now:()=>new Date(3000)});
  const report=new AttendanceReportService({summary,checkoutCloseDate:()=>new Date(2000),now:()=>new Date(3000)}).snapshot({event,students,records:[],verifiedAt:new Date(3000)});
  assert.equal(report.rows.length,2); assert.equal(report.totals.absent,1); assert.equal(report.totals.review,1); assert.equal(report.event.audience,'Sections 2A, 2B');
  const { AttendanceAnalyticsController }=await import('../assets/js/controllers/AttendanceAnalyticsController.js');
  const analytics=new AttendanceAnalyticsController({getEvents:()=>[event],getStudents:()=>students,closeDate:()=>new Date(2000),now:()=>new Date(3000)});
  const rows=analytics.rows(event.date); assert.equal(rows.length,2); assert.equal(rows.filter(row=>row.absent).length,1); assert.equal(rows.filter(row=>row.review).length,1);
});
test('multi-section surveys share the attendance eligibility policy', async () => {
  const Policy=await policy(), {SurveyPolicy}=await import('../assets/js/controllers/SurveyPolicy.js');
  const event={...original,...Policy.assignment(students,['2A','2B'],original,{now:new Date(1000),timestamp:()=>stamp(1000)})};
  const survey=new SurveyPolicy(); assert.equal(survey.eligible(students[1],event),true); assert.equal(survey.eligible(students[2],event),false);
});
test('section editor restores legacy selections, saves multiple boxes, and resets to All students', async () => {
  const {EventAudienceController}=await import('../assets/js/controllers/EventAudienceController.js');
  const nodes={'#eventAudience':{value:'All students'},'#eventSectionChoices':{hidden:false}};
  const boxes=['1A','1B','2A','2B','3A','3B','4A','4B'].map(value=>({value,checked:false}));
  let onChange;
  const editor=new EventAudienceController({document:{querySelector:id=>nodes[id],querySelectorAll:()=>boxes},scope:{listen:(_node,_event,callback)=>{onChange=callback;}}});
  editor.set({audience:'Section 2A'}); assert.equal(nodes['#eventAudience'].value,'Selected sections'); assert.deepEqual(editor.read(),['2A']); assert.equal(nodes['#eventSectionChoices'].hidden,false);
  boxes.find(box=>box.value==='2B').checked=true; assert.deepEqual(editor.read(),['2A','2B']);
  nodes['#eventAudience'].value='All students';onChange(); assert.equal(editor.read().length,8);assert.equal(nodes['#eventSectionChoices'].hidden,true);
  editor.set();assert.equal(editor.read().length,8);assert.equal(boxes.some(box=>box.checked),false);
});
