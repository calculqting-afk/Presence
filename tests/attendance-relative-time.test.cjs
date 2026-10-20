const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const load=()=>import(pathToFileURL(path.resolve(__dirname,'../assets/js/controllers/AttendanceRelativeTime.js')));

test('time since distinguishes actions, uses minutes/hours/days and handles pending/invalid/future timestamps',async()=>{
  const {AttendanceRelativeTime:Time}=await load(),now=2_000_000_000_000;
  assert.equal(Time.label(now-1000,'in',now),'Checked in just now');
  assert.equal(Time.label(now-60000,'in',now),'Checked in 1 min ago');
  assert.equal(Time.label(now-1800000,'in',now),'Checked in 30 min ago');
  assert.equal(Time.label(now-300000,'out',now),'Checked out 5 min ago');
  assert.equal(Time.label(now-7200000,'out',now),'Checked out 2 hr ago');
  assert.equal(Time.label(now-86400000,'in',now),'Checked in 1 day ago');
  assert.equal(Time.label(now-172800000,'in',now),'Checked in 2 days ago');
  assert.match(Time.label(now+120000,'in',now),/Time unavailable/);
  assert.equal(Time.render(null,'in',now),'');assert.equal(Time.render({toDate:()=>new Date(NaN)},'in',now),'');
  assert.equal(Time.render({toMillis:()=>{throw Error('unresolved')}},'in',now),'');
  for(const value of [new Date(now-1800000),{toMillis:()=>now-1800000},{toDate:()=>new Date(now-1800000)},{seconds:(now-1800000)/1000}])assert.match(Time.render(value,'in',now),/Checked in 30 min ago/);
});

test('minute refresh updates visible labels only, pauses in background, resumes on focus and cleans up',async()=>{
  const {AttendanceRelativeTime:Time}=await load();let now=2_000_000_000_000,timer,scheduled=0;
  const handlers=new Map(),listeners=new Set(),node={dataset:{attendanceTime:String(now-1800000),attendanceAction:'in'},closest:()=>null,textContent:''};
  const hiddenNode={...node,closest:()=>({hidden:true}),textContent:'unchanged'};
  const document={hidden:false,querySelectorAll:()=>[node,hiddenNode],addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};
  const window={setTimeout:(fn,delay)=>{assert.equal(delay,60000);timer=fn;scheduled++;return scheduled;},clearTimeout:()=>{},addEventListener:name=>listeners.add(name),removeEventListener:name=>listeners.delete(name)};
  const clock=new Time({window,document,now:()=>now});clock.initialize();clock.initialize();
  assert.equal(scheduled,1);assert.equal(node.textContent,'Checked in 30 min ago');assert.equal(hiddenNode.textContent,'unchanged');
  now+=60000;timer();assert.equal(node.textContent,'Checked in 31 min ago');
  document.hidden=true;const before=scheduled;handlers.get('visibilitychange')();assert.equal(scheduled,before);
  now+=600000;document.hidden=false;handlers.get('visibilitychange')();assert.equal(node.textContent,'Checked in 41 min ago');
  clock.dispose();assert.equal(listeners.size,0);assert.equal(handlers.size,0);timer();assert.equal(scheduled,before+1);
});
