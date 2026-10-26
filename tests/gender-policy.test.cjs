const test = require('node:test');
const assert = require('node:assert/strict');
test('gender never infers missing/invalid profile data and canonicalizes stored labels', async () => {
  const { GenderPolicy } = await import('../assets/js/core/GenderPolicy.js');
  assert.equal(GenderPolicy.normalize(' female '), 'Female');
  assert.equal(GenderPolicy.normalize('male'), 'Male');
  for (const value of [undefined, '', null, 'unknown', '<img>', '__proto__', 'constructor']) assert.equal(GenderPolicy.label(value), 'Not specified');
  assert.equal(GenderPolicy.valid(undefined), true); assert.equal(GenderPolicy.valid(''), true);
  assert.equal(GenderPolicy.valid('invalid'), false); assert.equal(GenderPolicy.valid(null), false);
});
