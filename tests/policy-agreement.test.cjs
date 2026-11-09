const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');

async function fixture(options = {}) {
  const { PolicyAgreementController } = await import('../assets/js/controllers/PolicyAgreementController.js');
  const { PolicyAgreementPolicy: Policy } = await import('../assets/js/core/PolicyAgreementPolicy.js');
  const attrs = new Set(['data-policy-required']); let resolved;
  const field = () => ({ textContent: '', disabled: false, hidden: false, checked: false, focus() {}, setAttribute() {}, removeAttribute() {} });
  const controller = new PolicyAgreementController({ uid: 'student', document: { body: { removeAttribute: key => attrs.delete(key) } }, window: {},
    read: async () => null, save: async () => {}, signOut: async () => {}, ...options });
  controller.scope.initialize();
  Object.assign(controller, { checkbox: field(), proceed: field(), retry: field(), error: field(), status: field(),
    dialog: { close() {}, remove() {} }, resolve: value => { resolved = value; } });
  return { controller, Policy, attrs, resolved: () => resolved };
}

test('agreement receipt requires this user, this version, both decisions and a timestamp', async () => {
  const { PolicyAgreementPolicy: Policy } = await import('../assets/js/core/PolicyAgreementPolicy.js');
  const receipt = Policy.receipt('student', 'server-time');
  assert.equal(Policy.accepted(receipt, 'student'), true);
  for (const changed of [{ uid: 'other' }, { version: 'old' }, { termsAccepted: false }, { privacyAcknowledged: false }, { acceptedAt: null }]) {
    assert.equal(Policy.accepted({ ...receipt, ...changed }, 'student'), false);
  }
  assert.equal(Policy.accepted(null, 'student'), false);
});

test('unchecked agreement never saves or unlocks; checked agreement waits for server acknowledgement', async () => {
  let writes = 0, finish;
  const f = await fixture({ save: () => { writes++; return new Promise(resolve => { finish = resolve; }); } });
  await f.controller.verify();
  await f.controller.accept();
  assert.match(f.controller.error.textContent, /Please accept/); assert.equal(writes, 0); assert.equal(f.resolved(), undefined);
  f.controller.checkbox.checked = true;
  const pending = f.controller.accept(); await f.controller.accept();
  assert.equal(writes, 1); assert.equal(f.controller.proceed.disabled, true); assert.ok(f.attrs.has('data-policy-required'));
  finish(); await pending;
  assert.equal(f.resolved(), true); assert.ok(!f.attrs.has('data-policy-required'));
});

test('offline verification and failed saves keep agreement required and retryable', async () => {
  const f = await fixture({ read: async () => { throw Error('offline'); } });
  await f.controller.verify(); assert.equal(f.controller.ready, false); assert.equal(f.controller.retry.hidden, false);
  assert.equal(f.resolved(), undefined);
  f.controller.read = async () => null; await f.controller.verify();
  f.controller.save = async () => { throw Error('offline'); }; f.controller.checkbox.checked = true;
  await f.controller.accept();
  assert.match(f.controller.error.textContent, /could not be saved/); assert.equal(f.resolved(), undefined); assert.equal(f.controller.proceed.disabled, false);
});

test('server receipt skips repeat acceptance across devices; concurrent immutable create is reconciled', async () => {
  const f = await fixture(); f.controller.read = async () => f.Policy.receipt('student', 'server-time');
  await f.controller.verify(); assert.equal(f.resolved(), true);
  const g = await fixture({ save: async () => { throw Error('already-created'); } });
  await g.controller.verify(); g.controller.checkbox.checked = true;
  g.controller.read = async () => g.Policy.receipt('student', 'server-time');
  await g.controller.accept(); assert.equal(g.resolved(), true);
});

test('sign out during verification cannot unlock the dashboard and Android Back cannot dismiss agreement', async () => {
  let finishRead, finishSignOut;
  const f = await fixture({ read: () => new Promise(resolve => { finishRead = resolve; }), signOut: () => new Promise(resolve => { finishSignOut = resolve; }) });
  const verification = f.controller.verify(), leaving = f.controller.leave();
  finishRead(f.Policy.receipt('student', 'server-time')); await verification;
  assert.equal(f.resolved(), undefined); finishSignOut(); await leaving; assert.equal(f.resolved(), false);
  const bridge = fs.readFileSync('mobile/native-bridge.js', 'utf8');
  assert.match(bridge, /data-policy-required[\s\S]*presence:policy-back[\s\S]*return;/);
  for (const file of ['pages/admin-dashboard.html', 'pages/student-dashboard.html']) {
    const html = fs.readFileSync(file, 'utf8'); assert.match(html, /data-policy-enabled/); assert.match(html, /privacy-policy.html/); assert.match(html, /terms-and-conditions.html/);
  }
});

test('dashboard agreement gate is student-only while admin role verification remains required', () => {
  const source=fs.readFileSync('assets/js/controllers/DashboardApplication.js','utf8');
  const gate=source.match(/if \((dashboardRole === 'student' && this.document.body.hasAttribute\?\.\('data-policy-enabled'\))\) \{/)[1];
  const enabled={document:{body:{hasAttribute:()=>true}}};
  const check=new Function('dashboardRole','return '+gate);
  assert.equal(check.call(enabled,'admin'),false);
  assert.equal(check.call(enabled,'student'),true);
  assert.ok(source.indexOf('if (!authorized)') < source.indexOf('this.agreement = new PolicyAgreementController'));
  assert.match(source,/const policyReference = currentUser && dashboardRole === 'student'/);
});
