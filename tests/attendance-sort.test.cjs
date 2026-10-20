const test = require('node:test');
const assert = require('node:assert/strict');


test('attendance ordering uses exact arrival time, handles legacy/missing timestamps and keeps ties stable', async () => {
  const { AttendanceSort } = await import('../assets/js/controllers/AttendanceSort.js');
  const records = [
    { id: 'first', name: 'Zoe', checkedInAt: { seconds: 10, nanoseconds: 1000000 }, checkedOutAt: new Date(90000) },
    { id: 'last', name: 'Ana', checkedInAt: { seconds: 10, nanoseconds: 2000000 } },
    { id: 'legacy', name: 'Ben', attendedAt: { toDate: () => new Date(9000) } },
    { id: 'absent', name: 'Cara' },
    { id: 'out-only', name: 'Dan', checkedOutAt: new Date(100000) },
    { id: 'invalid', name: 'Eve', checkedInAt: { toMillis() { throw Error('invalid'); } } }
  ];
  const order = sort => [...records].sort((a, b) => AttendanceSort.compare(a, b, { sort, name: r => r.name, key: r => r.id })).map(r => r.id);
  assert.deepEqual(order('check-in-desc'), ['last', 'first', 'legacy', 'absent', 'out-only', 'invalid']);
  assert.deepEqual(order('check-in-asc'), ['legacy', 'first', 'last', 'absent', 'out-only', 'invalid']);
  assert.deepEqual(order('no-check-in'), ['absent', 'out-only', 'invalid', 'last', 'first', 'legacy']);
  assert.deepEqual(order('name-desc'), ['first', 'invalid', 'out-only', 'absent', 'legacy', 'last']);
  assert.equal(records[0].id, 'first', 'source records are not mutated');
  assert.equal(AttendanceSort.checkIn({ checkedInAt: null, attendedAt: { toMillis: () => 123 } }), 123);
  assert.ok(Number.isNaN(AttendanceSort.checkIn({ checkedInAt: Infinity })));
  const ties = [{ id: 'b', name: 'Same', checkedInAt: 100 }, { id: 'a', name: 'Same', checkedInAt: 100 }];
  ties.sort((a,b) => AttendanceSort.compare(a,b,{ name: r => r.name, key: r => r.id }));
  assert.deepEqual(ties.map(r => r.id), ['a', 'b']);
});
