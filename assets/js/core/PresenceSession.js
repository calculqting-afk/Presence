/** Optional cleanup must never hold authentication open waiting for the network. */
export async function bestEffortCleanup(task, {
  timeoutMs = 1500,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout
} = {}) {
  let active = true, timer;
  const deadline = new Promise(resolve => {
    timer = setTimer(() => { active = false; resolve(false); }, timeoutMs);
  });
  const cleanup = Promise.resolve().then(() => task(() => active)).then(() => true, () => false);
  try { return await Promise.race([cleanup, deadline]); }
  finally { active = false; clearTimer(timer); }
}

/** End only this tab's student session, before Firebase authentication is removed. */
export async function endPresenceSession({ user, state, window, storage, write, deadline }) {
  state.studentLoggedOut = true;
  window.clearInterval(state.presenceHeartbeatTimer);
  let sessionId = state.presenceSessionId;
  try { sessionId ||= storage?.getItem('presenceDeviceSession'); } catch {}
  if (!user?.uid || !sessionId?.startsWith(`${user.uid}_`)) return;
  return bestEffortCleanup(async isCurrent => {
    // Preserve ordering while connected. If it stalls, sign out without starting
    // delayed writes in a later login; the last heartbeat will expire normally.
    await Promise.resolve(state.presenceWrite).catch(() => {});
    if (!isCurrent()) return;
    await Promise.allSettled([
      Promise.resolve().then(() => write('presenceSessions', sessionId, { studentUid: user.uid, sessionId })),
      Promise.resolve().then(() => write('presence', user.uid, {}))
    ]);
  }, deadline);
}
