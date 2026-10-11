// Authenticated Drive upload/reset and Firestore acknowledgement are separate steps.
export class FaceRegistrationService {
  constructor({
    endpoint,
    getUser,
    loadRegistration,
    fetch = globalThis.fetch,
    now = () => Date.now(),
    delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  }) {
    Object.assign(this, {
      endpoint,
      getUser,
      loadRegistration,
      fetch,
      now,
      delay
    });
  }
  async send(payload) {
    if (!this.endpoint) throw new Error('Face-photo storage is not configured.');
    const idToken = await this.getUser().getIdToken();
    // Apps Script receives an authenticated simple POST; confirmation is read separately.
    await this.fetch(this.endpoint, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        ...payload,
        idToken
      })
    });
  }
  upload(imageDataUrl, student = {}) {
    return this.send({
      imageDataUrl,
      studentName: [student.firstName, student.lastName].filter(Boolean).join(' '),
      studentId: student.accountId || '',
      section: student.section || ''
    });
  }
  reset(studentUid) {
    return this.send({
      action: 'reset',
      studentUid
    });
  }
  async waitForRegistration(studentUid, shouldExist, timeoutMs = 20000) {
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      const snapshot = await this.loadRegistration(studentUid);
      if (snapshot.exists() === shouldExist) return snapshot;
      await this.delay(800);
    }
    return null;
  }
}
