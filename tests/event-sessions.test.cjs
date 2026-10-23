const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = () => import(pathToFileURL(path.resolve(__dirname, '../assets/js/controllers/EventSessionPolicy.js')));
const now = new Date('2026-10-20T06:00:00');
const stamp = date => ({ toDate: () => date });
const record = () => ({ name:'Intramurals', date:'2026-10-20', timeIn:'07:00', checkInCutoff:'09:00', timeOut:'11:00', checkOutCutoff:'12:10',
  openAt:stamp(new Date('2026-10-20T07:00:00')), checkInClosesAt:stamp(new Date('2026-10-20T09:00:00')), closeAt:stamp(new Date('2026-10-20T11:00:00')), checkOutClosesAt:stamp(new Date('2026-10-20T12:10:00')),
  audience:'Section 2A', audienceSections:['2A'], attendanceRoster:{a:'2A'}, rosterVersion:1 });
const options = () => ({ id:'group',record:record(), enabled:true, times:['13:00','14:00','16:00','17:00'], students:[{uid:'a',section:'2A',active:true}], sections:['2A'], timestamp:()=>stamp(now), fromDate:stamp, now });

test('morning and afternoon have separate IDs, schedules and roster metadata; morning-only creates no afternoon', async () => {
  const {EventSessionPolicy:Policy} = await load();
  const plan = Policy.prepare(options());
  assert.equal(plan.primary.sessionGroupId,'group'); assert.equal(plan.primary.sessionPeriod,'morning');
  assert.equal(plan.afternoon.sessionGroupId,'group'); assert.equal(plan.afternoon.sessionPeriod,'afternoon');
  assert.equal(Policy.afternoonId('group'),'group_afternoon');
  assert.equal(plan.primary.name,'Intramurals — Morning'); assert.equal(plan.afternoon.name,'Intramurals — Afternoon');
  assert.equal(plan.primary.timeIn,'07:00'); assert.equal(plan.afternoon.timeIn,'13:00');
  assert.equal(plan.afternoon.attendanceRoster.a,'2A'); assert.notEqual(plan.primary.attendanceRoster, plan.afternoon.attendanceRoster);
  assert.equal(Policy.prepare({...options(),enabled:false}).afternoon,null);
});

test('legacy edits preserve the original single-session identity; enabling afternoon preserves the morning record ID', async () => {
  const {EventSessionPolicy:Policy} = await load();
  const original=record();
  assert.equal(Policy.prepare({...options(),previous:original,enabled:false}).primary.name,original.name);
  assert.equal(Policy.prepare({...options(),previous:original,enabled:false}).primary.sessionPeriod,undefined);
  assert.equal(Policy.prepare({...options(),previous:original}).primary.sessionGroupId,'group');
  assert.equal(original.sessionPeriod,undefined);
});

test('invalid, missing, overlapping and pre-noon afternoon windows are rejected', async () => {
  const {EventSessionPolicy:Policy} = await load();
  for (const times of [['','','',''],['11:00','12:00','15:00','16:00'],['12:00','13:00','15:00','16:00'],['13:00','13:00','15:00','16:00'],['13:00','15:00','14:00','16:00'],['13:00','14:00','16:00','16:00'],['25:00','26:00','27:00','28:00']]) {
    assert.throws(()=>Policy.prepare({...options(),times}),/morning|afternoon/);
  }
});

test('ongoing schedules can change with confirmation while closed schedules and opened dates stay protected', async () => {
  const {EventSessionPolicy:Policy} = await load();
  const later = new Date('2026-10-20T10:00:00'), previous=record();
  assert.equal(Policy.prepare({...options(),previous,now:later}).afternoon.timeIn,'13:00');
  const changed={...record(),timeIn:'07:30'};
  assert.equal(Policy.prepare({...options(),previous,now:later,record:changed}).primary.timeIn,'07:30');
  assert.equal(Policy.needsScheduleConfirmation(changed,previous,later),true);
  assert.equal(Policy.needsScheduleConfirmation(record(),previous,later),false);
  assert.throws(()=>Policy.prepare({...options(),previous,now:later,record:{...record(),date:'2026-10-21'}}),/date unchanged/);
  assert.throws(()=>Policy.prepare({...options(),previous,now:new Date('2026-10-20T13:00:00')}),/before its check-in/);
  const afternoon=Policy.prepare(options()).afternoon;
  assert.throws(()=>Policy.prepare({...options(),previous,afternoon,enabled:false}),/preserved/);
  assert.equal(Policy.prepare({...options(),previous,afternoon,now:new Date('2026-10-20T14:00:00'),times:['13:00','14:00','16:30','17:30']}).afternoon.timeOut,'16:30');
  assert.throws(()=>Policy.prepare({...options(),previous,afternoon,now:new Date('2026-10-20T18:00:00'),times:['13:00','14:00','16:30','17:30']}),/Closed-session/);
});

test('closed afternoon groups retain their roster and cannot gain new obligations', async () => {
  const {EventSessionPolicy:Policy} = await load();
  const afternoon = Policy.prepare(options()).afternoon;
  const plan=Policy.prepare({...options(),previous:record(),afternoon,now:new Date('2026-10-20T18:00:00')});
  assert.equal(Object.hasOwn(plan.afternoon,'attendanceRoster'),false);
  assert.equal(Object.hasOwn(plan.afternoon,'rosterVersion'),false);
  assert.throws(()=>Policy.prepare({...options(),previous:record(),afternoon,sections:['2B'],now:new Date('2026-10-20T18:00:00')}),/Closed afternoon/);
});

test('finished sessions reopen only by extending checkout, with other times locked and separate session flags', async () => {
  const {EventSessionPolicy:Policy}=await load();
  const previous=record(),at=new Date('2026-10-20T12:20:00');
  const extended={...record(),checkOutCutoff:'12:45',checkOutClosesAt:stamp(new Date('2026-10-20T12:45:00'))};
  const plan=Policy.prepare({...options(),previous,record:extended,now:at});
  assert.equal(plan.primary.checkoutOnlyReopened,true);
  assert.equal(plan.afternoon.checkoutOnlyReopened,undefined,'reopening morning must not mark afternoon as reopened');
  assert.equal(Policy.needsScheduleConfirmation(plan.primary,previous,at),true);
  assert.throws(()=>Policy.prepare({...options(),previous,record:{...extended,timeOut:'11:15'},now:at}),/only extend/);
  assert.throws(()=>Policy.prepare({...options(),previous,record:{...extended,checkOutCutoff:'12:15',checkOutClosesAt:stamp(new Date('2026-10-20T12:15:00'))},now:at}),/current time/);
  assert.throws(()=>Policy.prepare({...options(),previous,record:{...extended,checkOutCutoff:'14:00',checkOutClosesAt:stamp(new Date('2026-10-20T14:00:00'))},now:at}),/morning|afternoon/);
  const afternoon=Policy.prepare(options()).afternoon;
  const both=Policy.prepare({...options(),previous,afternoon,now:new Date('2026-10-20T18:00:00'),times:['13:00','14:00','16:00','20:00']});
  assert.equal(both.primary.checkoutOnlyReopened,undefined);assert.equal(both.afternoon.checkoutOnlyReopened,true);
  const preserved=Policy.prepare({...options(),previous:plan.primary,record:{...extended},now:at});
  assert.equal(preserved.primary.checkoutOnlyReopened,true,'later saves cannot clear checkout-only protection');
});

test('legacy cutoff aliases follow edited primary and afternoon schedules, never the other session', async () => {
  const {EventSessionPolicy:Policy}=await load(),previous={...record(),lateAfterAt:record().checkInClosesAt,checkInClose:'09:00'};
  const changed={...record(),checkInCutoff:'09:30',checkInClosesAt:stamp(new Date('2026-10-20T09:30:00'))};
  const plan=Policy.prepare({...options(),previous,record:changed,now:new Date('2026-10-20T10:00:00')});
  assert.equal(plan.primary.checkInClose,'09:30');assert.equal(+plan.primary.lateAfterAt.toDate(),+changed.checkInClosesAt.toDate());
  assert.equal(plan.afternoon.checkInClose,'14:00');assert.equal(+plan.afternoon.lateAfterAt.toDate(),+plan.afternoon.checkInClosesAt.toDate());
  assert.equal(previous.checkInClose,'09:00');
});

test('report scopes keep morning and afternoon separate instead of consolidating their students', async () => {
  const {EventSessionPolicy:Policy}=await load();
  const {AttendanceReportService}=await import(pathToFileURL(path.resolve(__dirname,'../assets/js/controllers/AttendanceReportService.js')));
  const plan=Policy.prepare(options());
  const morning={...plan.primary,id:'group'},afternoon={...plan.afternoon,id:'group_afternoon'};
  const service=new AttendanceReportService({});
  assert.deepEqual(service.eventIds(morning,[morning,afternoon]),['group']);
  assert.deepEqual(service.eventIds(afternoon,[morning,afternoon]),['group_afternoon']);
});

test('afternoon-only creates a single primary session and rejects a pre-noon schedule', async () => {
  const {EventSessionPolicy:Policy}=await load();
  const record={...options().record,timeIn:'13:00',checkInCutoff:'14:00',timeOut:'16:00',checkOutCutoff:'17:00',
    openAt:stamp(new Date('2026-10-20T13:00:00')),checkInClosesAt:stamp(new Date('2026-10-20T14:00:00')),closeAt:stamp(new Date('2026-10-20T16:00:00')),checkOutClosesAt:stamp(new Date('2026-10-20T17:00:00'))};
  const plan=Policy.prepare({...options(),record,mode:'afternoon'});
  assert.equal(plan.primary.sessionPeriod,'afternoon');assert.equal(plan.primary.sessionGroupId,'group');
  assert.equal(plan.primary.name,'Intramurals — Afternoon');assert.equal(plan.afternoon,null);
  assert.throws(()=>Policy.prepare({...options(),mode:'afternoon'}),/after noon/);
  assert.throws(()=>Policy.prepare({...options(),record,mode:'morning'}),/before noon/);
  assert.throws(()=>Policy.prepare({...options(),mode:'unknown'}),/Choose/);
  assert.throws(()=>Policy.prepare({...options(),record,previous:plan.primary,mode:'morning',now:new Date('2026-10-20T14:00:00')}),/mode is locked/);
});

test('cards show both schedules and mark the session matching the current time', async () => {
  const {EventSessionPolicy:Policy}=await load();
  const {EventSchedulePresenter}=await import(pathToFileURL(path.resolve(__dirname,'../assets/js/controllers/EventSchedulePresenter.js')));
  const plan=Policy.prepare(options()),morning={...plan.primary,id:'group'},afternoon={...plan.afternoon,id:'group_afternoon'};
  const presenter=new EventSchedulePresenter({formatTime:value=>value,escapeHtml:String,addMinutes:value=>value,now:()=>+afternoon.openAt.toDate()+60000});
  const html=presenter.render(afternoon,[morning,afternoon]);
  assert.match(html,/Both — Morning and Afternoon/);assert.match(html,/Morning schedule/);assert.match(html,/Afternoon schedule/);
  for(const time of ['07:00','09:00','11:00','12:10','13:00','14:00','16:00','17:00'])assert.ok(html.includes(time),time);
  assert.match(html,/Afternoon <span>Current session/);
  assert.equal((html.match(/Current session/g)||[]).length,1);
  assert.equal(html.includes('<button'),false,'schedule rendering must not replace attendance controls');
  const unrelated={...morning,id:'different',sessionGroupId:'different',timeIn:'04:00'};
  assert.equal(presenter.render(afternoon,[morning,afternoon,unrelated]).includes('04:00'),false);
  assert.match(presenter.render(morning),/Morning only/);
  assert.match(presenter.render({...afternoon,id:'solo',sessionGroupId:'solo'}),/Afternoon only/);
});
