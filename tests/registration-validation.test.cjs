const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function controller() {
  const context = vm.createContext({ FormData: class { constructor(form) { return Object.entries(form.values); } } });
  const entry = new vm.SourceTextModule(fs.readFileSync(path.join(__dirname, '../assets/js/controllers/RegistrationController.js'), 'utf8'), { context });
  await entry.link(specifier => {
    if (/\/(CoursePolicy|GenderPolicy)\.js$/.test(specifier)) return new vm.SourceTextModule(fs.readFileSync(path.join(__dirname, '../assets/js/core', path.basename(specifier)), 'utf8'), { context });
    const names = specifier.includes('firebase-auth')
      ? ['createUserWithEmailAndPassword', 'signInWithEmailAndPassword', 'signOut']
      : ['doc', 'getDoc', 'serverTimestamp', 'setDoc', 'updateDoc', 'writeBatch'];
    return new vm.SyntheticModule(names, function () {
      for (const name of names) this.setExport(name, () => { throw new Error('Validation must not call Firebase'); });
    }, { context });
  });
  await entry.evaluate();
  return new entry.namespace.RegistrationController({ document: {} });
}

const complete = { accountId: '2510001', birthday: '2005-01-01', firstName: 'Test', lastName: 'Student', course: 'BSIT', section: '2A', password: 'password123', confirmPassword: 'password123' };
const missingMessage = 'Fill all the fields first before proceeding';

test('registration requires every field before password validation', async () => {
  const registration = await controller();
  assert.equal(registration.registrationValidationMessage({}), missingMessage);
  for (const name of Object.keys(complete)) {
    for (const blank of ['', '   ', undefined]) {
      assert.equal(registration.registrationValidationMessage({ ...complete, [name]: blank }), missingMessage, name);
    }
  }
  assert.equal(registration.registrationValidationMessage({ ...complete, firstName: '', password: 'short', confirmPassword: 'different' }), missingMessage);
});

test('complete registration still enforces password length and confirmation', async () => {
  const registration = await controller();
  assert.equal(registration.registrationValidationMessage({ ...complete, password: 'short', confirmPassword: 'short' }), 'Use a password with at least 8 characters.');
  assert.equal(registration.registrationValidationMessage({ ...complete, confirmPassword: 'different' }), 'Passwords do not match.');
  assert.equal(registration.registrationValidationMessage(complete), '');
});

test('registration accepts known or unspecified gender and rejects tampered values before Firebase', async () => {
  const registration = await controller();
  for (const gender of ['Male', 'Female', '', undefined]) assert.equal(registration.registrationValidationMessage({ ...complete, gender }), '');
  for (const gender of ['invalid', '<script>', {}, null]) assert.match(registration.registrationValidationMessage({ ...complete, gender }), /gender/);
});

test('incomplete registration shows missing-field error without submitting or setting busy', async () => {
  const registration = await controller();
  registration.registrationForm = { values: {}, querySelector() { throw new Error('Must stop before submission'); } };
  registration.registrationError = { textContent: 'Old error' };
  let prevented = false;
  await registration.submitRegistration({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(registration.registrationError.textContent, missingMessage);
});
