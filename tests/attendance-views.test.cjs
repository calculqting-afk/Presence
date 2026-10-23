const test = require('node:test');
const assert = require('node:assert/strict');
const at = clock => +new Date(`2026-10-22T${clock}:00+08:00`);
const sessions = () => [
  { id:'day', sessionGroupId:'day',sessionPeriod:'morning', sessionBaseName:'Day 4',name:'Day 4 — Morning',date:'2026-10-22',timeIn:'07:00',checkOutCutoff:'12:30',openAt:new Date(at('07:00')),checkOutClosesAt:new Date(at('12:30')) },
  { id:'day_afternoon', sessionGroupId:'day',sessionPeriod:'afternoon',sessionBaseName:'Day 4',name:'Day 4 — Afternoon',date:'2026-10-22',timeIn:'13:25',checkOutCutoff:'17:25',openAt:new Date(at('13:25')),checkOutClosesAt:new Date(at('17:25')) }
];
test('one grouped event survives morning, the gap and afternoon, then closes only after final cutoff',async()=>{
 const {AttendanceViews:View}=await import('../assets/js/controllers/AttendanceViews.js');
 const pair=sessions();assert.equal(View.groups(pair).length,1);assert.equal(View.title(pair[1]),'Day 4');
 assert.equal(View.state(pair,at('06:00')).upcoming.id,'day');
 assert.equal(View.state(pair,at('08:00')).current.id,'day');
 assert.equal(View.state(pair,at('12:30')).current.id,'day');
 const gap=View.state(pair,at('12:45'));assert.equal(gap.current,undefined);assert.equal(gap.selected.id,'day_afternoon');assert.equal(gap.closed,false);
 assert.equal(View.state(pair,at('13:25')).current.id,'day_afternoon');
 assert.equal(View.state(pair,at('17:25')).closed,false);
 assert.equal(View.state(pair,at('17:26')).closed,true);
 assert.deepEqual(View.selection(pair,'day','both').map(e=>e.id),['day','day_afternoon']);
 assert.deepEqual(View.selection(pair,'day','afternoon').map(e=>e.id),['day_afternoon']);
 assert.deepEqual(View.selection(pair,'day_afternoon','morning').map(e=>e.id),['day']);
 assert.equal(View.groups([...pair,{id:'legacy',name:'Different — Morning',date:pair[0].date}]).length,2);
 assert.equal(View.title({id:'legacy',name:'Different — Morning'}),'Different — Morning');
 const legacy={id:'old',date:'2026-10-22',timeIn:'07:00',timeOut:'11:00'};
 assert.equal(View.state([legacy],at('11:14')).closed,false);
 assert.equal(View.state([legacy],at('11:16')).closed,true);
});
test('current-session badge follows the actual open window rather than whichever session was passed to render',async()=>{
 const {EventSchedulePresenter}=await import('../assets/js/controllers/EventSchedulePresenter.js');
 const pair=sessions();let now=at('08:00');
 const presenter=new EventSchedulePresenter({formatTime:String,escapeHtml:String,addMinutes:String,now:()=>now});
 assert.match(presenter.render(pair[1],pair),/Morning <span>Current session/);
 now=at('12:45');assert.doesNotMatch(presenter.render(pair[0],pair),/Current session/);
 now=at('14:00');assert.match(presenter.render(pair[0],pair),/Afternoon <span>Current session/);
 now=at('18:00');assert.doesNotMatch(presenter.render(pair[1],pair),/Current session/);
});
test('combined report preserves each session, groups students, and marks only closed session absences',async()=>{
 const {AttendanceReportService}=await import('../assets/js/controllers/AttendanceReportService.js');
 const {AttendanceSummaryService}=await import('../assets/js/controllers/AttendanceSummaryService.js');
 const {AttendancePdfExporter}=await import('../assets/js/controllers/AttendancePdfExporter.js');
 const pair=sessions().map(e=>({...e,type:'School Activity',location:'Campus',audience:'All students',attendanceRoster:{a:'2A',b:'2A'},timeOut:e.sessionPeriod==='morning'?'11:00':'16:00',checkInCutoff:e.sessionPeriod==='morning'?'09:00':'14:30'}));
 const students=[{uid:'a',accountId:'A',firstName:'Ana',section:'2A',course:'BSA'},{uid:'b',accountId:'B',firstName:'Ben',section:'2A',course:'BSA'}];
 const now=()=>new Date(at('12:45')),checkoutCloseDate=e=>e.checkOutClosesAt;
 const service=new AttendanceReportService({summary:new AttendanceSummaryService({now,checkoutCloseDate,closeDate:checkoutCloseDate}),now,checkoutCloseDate});
 const records=[{id:'a_day',studentUid:'a',eventId:'day',checkedInAt:new Date(at('08:00')),checkedOutAt:new Date(at('11:30')),status:'completed',arrivalStatus:'present'}];
 const report=service.snapshotGroup({events:pair,students,records,verifiedAt:now(),filters:{sort:'name-asc'}});
 assert.equal(report.rows.length,4);assert.equal(report.totals.completed,1);assert.equal(report.totals.absent,1);assert.equal(report.totals.pending,2);
 assert.deepEqual(report.rows.map(row=>[row.studentId,row.sessionLabel,row.status]),[['A','Morning','completed'],['A','Afternoon','pending'],['B','Morning','absent'],['B','Afternoon','pending']]);
 assert.equal(report.closed,false);assert.equal(report.event.name,'Day 4');
 const pdf=new AttendancePdfExporter();assert.match(pdf.header(report).filters,/Both sessions/);assert.match(pdf.header(report).totals,/Session records: 4/);
 assert.match(pdf.footer(report)[0],/Morning/);assert.match(pdf.footer(report)[1],/Afternoon/);
 const absent=service.snapshotGroup({events:pair,students,records,verifiedAt:now(),filters:{status:'absent'}});
 assert.equal(absent.rows.length,1);assert.equal(absent.rows[0].sessionLabel,'Morning');
});
