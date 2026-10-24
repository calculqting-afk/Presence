const test = require('node:test');
const assert = require('node:assert/strict');

test('request filters combine student search, section, and status', async () => {
  const { CorrectionRequestFilters: Filters } = await import('../assets/js/controllers/CorrectionRequestFilters.js');
  const student = { uid: 'u1', accountId: '2510004-1', firstName: 'Apollo', middleName: 'Balacuit', lastName: 'Paderes', section: '2A', email: 'test@example.com' };
  const request = { studentUid: 'u1', status: 'pending' };
  for (const search of ['apollo', 'PADERES', 'Apollo 2510004', 'test@example', 'balacuit', '  Apollo   Paderes  ']) {
    assert.equal(Filters.matches(request, student, { search, status: 'pending', section: '2A' }), true, search);
  }
  for (const filters of [{ section: '2B' }, { status: 'approved' }, { search: 'different student' }, { search: 'Apollo', section: '2B' }]) assert.equal(Filters.matches(request, student, filters), false);
  assert.equal(Filters.matches(request, student, { status: 'all' }), true);
});
test('year level is display-only and unknown profiles do not match a section', async () => {
  const { CorrectionRequestFilters: Filters } = await import('../assets/js/controllers/CorrectionRequestFilters.js');
  for (const [section, year] of [['1A', '1'], ['2B', '2'], ['3A', '3'], ['4B', '4'], ['', ''], ['unknown', '']]) assert.equal(Filters.year(section), year);
  const request = { studentUid: 'missing-user', status: 'approved' };
  assert.equal(Filters.matches(request, null, { search: 'missing-user' }), true);
  assert.equal(Filters.matches(request, null, { section: '2A' }), false);
  assert.equal(Filters.matches(request, { accountId: '2510004-1', section: '3A' }, { year: '2' }), true);
});
