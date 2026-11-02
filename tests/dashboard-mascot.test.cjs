const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('both dashboards have one decorative mascot with motion fallback and no pause checkbox', () => {
  for (const role of ['admin', 'student']) {
    const html = fs.readFileSync(path.join(root, `pages/${role}-dashboard.html`), 'utf8');
    assert.equal((html.match(/data-presence-mascot/g) || []).length, 1);
    assert.doesNotMatch(html, /welcome-mascot-pause|welcome-mascot-control|welcomeMascotPause/);
    assert.match(html, /data-mascot-state="idle" aria-hidden="true"/);
    assert.match(html, /data-mascot-hello type="button" aria-label="Say hello to the Presence mascot"/);
    assert.match(html, /data-mascot-bubble role="status" aria-live="polite"/);
    assert.match(html, /assets\/css\/mascot.css/);
    for (const asset of html.matchAll(/(?:src|srcset)="(\.\.\/assets\/emoji\/[^\"]+)"/g)) {
      assert.ok(fs.statSync(path.resolve(root, 'pages', asset[1])).size > 0);
    }
    assert.match(html, role === 'admin' ? /data-go-view="create">＋ Create event/ : /data-go-view="events"><span>◇<\/span> View events/);
  }
});

test('mascot speech follows the current eligible session, upcoming gap and closed schedule', async () => {
  const { mascotEventMessage } = await import('../assets/js/controllers/PresenceMascotController.js');
  const events = [
    {id:'morning',date:'2026-11-02',name:'Campus day — Morning',sessionBaseName:'Campus day',sessionGroupId:'day',sessionPeriod:'morning',timeIn:'07:00',timeOut:'11:00',checkOutCutoff:'12:00',audienceSections:['2A']},
    {id:'afternoon',date:'2026-11-02',name:'Campus day — Afternoon',sessionBaseName:'Campus day',sessionGroupId:'day',sessionPeriod:'afternoon',timeIn:'13:00',timeOut:'16:00',checkOutCutoff:'17:00',audienceSections:['2A']}
  ];
  const context = {events,ready:true,student:{uid:'student',active:true,section:'2A'}};
  const at = clock => +new Date(`2026-11-02T${clock}:00+08:00`);
  assert.match(mascotEventMessage(context,at('09:00')).text,/Morning is happening now/);
  assert.match(mascotEventMessage(context,at('14:00')).text,/Afternoon is happening now/);
  assert.match(mascotEventMessage(context,at('12:30')).text,/Next up/);
  assert.equal(mascotEventMessage(context,at('12:30')).key,'');
  assert.match(mascotEventMessage(context,at('18:00')).text,/No current event/);
  assert.match(mascotEventMessage({...context,student:{uid:'other',section:'3A'}},at('14:00')).text,/No current event/);
  assert.match(mascotEventMessage({...context,ready:false},at('14:00')).text,/check today’s events together/);
  assert.doesNotMatch(mascotEventMessage({...context,role:'admin'},at('14:00')).text,/Check Events for your attendance/);
});

test('tap reactions are bounded, safe, keyboard-ready and yield to real progress feedback', async () => {
  const { PresenceMascotController } = await import('../assets/js/controllers/PresenceMascotController.js');
  const timers = new Map(), handlers = new Map(), mascot = {dataset:{}}, button = {dataset:{},closest:()=>null,
    addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};
  const bubble = {hidden:true,textContent:'',set innerHTML(_value){throw Error('Speech must be plain text');}};
  let sequence=0;
  const context={ready:true,role:'admin',events:[{id:'current',name:'<img onerror=evil()>',date:'2026-11-02',timeIn:'13:00',timeOut:'16:00',checkOutCutoff:'17:00'}]};
  const controller = new PresenceMascotController({
    document:{hidden:false,querySelectorAll:()=>[mascot],querySelector:selector=>selector==='[data-mascot-hello]'?button:bubble,addEventListener(){},removeEventListener(){}},
    getContext:()=>context,now:()=>+new Date('2026-11-02T14:00:00+08:00'),random:()=>.5,
    schedule:(fn,delay)=>{timers.set(++sequence,{fn,delay});return sequence;},cancel:id=>timers.delete(id)
  }).initialize();
  controller.refreshContext(); assert.equal(bubble.hidden,false); assert.match(bubble.textContent,/<img onerror=evil\(\)>/);
  const initial=sequence;controller.refreshContext();assert.equal(sequence,initial);
  handlers.get('click')(); assert.equal(button.dataset.mascotEffect,'bounce');
  assert.equal(mascot.dataset.mascotState,'idle'); assert.doesNotMatch(bubble.textContent,/recorded|completed|checked in/);
  const count=timers.size;for(let i=0;i<10;i++)controller.tap();assert.equal(timers.size,count);
  controller.react('checking');assert.equal(button.dataset.mascotEffect,undefined);
  controller.tap();assert.equal(mascot.dataset.mascotState,'checking');assert.match(bubble.textContent,/One moment/);
  controller.react('success');controller.tap();assert.equal(mascot.dataset.mascotState,'success');
  controller.dispose();assert.equal(timers.size,0);assert.equal(bubble.hidden,true);assert.equal(handlers.size,0);
});

test('mascot floats with transforms and disables all motion for reduced motion', () => {
  const css = fs.readFileSync(path.join(root, 'assets/css/mascot.css'), 'utf8');
  assert.match(css, /@keyframes mascot-bob[^\n]+translateY\(-4px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none !important/);
  assert.doesNotMatch(css, /welcome-mascot-pause|welcome-mascot-control/);
  const build = fs.readFileSync(path.join(root, 'tools/build-mobile.cjs'), 'utf8');
  assert.match(build, /\['index.html', 'assets', 'pages'\]/);
});

test('busy cleanup cannot erase a confirmed mascot result and reactions clean up', async () => {
  const { PresenceMascotController, mascotStateForFeedback, mascotMarkup } = await import('../assets/js/controllers/PresenceMascotController.js');
  const timers = new Map(), listeners = new Map(), mascot = { dataset: {} };
  let sequence = 0;
  const controller = new PresenceMascotController({
    document: { querySelectorAll: () => [mascot], addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    schedule: fn => { timers.set(++sequence, fn); return sequence; }, cancel: id => timers.delete(id)
  }).initialize();
  controller.react('checking');
  assert.equal(timers.size, 0);
  controller.react('success');
  controller.react('idle', true);
  assert.equal(mascot.dataset.mascotState, 'success');
  controller.react('welcome');
  assert.equal(timers.size, 1);
  timers.get(sequence)();
  assert.equal(mascot.dataset.mascotState, 'idle');
  controller.dispose();
  assert.equal(listeners.size, 0);
  for (const title of ['Reset service unavailable', 'Attendance confirmation pending', 'Unable to save', 'Session ended']) assert.equal(mascotStateForFeedback(title), 'attention');
  assert.equal(mascotStateForFeedback('Checkout recorded', { attendanceSuccess: true }), 'success');
  assert.equal(mascotStateForFeedback('Logged out successfully'), 'goodbye');
  assert.doesNotMatch(mascotMarkup('<img onerror=alert(1)>'), /onerror/);
});
