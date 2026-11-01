const test = require('node:test'), assert = require('node:assert/strict');

test('age is calculated by Philippine calendar birthday without storing a stale age', async () => {
  const { studentAge, ageLabel } = await import('../assets/js/core/StudentPersonalInfo.js');
  assert.equal(studentAge('2005-10-30', new Date('2026-10-29T15:59:59Z')), 20);
  assert.equal(studentAge('2005-10-30', new Date('2026-10-29T16:00:00Z')), 21);
  assert.equal(studentAge('2004-02-29', new Date('2025-02-28T12:00:00Z')), 20);
  assert.equal(studentAge('2004-02-29', new Date('2025-03-01T00:00:00Z')), 21);
  assert.equal(ageLabel('2025-10-30', new Date('2026-10-30T00:00:00Z')), '1 year old');
  for (const value of ['', undefined, null, '2005-02-30', '2005-13-01', 'October 30', '2027-01-01']) assert.equal(studentAge(value, new Date('2026-10-30T00:00:00Z')), null);
});

test('hometown is optional, bounded and trimmed; partial information remains usable', async () => {
  const { hometownFields, hometownLabel, fillHometownForm, hometownForm } = await import('../assets/js/core/StudentPersonalInfo.js');
  assert.deepEqual(hometownFields(), { hometownBarangay: '', hometownCity: '', hometownProvince: '' });
  const expected = { hometownBarangay: 'San Juan', hometownCity: 'Bontoc', hometownProvince: 'Southern Leyte' };
  assert.deepEqual(hometownFields({ ...expected, hometownCity: ' Bontoc ' }), expected);
  assert.equal(hometownLabel({ hometownProvince: 'Southern Leyte' }), 'Southern Leyte');
  assert.equal(hometownLabel(), 'Not provided');
  for (const [key, limit] of Object.entries({ hometownBarangay: 80, hometownCity: 120, hometownProvince: 120 })) {
    for (const value of [true, null, {}, [], 'a'.repeat(limit + 1)]) assert.throws(() => hometownFields({ [key]: value }), /valid hometown/);
    assert.equal(hometownFields({ [key]: 'a'.repeat(limit) })[key].length, limit);
  }
  const nodes = new Map(), document = { querySelector: id => { if (!nodes.has(id)) nodes.set(id, { value: 'old' }); return nodes.get(id); } };
  fillHometownForm(document, 'profile', expected);
  assert.deepEqual(hometownForm(document, 'profile'), expected);
  fillHometownForm(document, 'profile', {});
  assert.deepEqual(hometownForm(document, 'profile'), hometownFields());
});
