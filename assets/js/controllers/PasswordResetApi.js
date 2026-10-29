export class PasswordResetApi {
  constructor({ url = 'https://presence-admin-api.mikhailovna2007.workers.dev', fetcher = globalThis.fetch.bind(globalThis) } = {}) { Object.assign(this, { url, fetcher }); }
  async call(path, user, body) {
    const token = await user.getIdToken(true);
    const response = await this.fetcher(this.url + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(60000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Presence service unavailable. Retry later.');
    return result;
  }
  reset(user, studentUid, reason) { return this.call('/v1/admin/password-reset', user, { studentUid, reason, operationId: crypto.randomUUID() }); }
  complete(user, newPassword) { return this.call('/v1/student/password-change', user, { newPassword }); }
}
