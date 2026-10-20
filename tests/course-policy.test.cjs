const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('course policy standardizes verified legacy spelling without guessing other courses or mutating profiles', async () => {
  const { CoursePolicy } = await import('../assets/js/core/CoursePolicy.js');
  for (const value of ['BSInfo Tech', 'BS Info Tech', ' bsinfo tech ', 'BS INFO TECH']) assert.equal(CoursePolicy.normalize(value), 'BS Info Tech');
  for (const course of ['BSA', 'BSMB', 'BSFI']) assert.equal(CoursePolicy.normalize(course.toLowerCase()), course);
  for (const course of ['BSIT', 'BS Information Technology', 'Unknown course']) assert.equal(CoursePolicy.normalize(course), course);
  assert.equal(CoursePolicy.normalize(undefined), '');
  const original = Object.freeze({ uid: 'old', course: 'BSInfo Tech', section: '2A', accountId: '123', active: true });
  const profile = CoursePolicy.profile(original);
  assert.equal(profile.course, 'BS Info Tech'); assert.equal(original.course, 'BSInfo Tech');
  assert.deepEqual({ ...profile, course: original.course }, original);
});

test('registration, admin and student course dropdowns share canonical saved values', () => {
  for (const [file, selector] of [['index.html', 'name="course"'], ['pages/admin-dashboard.html', 'id="managedCourse"'], ['pages/student-dashboard.html', 'id="profileCourse"']]) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const select = html.match(new RegExp(`<select ${selector}[^>]*>([\\s\\S]*?)<\\/select>`))?.[1];
    assert.ok(select, file);
    const values = [...select.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]).sort();
    assert.deepEqual(values, ['BS Info Tech', 'BSA', 'BSFI', 'BSMB'].sort(), file);
    assert.doesNotMatch(select, /BSInfo Tech/);
  }
});
