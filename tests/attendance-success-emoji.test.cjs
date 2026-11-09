const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('dark theme keeps animated attendance logos transparent without changing regular toast marks',()=>{
  const root=path.resolve(__dirname,'..');
  const theme=fs.readFileSync(path.join(root,'assets/css/dashboard-theme.css'),'utf8');
  const css=fs.readFileSync(path.join(root,'assets/css/mascot.css'),'utf8');
  assert.match(theme, /:root\[data-theme="dark"\] \.toast-mark:not\(\.is-mascot\) \{[^}]*background: #168653;/);
  assert.doesNotMatch(theme, /:root\[data-theme="dark"\] \.toast-mark\s*\{/);
  assert.match(css, /\.toast-mark\.is-mascot, \.toast-icon\.is-mascot \{[^}]*background: transparent;/);
});
test('attendance success toast opts into smooth animation, supports reduced motion and clears hidden animations',async()=>{
  const {DashboardToastController}=await import('../assets/js/controllers/DashboardToastController.js');
  const classes=new Set(),markClasses=new Set();let html='',text='✓';
  const mark={classList:{add:name=>markClasses.add(name),remove:name=>markClasses.delete(name)},setAttribute(){},get innerHTML(){return html;},set innerHTML(value){html=value;text='';},set textContent(value){text=value;html='';},get textContent(){return text;}};
  const toast={classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)},querySelector:()=>mark};
  const title={},message={},timers=new Map();let sequence=0;
  const controller=new DashboardToastController({document:{querySelector:id=>id==='#dashboardToast'?toast:id==='#dashboardToastTitle'?title:message},schedule:fn=>{timers.set(++sequence,fn);return sequence;},cancel:id=>timers.delete(id)});
  controller.show('Attendance recorded','Saved',{attendanceSuccess:true});
  assert.equal(title.textContent,'Attendance recorded');assert.equal(message.textContent,'Saved');
  assert.equal(classes.has('show'),true);assert.equal(markClasses.has('is-mascot'),true);
  assert.match(html,/data-mascot-state="success"/);
  controller.show('Unable to save','Try again');assert.match(html,/data-mascot-state="attention"/);assert.equal(markClasses.size,1);assert.equal(timers.size,1);
  controller.show('Checkout recorded','Saved',{attendanceSuccess:true});timers.get(sequence)();
  assert.equal(classes.has('show'),false);assert.notEqual(mark.textContent,'✓');assert.match(html,/data-mascot-state="success"/);
  controller.show('Saved','Done',{attendanceSuccess:true});controller.dispose();assert.equal(classes.has('show'),false);assert.match(html,/data-mascot-state="success"/);
});
test('success animation is requested only by confirmed attendance branches and required public assets exist',()=>{
  const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'assets/js/controllers/StudentAttendanceController.js'),'utf8');
  assert.equal((source.match(/attendanceSuccess:/g)||[]).length,2);
  assert.match(source,/Checkout recorded[^\n]+attendanceSuccess: result.state !== 'existing'/);
  assert.match(source,/else showDashboardToast\([^\n]+attendanceSuccess: true/);
  for(const state of ['unknown','confirmation-pending']){
    for(const part of source.split(`if (result.state === '${state}')`).slice(1))assert.doesNotMatch(part.split('return;')[0],/attendanceSuccess/);
  }
  for(const file of ['presence-check-in-smooth.webp','presence-check-in-128.gif','presence-check-in.png'])assert.ok(fs.statSync(path.join(root,'assets/emoji',file)).size>0);
});
