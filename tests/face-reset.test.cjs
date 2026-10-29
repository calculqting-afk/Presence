const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const response = (status, data = {}) => ({ getResponseCode: () => status, getContentText: () => JSON.stringify(data) });

test('Apps Script confirms a saved upload through the authenticated private Worker connection',()=>{
  const calls=[],secret='private-script-setting';
  const context=vm.createContext({console,PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='FACE_BACKEND_SECRET'?secret:null})},
    UrlFetchApp:{fetch:(url,options)=>{calls.push({url,options});return response(200,{registered:true});}}});
  vm.runInContext(fs.readFileSync(path.join(root,'docs/google-apps-script-face-upload.js'),'utf8'),context);
  const file={getId:()=> 'saved-photo-123456',getName:()=> 'Face.jpg'};
  context.createFaceRegistration_('student','student-token',file);
  assert.match(calls[0].url,/\/v1\/internal\/face-registration$/);
  assert.equal(calls[0].options.headers.Authorization,'Bearer student-token');
  assert.equal(calls[0].options.headers['X-Presence-Face-Secret'],secret);
  assert.deepEqual(JSON.parse(calls[0].options.payload),{fileId:file.getId(),fileName:file.getName()});
  context.UrlFetchApp.fetch=()=>response(503);assert.throws(()=>context.createFaceRegistration_('student','student-token',file),/confirmation failed/);
});

test('recovery modal places a labeled multiline reason below the confirmation option', () => {
  const html = fs.readFileSync(path.join(root, 'pages/admin-dashboard.html'), 'utf8');
  const block = html.split('id="faceMissingRecovery"')[1].split('<div class="modal-actions">')[0];
  assert.match(block, /class="face-recovery-box" hidden/);
  assert.match(block, /<textarea id="faceRecoveryReason" rows="3" maxlength="500"/);
  assert.match(block, /<label for="faceRecoveryReason">/);
  assert.ok(block.indexOf('id="recoverMissingFace"') < block.indexOf('id="faceRecoveryReason"'));
  assert.match(block, /aria-describedby="faceRecoveryReasonHelp"/);
});

function fixture() {
  const calls = [], trash = [];
  const context = vm.createContext({ console, UrlFetchApp: { fetch: (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.payload || '{}') }); return response(200);
  } }, Utilities: { getUuid: () => 'test-request-123456' } });
  vm.runInContext(fs.readFileSync(path.join(root, 'docs/google-apps-script-face-upload.js'), 'utf8'), context);
  const Service = vm.runInContext('FaceResetService', context);
  context.canResetFace_ = () => true;
  context.canRecoverMissingFace_ = () => true;
  context.getFaceRegistration_ = () => ({ fields: { driveFileId: { stringValue: 'photo' } }, updateTime: '2026-10-11T00:00:00Z' });
  context.firestoreRequest_ = (...args) => calls.push({ failure: args });
  const file = { ownedByMe: true, description: 'Presence face registration\nStudent UID: student',
    parents: ['folder'], trashed: false, capabilities: { canTrash: true } };
  const service = new Service({ requestDrive: () => response(200, file), trash: id => trash.push(id), findFiles: () => [], folderId: () => 'folder' });
  const payload = { studentUid: 'student', requestId: 'test-request-123456' };
  const actor = { localId: 'admin' };
  return { context, service, file, payload, actor, calls, trash };
}

test('face reset trashes a matching owned photo and atomically audits/deletes only the original registration', () => {
  const f = fixture();
  assert.equal(f.service.reset(f.payload, f.actor, 'token').outcome, 'trashed');
  assert.deepEqual(f.trash, ['photo']);
  const commit = f.calls[0];
  assert.match(commit.url, /documents:commit$/);
  assert.equal(commit.body.writes[0].update.fields.requesterUid.stringValue, 'admin');
  assert.equal(commit.body.writes[0].updateTransforms[0].setToServerValue, 'REQUEST_TIME');
  assert.equal(commit.body.writes[1].currentDocument.updateTime, '2026-10-11T00:00:00Z');
});

test('already-trashed photos reset without trashing again', () => {
  const f = fixture(); f.file.trashed = true;
  assert.equal(f.service.reset(f.payload, f.actor, 'token').outcome, 'already_trashed');
  assert.equal(f.trash.length, 0);
});

test('missing photo requires explicit elevated recovery and a reason', () => {
  const f = fixture(); f.service.requestDrive = () => response(404);
  assert.throws(() => f.service.reset(f.payload, f.actor, 'token'), /verify its removal/);
  assert.equal(f.calls[0].failure[3].fields.status.stringValue, 'failed');
  f.payload.recoverMissing = true;
  assert.throws(() => f.service.reset(f.payload, f.actor, 'token'), /10–500/);
  f.payload.recoveryReason = 'Verified original photo permanently removed';
  f.context.canRecoverMissingFace_ = () => false;
  assert.throws(() => f.service.reset(f.payload, f.actor, 'token'), /Only Super Admin/);
});

test('guarded missing recovery verifies folder ownership and no replacement photo, then records the reason', () => {
  const f = fixture();
  Object.assign(f.payload, { recoverMissing: true, recoveryReason: 'Verified original photo permanently removed' });
  const folder = { ownedByMe: true, capabilities: { canListChildren: true } };
  f.service.requestDrive = id => id === 'photo' ? response(404) : response(200, folder);
  assert.equal(f.service.reset(f.payload, f.actor, 'token').outcome, 'missing_recovered');
  assert.equal(f.calls[0].body.writes[0].update.fields.recoveryReason.stringValue, f.payload.recoveryReason);
  folder.ownedByMe = false;
  assert.throws(() => f.service.reset(f.payload, f.actor, 'token'), /must own/);
  folder.ownedByMe = true; f.service.findFiles = () => [{}];
  assert.throws(() => f.service.reset(f.payload, f.actor, 'token'), /another matching photo/);
});

for (const code of [401, 403, 429, 500]) {
  test(`Drive ${code} is never treated as a missing-photo recovery`, () => {
    const f = fixture(); f.service.requestDrive = () => response(code);
    Object.assign(f.payload, { recoverMissing: true, recoveryReason: 'Verified original photo permanently removed' });
    assert.throws(() => f.service.reset(f.payload, f.actor, 'token'), /Drive access failed/);
    assert.equal(f.trash.length, 0); assert.equal(f.calls.some(c => c.body?.writes), false);
  });
}

test('wrong student, wrong folder and trash permission failures never clear registration', () => {
  for (const change of [{ description: 'Student UID: student-other' }, { parents: ['other'] }, { ownedByMe: false }, { capabilities: { canTrash: false } }]) {
    const f = fixture(); Object.assign(f.file, change);
    assert.throws(() => f.service.reset(f.payload, f.actor, 'token'));
    assert.equal(f.trash.length, 0); assert.equal(f.calls.some(c => c.body?.writes), false);
  }
});

test('legacy records reset matching files or require explicit recovery when no file exists', () => {
  const f = fixture(); f.context.getFaceRegistration_ = () => ({ fields: {}, updateTime: 'version' });
  assert.throws(() => f.service.reset(f.payload, f.actor, 'token'), /verify its removal/);
  f.service.findFiles = () => [{ getId: () => 'legacy' }];
  assert.equal(f.service.reset(f.payload, f.actor, 'token').outcome, 'trashed');
  assert.deepEqual(f.trash, ['legacy']);
});

test('reset authorization and request validation happen before Drive access or audit writes', () => {
  const f = fixture(); f.context.canResetFace_ = () => false;
  assert.throws(() => f.service.reset(f.payload, f.actor, 'token'), /Your role/);
  assert.equal(f.calls.length, 0);
  f.context.canResetFace_ = () => true; f.payload.studentUid = '../invalid';
  assert.throws(() => f.service.reset(f.payload, f.actor, 'token'), /Invalid student/);
  f.payload.studentUid = 'student'; f.payload.requestId = '../invalid';
  assert.throws(() => f.service.reset(f.payload, f.actor, 'token'), /Invalid reset request/);
});

test('Firestore failure is reported, never presented as a completed reset', () => {
  const f = fixture(); f.context.UrlFetchApp.fetch = () => response(403);
  assert.throws(() => f.service.reset(f.payload, f.actor, 'token'), /Firebase reset confirmation failed/);
  assert.equal(f.calls[0].failure[3].fields.status.stringValue, 'failed');
});

test('reset rules protect immutable actor-scoped results and elevated recovery', () => {
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const block = rules.split('match /faceResetRequests/{requestId}')[1].split('match /faceRegistrations')[0];
  assert.match(block, /requesterUid == request.auth.uid/);
  assert.match(block, /isSuperAdmin\(\) \|\| isHeadAdmin\(\)/);
  assert.match(block, /allow update, delete: if false/);
  assert.match(block, /!existsAfter/);
  assert.match(block, /!exists\(/, 'polling a not-yet-created result must be permitted');
});

test('Apps Script reads stored roles: Student Manager resets normally but cannot approve missing recovery', () => {
  const context = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(root, 'docs/google-apps-script-face-upload.js'), 'utf8'), context);
  const actor = { localId: 'manager', email: 'manager@example.test' };
  for (const role of ['head_admin', 'student_manager', 'attendance_admin', 'student']) {
    context.firestoreRequest_ = () => ({ fields: { active: { booleanValue: true }, role: { stringValue: role } } });
    assert.equal(context.canResetFace_(actor, 'token'), ['head_admin', 'student_manager'].includes(role));
    assert.equal(context.canRecoverMissingFace_(actor, 'token'), role === 'head_admin');
  }
  context.firestoreRequest_ = () => ({ fields: { active: { booleanValue: false }, role: { stringValue: 'head_admin' } } });
  assert.equal(context.canRecoverMissingFace_(actor, 'token'), false);
});
