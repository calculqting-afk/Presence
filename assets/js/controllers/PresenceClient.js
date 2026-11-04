import { PasswordResetApi } from './PasswordResetApi.js';

// Enable only after the D1 schema, binding and backend are verified remotely.
export const D1_PRESENCE_ENABLED = true;
export const PRESENCE_HEARTBEAT_MS = D1_PRESENCE_ENABLED ? 300000 : 60000;

export class PresenceClient {
  constructor(api) { this.api = api; this.lastOnline = 0; }
  call(...args) { this.api ||= new PasswordResetApi(); return this.api.call(...args); }
  async write(user, online) {
    if (online && Date.now() - this.lastOnline < PRESENCE_HEARTBEAT_MS - 1000) return;
    // Enroll restored tabs once after deployment, rather than reading Firestore
    // for every heartbeat. Existing session verification also checks disabled accounts.
    if (!this.confirmed) {
      const status = await this.call('/v1/session/status', user, {}, { forceRefresh: false });
      if (!status.current) throw Error('Sign in again to synchronize online status.');
      this.confirmed = true;
    }
    await this.call('/v1/presence/heartbeat', user, { online }, { forceRefresh: false });
    this.lastOnline = online ? Date.now() : 0;
  }
  async list(user) {
    const result = await this.call('/v1/admin/presence', user, {}, { forceRefresh: false });
    const timestamp = value => ({ toMillis: () => value, toDate: () => new Date(value) });
    return result.sessions.map(session => ({ ...session, lastSeen: timestamp(session.lastSeen), ttlMs: result.ttlMs }));
  }
}
