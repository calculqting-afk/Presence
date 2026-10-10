export class SurveyLinkService {
  constructor({ href = globalThis.location?.href } = {}) { this.href = href; }
  eventId() {
    const value = new URL(this.href).searchParams.get('survey');
    return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
  }
  url(eventId) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) throw new Error('Invalid event link.');
    const url = new URL(this.href);
    url.pathname = url.pathname.replace(/pages\/(?:student|admin)-dashboard(?:\.html)?$/, 'index.html');
    url.search = ''; url.hash = ''; url.searchParams.set('survey', eventId);
    return url.href;
  }
}
