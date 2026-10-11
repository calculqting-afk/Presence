// Authenticated Drive upload/reset and Firestore acknowledgement are separate steps.
export class FaceRegistrationService {
  constructor({
    endpoint,
    getUser,
    loadRegistration,
    loadResetResult,
    createRequestId = () => globalThis.crypto.randomUUID(),
    // Keep the browser receiver: calling native fetch as this.fetch() would
    // otherwise pass the service instance as `this` and can throw Illegal invocation.
    fetch = (...args) => globalThis.fetch(...args),
    now = () => Date.now(),
    requestTimeoutMs = 15000,
    schedule = (callback, ms) => setTimeout(callback, ms),
    cancel = timer => clearTimeout(timer),
    delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  }) {
    Object.assign(this, {
      endpoint,
      getUser,
      loadRegistration,
      loadResetResult,
      createRequestId,
      fetch,
      now,
      requestTimeoutMs,
      schedule,
      cancel,
      delay
    });
    this.resetRequests = new Map();
  }
  async withTimeout(operation, timeoutMs, message) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = this.schedule(() => reject(new Error(message)), timeoutMs);
        })
      ]);
    } finally {
      this.cancel(timer);
    }
  }
  async send(payload) {
    if (!this.endpoint) throw new Error('Face-photo storage is not configured.');
    const idToken = await this.withTimeout(() => this.getUser().getIdToken(), this.requestTimeoutMs,
      'Sign-in verification timed out. Check your connection and sign in again.');
    // Apps Script receives an authenticated simple POST; confirmation is read separately.
    await this.withTimeout(() => this.fetch(this.endpoint, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        ...payload,
        idToken
      })
    }), this.requestTimeoutMs,
    'The Drive request was not confirmed. Refresh student status before retrying; the request may still complete.');
  }
  upload(imageDataUrl, student = {}) {
    return this.send({
      imageDataUrl,
      studentName: [student.firstName, student.lastName].filter(Boolean).join(' '),
      studentId: student.accountId || '',
      section: student.section || ''
    });
  }
  reset(studentUid, options = {}) {
    const requestId = this.loadResetResult ? this.createRequestId() : undefined;
    if (requestId) this.resetRequests.set(studentUid, requestId);
    return this.send({
      action: 'reset',
      studentUid,
      requestId,
      recoverMissing: options.recoverMissing === true,
      recoveryReason: options.recoveryReason || ''
    });
  }
  async waitForRegistration(studentUid, shouldExist, timeoutMs = 20000) {
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      const snapshot = await this.withTimeout(() => this.loadRegistration(studentUid), deadline - this.now(),
        'Firebase status could not be confirmed. Refresh student status before retrying.');
      if (snapshot.exists() === shouldExist) return snapshot;
      const requestId = !shouldExist && this.resetRequests.get(studentUid);
      if (requestId && this.loadResetResult) {
        const result = await this.withTimeout(() => this.loadResetResult(requestId), Math.max(1, deadline - this.now()),
          'Reset status could not be confirmed. Check deployed Firestore Rules and refresh student status.');
        if (result.exists() && result.data().status === 'failed') throw new Error(result.data().error || 'The reset service rejected this request.');
      }
      await this.delay(Math.min(800, Math.max(0, deadline - this.now())));
    }
    return null;
  }
}
