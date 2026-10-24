const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

async function fixture() {
  const badge = { hidden: true }, button = { setAttribute(key, value) { this[key] = value; } };
  const list = { addEventListener() {}, innerHTML: '' }, count = {};
  const nodes = { '#accountApprovalNavCount': badge, '[data-view="account-approvals"]': button, '#accountApprovalList': list, '#accountApprovalCount': count };
  let next, error, reads = 0, stopped = 0, reference;
  const sdk = { collection: (db, name) => name, doc() {}, query: (...args) => args, where: (...args) => args, serverTimestamp() {}, updateDoc() {}, writeBatch() {},
    onSnapshot(ref, success, failed) { reads++; reference = ref; next = success; error = failed; return () => stopped++; } };
  const context = vm.createContext({});
  const controller = new vm.SourceTextModule(fs.readFileSync(path.join(root, 'assets/js/controllers/AccountApprovalController.js'), 'utf8'), { context });
  await controller.link(specifier => {
    const exports = specifier.startsWith('https:') ? sdk : { CoursePolicy: { profile: value => value } };
    return new vm.SyntheticModule(Object.keys(exports), function() { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await controller.evaluate();
  const instance = new controller.namespace.AccountApprovalController({ document: {
    querySelector: key => nodes[key] || null,
    createElement: () => ({ textContent: '', get innerHTML() { return this.textContent.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); } })
  }, canApprove: () => false });
  return { instance, badge, button, list, count, get reads() { return reads; }, get stopped() { return stopped; }, get reference() { return reference; }, snapshot: requests => next({ docs: requests.map((data, id) => ({ id, data: () => data })) }), fail: () => error() };
}

test('one pending-only live listener updates navigation while approvals are not open', async () => {
  const f = await fixture(); f.instance.initialize(); f.instance.initialize();
  assert.equal(f.reads, 1);
  assert.equal(JSON.stringify(f.reference), JSON.stringify(['registrationRequests', ['status', '==', 'pending']]));
  f.snapshot([]); assert.equal(f.badge.hidden, true);
  f.snapshot([{ status: 'pending', requestedAt: { seconds: 1 } }]);
  assert.equal(f.badge.hidden, false); assert.equal(f.badge.textContent, '1');
  assert.equal(f.button['aria-label'], 'Account Approvals, 1 pending registration');
  assert.equal(f.count.textContent, '1 pending');
  // A server update removes reviewed requests from this pending-only query.
  f.snapshot([]); assert.equal(f.badge.hidden, true); assert.equal(f.button['aria-label'], 'Account Approvals');
});

test('badge caps display, sorts pending requests, clears stale counts on errors and ignores disposed callbacks', async () => {
  const f = await fixture(); f.instance.initialize();
  f.snapshot(Array.from({ length: 105 }, (_, index) => ({ status: 'pending', requestedAt: { seconds: index } })));
  assert.equal(f.badge.textContent, '99+'); assert.equal(f.badge.title, '105 pending registrations');
  assert.equal(f.instance.requests[0].requestedAt.seconds, 104);
  f.fail(); assert.equal(f.badge.hidden, true); assert.equal(f.count.textContent, 'Unavailable');
  f.instance.dispose(); assert.equal(f.stopped, 1);
  f.snapshot([{ status: 'pending' }]); assert.equal(f.badge.hidden, true);
});

test('badge is present in navigation and its controller starts behind the existing permission guard', () => {
  const html = fs.readFileSync(path.join(root, 'pages/admin-dashboard.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'assets/js/admin/AdminDashboard.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'assets/css/dashboard.css'), 'utf8');
  assert.match(html, /data-view="account-approvals"[^\n]+id="accountApprovalNavCount"[^\n]+hidden/);
  assert.match(source, /this.startSubscriptions\(\);\s*\/\/[^\n]+\n\s*void this.loadAccountApprovals\(\)/);
  assert.match(source, /if \(!dashboard.can\('viewAccountApprovals'\) \|\| dashboard.accountApprovalController\) return;/);
  assert.match(css, /\.account-approval-nav-count\[hidden\] \{ display: none; \}/);
});
