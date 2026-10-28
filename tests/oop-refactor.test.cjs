const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

async function load(relative) {
  const context = vm.createContext({ URL, console, setTimeout, clearTimeout });
  const modules = new Map();
  const sdk = Object.fromEntries(['browserLocalPersistence', 'browserSessionPersistence', 'setPersistence',
    'onAuthStateChanged', 'signInWithEmailAndPassword', 'signOut', 'doc', 'getDoc', 'getDocFromServer', 'serverTimestamp',
    'setDoc', 'updateDoc', 'writeBatch', 'createUserWithEmailAndPassword'].map(name => [name, () => { throw Error('Unexpected live SDK call'); }]));
  const synthetic = (key, values) => {
    if (!modules.has(key)) modules.set(key, new vm.SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context }));
    return modules.get(key);
  };
  function module(file) {
    if (!modules.has(file)) modules.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file }));
    return modules.get(file);
  }
  const entry = module(path.join(root, relative));
  await entry.link((specifier, parent) => {
    if (specifier.startsWith('https:')) return synthetic('sdk', sdk);
    if (specifier.includes('firebase-config')) return synthetic('config', { SUPER_ADMIN_UID: 'owner',
      auth: {}, db: {}, studentIdToEmail: id => `${id}@student.test`, studentProvisioningAuth: {}, studentProvisioningDb: {} });
    return module(path.resolve(path.dirname(parent.identifier), specifier.split('?')[0]));
  });
  await entry.evaluate();
  return entry.namespace;
}

function sessionOptions(profile = { active: true, role: 'student', accountId: '123' }) {
  const calls = [];
  return { calls, auth: {}, superAdminUid: 'owner', studentEmail: id => `${id}@student.test`,
    localPersistence: 'local', sessionPersistence: 'session',
    persist: async (_, mode) => calls.push(['persist', mode]),
    signIn: async (_, email, password) => { calls.push(['signIn', email, password]); return { user: { uid: email === 'owner@test.local' ? 'owner' : 'one', email } }; },
    logOut: async () => calls.push(['signOut']),
    loadStudent: async () => ({ exists: () => true, data: () => profile }) };
}

test('login session preserves student/viewer/admin roles and persistence choices', async () => {
  const { LoginSessionService } = await load('assets/js/controllers/LoginSessionService.js');
  for (const role of ['student', 'viewer', 'head_admin', 'attendance_admin', 'student_manager']) {
    const options = sessionOptions({ active: true, role, accountId: '123' });
    const service = new LoginSessionService(options);
    const result = await service.authenticate({ accountId: '123', password: 'secret123', remember: true });
    assert.equal(result.session.role, ['student', 'viewer'].includes(role) ? 'student' : 'admin');
    assert.equal(result.session.assignedRole, role === 'viewer' ? 'student' : role);
    assert.deepEqual(options.calls[0], ['persist', 'local']);
    assert.deepEqual(options.calls[1], ['signIn', '123@student.test', 'secret123']);
  }
  const options = sessionOptions();
  const result = await new LoginSessionService(options).authenticate({ accountId: 'owner@test.local', password: 'secret123', remember: false });
  assert.equal(result.session.role, 'admin');
  assert.equal(result.session.assignedRole, 'super_admin');
  assert.equal(result.session.accountId, '');
  assert.deepEqual(options.calls[0], ['persist', 'session']);
});

test('login session completes approved registration and rejects inactive students', async () => {
  const { LoginSessionService } = await load('assets/js/controllers/LoginSessionService.js');
  const options = sessionOptions();
  let reads = 0, completed = 0;
  options.loadStudent = async () => {
    const exists = ++reads > 1;
    return { exists: () => exists, data: () => exists ? { active: true, accountId: '123' } : undefined };
  };
  const result = await new LoginSessionService(options).authenticate({ accountId: '123', password: 'secret123',
    completeRegistration: async input => { completed++; assert.equal(input.accountId, '123'); return {}; } });
  assert.equal(completed, 1); assert.equal(reads, 2); assert.equal(result.session.role, 'student');
  const inactive = sessionOptions({ active: false, role: 'student' });
  await assert.rejects(new LoginSessionService(inactive).authenticate({ accountId: '123', password: 'secret123' }), /not a registered student/);
  assert.deepEqual(inactive.calls.at(-1), ['signOut']);
});

test('survey auto-resume eligibility and login error messages stay unchanged', async () => {
  const { LoginSessionService } = await load('assets/js/controllers/LoginSessionService.js');
  const service = new LoginSessionService(sessionOptions({ active: false, role: 'head_admin' }));
  assert.equal(await service.resolveExistingRole({ uid: 'one', email: 'a@test.local' }), null);
  assert.equal(await service.resolveExistingRole({ uid: 'owner', email: 'owner@test.local' }), 'admin');
  for (const [role,expected] of [['student','student'],['viewer','student'],['head_admin','admin'],['attendance_admin','admin'],['student_manager','admin'],['unknown',null]]) {
    const active=new LoginSessionService(sessionOptions({active:true,role}));
    assert.equal(await active.resolveExistingRole({uid:'one',email:'a@test.local'}),expected);
  }
  assert.match(service.errorMessage({ code: 'auth/invalid-credential' }), /incorrect/);
  assert.match(service.errorMessage({ code: 'auth/too-many-requests' }), /Too many attempts/);
  assert.match(service.errorMessage({ code: 'firestore/permission-denied' }), /Firestore rules/);
});

test('Super Admin uses authenticated UID rather than email, and inactive or invented roles cannot sign in as staff',async()=>{
  const {LoginSessionService}=await load('assets/js/controllers/LoginSessionService.js');
  const options=sessionOptions(),service=new LoginSessionService(options);
  assert.equal(service.isSuperAdmin({uid:'impostor',email:'owner@test.local'}),false);
  assert.equal(service.isSuperAdmin({uid:'owner',email:'changed@example.test'}),true);
  assert.equal(service.isSuperAdmin({email:'owner@test.local'}),false);
  options.signIn=async()=>({user:{uid:'owner',email:'changed@example.test'}});options.loadStudent=async()=>{throw Error('Pinned admin must not require student profile');};
  const authenticated=await new LoginSessionService(options).authenticate({accountId:'changed@example.test',password:'test',remember:false});
  assert.equal(authenticated.session.assignedRole,'super_admin');assert.equal(authenticated.session.accountId,'');
  for(const role of ['head_admin','attendance_admin','student_manager']){
    const inactive=sessionOptions({active:false,role});await assert.rejects(new LoginSessionService(inactive).authenticate({accountId:'123',password:'test'}),/not a registered student/);assert.equal(inactive.calls.at(-1)[0],'signOut');
  }
  const forged=sessionOptions({active:true,role:'super_admin'});await assert.rejects(new LoginSessionService(forged).authenticate({accountId:'123',password:'test'}),/unsupported role/);
});

function browser() {
  const nodes = new Map(), listeners = new Map(), records = new Map(), timers = new Map();
  function element(selector) {
    if (!nodes.has(selector)) {
      const handlers = new Map(), attrs = new Map(), classes = new Set();
      const node = { handlers, value: '', textContent: '', innerHTML: 'Sign in', type: 'password', hidden: true, disabled: false,
        classList: { add: name => classes.add(name), remove: name => classes.delete(name),
          toggle(name, present) { if (present) classes.add(name); else classes.delete(name); } },
        addEventListener(type, handler) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(handler); },
        removeEventListener(type, handler) { handlers.get(type)?.delete(handler); },
        setAttribute: (name, value) => attrs.set(name, value), getAttribute: name => attrs.get(name), removeAttribute: name => attrs.delete(name),
        querySelector: element, closest() { return this; }, focus() { this.focused = true; } };
      nodes.set(selector, node);
    }
    return nodes.get(selector);
  }
  const form = element('#loginForm'); form.elements = { remember: { checked: true } };
  const document = { querySelector: element, addEventListener(type, handler) { listeners.set(type, handler); }, removeEventListener(type) { listeners.delete(type); } };
  const window = { location: { href: 'https://presence.test/index.html?survey=event-1' },
    addEventListener: (type, handler) => listeners.set(type, handler), removeEventListener: type => listeners.delete(type),
    setTimeout: callback => { const id = timers.size + 1; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id) };
  const storage = { setItem: (key, value) => records.set(key, value) };
  const registration = { starts: 0, stops: 0, initialize() { this.starts++; }, dispose() { this.stops++; }, completeApprovedRegistration() {} };
  const surveyEntry = { starts: 0, stops: 0, initialize() { this.starts++; }, dispose() { this.stops++; } };
  const identity = { save(uid, profile) { this.saved = { uid, profile }; }, clear() { this.cleared = true; } };
  return { document, window, storage, registration, surveyEntry, identity, element, records, timers, listeners };
}

test('login UI initializes once, validates fields, toggles password/help and cleans up', async () => {
  const { LoginController } = await load('assets/js/controllers/LoginController.js');
  const env = browser(); let calls = 0;
  const login = new LoginController({ ...env, sessionService: { authenticate() { calls++; } } });
  login.initialize(); login.initialize();
  assert.equal(env.registration.starts, 1); assert.equal(env.surveyEntry.starts, 1);
  assert.equal(env.element('#loginForm').handlers.get('submit').size, 1);
  await login.submit({ preventDefault() {} });
  assert.equal(calls, 0); assert.match(env.element('#accountError').textContent, /student ID/);
  assert.match(env.element('#passwordError').textContent, /password/);
  login.togglePassword(); assert.equal(env.element('#password').type, 'text');
  login.openHelp(); assert.equal(env.element('#helpDialog').hidden, false);
  login.closeHelp(); assert.equal(env.element('#helpDialog').hidden, true);
  login.showToast('Test', 'message'); assert.equal(env.timers.size, 1);
  login.dispose(); login.dispose();
  assert.equal(env.element('#loginForm').handlers.get('submit').size, 0);
  assert.equal(env.registration.stops, 1); assert.equal(env.surveyEntry.stops, 1);
  assert.equal(env.timers.size, 0); assert.equal(env.listeners.size, 0);
});

test('login blocks duplicate submits and preserves student session, identity and survey routing', async () => {
  const { LoginController } = await load('assets/js/controllers/LoginController.js');
  const env = browser(); let resolve, calls = 0;
  const result = { user: { uid: 'one' }, profile: { firstName: 'Test' }, session: { uid: 'one', role: 'student' } };
  const login = new LoginController({ ...env, sessionService: { authenticate() { calls++; return new Promise(done => { resolve = done; }); } } });
  login.initialize(); env.element('#accountId').value = ' 123 '; env.element('#password').value = 'secret123';
  const pending = login.submit({ preventDefault() {} }); await login.submit({ preventDefault() {} });
  assert.equal(calls, 1); assert.equal(login.submitButton.disabled, true);
  resolve(result); await pending;
  assert.equal(env.window.location.href, 'pages/student-dashboard.html?survey=event-1');
  assert.deepEqual(JSON.parse(env.records.get('presenceSession')), result.session);
  assert.equal(env.identity.saved.uid, 'one'); login.dispose();
});

test('login failures restore controls and disposal discards late authentication results', async () => {
  const { LoginController } = await load('assets/js/controllers/LoginController.js');
  const env = browser();
  const service = { authenticate: async () => { throw Error('Offline'); }, errorMessage: error => error.message };
  const login = new LoginController({ ...env, sessionService: service });
  login.initialize(); env.element('#accountId').value = '123'; env.element('#password').value = 'secret123';
  await login.submit({ preventDefault() {} });
  assert.equal(login.submitButton.disabled, false); assert.equal(login.loginAction.busy, false);
  assert.equal(env.element('#passwordError').textContent, 'Offline');
  let resolve;
  service.authenticate = () => new Promise(done => { resolve = done; });
  const pending = login.submit({ preventDefault() {} }); login.dispose();
  resolve({ user: { uid: 'one' }, profile: {}, session: { role: 'student' } }); await pending;
  assert.equal(env.records.size, 0); assert.equal(env.identity.saved, undefined);
  assert.equal(env.window.location.href, 'https://presence.test/index.html?survey=event-1');
});

test('dashboard state owns view/session updates and retains shared session resources', async () => {
  const { DashboardState } = await load('assets/js/core/DashboardState.js');
  const updates = [], state = new DashboardState({ onChange: value => updates.push(value) });
  state.mediaStream = { stop() {} };
  state.setSession({ user: { uid: 'one' }, role: 'student', profile: { firstName: 'Test' } });
  state.setView({ activeView: 'events', previousView: 'dashboard' });
  state.setView({ activeView: 'attendance-line' });
  assert.equal(state.user.uid, 'one'); assert.equal(state.profile.firstName, 'Test');
  assert.equal(state.activeView, 'attendance-line'); assert.equal(state.previousView, 'dashboard');
  assert.ok(state.mediaStream); assert.equal(updates.length, 3);
});

test('entry scripts only bootstrap controllers and preserve dashboard compatibility exports', () => {
  const login = fs.readFileSync(path.join(root, 'assets/js/script.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'assets/js/dashboard.js'), 'utf8');
  for (const source of [login, dashboard]) {
    assert.doesNotMatch(source, /addEventListener|querySelector|setTimeout|\bfunction\b/);
    assert.ok(source.trim().split('\n').length < 10);
  }
  assert.match(login, /new LoginController/);
  assert.match(dashboard, /sessionState, setDashboardViewState/);
});
