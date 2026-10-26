const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

async function fixture({ resubmit = false } = {}) {
  const calls = [], success = []; let resolveSave, rejectSave;
  const save = async (_, data) => { calls.push(data); await new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; }); };
  const sdk = { createUserWithEmailAndPassword: async () => { calls.push('auth'); if (resubmit) throw Object.assign(Error('Existing account'), { code: 'auth/email-already-in-use' }); return { user: { uid: 'new-user' } }; },
    signInWithEmailAndPassword() { if (!resubmit) throw Error('Unexpected sign-in'); calls.push('sign-in'); return { user: { uid: 'new-user' } }; }, signOut: async () => calls.push('sign-out'),
    doc: (...args) => args, getDoc: async () => ({ exists: () => true, data: () => ({ uid: 'new-user', status: 'declined' }) }), serverTimestamp: () => 'SERVER',
    setDoc: save, updateDoc: save, writeBatch() {} };
  const context = vm.createContext({ FormData: class { constructor(form) { return Object.entries(form.values); } } });
  const entry = new vm.SourceTextModule(fs.readFileSync(path.join(root, 'assets/js/controllers/RegistrationController.js'), 'utf8'), { context });
  await entry.link(specifier => {
    if (specifier.endsWith('GenderPolicy.js')) return new vm.SourceTextModule(fs.readFileSync(path.join(root, 'assets/js/core/GenderPolicy.js'), 'utf8'), { context });
    const exports = specifier.endsWith('CoursePolicy.js') ? { CoursePolicy: { normalize: value => value } } : sdk;
    return new vm.SyntheticModule(Object.keys(exports), function() { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await entry.evaluate();
  const fields = {};
  for (const name of ['accountId', 'birthday', 'firstName', 'lastName', 'course', 'section', 'password', 'confirmPassword']) {
    fields[name] = { name, value: '', required: true, custom: '', focused: 0, reports: 0,
      setCustomValidity(message) { this.custom = message; }, focus() { this.focused++; }, reportValidity() { this.reports++; },
      get validationMessage() { return this.custom || 'Invalid field'; },
      checkValidity() { return !this.custom && Boolean(this.value) && (!name.includes('assword') || this.value.length >= 8) && (name !== 'birthday' || this.value <= this.max); } };
  }
  const panels = [['accountId', 'birthday', 'firstName', 'lastName'], ['course', 'section'], ['password', 'confirmPassword']].map(names => ({ hidden: false, disabled: false, querySelectorAll: () => names.map(name => fields[name]) }));
  const indicators = [0, 1, 2].map(() => { const values = new Set(); return { classes: values, classList: { toggle: (name, set) => set ? values.add(name) : values.delete(name), add: name => values.add(name), remove: name => values.delete(name) }, setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; } }; });
  const next = {}, back = {}, submit = { textContent: 'Send registration request', dataset: {}, disabled: false }, status = {}, error = { textContent: '' };
  const review = ['accountId', 'birthday', 'firstName', 'lastName', 'course', 'section'].map(name => ({ dataset: { registrationReview: name }, textContent: '' }));
  const nodes = { '[data-registration-next]': next, '[data-registration-back]': back, '[type="submit"]': submit, '[data-registration-step-status]': status };
  const form = { elements: { namedItem: name => fields[name] }, querySelector: selector => nodes[selector],
    querySelectorAll: selector => selector === '[data-registration-step]' ? panels : selector === '[data-registration-indicator]' ? indicators : selector === '[data-registration-review]' ? review : [],
    get values() { return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.value])); }, reset() { for (const field of Object.values(fields)) field.value = ''; } };
  const handlers = new Map();
  const registration = new entry.namespace.RegistrationController({ document: {}, onSuccess: (...args) => success.push(args), studentIdToEmail: id => id + '@test.invalid' });
  const wizard = new entry.namespace.RegistrationWizard({ form, error, listen(target, event, handler) { if (!handlers.has(target)) handlers.set(target, {}); handlers.get(target)[event] = handler; }, isBusy: () => registration.registrationBusy });
  registration.registrationForm = form; registration.registrationError = error; registration.registrationDialog = { querySelectorAll: () => [] };
  registration.wizard = wizard; registration.close = () => calls.push('closed'); wizard.initialize();
  const fill = () => { for (const [name, value] of Object.entries({ accountId: '2510004-1', birthday: '2005-01-01', firstName: 'Test', lastName: 'Student', course: 'BS Info Tech', section: '2A', password: 'password123', confirmPassword: 'password123' })) fields[name].value = value; };
  return { registration, wizard, fields, panels, indicators, next, back, submit, status, error, review, handlers, calls, success, fill, resolveSave: () => resolveSave(), rejectSave: () => rejectSave(Error('Save unavailable')) };
}

test('wizard validates each step and animates only validated previous steps; Next never writes', async () => {
  const f = await fixture();
  assert.equal(f.wizard.step, 0); assert.equal(f.submit.hidden, true); assert.equal(f.back.hidden, true);
  f.wizard.next(); assert.equal(f.wizard.step, 0); assert.ok(f.error.textContent); assert.equal(f.fields.accountId.focused, 1);
  f.fill(); f.wizard.next();
  assert.equal(f.wizard.step, 1); assert.equal(f.panels[0].hidden, true); assert.equal(f.panels[1].hidden, false);
  assert.equal(f.indicators[0].classes.has('is-complete'), true); assert.equal(f.indicators[1]['aria-current'], 'step');
  f.wizard.next(); assert.equal(f.wizard.step, 2); assert.equal(f.submit.hidden, false); assert.equal(f.next.hidden, true);
  assert.equal(f.review.find(item => item.dataset.registrationReview === 'course').textContent, 'BS Info Tech');
  assert.ok(!f.review.some(item => /password/i.test(item.dataset.registrationReview)));
  assert.equal(f.calls.length, 0);
});
test('Back retains entries and passwords in memory; final validation exposes the correct invalid panel', async () => {
  const f = await fixture(); f.fill(); f.wizard.next(); f.wizard.next();
  f.handlers.get(f.back).click(); assert.equal(f.wizard.step, 1); assert.equal(f.fields.password.value, 'password123');
  f.wizard.next(); f.fields.confirmPassword.value = 'wrongpassword';
  assert.equal(f.wizard.validateAll(), false); assert.equal(f.wizard.step, 2); assert.match(f.error.textContent, /Passwords do not match/);
  f.fields.confirmPassword.value = f.fields.password.value; f.fields.firstName.value = '   ';
  assert.equal(f.wizard.validateAll(), false); assert.equal(f.wizard.step, 0); assert.ok(f.fields.firstName.reports > 0);
  f.wizard.reset(); assert.equal(f.fields.password.value, ''); assert.equal(f.fields.confirmPassword.value, '');
  assert.equal(f.fields.accountId.value, '2510004-1');
});
test('Enter advances early steps without reaching Firebase; duplicate final submission is blocked until save acknowledgement', async () => {
  const f = await fixture(); f.fill(); const event = { preventDefault() {} };
  await f.registration.submitRegistration(event); assert.equal(f.wizard.step, 1); assert.equal(f.calls.length, 0);
  await f.registration.submitRegistration(event); assert.equal(f.wizard.step, 2); assert.equal(f.calls.length, 0);
  const pending = f.registration.submitRegistration(event); await Promise.resolve();
  assert.equal(f.registration.registrationBusy, true); assert.equal(f.submit.disabled, true); assert.equal(f.panels[0].disabled, true);
  await f.registration.submitRegistration(event); assert.equal(f.calls.filter(item => item === 'auth').length, 1);
  assert.equal(f.success.length, 0); assert.ok(!f.indicators[2].classes.has('is-complete'));
  assert.ok(!Object.hasOwn(f.calls.find(item => typeof item === 'object'), 'password'));
  f.resolveSave(); await pending;
  assert.equal(f.success.length, 1); assert.match(f.success[0][1], /administrator approval/);
  assert.ok(f.indicators[2].classes.has('is-complete')); assert.equal(f.submit.disabled, false); assert.equal(f.panels[0].disabled, false);
});
test('failed final save stays on security step and preserves entries without a success or completed third circle', async () => {
  const f = await fixture(); f.fill(); f.wizard.next(); f.wizard.next();
  const pending = f.registration.submitRegistration({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve));
  f.rejectSave(); await pending;
  assert.equal(f.wizard.step, 2); assert.equal(f.fields.password.value, 'password123'); assert.equal(f.success.length, 0);
  assert.match(f.error.textContent, /Save unavailable/); assert.equal(f.submit.disabled, false); assert.equal(f.registration.registrationBusy, false);
  assert.ok(!f.indicators[2].classes.has('is-complete'));
});
test('declined registrations keep the existing resubmission path after all wizard steps', async () => {
  const f = await fixture({ resubmit: true }); f.fill(); f.wizard.next(); f.wizard.next();
  const pending = f.registration.submitRegistration({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.includes('sign-in')); assert.equal(f.success.length, 0);
  const saved = f.calls.find(item => typeof item === 'object'); assert.equal(saved.status, 'pending'); assert.equal(saved.course, 'BS Info Tech');
  assert.ok(!Object.hasOwn(saved, 'password'));
  f.resolveSave(); await pending;
  assert.equal(f.success[0][0], 'Registration resubmitted'); assert.ok(f.calls.includes('sign-out'));
});
test('keyboard focus stays in registration and Escape closes through the password-clearing close path', async () => {
  const f = await fixture(); let prevented = 0, focused = '', closed = 0;
  const first = { disabled: false, tabIndex: 0, closest: () => null, focus: () => { focused = 'first'; } };
  const last = { disabled: false, tabIndex: 0, closest: () => null, focus: () => { focused = 'last'; } };
  f.registration.document.activeElement = last;
  f.registration.registrationDialog.querySelectorAll = () => [first, last];
  f.registration.registrationKeydown({ key: 'Tab', preventDefault: () => prevented++ });
  assert.equal(focused, 'first'); assert.equal(prevented, 1);
  f.registration.document.activeElement = first;
  f.registration.registrationKeydown({ key: 'Tab', shiftKey: true, preventDefault: () => prevented++ }); assert.equal(focused, 'last');
  f.registration.close = () => { closed++; f.wizard.clearPasswords(); };
  f.fill(); f.registration.registrationKeydown({ key: 'Escape', preventDefault() {} });
  assert.equal(closed, 1); assert.equal(f.fields.password.value, '');
});
test('stepper markup has three accessible panels, safe review fields and reduced-motion styling', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), css = fs.readFileSync(path.join(root, 'assets/css/style.css'), 'utf8');
  assert.equal((html.match(/data-registration-indicator/g) || []).length, 3);
  assert.equal((html.match(/data-registration-step="/g) || []).length, 3);
  assert.match(html, /aria-label="Registration progress"/); assert.match(html, /aria-current="step"/);
  assert.match(html, /data-registration-step-status role="status" aria-live="polite"/);
  assert.doesNotMatch(html, /data-registration-review="(?:password|confirmPassword)"/);
  assert.match(css, /\.registration-step-panel\[hidden\][^}]+display: none !important/);
  assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /stroke-dashoffset \.35s/);
  assert.match(css, /#registrationDialog > \.registration-dialog \{ width: min\(640px,/);
});
