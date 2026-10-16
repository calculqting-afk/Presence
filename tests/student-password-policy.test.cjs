const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const policy = async () => (await import(pathToFileURL(path.join(root, 'assets/js/core/StudentPasswordPolicy.js')).href)).StudentPasswordPolicy;

test('birthday passwords use MMDDYYYY with leading zeros and real calendar validation', async () => {
  const P = await policy();
  assert.equal(P.birthdayPassword('2005-01-02'), '01022005');
  assert.equal(P.birthdayPassword('2004-02-29'), '02292004');
  for (const date of ['', '01/02/2005', '2005-02-29', '2005-02-30', '2005-13-01', 'not-a-date', '2999-01-01']) assert.throws(() => P.birthdayPassword(date), /valid birthday/);
});

test('new passwords accept letters and symbols but reject birthday, ID and invalid lengths', async () => {
  const P = await policy(), profile = { accountId:'12345678', birthday:'2005-01-02' };
  for (const value of ['short', ' '.repeat(8), 'x'.repeat(129), '01022005', '12345678']) assert.ok(P.newPasswordError(value, profile));
  for (const value of ['Student!42', 'abcdefgh', '87654321']) assert.equal(P.newPasswordError(value, profile), '');
  assert.equal(P.newPasswordError('Student!42', { birthday:'bad legacy date' }), '');
});

test('admin and student forms describe birthday onboarding and mask new passwords', () => {
  const admin = fs.readFileSync(path.join(root,'pages/admin-dashboard.html'),'utf8');
  const student = fs.readFileSync(path.join(root,'pages/student-dashboard.html'),'utf8');
  assert.match(admin, /id="managedBirthday" type="date" required/);
  assert.match(admin, /id="managedPassword" type="text" readonly/);
  assert.match(admin, /MMDDYYYY/);
  for (const id of ['requiredNewPassword','requiredConfirmPassword']) assert.match(student, new RegExp(`id="${id}" type="password" required minlength="8" maxlength="128"`));
});
