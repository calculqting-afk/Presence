const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../assets/js/core/PresenceSession.js');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deadline() {
  let expire, cleared;
  return { options: { setTimer: callback => { expire = callback; return 7; }, clearTimer: id => { cleared = id; } },
    expire: () => expire(), cleared: () => cleared };
}

test('stalled heartbeat cannot prevent sign-out or start writes after a later login', async () => {
  const { endPresenceSession } = await load(); const clock = deadline();
  let finish, signedOut = false; const writes = [];
  const state = { presenceSessionId: 's_device', presenceWrite: new Promise(resolve => { finish = resolve; }) };
  const pending = (async () => {
    await endPresenceSession({ user: { uid: 's' }, state, window: { clearInterval() {} },
      write: (...args) => writes.push(args), deadline: clock.options });
    signedOut = true;
  })();
  assert.equal(state.studentLoggedOut, true); await flush(); assert.equal(signedOut, false);
  clock.expire(); await pending; assert.equal(signedOut, true); assert.equal(clock.cleared(), 7);
  state.studentLoggedOut = false; finish(); await flush(); assert.deepEqual(writes, []);
});

test('stalled logout writes time out and late failures are handled', async () => {
  const { endPresenceSession } = await load(); const clock = deadline(); const reject = [];
  const pending = endPresenceSession({ user: { uid: 's' }, state: { presenceSessionId: 's_device' },
    window: { clearInterval() {} }, write: () => new Promise((resolve, fail) => reject.push(fail)), deadline: clock.options });
  await flush(); assert.equal(reject.length, 2); clock.expire(); assert.equal(await pending, false);
  reject.forEach(fail => fail(Error('offline'))); await flush();
});

test('successful cleanup clears its deadline and failed cleanup remains best effort', async () => {
  const { bestEffortCleanup } = await load(); const clock = deadline();
  assert.equal(await bestEffortCleanup(async () => {}, clock.options), true); assert.equal(clock.cleared(), 7);
  assert.equal(await bestEffortCleanup(() => { throw Error('offline'); }, clock.options), false);
});

test('notification cleanup cannot indefinitely block sign-out', async () => {
  const { bestEffortCleanup } = await load(); const clock = deadline(); let signedOut = false;
  const pending = (async () => {
    await bestEffortCleanup(() => new Promise(() => {}), clock.options); signedOut = true;
  })();
  await flush(); clock.expire(); await pending; assert.equal(signedOut, true);
});
