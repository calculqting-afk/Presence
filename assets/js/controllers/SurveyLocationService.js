import { GeofenceBoundary } from './GeofenceBoundary.js';

// Client evidence only: deliberately does not claim trusted/server GPS validation.
export class SurveyLocationService {
  constructor({ loadBoundary, geolocation = globalThis.navigator?.geolocation, secure = globalThis.isSecureContext, now = () => Date.now() } = {}) {
    Object.assign(this, { loadBoundary, geolocation, secure, now });
  }
  async check(eventId, { onProgress = () => {}, isCancelled = () => false } = {}) {
    if (!this.secure) throw this.issue('unavailable', 'Location requires HTTPS (or localhost). Open the published HTTPS website to test on a phone.');
    if (!this.geolocation) throw this.issue('unavailable', 'Location is unavailable in this browser.');
    const area = await this.loadBoundary(eventId);
    if (!area?.enabled) throw this.issue('unavailable', 'The organizer must configure an enabled event boundary first.');
    const boundary = GeofenceBoundary.create(area);
    // At most two one-shot requests; no background tracking or boundary expansion.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (isCancelled()) throw this.issue('unavailable', 'Location check cancelled. Reopen the survey to continue.');
      try {
        const position = await this.readPosition(attempt === 0 ? 10000 : 5000);
        if (isCancelled()) throw this.issue('unavailable', 'Location check cancelled. Reopen the survey to continue.');
        const { latitude, longitude, accuracy } = this.validatePosition(position);
        const result = boundary.evaluate({ latitude, longitude }, 0);
        if (!result.inside) throw this.issue('outside', 'Your reported location is outside the event boundary. Move inside and retry, or request review if GPS is inaccurate.');
        return { result: 'inside', boundaryType: result.type, accuracy: Math.round(accuracy), method: 'browser' };
      } catch (error) {
        if (attempt === 1 || !error.retryable || isCancelled()) throw error;
        onProgress(error.locationReason === 'accuracy' ? `Improving location (${Math.ceil(error.accuracy)} m)…` : 'Retrying fresh location…');
      }
    }
  }
  readPosition(timeout) {
    return new Promise((resolve, reject) => this.geolocation.getCurrentPosition(resolve, error => reject(Object.assign(
      this.issue('unavailable', ({ 1: 'Location permission was denied. Allow access in browser/device settings, or request administrative review.', 2: 'Your location could not be determined. Retry with device location enabled, or request review.', 3: 'Location timed out. Retry, or request administrative review.' })[error.code] || 'Location unavailable.'),
      { retryable: error.code === 2 || error.code === 3 }
    )), { enableHighAccuracy: true, maximumAge: 0, timeout }));
  }
  validatePosition(position) {
    const { latitude, longitude, accuracy } = position?.coords || {};
    if (![latitude, longitude, accuracy].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) throw this.issue('unavailable', 'The browser returned invalid location data. Retry or request administrative review.');
    if (!Number.isFinite(position.timestamp) || Math.abs(this.now() - position.timestamp) > 30000) throw Object.assign(this.issue('unavailable', 'The location reading is stale (over 30 seconds old) or has an invalid timestamp. Retry or request review.'), { retryable: true, locationReason: 'stale' });
    if (accuracy > 50) throw Object.assign(this.issue('unavailable', `Location is insufficiently precise: reported accuracy ${Math.ceil(accuracy)} m; required 50 m or better. Allow precise location on a phone using the HTTPS site, or request administrative review. Permission alone does not guarantee accuracy.`), { retryable: true, locationReason: 'accuracy', accuracy });
    return { latitude, longitude, accuracy };
  }
  issue(issue, message) { return Object.assign(new Error(message), { surveyIssue: issue }); }
}
