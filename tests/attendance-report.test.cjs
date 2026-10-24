const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const stamp = value => ({ toDate: () => new Date(value) });
const event = { id: 'event-1', name: 'Campus assembly', date: '2026-10-17', timeIn: '08:00', timeOut: '17:00', audience: 'All students', location: 'Campus hall', attendanceRoster: { a: '2A', b: '2A', c: '2B' } };
const students = ['a', 'b', 'c'].map((uid, index) => ({ uid, accountId: `2026-${index}`, firstName: ['Ana', 'Ben', 'José'][index], lastName: ['Zulu', 'Bravo', 'Peña'][index], section: '3A', course: 'BSInfo Tech', birthday: 'SECRET-BIRTHDAY', password: 'SECRET-PASSWORD' }));
async function serviceAt(time = '2026-10-17T04:00:00Z') {
  const { AttendanceReportService } = await import('../assets/js/controllers/AttendanceReportService.js');
  const { AttendanceSummaryService } = await import('../assets/js/controllers/AttendanceSummaryService.js');
  const checkoutCloseDate = () => new Date('2026-10-17T09:00:00Z'), now = () => new Date(time);
  return new AttendanceReportService({ summary: new AttendanceSummaryService({ closeDate: checkoutCloseDate, checkoutCloseDate, now }), checkoutCloseDate, now });
}
const snapshot = (service, records = [], options = {}) => service.snapshot({ event, students, records, verifiedAt: new Date('2026-10-17T04:00:00Z'), ...options });
const checkIn = { id: 'r1', studentUid: 'a', eventId: event.id, checkedInAt: stamp('2026-10-17T00:01:00Z'), arrivalStatus: 'late', gps: 'SECRET-GPS' };

test('report follows arrival sort and puts missing check-ins first only when requested', async () => {
  const service = await serviceAt();
  const records = [checkIn, { id: 'r2', studentUid: 'b', eventId: event.id, checkedInAt: stamp('2026-10-17T00:02:00Z') }];
  assert.deepEqual(snapshot(service, records).rows.map(r => r.studentId), ['2026-1', '2026-0', '2026-2']);
  assert.deepEqual(snapshot(service, records, { filters: { sort: 'check-in-asc' } }).rows.map(r => r.studentId), ['2026-0', '2026-1', '2026-2']);
  const missing = snapshot(service, records, { filters: { sort: 'no-check-in' } });
  assert.deepEqual(missing.rows.map(r => r.studentId), ['2026-2', '2026-1', '2026-0']);
  assert.equal(missing.rows[0].status, 'pending');
  assert.equal('checkInMilliseconds' in missing.rows[0], false);
});

test('report filters the selected course including legacy course names and pending roster members', async () => {
  const service = await serviceAt();
  const mixed = students.map((student, i) => ({ ...student, course: ['BSInfo Tech', 'BSA', 'BSMB'][i] }));
  const report = snapshot(service, [], { students: mixed, filters: { course: 'BS Info Tech' } });
  assert.deepEqual(report.rows.map(row => row.studentId), ['2026-0']);
  assert.equal(report.totals.pending, 1); assert.equal(report.filters.course, 'BS Info Tech');
  assert.equal(report.filtered, true);
  assert.equal(snapshot(service, [], { students: mixed, filters: { course: 'BSFI' } }).rows.length, 0);
  assert.equal(snapshot(service, [], { students: mixed }).rows.length, 3);
});

test('live report moves pending to check-in to completed without premature absences', async () => {
  const service = await serviceAt();
  assert.deepEqual(snapshot(service).totals, { rows: 3, present: 0, late: 0, completed: 0, review: 0, absent: 0, pending: 3 });
  const checked = snapshot(service, [checkIn]);
  assert.equal(checked.totals.present, 1); assert.equal(checked.totals.late, 1); assert.equal(checked.totals.pending, 2);
  const completed = snapshot(service, [{ ...checkIn, checkedOutAt: stamp('2026-10-17T08:00:00Z') }]);
  assert.equal(completed.totals.completed, 1); assert.equal(completed.rows.find(row => row.studentId === '2026-0').section, '2A');
  assert.equal(completed.rows.find(row => row.studentId === '2026-0').course, 'BS Info Tech');
  assert.match(completed.rows[0].checkIn, /2026/);
  assert.doesNotMatch(JSON.stringify(completed), /SECRET-|birthday|password|gps/i);
});

test('checked-in report filter includes completed and review check-ins and excludes partial and absent records across sessions', async () => {
  const service=await serviceAt('2026-10-17T10:00:00Z');
  const records=[{...checkIn,checkedOutAt:stamp('2026-10-17T08:00:00Z')},
    {id:'legacy',studentUid:'b',eventId:event.id,attendedAt:stamp('2026-10-17T00:02:00Z')},
    {id:'partial',studentUid:'c',eventId:event.id,checkedOutAt:stamp('2026-10-17T08:00:00Z'),status:'checkout-only',arrivalStatus:'absent'}];
  const report=snapshot(service,records,{filters:{status:'checked-in'}});
  assert.deepEqual(report.rows.map(row=>row.studentId).sort(),['2026-0','2026-1']);
  assert.equal(report.totals.completed,1);assert.equal(report.totals.review,1);assert.equal(report.totals.present,2);
  assert.ok(report.rows.every(row=>!('hasCheckIn' in row)));
  const afternoon={...event,id:'event-2',sessionPeriod:'afternoon',sessionGroupId:event.id,sessionBaseName:'Assembly'};
  const combined=service.snapshotGroup({events:[{...event,sessionPeriod:'morning',sessionGroupId:event.id},afternoon],students,
    records:[...records,{...checkIn,id:'pm',eventId:afternoon.id}],filters:{status:'checked-in'},verifiedAt:new Date('2026-10-17T10:00:00Z')});
  assert.equal(combined.rows.length,3);assert.equal(combined.rows.filter(row=>row.sessionLabel==='Afternoon').length,1);
});
test('closed report distinguishes missed checkout, confirmed absence and unverified legacy roster', async () => {
  const service = await serviceAt('2026-10-17T10:00:00Z');
  const report = snapshot(service, [checkIn]);
  assert.equal(report.totals.review, 1); assert.equal(report.totals.present, 1); assert.equal(report.totals.absent, 2);
  const legacy = snapshot(service, [], { event: { ...event, attendanceRoster: undefined } });
  assert.equal(legacy.totals.absent, 0); assert.equal(legacy.totals.review, 3);
});
test('deleted roster profiles remain review rows in their historical section, never confirmed absences', async () => {
  const closed = await serviceAt('2026-10-17T10:00:00Z'), remaining = students.filter(student => student.uid !== 'c');
  for (const service of [closed, await serviceAt()]) {
    const report = snapshot(service, [], { students: remaining, filters: { section: '2B' } });
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].name, 'Deleted/missing student profile');
    assert.equal(report.rows[0].section, '2B');
    assert.equal(report.rows[0].status, 'review');
    assert.equal(report.rows[0].arrival, 'No check-in');
    assert.match(report.rows[0].completion, /profile missing/);
    assert.equal(report.totals.absent, 0); assert.equal(report.totals.pending, 0); assert.equal(report.totals.review, 1);
    assert.equal(snapshot(service, [], { students: remaining, filters: { status: 'absent', section: '2B' } }).rows.length, 0);
    assert.equal(snapshot(service, [], { students: remaining, filters: { status: 'review', section: '2B' } }).rows.length, 1);
  }
  const restored = snapshot(closed, [], { filters: { section: '2B' } });
  assert.equal(restored.totals.absent, 1); assert.equal(restored.totals.review, 0);
  assert.equal(event.attendanceRoster.c, '2B');
});
test('missing profiles with saved attendance retain identity snapshots and timestamps for review', async () => {
  const report = snapshot(await serviceAt('2026-10-17T10:00:00Z'), [{ ...checkIn, studentId: 'SAVED-ID', studentName: 'Saved name', checkedOutAt: stamp('2026-10-17T08:00:00Z') }], { students: students.filter(student => student.uid !== 'a'), filters: { status: 'review' } });
  assert.equal(report.rows.length, 1); assert.equal(report.rows[0].studentId, 'SAVED-ID'); assert.equal(report.rows[0].name, 'Saved name');
  assert.notEqual(report.rows[0].checkIn, 'Not recorded'); assert.notEqual(report.rows[0].checkOut, 'Not recorded');
  assert.equal(report.totals.present, 1); assert.equal(report.totals.review, 1); assert.equal(report.totals.absent, 0);
});
test('projection preserves missing-profile roster entries under review and excludes them from absence filter', async () => {
  const { AttendanceRecordProjectionService } = await import('../assets/js/controllers/AttendanceRecordProjectionService.js');
  const projection = new AttendanceRecordProjectionService({ getEvents: () => [event], getStudents: () => students.filter(student => student.uid !== 'c'), checkoutCloseDate: () => new Date(1000), now: () => new Date(2000) });
  const review = projection.project([], { status: 'review', section: '2B' });
  assert.equal(review.length, 1); assert.equal(review[0].profileMissing, true); assert.equal(review[0].status, 'review'); assert.equal(review[0].rosterSection, '2B');
  assert.equal(projection.project([], { status: 'absent', section: '2B' }).length, 0);
  assert.equal(projection.project([], { status: 'completed' }).length, 0);
  const saved = { studentUid: 'c', eventId: event.id, checkedInAt: stamp('2026-10-17T00:00:00Z') };
  assert.equal(projection.project([saved]).filter(record => record.studentUid === 'c').length, 1);
});
test('no-check-in view can include pending roster rows without inventing absences or duplicating arrivals', async () => {
  const { AttendanceRecordProjectionService } = await import('../assets/js/controllers/AttendanceRecordProjectionService.js');
  const projection = new AttendanceRecordProjectionService({ getEvents: () => [event], getStudents: () => students,
    checkoutCloseDate: () => new Date('2026-10-17T09:00:00Z'), now: () => new Date('2026-10-17T04:00:00Z') });
  assert.equal(projection.project([checkIn]).length, 1);
  const rows = projection.project([checkIn], { includePending: true });
  assert.equal(rows.length, 3);
  for (const row of rows.filter(r => r.displayOnly)) {
    assert.equal(row.pending, true); assert.equal(row.status, 'pending'); assert.equal(row.checkedInAt, undefined);
  }
  assert.equal(projection.project([checkIn], { includePending: true, status: 'absent' }).length, 1);
  assert.equal(projection.project([], { includePending: true, section: '2B' }).length, 1);
  assert.equal(projection.project([], { includePending: true, search: 'nobody' }).length, 0);
  assert.equal(projection.project([], { includePending: true, course: 'BS Info Tech' }).length, 3);
  assert.equal(projection.project([], { includePending: true, course: 'BSA' }).length, 0);
});

test('report consolidates duplicate schedules and respects correction, section, status and name sorting', async () => {
  const service = await serviceAt();
  assert.deepEqual(service.eventIds(event, [event, { ...event, id: 'old-event' }, { ...event, id: 'other', date: '2026-10-18' }]), ['event-1', 'old-event']);
  const records = [checkIn, { ...checkIn, id: 'r2', eventId: 'old-event', checkedOutAt: stamp('2026-10-17T08:00:00Z'), correctedAt: stamp('2026-10-17T08:01:00Z'), recordSource: 'admin-corrected' }];
  const report = snapshot(service, records, { filters: { section: '2A', status: 'completed', search: 'ana', sort: 'last-name-desc' } });
  assert.equal(report.rows.length, 1); assert.equal(report.rows[0].corrected, true); assert.equal(report.totals.completed, 1);
  assert.match(report.note, /1 duplicate/);
  assert.equal(snapshot(service, records, { filters: { section: '2B', status: 'late' } }).rows.length, 0);
});
test('report covers more than the attendance UI page and refuses oversized/invalid data', async () => {
  const service = await serviceAt();
  const many = Array.from({ length: 123 }, (_, i) => ({ ...students[0], uid: `s${i}`, accountId: `ID${i}` }));
  const report = snapshot(service, [], { event: { ...event, attendanceRoster: undefined }, students: many });
  assert.equal(report.rows.length, 123);
  assert.throws(() => snapshot(service, [], { event: { ...event, name: 'x'.repeat(513) } }), /512/);
  assert.throws(() => snapshot(service, [], { event: { ...event, attendanceRoster: undefined }, students: Array.from({ length: 5001 }, (_, i) => ({ ...many[0], uid: String(i) })) }), /5,000/);
});

async function isolated(relative, sdk = {}) {
  const context = vm.createContext({ console, Date, setTimeout, clearTimeout, Uint8Array, ArrayBuffer, URL, Blob, btoa });
  const modules = new Map();
  const remote = new vm.SyntheticModule(['collection', 'doc', 'query', 'where', 'limit', 'onSnapshot'], function () {
    for (const key of ['collection', 'doc', 'query', 'where', 'limit', 'onSnapshot']) this.setExport(key, sdk[key] || ((...args) => ({ kind: key, args })));
  }, { context });
  async function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const module = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename, initializeImportMeta: meta => { meta.url = pathToFileURL(filename).href; } });
    modules.set(filename, module);
    await module.link((specifier, parent) => specifier.startsWith('https:') ? remote : load(path.resolve(path.dirname(parent.identifier), specifier)));
    return module;
  }
  const module = await load(path.join(root, relative)); await module.evaluate(); return module.namespace;
}
test('combined repository verifies both sessions, keeps duplicate-student records separate and cleans all listeners', async () => {
  const callbacks=[];let stopped=0;
  const {AttendanceReportRepository}=await isolated('assets/js/controllers/AttendanceReportRepository.js',{onSnapshot:(ref,options,receive)=>{callbacks.push(receive);return ()=>{stopped++;};}});
  const updates=[],repository=new AttendanceReportRepository({});
  const stop=repository.watchSessions([{id:'morning'},{id:'afternoon'}],event=>[event.id],update=>updates.push(update),()=>{});
  const meta={fromCache:false,hasPendingWrites:false};
  callbacks[0]({exists:()=>true,id:'morning',data:()=>({name:'Morning'}),metadata:meta});
  assert.equal(updates.at(-1).verified,false);
  callbacks[1]({docs:[{id:'a_m',data:()=>({studentUid:'a',eventId:'morning'})}],metadata:meta});assert.equal(updates.at(-1).verified,false);
  callbacks[2]({exists:()=>true,id:'afternoon',data:()=>({name:'Afternoon'}),metadata:meta});assert.equal(updates.at(-1).verified,true);
  callbacks[3]({docs:[{id:'a_a',data:()=>({studentUid:'a',eventId:'afternoon'})}],metadata:meta});
  assert.equal(updates.at(-1).verified,true);assert.equal(updates.at(-1).records.length,2);
  assert.deepEqual(Array.from(updates.at(-1).records,r=>r.reportSessionId),['morning','afternoon']);
  callbacks[3]({docs:[],metadata:{...meta,fromCache:true}});assert.equal(updates.at(-1).verified,false);
  stop();assert.equal(stopped,4);
});

test('report repository watches full event scope, verifies metadata, caps overflow and cleans up', async () => {
  const watches = []; let stopped = 0;
  const { AttendanceReportRepository } = await isolated('assets/js/controllers/AttendanceReportRepository.js', { onSnapshot: (reference, options, receive, fail) => { watches.push({ reference, options, receive, fail }); return () => stopped++; } });
  const updates = [], repository = new AttendanceReportRepository({});
  const stop = repository.watch(event.id, [event.id, 'old-event'], update => updates.push(update), () => {});
  assert.equal(watches.length, 2); assert.match(JSON.stringify(watches[1].reference), /5001/); assert.match(JSON.stringify(watches[1].reference), /old-event/);
  watches[0].receive({ exists: () => true, id: event.id, data: () => event, metadata: { fromCache: true, hasPendingWrites: false } });
  assert.equal(updates.at(-1).verified, false);
  watches[1].receive({ docs: [], metadata: { fromCache: false, hasPendingWrites: true } }); assert.equal(updates.at(-1).verified, false);
  watches[1].receive({ docs: Array.from({ length: 5001 }, (_, i) => ({ id: String(i), data: () => ({}) })), metadata: { fromCache: false, hasPendingWrites: false } });
  assert.equal(updates.at(-1).oversized, true); assert.equal(updates.at(-1).verified, true);
  stop(); assert.equal(stopped, 2);
  assert.throws(() => repository.watch(event.id, Array(31).fill('id'), () => {}, () => {}), /duplicate/);
});

function element() {
  const nodes = new Map(), listeners = new Map();
  return { children: [], dataset: {}, open: false, disabled: false, setAttribute() {}, focus() {}, remove() {},
    append(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
    addEventListener(type, callback) { listeners.set(type, callback); }, removeEventListener(type) { listeners.delete(type); },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    showModal() { this.open = true; }, close() { this.open = false; }, dispatch(type, value) { listeners.get(type)?.(value); }
  };
}
test('report controller blocks stale/offline export, freezes full snapshot and disposes late callbacks', async () => {
  const { AttendanceReportController } = await isolated('assets/js/controllers/AttendanceReportController.js');
  const document = element(); document.body = element(); document.createElement = element;
  const window = element(); Object.assign(window, { setInterval: () => 1, clearInterval() {}, setTimeout: () => 2, clearTimeout() {} });
  let receive, stopped = 0, online = true, allowed = true, generated, finish, delivered = 0;
  const service = await serviceAt(), context = { filters: { event: event.id }, events: [event], students, studentsReady: true };
  const controller = new AttendanceReportController({ document, window, can: () => allowed, context: () => context, online: () => online, service,
    repository: { watch: (_id, _ids, callback) => { receive = callback; return () => stopped++; } }, notify() {},
    exporter: { generate: report => { generated = report; return new Promise(resolve => { finish = resolve; }); } }, files: { native: () => null, deliver: async () => { delivered++; return { started: true }; } } });
  controller.initialize(); controller.open();
  receive({ kind: 'event', event, exists: true, verified: true });
  receive({ kind: 'attendance', records: [], verified: false }); assert.equal(controller.valid, false);
  receive({ kind: 'attendance', records: [], verified: true }); assert.equal(controller.valid, true);
  online = false; controller.render(); assert.equal(controller.valid, false); await controller.export('save'); assert.equal(generated, undefined);
  online = true; controller.render(); const exporting = controller.export('save');
  await controller.export('save');
  receive({ kind: 'attendance', records: [checkIn], verified: true });
  assert.equal(generated.totals.present, 0); assert.equal(controller.report.totals.present, 1);
  finish(new Uint8Array([1])); await exporting; assert.equal(delivered, 1);
  allowed = false; controller.refreshContext(); assert.equal(controller.active, false); assert.equal(stopped, 1);
  receive({ kind: 'attendance', records: [checkIn], verified: true }); assert.equal(controller.records.length, 0);
  controller.dispose();
});
test('native PDF handoff uses save/share bridge, respects cancellation and rejects oversized files', async () => {
  const { AttendanceReportFileService } = await import('../assets/js/controllers/AttendanceReportFileService.js');
  const calls = [], files = new AttendanceReportFileService({ native: () => ({ isNative: true, attendancePdf: { save: async value => { calls.push(value); return { cancelled: true }; }, share: async value => { calls.push(value); return { started: true }; } } }) });
  const bytes = new TextEncoder().encode('%PDF-test');
  assert.equal((await files.deliver(bytes, 'test.pdf')).cancelled, true);
  assert.equal((await files.deliver(bytes, 'test.pdf', 'share')).started, true);
  assert.equal(Buffer.from(calls[0].base64, 'base64').toString(), '%PDF-test');
  await assert.rejects(files.deliver(new Uint8Array(10 * 1024 * 1024 + 1), 'test.pdf'), /10 MB/);
});
test('PDF footer includes all four schedule times instead of the old snapshot/timezone text', async () => {
  const { AttendancePdfExporter } = await import('../assets/js/controllers/AttendancePdfExporter.js');
  const service = await serviceAt();
  const report = snapshot(service, [], { event: { ...event, timeIn: '07:10', checkInCutoff: '07:30', timeOut: '11:10', checkOutCutoff: '11:25' } });
  const exporter = new AttendancePdfExporter();
  assert.equal(exporter.footer(report).join('\n'), 'Check-in time: 7:10 AM | Check-in cutoff: 7:30 AM\nCheck-out time: 11:10 AM | Check-out cutoff: 11:25 AM');
  const legacy = service.schedule(event);
  assert.equal(legacy.checkInCutoff, '5:00 PM'); assert.equal(legacy.checkOutCutoff, '5:00 PM');
  const timestamps = service.schedule({ ...event, openAt: stamp('2026-10-17T00:00:00Z'), lateAfterAt: stamp('2026-10-17T00:15:00Z'), closeAt: stamp('2026-10-17T04:00:00Z'), checkOutClosesAt: stamp('2026-10-17T04:15:00Z') });
  assert.deepEqual(timestamps, { checkIn: '8:00 AM', checkInCutoff: '8:15 AM', checkOut: '12:00 PM', checkOutCutoff: '12:15 PM' });
  assert.doesNotMatch(exporter.footer(report).join(' '), /Confidential attendance snapshot|Times: Asia\/Manila/);
});

test('PDF header uses readable Philippine dates, hides unused filters and keeps totals and useful warnings', async () => {
  const { AttendancePdfExporter } = await import('../assets/js/controllers/AttendancePdfExporter.js');
  const exporter = new AttendancePdfExporter(), report = snapshot(await serviceAt());
  const header = exporter.header(report);
  assert.equal(header.filters, 'Session: Morning'); assert.match(header.schedule, /Oct 17, 2026/);
  assert.match(header.exported, /12:00 PM/); assert.match(header.exported, /PH time/);
  assert.doesNotMatch(JSON.stringify(header), /name-asc|Search: None|T04:00|0 duplicate|Server verified|Asia\/Manila/);
  assert.match(header.totals, /Students: 3/); assert.match(header.breakdown, /Pending: 3/); assert.match(header.note, /ongoing/);
  const filtered = exporter.header({ ...report, closed: true, duplicateCount: 2, filters: { section: '2B', status: 'review', search: 'ana', sort: 'last-name-desc' } });
  assert.equal(filtered.filters, 'Section: 2B | Status: Needs review | Search: ana'); assert.match(filtered.note, /2 duplicate/); assert.match(filtered.note, /Event closed/);
});

test('actual PDF generator produces multiple pages, local embedded Unicode font and rejects unsupported glyphs', async () => {
  const { AttendancePdfExporter } = await import('../assets/js/controllers/AttendancePdfExporter.js');
  const library = file => { const module = { exports: {} }; new Function('module', 'exports', fs.readFileSync(path.join(root, 'assets/vendor', file), 'utf8'))(module, module.exports); return module.exports; };
  const runtime = { PDFLib: library('pdf-lib.min.js'), fontkit: library('fontkit.umd.min.js') };
  const assets = { load: async () => ({ pdf: runtime.PDFLib, fontkit: runtime.fontkit, font: new Uint8Array(fs.readFileSync(path.join(root, 'assets/fonts/NotoSans-Regular.ttf'))), logo: new Uint8Array(fs.readFileSync(path.join(root, 'assets/images/presence-logo.png'))) }) };
  const exporter = new AttendancePdfExporter({ assets }), report = snapshot(await serviceAt(), [checkIn]);
  report.rows = Array.from({ length: 90 }, (_, i) => ({ ...report.rows[0], name: `José Peña ${i} - A long student name that wraps safely`, studentId: `ID-${i}` })); report.totals.rows = 90;
  const bytes = await exporter.generate(report), pdf = await runtime.PDFLib.PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 2); assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  for (const page of pdf.getPages()) {
    assert.equal(page.getWidth(), 595.28);
    assert.equal(page.getHeight(), 841.89);
  }
  assert.ok(bytes.length < 10 * 1024 * 1024);
  await assert.rejects(exporter.generate({ ...report, rows: [{ ...report.rows[0], name: 'Unsupported 🦄' }] }), /cannot display/);
});

function excelParts(bytes) {
  const buffer = Buffer.from(bytes), parts = new Map(); let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), nameSize = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameSize), start = offset + 30 + nameSize + extra;
    assert.equal(buffer.readUInt16LE(offset + 8), 0, 'Stored ZIP entries are independently readable');
    const crc = require('node:zlib').crc32;
    if (crc) assert.equal(crc(buffer.subarray(start, start + size)), buffer.readUInt32LE(offset + 14));
    parts.set(name, buffer.toString('utf8', start, start + size)); offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50);
  assert.equal(buffer.readUInt16LE(buffer.length - 12), parts.size);
  assert.equal(buffer.readUInt32LE(buffer.length - 6), offset);
  return parts;
}
test('Excel is a real XLSX with typed Philippine dates, text IDs and no private profile fields', async () => {
  const { AttendanceExcelExporter } = await import('../assets/js/controllers/AttendanceExcelExporter.js');
  const report = snapshot(await serviceAt(), [{ ...checkIn, checkedOutAt: stamp('2026-10-17T01:05:00Z'), status: 'completed' }]);
  const record = report.rows.find(row => row.studentId === '2026-0');
  assert.equal(record.checkInIso, '2026-10-17T00:01:00.000Z');
  assert.equal(record.checkOutIso, '2026-10-17T01:05:00.000Z');
  record.studentId = '0000123-4'; record.password = 'MUST-NOT-EXPORT'; record.uid = 'INTERNAL-UID';
  const parts = excelParts(await new AttendanceExcelExporter().generate(report));
  assert.match(parts.get('[Content_Types].xml'), /spreadsheetml.sheet.main\+xml/);
  assert.match(parts.get('xl/workbook.xml'), /name="Summary"/);
  assert.match(parts.get('xl/workbook.xml'), /name="Attendance"/);
  const worksheet = parts.get('xl/worksheets/sheet2.xml');
  assert.match(worksheet, /t="inlineStr"><is><t xml:space="preserve">0000123-4/);
  assert.match(worksheet, /Year level/); assert.match(worksheet, /state="frozen"/); assert.match(worksheet, /autoFilter/);
  const serial = +worksheet.match(/<c r="I\d+" s="2"><v>([^<]+)<\/v>/)[1];
  assert.equal(new Date(Math.round((serial - 25569) * 86400000)).toISOString(), '2026-10-17T08:01:00.000Z');
  assert.doesNotMatch([...parts.values()].join(''), /SECRET-|MUST-NOT-EXPORT|INTERNAL-UID|studentUid|authEmail/);
});
test('Excel exports all matching rows, literal formula-like text, Unicode and unknown year without guessing', async () => {
  const { AttendanceExcelExporter } = await import('../assets/js/controllers/AttendanceExcelExporter.js');
  const report = snapshot(await serviceAt(), [checkIn]);
  report.rows = Array.from({ length: 80 }, (_, i) => ({ ...report.rows[0], studentId: `000${i}`, name: '=HYPERLINK("https://example.test","José <Peña> 🦄")', course: 'BS Info Tech', section: i ? '2B' : 'Unknown' }));
  report.totals.rows = 80;
  const parts = excelParts(await new AttendanceExcelExporter().generate(report)), xml = parts.get('xl/worksheets/sheet2.xml');
  assert.equal((xml.match(/<row /g) || []).length, 81);
  assert.match(xml, /=HYPERLINK\(&quot;https:\/\/example.test/); assert.match(xml, /José &lt;Peña&gt; 🦄/);
  assert.doesNotMatch(xml, /<f[ >]|<hyperlink[ >]/);
  assert.match(xml, /<c r="D2" s="0" t="inlineStr"><is><t xml:space="preserve"><\/t>/);
  assert.match(xml, /<c r="D3" s="0" t="inlineStr"><is><t xml:space="preserve">2/);
  await assert.rejects(new AttendanceExcelExporter().generate({ ...report, rows: Array(5001).fill(report.rows[0]) }), /5,000/);
});
test('Excel both-session workbook separates morning/afternoon and preserves the filtered roster', async () => {
  const { AttendanceExcelExporter } = await import('../assets/js/controllers/AttendanceExcelExporter.js');
  const report = snapshot(await serviceAt(), [checkIn], { filters: { course: 'BS Info Tech', section: '2A' } });
  report.filters.session = 'Both sessions';
  report.rows = [{ ...report.rows[0], name: 'Morning student', sessionLabel: 'Morning' }, { ...report.rows[0], name: 'Afternoon student', sessionLabel: 'Afternoon' }];
  const parts = excelParts(await new AttendanceExcelExporter().generate(report));
  assert.match(parts.get('xl/workbook.xml'), /name="Morning"/); assert.match(parts.get('xl/workbook.xml'), /name="Afternoon"/);
  assert.match(parts.get('xl/worksheets/sheet2.xml'), /Morning student/); assert.doesNotMatch(parts.get('xl/worksheets/sheet2.xml'), /Afternoon student/);
  assert.match(parts.get('xl/worksheets/sheet3.xml'), /Afternoon student/);
  assert.match(parts.get('xl/worksheets/sheet1.xml'), /BS Info Tech/);
});
test('Excel export is server-gated, snapshot-frozen, and shares a duplicate-submit lock with PDF', async () => {
  const { AttendanceReportController } = await isolated('assets/js/controllers/AttendanceReportController.js');
  const document = element(); document.body = element(); document.createElement = element;
  const window = element(); Object.assign(window, { setInterval: () => 1, clearInterval() {}, setTimeout: () => 2, clearTimeout() {} });
  let receive, online = true, allowed = true, captured, finish, delivered = 0;
  const service = await serviceAt(), context = { filters: { event: event.id }, events: [event], students, studentsReady: true };
  const controller = new AttendanceReportController({ document, window, can: () => allowed, context: () => context, online: () => online, service,
    repository: { watch: (_id, _ids, callback) => { receive = callback; return () => {}; } }, notify() {},
    excelExporter: { generate: report => { captured = report; return new Promise(resolve => { finish = resolve; }); } },
    excelFiles: { deliver: async (_bytes, filename) => { delivered++; assert.match(filename, /\.xlsx$/); return { started: true }; } } });
  controller.initialize(); controller.open(); await controller.exportExcel(); assert.equal(captured, undefined);
  receive({ kind: 'event', event, exists: true, verified: true }); receive({ kind: 'attendance', records: [], verified: true });
  online = false; await controller.exportExcel(); assert.equal(captured, undefined); online = true;
  const saving = controller.exportExcel(); await controller.exportExcel(); await controller.export('save');
  receive({ kind: 'attendance', records: [checkIn], verified: true });
  assert.equal(captured.totals.present, 0); assert.equal(controller.report.totals.present, 1);
  finish(new Uint8Array([80, 75, 3, 4])); await saving; assert.equal(delivered, 1);
  const stopped = controller.exportExcel(); controller.close(); finish(new Uint8Array([1])); await stopped; assert.equal(delivered, 1);
  allowed = false; await controller.exportExcel(); assert.equal(delivered, 1); controller.dispose();
});
test('Excel Android delivery uses a separate save bridge and safely rejects old APKs and invalid files', async () => {
  const { AttendanceExcelFileService } = await import('../assets/js/controllers/AttendanceExcelFileService.js');
  let saved;
  const files = new AttendanceExcelFileService({ native: () => ({ isNative: true, attendanceSpreadsheet: { save: async value => { saved = value; return { cancelled: true }; } } }) });
  assert.equal((await files.deliver(new Uint8Array([80, 75, 3, 4]), 'report.xlsx')).cancelled, true);
  assert.equal(saved.filename, 'report.xlsx'); assert.equal(Buffer.from(saved.base64, 'base64').toString('hex'), '504b0304');
  await assert.rejects(files.deliver(new Uint8Array(10 * 1024 * 1024 + 1), 'report.xlsx'), /10 MB/);
  await assert.rejects(files.deliver(new Uint8Array(4), '../report.xlsx'), /Invalid/);
  const oldApk = new AttendanceExcelFileService({ native: () => ({ isNative: true }) });
  await assert.rejects(oldApk.deliver(new Uint8Array(4), 'report.xlsx'), /Update the Presence APK/);
});
