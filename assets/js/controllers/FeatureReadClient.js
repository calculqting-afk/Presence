import { PasswordResetApi } from './PasswordResetApi.js';

// Firestore timestamps cross the API as ISO strings; preserve the UI's familiar
// toDate/toMillis interface without exposing Firebase document references.
export function hydrateFeature(value, field = '') {
  if (/At$/.test(field) && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    return { toDate: () => new Date(value), toMillis: () => Date.parse(value), seconds: Math.floor(Date.parse(value) / 1000) };
  }
  if (Array.isArray(value)) return value.map(hydrateFeature);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrateFeature(item, key)]));
  return value;
}

export class FeatureReadClient {
  constructor(getUser, api) { this.getUser = getUser; this.api = api; }
  call(path, body) { this.api ||= new PasswordResetApi(); return this.api.call(path, this.getUser(), body, { forceRefresh: false }); }
  async activity(body) {
    const page = await this.call('/v1/admin/activity', body);
    return { ...page, rows: page.rows.map(hydrateFeature) };
  }
  async responses(eventId, cursor) {
    const page = await this.call('/v1/surveys/read', { eventId, operation: 'responses', cursor });
    return { ...page, rows: page.rows.map(hydrateFeature) };
  }
  invalidate(eventId) { return this.call('/v1/surveys/read', { eventId, operation: 'invalidate' }); }
}
