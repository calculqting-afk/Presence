const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.crypto ||= require('node:crypto').webcrypto;

async function fixture() {
  const { AttendanceQrService } = await import('../workers/admin-api/src/attendance-qr.js');
  const { PolicyAgreementPolicy: Policy } = await import('../assets/js/core/PolicyAgreementPolicy.js');
  let now = Date.parse('2026-11-09T10:00:00+08:00'), revision = 0;
  const store = new Map([
    ['students/student', { active: true, role: 'student', accountId: '2510004-1', firstName: 'Test', lastName: 'Student', course: 'BS Info Tech', section: '2A', _updateTime: 'student-v1' }],
    ['students/admin', { active: true, role: 'attendance_admin', firstName: 'Test', lastName: 'Admin' }],
    ['accountSessions/student', { sessionId: 'student-session' }],
    ['accountSessions/admin', { sessionId: 'admin-session' }],
    [Policy.path('student').join('/'), Policy.receipt('student', new Date(now))],
    ['events/morning', { name: 'Test — Morning', date: '2026-11-09', timeIn: '09:00', timeOut: '11:00', openAt: new Date(now - 3600000), lateAfterAt: new Date(now + 60000), closeAt: new Date(now + 3600000), checkOutClosesAt: new Date(now + 7200000), audienceSections: ['2A'], attendanceRoster: { student: '2A' }, _updateTime: 'event-v1' }]
  ]);
  const users = new Map(['student', 'admin'].map(uid => [uid, { localId: uid, validSince: '0' }]));
  const db = { get: async path => structuredClone(store.get(path) || null), user: async uid => users.get(uid),
    write: (path, data, options = {}) => ({ path, data, options }),
    transaction: async operation => {
      const writes = await operation(db.get);
      for (const { path, data, options } of writes) {
        if (options.exists !== undefined) assert.equal(store.has(path), options.exists, 'write precondition');
        store.set(path, { ...(options.merge ? store.get(path) : {}), ...data, _updateTime: 'revision-' + ++revision });
      }
    }
  };
  const student = { sub: 'student', auth_time: now / 1000, presenceAuthTime: now / 1000, presenceSession: 'student-session' };
  const admin = { ...student, sub: 'admin', presenceSession: 'admin-session' };
  const service = new AttendanceQrService(db, 'test-only-purpose-separated-secret-1234567890', () => now);
  const issue = () => service.issue(student, { eventId: 'morning' });
  const preview = (token, action = 'in') => service.scan(admin, { token, action, eventId: 'morning' });
  const confirm = (confirmation, action = 'in') => service.scan(admin, { confirmation, action, eventId: 'morning' }, true);
  return { service, store, users, db, student, admin, issue, preview, confirm, advance: milliseconds => { now += milliseconds; }, Policy };
}

test('event QR is opaque, round-trips through the bundled camera decoder, and expires after 30 minutes', async () => {
  const f = await fixture(), qr = await f.issue();
  assert.doesNotMatch(qr.token, /2510004|Student|student-session|password/);
  assert.equal(qr.expiresAt - qr.serverNow, 1800000);
  const makeQr = require('qrcode-generator'), decodeQr = require('jsqr');
  const code = makeQr(0, 'M'); code.addData(qr.token); code.make();
  const scale = 4, margin = 4, size = (code.getModuleCount() + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const row = Math.floor(y / scale) - margin, col = Math.floor(x / scale) - margin;
    if (row >= 0 && col >= 0 && row < code.getModuleCount() && col < code.getModuleCount() && code.isDark(row, col)) {
      const offset = (y * size + x) * 4; pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
    }
  }
  assert.equal(decodeQr(pixels, size, size).data, qr.token);
  f.advance(1800000); await assert.rejects(f.preview(qr.token), /expired/);
});

test('preview changes no attendance; confirmation records server time and one audit; replay is idempotent', async () => {
  const f = await fixture(), qr = await f.issue(), view = await f.preview(qr.token);
  assert.equal(view.student.studentId, '2510004-1'); assert.equal(view.student.course, 'BS Info Tech');
  assert.equal(f.store.has('attendance/student_morning'), false);
  const saved = await f.confirm(view.confirmation);
  assert.equal(saved.saved, true);
  const record = f.store.get('attendance/student_morning');
  assert.equal(+record.checkedInAt, qr.serverNow); assert.equal(record.qrCheckedInBy, 'admin');
  assert.equal(record.recordSource, 'admin-qr'); assert.equal(record.arrivalStatus, 'present');
  assert.equal(record.checkInLocation, undefined);
  assert.equal((await f.confirm(view.confirmation)).existing, true);
  assert.equal([...f.store.keys()].filter(key => key.startsWith('auditLogs/')).length, 1);
});

test('checkout respects its opening, needs check-in, preserves original metadata, and records the scanning admin', async () => {
  const f = await fixture(); let qr = await f.issue();
  await assert.rejects(f.preview(qr.token, 'out'), /window is closed/);
  f.advance(3600000); qr = await f.issue();
  await assert.rejects(f.preview(qr.token, 'out'), /valid check-in/);
  const first = await f.preview(qr.token); await f.confirm(first.confirmation);
  const original = f.store.get('attendance/student_morning');
  assert.equal(original.arrivalStatus, 'late');
  f.advance(1000);
  const out = await f.preview(qr.token, 'out'); await f.confirm(out.confirmation, 'out');
  const saved = f.store.get('attendance/student_morning');
  assert.equal(+saved.checkedInAt, +original.checkedInAt); assert.equal(saved.status, 'completed');
  assert.equal(saved.qrCheckedOutBy, 'admin'); assert.equal(saved.arrivalStatus, 'late');
  assert.equal((await f.preview(qr.token, 'out')).existing, true);
});

test('codes are bound to event, student session and scanning admin, and cannot be altered', async () => {
  const f = await fixture(), qr = await f.issue(), view = await f.preview(qr.token);
  await assert.rejects(f.preview(qr.token.slice(0, -4) + 'AAAA'), /invalid/);
  await assert.rejects(f.service.scan(f.admin, { token: qr.token, action: 'in', eventId: 'afternoon' }), /another event/);
  await assert.rejects(f.service.scan({ ...f.admin, sub: 'someone' }, { confirmation: view.confirmation, action: 'in', eventId: 'morning' }, true), /Only|again/);
  f.store.set('accountSessions/student', { sessionId: 'transferred' });
  await assert.rejects(f.confirm(view.confirmation), /session changed/);
  assert.equal(f.store.has('attendance/student_morning'), false);
});

test('every save rechecks live roles, disabled accounts, password setup, eligibility and agreement', async () => {
  for (const change of ['role', 'disabled', 'password', 'roster', 'agreement', 'admin-session', 'revoked-token']) {
    const f = await fixture(), qr = await f.issue(), view = await f.preview(qr.token);
    if (change === 'role') f.store.get('students/admin').role = 'student_manager';
    if (change === 'disabled') f.users.get('student').disabled = true;
    if (change === 'password') f.store.get('students/student').mustChangePassword = true;
    if (change === 'roster') f.store.get('events/morning').attendanceRoster = { other: '2A' };
    if (change === 'agreement') f.store.delete(f.Policy.path('student').join('/'));
    if (change === 'admin-session') f.store.get('accountSessions/admin').sessionId = null;
    if (change === 'revoked-token') f.users.get('student').validSince = String(f.student.auth_time + 1);
    await assert.rejects(f.confirm(view.confirmation), undefined, change);
    assert.equal(f.store.has('attendance/student_morning'), false, change);
  }
});

test('confirmation expires quickly and rejects changed identity, changed event and changed action', async () => {
  for (const change of ['expiry', 'profile', 'event', 'action']) {
    const f = await fixture(), qr = await f.issue(), view = await f.preview(qr.token);
    if (change === 'expiry') f.advance(120000);
    if (change === 'profile') f.store.get('students/student')._updateTime = 'changed';
    if (change === 'event') f.store.get('events/morning')._updateTime = 'changed';
    await assert.rejects(f.confirm(view.confirmation, change === 'action' ? 'out' : 'in'), /expired|changed|Scan again/);
  }
});

test('completed sessions cannot issue codes, expiry never exceeds cutoff, reopened checkout cannot create a check-in', async () => {
  const f = await fixture(); f.advance(7150000);
  const qr = await f.issue(); assert.equal(qr.expiresAt - qr.serverNow, 50000);
  f.advance(50001); await assert.rejects(f.issue(), /window is closed/);
  const g = await fixture(), event = g.store.get('events/morning'); event.checkoutOnlyReopened = true; event.closeAt = new Date(0);
  await assert.rejects(g.issue(), /saved check-in/);
  g.store.set('attendance/student_morning', { studentUid: 'student', eventId: 'morning', eventDate: event.date, status: 'checked-in', checkedInAt: new Date(Date.parse('2026-11-09T09:00:00+08:00')) });
  const reopened = await g.issue();
  await assert.rejects(g.preview(reopened.token), /window is closed/);
  assert.ok((await g.preview(reopened.token, 'out')).confirmation);
});

test('revoking QR attendance does not let an old code recreate it and excessive issuance is bounded', async () => {
  const f = await fixture(), qr = await f.issue(), view = await f.preview(qr.token);
  await f.confirm(view.confirmation); f.store.delete('attendance/student_morning');
  const again = await f.preview(qr.token);
  await assert.rejects(f.confirm(again.confirmation), /already processed/);
  for (let i = 0; i < 9; i++) await f.issue();
  await assert.rejects(f.issue(), /one minute/);
  f.advance(60000); assert.ok((await f.issue()).token);
});

test('QR scanning cannot overwrite checkout-only attendance or complete a wrong-day check-in', async () => {
  const f = await fixture(), qr = await f.issue();
  f.store.set('attendance/student_morning', { status: 'checkout-only', checkedOutAt: new Date() });
  await assert.rejects(f.preview(qr.token), /audited attendance correction/);
  f.advance(3600000); const next = await f.issue();
  f.store.set('attendance/student_morning', { studentUid: 'student', eventId: 'morning', eventDate: '2026-11-09', status: 'checked-in', checkedInAt: new Date('2026-11-08T09:00:00+08:00') });
  await assert.rejects(f.preview(next.token, 'out'), /audited correction/);
});

async function browserFixture(admin = true) {
  const { AttendanceQrController } = await import('../assets/js/controllers/AttendanceQrController.js');
  const event = { id: 'session', name: 'Current event', date: '2026-11-09', openAt: new Date(Date.now() - 1000), checkOutClosesAt: new Date(Date.now() + 3600000), audienceSections: ['2A'] };
  const node = () => ({ value: '', checked: false, disabled: false, hidden: false, children: [], textContent: '',
    classList: { toggle() {} }, setAttribute() {}, removeAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {},
    append(child) { child.connected = true; this.children.push(child); }, replaceChildren(...children) { this.children = children; } });
  const body = node(), intervals = new Map(); let sequence = 0;
  const document = { body, head: node(), querySelector: () => node(), addEventListener() {}, removeEventListener() {},
    createElement(tag) {
      const element = node(), fields = new Map();
      element.querySelector = selector => {
        if (!fields.has(selector)) fields.set(selector, node());
        const field = fields.get(selector);
        if (selector === '[data-qr-event]' && !field.value) field.value = 'session';
        if (selector === '[data-qr-action]' && !field.value) field.value = 'in';
        return field;
      };
      element.querySelectorAll = () => [...fields.values()];
      element.close = () => { element.open = false; };
      element.remove = () => { element.connected = false; };
      element.showModal = () => { assert.equal(element.connected, true, 'dialog must be attached before showModal'); element.open = true; };
      return element;
    }
  };
  const window = { navigator: { mediaDevices: {} }, addEventListener() {}, removeEventListener() {},
    clearTimeout() {}, clearInterval: id => intervals.delete(id), setInterval: callback => { intervals.set(++sequence, callback); return sequence; } };
  const calls = [], notifications = [], controller = new AttendanceQrController({ document, window, admin,
    getEvents: () => [event], getUser: () => ({ uid: 'student' }), getProfile: () => ({ active: true, section: '2A' }), escapeHtml: String,
    showToast: (...args) => notifications.push(args), api: { call: async (...args) => { calls.push(args); return { saved: true, student: { name: 'Test Student' } }; } }
  });
  controller.initialize();
  return { controller, calls, notifications, window, document, intervals, event };
}

test('scanner attaches its dialog and always releases camera and timers on close', async () => {
  const f = await browserFixture(); await f.controller.open();
  assert.equal(f.controller.dialog.open, true);
  let stopped = 0;
  f.controller.stream = { getTracks: () => [{ stop: () => stopped++ }] };
  f.controller.expiryTimer = f.window.setInterval(() => {});
  f.controller.close();
  assert.equal(stopped, 1); assert.equal(f.intervals.size, 0); assert.equal(f.controller.dialog, null);
  assert.equal(f.calls.length, 0);
});

test('scanner never confirms without physical identity verification, and repeated clicks cannot duplicate a pending save', async () => {
  const f = await browserFixture(); await f.controller.open();
  f.controller.preview = { eventId: 'session', action: 'in', confirmation: 'opaque' };
  await f.controller.confirm(); assert.equal(f.calls.length, 0);
  f.controller.field('[data-qr-verified]').checked = true;
  let finish; f.controller.api.call = async () => { f.calls.push('save'); return new Promise(resolve => { finish = resolve; }); };
  const pending = f.controller.confirm();
  await f.controller.confirm(); f.controller.close();
  assert.ok(f.controller.dialog, 'pending save cannot disappear through Escape/back'); assert.equal(f.calls.length, 1);
  finish({ saved: true, student: { name: 'Test Student' } }); await pending;
  assert.equal(f.notifications.length, 1); assert.equal(f.controller.preview, null);
  f.controller.close(); assert.equal(f.controller.dialog, null);
});

test('permission denial is visible and a late camera grant after closing is immediately stopped', async () => {
  const f = await browserFixture(); await f.controller.open();
  f.controller.decoder = async () => () => null;
  f.window.navigator.mediaDevices.getUserMedia = async () => { const error = Error('denied'); error.name = 'NotAllowedError'; throw error; };
  await f.controller.startCamera(); assert.match(f.controller.field('[data-qr-status]').textContent, /denied/);
  let grant, stopped = 0;
  f.window.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { grant = resolve; });
  const pending = f.controller.startCamera(); await new Promise(resolve => setImmediate(resolve));
  f.controller.close(); grant({ getTracks: () => [{ stop: () => stopped++ }] }); await pending;
  assert.equal(stopped, 1); assert.equal(f.controller.stream, null);
});

test('an unconfirmed save error resets the preview and tells the admin to check saved status before retrying', async () => {
  const f = await browserFixture(); await f.controller.open();
  f.controller.preview = { eventId: 'session', action: 'in', confirmation: 'opaque' };
  f.controller.field('[data-qr-verified]').checked = true;
  f.controller.api.call = async () => { throw Error('Connection lost.'); };
  await f.controller.confirm();
  assert.equal(f.controller.preview, null); assert.equal(f.notifications.length, 0);
  assert.match(f.controller.field('[data-qr-status]').textContent, /Scan again to check the saved status/);
  assert.equal(f.controller.confirming, false);
});


test('student QR navigation renders inline only while its page is visible and clears timers on exit', async () => {
  const f=await browserFixture(false);let generated=0;
  f.controller.generate=async()=>{generated++;};
  assert.equal(f.calls.length,0);assert.equal(f.controller.dialog,undefined);
  f.controller.onView({detail:{viewName:'attendance-qr'}});
  assert.equal(generated,1);assert.match(f.controller.dialog.className,/attendance-qr-page/);
  assert.equal(f.controller.dialog.open,undefined,'student QR is a page, not a modal');
  assert.equal(f.document.body.children.length,0);assert.equal(f.intervals.size,0);
  f.controller.onView({detail:{viewName:'events'}});
  assert.equal(f.controller.dialog,null);assert.equal(f.intervals.size,0);
  assert.equal(generated,1);
  f.controller.onView({detail:{viewName:'attendance-qr'}});assert.equal(generated,2);
  f.document.hidden=true;f.controller.onVisibility();assert.equal(f.intervals.size,0);
  f.document.hidden=false;f.controller.onVisibility();assert.equal(generated,3);
  f.controller.dispose();assert.equal(f.intervals.size,0);
});

test('student QR has its own navigation and section instead of an Events shortcut', async () => {
  const fs=await import('node:fs');
  const html=fs.readFileSync(require('node:path').join(__dirname, '../pages/student-dashboard.html'),'utf8');
  assert.match(html,/data-view="attendance-qr"/);assert.match(html,/data-section="attendance-qr"/);
  assert.doesNotMatch(html,/id="openStudentAttendanceQr"/);
});


test('identity QR issues without any event and the admin selects each eligible session', async () => {
  const f=await fixture();
  const first=await f.service.issue(f.student, {});
  assert.equal(first.expiresAt-first.serverNow,1800000);
  assert.equal(first.student.studentId,'2510004-1');
  const secondEvent=structuredClone(f.store.get('events/morning'));f.store.set('events/another',secondEvent);
  const preview=await f.service.scan(f.admin,{token:first.token,eventId:'another',action:'in'});
  await f.service.scan(f.admin,{confirmation:preview.confirmation,eventId:'another',action:'in'},true);
  assert.ok(f.store.get('attendance/student_another'));
  assert.equal(f.store.has('attendance/student_morning'),false);
  const morning=await f.preview(first.token);await f.confirm(morning.confirmation);
  assert.equal((await f.preview(first.token)).existing,true);
  f.store.get('events/another').attendanceRoster={other:'2A'};
  await assert.rejects(f.service.scan(f.admin,{token:first.token,eventId:'another',action:'in'}),/not assigned/);
});

test('identity QR is available outside events but cannot bypass windows, expiry or account restrictions',async()=>{
  const f=await fixture();f.advance(7200001);
  const qr=await f.service.issue(f.student,{});assert.ok(qr.token);
  await assert.rejects(f.preview(qr.token),/window is closed/);
  f.advance(1800000);await assert.rejects(f.preview(qr.token),/expired/);
  f.store.get('students/student').active=false;
  await assert.rejects(f.service.issue(f.student,{}),/active student/);
});

test('student identity QR loads without a selector, reuses its lifetime and downloads a labelled PNG',async()=>{
  const f=await browserFixture(false),makeQr=require('qrcode-generator');
  f.window.qrcode=makeQr;
  f.controller.api.call=async(route,user,body)=>{const now=Date.now();f.calls.push({route,body});return {token:'opaque-test-token',student:{name:'Test Student',studentId:'2510004-1'},serverNow:now,expiresAt:now+(body.download?900000:1800000)};};
  await f.controller.open();
  assert.deepEqual(f.calls[0].body,{});
  assert.doesNotMatch(f.controller.dialog.innerHTML,/<select/);
  assert.match(f.controller.field('[data-qr-countdown]').textContent,/New QR in 30:00/);
  const labels=[],rects=[];let link;
  const original=f.document.createElement;
  f.document.createElement=tag=>tag==='canvas'?{getContext:()=>({fillRect:(...args)=>rects.push(args),fillText:text=>labels.push(text)}),toDataURL:()=> 'data:image/png;base64,PNGDATA'}:tag==='a'?(link={click(){this.clicked=true;},remove(){}}):original(tag);
  await f.controller.download();assert.equal(link.download,'Presence-QR-2510004-1.png');assert.equal(link.clicked,true);
  assert.ok(labels.includes('Test Student'));assert.ok(labels.includes('2510004-1'));assert.ok(labels.some(text=>text.startsWith('Expires:')));assert.ok(rects.length>10);
  assert.deepEqual(f.calls[1].body,{download:true});
  f.controller.close();await f.controller.open();assert.equal(f.calls.length,2,'reopening must not renew a still-valid code');
  f.controller.dispose();assert.equal(f.intervals.size,0);
});


test('visible QR automatically renews on expiry and never downloads an expired code', async()=>{
  const f=await browserFixture(false), originalNow=Date.now;let clock=originalNow(), requests=0;
  Date.now=()=>clock;f.window.qrcode=require('qrcode-generator');
  f.controller.api.call=async()=>{requests++;return {token:'token-'+requests,student:{name:'Test Student',studentId:'123'},serverNow:clock,expiresAt:clock+1800000};};
  try {
    await f.controller.open();const data=f.controller.downloadData;
    clock+=1800000;
    await f.controller.download();assert.equal(f.controller.downloading,undefined);
    assert.match(f.controller.field('[data-qr-status]').textContent,/expired/);
    [...f.intervals.values()][0]();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(requests,2);assert.notEqual(f.controller.downloadData,data);
    assert.match(f.controller.field('[data-qr-countdown]').textContent,/30:00/);
    f.controller.close();assert.equal(f.intervals.size,0);
  } finally {Date.now=originalNow;f.controller.dispose();}
});

test('full-page refresh preserves QR and remaining lifetime only for the same login session', async()=>{
  const originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;
  const values=new Map(), storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const setup=async(session)=>{
    const f=await browserFixture(false);f.window.sessionStorage=storage;f.window.qrcode=require('qrcode-generator');
    f.controller.getUser=()=>({uid:'student',getIdTokenResult:async()=>({claims:{presenceSession:session,presenceAuthTime:123}})});
    f.controller.api.call=async()=>{f.calls.push('issue');return {token:'token-'+clock,student:{name:'Test Student',studentId:'123'},serverNow:clock,expiresAt:clock+1800000};};
    return f;
  };
  let first,refreshed,transferred,expired;
  try {
    first=await setup('session-a');await first.controller.open();const token=first.controller.cachedQr.result.token;
    first.controller.dispose();clock+=300000;
    refreshed=await setup('session-a');await refreshed.controller.open();
    assert.equal(refreshed.calls.length,0,'reload must not issue another QR');
    assert.equal(refreshed.controller.cachedQr.result.token,token);
    assert.equal(refreshed.controller.field('[data-qr-countdown]').textContent,'New QR in 25:00');
    refreshed.controller.dispose();
    transferred=await setup('session-b');await transferred.controller.open();
    assert.equal(transferred.calls.length,1,'new login session must not reuse the previous QR');
    transferred.controller.dispose();clock+=1800001;
    expired=await setup('session-b');await expired.controller.open();assert.equal(expired.calls.length,1);
    expired.controller.onSigningOut();assert.equal(values.size,0);assert.equal(expired.controller.dialog,null);
  } finally {Date.now=originalNow;for(const f of [first,refreshed,transferred,expired])f?.controller.dispose();}
});

test('Android QR download confirms gallery saves and reports native failures without false success',async()=>{
  const f=await browserFixture(false);f.window.qrcode=require('qrcode-generator');
  f.controller.api.call=async()=>{const now=Date.now();return {token:'gallery-test',student:{name:'Test Student',studentId:'123'},serverNow:now,expiresAt:now+1800000};};
  await f.controller.open();const original=f.document.createElement;
  f.document.createElement=tag=>tag==='canvas'?{getContext:()=>({fillRect(){},fillText(){}}),toDataURL:()=> 'data:image/png;base64,PNGDATA'}:original(tag);
  let saved;
  f.window.PresenceNative={isNative:true,attendanceQrImage:{save:async input=>{saved=input;return {saved:true,album:'Pictures/Presence'};}}};
  await f.controller.download();assert.equal(saved.base64,'PNGDATA');assert.match(f.notifications.at(-1)[1],/Photos \/ Gallery.*Pictures\/Presence/);
  f.window.PresenceNative.attendanceQrImage.save=async()=>{throw Error('Storage unavailable');};
  await f.controller.download();assert.deepEqual(f.notifications.at(-1),['QR download unavailable','Storage unavailable']);
  assert.equal(f.controller.field('[data-qr-download]').disabled,false);f.controller.dispose();
});

test('downloadable identity QR survives logout and a new login until its exact original expiry', async()=>{
  const f=await fixture(), qr=await f.service.issue(f.student,{});
  const {DeviceSessionService}=await import('../workers/admin-api/src/device-session.js');
  await new DeviceSessionService(f.db,()=>qr.serverNow).release(f.student);
  assert.equal(f.store.get('accountSessions/student').sessionId,null);
  await assert.rejects(f.service.issue(f.student,{}),/Sign in again/,'logged-out students cannot issue codes');
  const view=await f.preview(qr.token);assert.ok(view.confirmation,'saved QR works after logout');
  f.store.set('accountSessions/student',{sessionId:'new-login-session'});
  const newer=await f.service.issue({...f.student,presenceSession:'new-login-session'},{});
  assert.notEqual(newer.token,qr.token);
  f.advance(1799999);
  const last=await f.preview(qr.token);assert.equal(last.expiresAt,qr.expiresAt);
  assert.equal((await f.confirm(last.confirmation)).saved,true);
  f.advance(1);await assert.rejects(f.preview(qr.token),/expired/);
  await assert.rejects(f.confirm(last.confirmation),/expired/);
});

test('student logout between QR preview and confirmation does not end its validity; scanner logout still blocks saving',async()=>{
  const f=await fixture(),qr=await f.service.issue(f.student,{}),preview=await f.preview(qr.token);
  f.store.get('accountSessions/student').sessionId=null;
  assert.equal((await f.confirm(preview.confirmation)).saved,true);
  const g=await fixture(),other=await g.service.issue(g.student,{}),pending=await g.preview(other.token);
  g.store.get('accountSessions/student').sessionId=null;g.store.get('accountSessions/admin').sessionId=null;
  await assert.rejects(g.confirm(pending.confirmation),/session|Sign in/i);
  assert.equal(g.store.has('attendance/student_morning'),false);
});

test('logged-out identity QR still rejects disabled/reset accounts, ineligible students and closed attendance windows',async()=>{
  for(const change of ['disabled','inactive','password','revoked-token','roster','closed']){
    const f=await fixture(),qr=await f.service.issue(f.student,{});
    f.store.get('accountSessions/student').sessionId=null;
    if(change==='disabled')f.users.get('student').disabled=true;
    if(change==='inactive')f.store.get('students/student').active=false;
    if(change==='password')f.store.get('students/student').passwordResetRequired=true;
    if(change==='revoked-token')f.users.get('student').validSince=String(f.student.auth_time+1);
    if(change==='roster')f.store.get('events/morning').attendanceRoster={other:'2A'};
    if(change==='closed')f.store.get('events/morning').checkOutClosesAt=new Date(qr.serverNow-1);
    await assert.rejects(f.preview(qr.token),undefined,change);
    assert.equal(f.store.has('attendance/student_morning'),false,change);
  }
});


test('downloads have a separate 15-minute lifetime from issue, survive logout and outlast the screen code',async()=>{
  const f=await fixture(),screen=await f.service.issue(f.student,{});
  assert.equal(screen.expiresAt-screen.serverNow,1800000);
  f.advance(20*60000);
  const download=await f.service.issue(f.student,{download:true});
  assert.equal(download.expiresAt-download.serverNow,900000);
  assert.notEqual(download.token,screen.token);
  assert.equal((await f.service.open(download.token,'student')).scope,'download');
  f.store.get('accountSessions/student').sessionId=null;
  await assert.rejects(f.service.issue(f.student,{download:true}),/Sign in again/);
  f.advance(10*60000);
  await assert.rejects(f.preview(screen.token),/expired/);
  assert.ok((await f.preview(download.token)).confirmation);
  f.advance(5*60000-1);const preview=await f.preview(download.token);
  assert.equal(preview.expiresAt,download.expiresAt);
  f.advance(1);
  await assert.rejects(f.preview(download.token),/expired/);
  await assert.rejects(f.confirm(preview.confirmation),/expired/);
  assert.equal(f.store.has('attendance/student_morning'),false);
});

test('download lifetime is enforced on signed tokens and nested confirmations',async()=>{
  const f=await fixture(),download=await f.service.issue(f.student,{download:true});
  const payload=await f.service.open(download.token,'student');
  const extended={...payload,exp:payload.iat+1800000};
  await assert.rejects(f.preview(await f.service.seal(extended)),/invalid/);
  f.advance(900000);
  const confirmation=await f.service.seal({kind:'confirmation',actor:'admin',qr:extended,eventId:'morning',action:'in',iat:download.serverNow+900000,exp:download.serverNow+1020000});
  await assert.rejects(f.confirm(confirmation),/expired/);
  await assert.rejects(f.service.issue(f.student,{download:true,eventId:'morning'}));
  await assert.rejects(f.service.issue(f.student,{download:'true'}));
});

test('download encodes a separate token and expiry without resetting the screen timer or cache',async()=>{
  const originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;
  const f=await browserFixture(false),encoded=[],labels=[],makeQr=require('qrcode-generator');
  f.window.qrcode=(...args)=>{const code=makeQr(...args),add=code.addData;code.addData=value=>{encoded.push(value);add.call(code,value);};return code;};
  f.controller.api.call=async(route,user,body)=>{f.calls.push(body);return {token:body.download?'download-only-token':'screen-only-token',student:{name:'Test Student',studentId:'123'},serverNow:clock,expiresAt:clock+(body.download?900000:1800000)};};
  const original=f.document.createElement;
  f.document.createElement=tag=>tag==='canvas'?{getContext:()=>({fillRect(){},fillText:text=>labels.push(text)}),toDataURL:()=> 'data:image/png;base64,PNGDATA'}:tag==='a'?{click(){},remove(){}}:original(tag);
  try{
    await f.controller.open();const cache=f.controller.cachedQr,displayed=f.controller.downloadData;
    clock+=20*60000;[...f.intervals.values()][0]();
    const countdown=f.controller.field('[data-qr-countdown]').textContent,svg=f.controller.field('[data-qr-code]').innerHTML;
    assert.equal(countdown,'New QR in 10:00');
    await f.controller.download();
    assert.deepEqual(f.calls,[{},{download:true}]);
    assert.deepEqual(encoded,['screen-only-token','download-only-token']);
    assert.equal(f.controller.cachedQr,cache);assert.equal(f.controller.downloadData,displayed);
    assert.equal(f.controller.field('[data-qr-code]').innerHTML,svg);
    assert.equal(f.controller.field('[data-qr-countdown]').textContent,countdown);
    assert.equal(f.intervals.size,1);
    assert.ok(labels.includes('Expires: '+new Date(clock+900000).toLocaleString('en-PH',{timeZone:'Asia/Manila'})+' (PH)'));
    f.controller.api.call=async()=>{throw Error('Connection lost');};
    await f.controller.download();assert.deepEqual(f.notifications.at(-1),['QR download unavailable','Connection lost']);
    assert.equal(f.controller.cachedQr,cache);
  }finally{Date.now=originalNow;f.controller.dispose();}
});


test('Retry explicitly issues a fresh QR, shows loading and keeps normal refresh cached',async()=>{
  const originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;
  const f=await browserFixture(false);f.window.qrcode=require('qrcode-generator');
  let release,requests=0;
  f.controller.api.call=async()=>{requests++;if(requests===2)await new Promise(resolve=>{release=resolve;});return {token:'retry-token-'+requests,student:{name:'Test Student',studentId:'123'},serverNow:clock,expiresAt:clock+1800000};};
  try{
    await f.controller.open();const first=f.controller.cachedQr.result.token;clock+=60000;
    await f.controller.generate();assert.equal(requests,1);
    assert.equal(f.controller.field('[data-qr-countdown]').textContent,'New QR in 29:00');
    const button=f.controller.field('[data-qr-refresh]');button.onclick();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(button.disabled,true);assert.equal(button.textContent,'Loading…');
    button.onclick();assert.equal(requests,2,'repeated clicks cannot start parallel requests');
    release();await new Promise(resolve=>setImmediate(resolve));
    assert.notEqual(f.controller.cachedQr.result.token,first);
    assert.equal(f.controller.field('[data-qr-countdown]').textContent,'New QR in 30:00');
    assert.equal(button.disabled,false);assert.equal(button.textContent,'Retry');
    assert.equal(f.controller.field('[data-qr-status]').textContent,'New QR ready to scan.');
    assert.equal(f.intervals.size,1);
    f.controller.api.call=async()=>{throw Error('Wait one minute before generating another QR.');};
    button.onclick();await new Promise(resolve=>setImmediate(resolve));
    assert.match(f.controller.field('[data-qr-status]').textContent,/Wait one minute/);
    assert.equal(button.disabled,false);assert.equal(button.textContent,'Retry');
  }finally{Date.now=originalNow;f.controller.dispose();}
});


test('failed Retry preserves the visible QR, running countdown, download button and refresh cache',async()=>{
  const originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;
  const f=await browserFixture(false),values=new Map();f.window.qrcode=require('qrcode-generator');
  f.window.sessionStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  f.controller.getUser=()=>({uid:'student',getIdTokenResult:async()=>({claims:{presenceSession:'session-a',presenceAuthTime:123}})});
  f.controller.api.call=async()=>({token:'valid-qr',student:{name:'Student',studentId:'123'},serverNow:clock,expiresAt:clock+1800000});
  let reject;
  try{
    await f.controller.open();const data=f.controller.downloadData,cache=f.controller.cachedQr,stored=values.get('presence.attendanceQr.v2'),svg=f.controller.field('[data-qr-code]').innerHTML;
    f.controller.api.call=()=>new Promise((resolve,fail)=>{reject=fail;});
    const pending=f.controller.generate({force:true});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.controller.downloadData,data);assert.equal(f.controller.field('[data-qr-code]').innerHTML,svg);
    assert.equal(f.controller.field('[data-qr-download]').disabled,false);assert.equal(f.intervals.size,1);
    clock+=60000;[...f.intervals.values()][0]();assert.equal(f.controller.field('[data-qr-countdown]').textContent,'New QR in 29:00');
    reject(Error('Network unavailable'));await pending;
    assert.equal(f.controller.downloadData,data);assert.equal(f.controller.cachedQr,cache);assert.equal(values.get('presence.attendanceQr.v2'),stored);
    assert.equal(f.intervals.size,1);assert.match(f.controller.field('[data-qr-status]').textContent,/current QR is still valid/);
    assert.equal(f.controller.field('[data-qr-refresh]').disabled,false);
    f.controller.close();await f.controller.open();assert.equal(f.controller.cachedQr.result.token,'valid-qr');
    assert.equal(f.controller.field('[data-qr-countdown]').textContent,'New QR in 29:00');
  }finally{Date.now=originalNow;f.controller.dispose();}
});

test('a retained QR still expires normally while Retry is pending and cannot be downloaded after failure',async()=>{
  const originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;
  const f=await browserFixture(false);f.window.qrcode=require('qrcode-generator');
  f.controller.api.call=async()=>({token:'old-qr',student:{name:'Student',studentId:'123'},serverNow:clock,expiresAt:clock+1800000});
  let reject;
  try{
    await f.controller.open();f.controller.api.call=()=>new Promise((resolve,fail)=>{reject=fail;});
    const pending=f.controller.generate({force:true});await new Promise(resolve=>setImmediate(resolve));
    clock+=1800000;[...f.intervals.values()][0]();assert.equal(f.controller.downloadData,null);assert.equal(f.intervals.size,0);
    reject(Error('Request failed'));await pending;
    assert.equal(f.controller.downloadData,null);assert.equal(f.controller.field('[data-qr-download]').disabled,true);
    assert.doesNotMatch(f.controller.field('[data-qr-status]').textContent,/still valid/);
    await f.controller.download();assert.match(f.controller.field('[data-qr-status]').textContent,/expired/);
  }finally{Date.now=originalNow;f.controller.dispose();}
});
