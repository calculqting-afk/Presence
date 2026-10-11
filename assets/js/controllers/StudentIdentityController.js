// Display-only identity handoff. Never use this cache for permissions or writes.
export class StudentIdentityController {
  constructor({ document = globalThis.document, storage = globalThis.sessionStorage, now = Date.now } = {}) {
    Object.assign(this, { document, storage, now });
    this.key = 'presence.studentIdentity';
  }
  save(uid, profile) {
    if (!uid || !profile) return;
    const identity = {};
    for (const field of ['firstName', 'middleName', 'lastName', 'course', 'section', 'photoDataUrl']) {
      const value = profile[field];
      if (typeof value === 'string' && value.length <= (field === 'photoDataUrl' ? 200000 : 200)) identity[field] = value;
    }
    try { this.storage?.setItem(this.key, JSON.stringify({ uid, savedAt: this.now(), identity })); } catch {}
  }
  restore(uid) {
    try {
      const record = JSON.parse(this.storage?.getItem(this.key) || 'null');
      if (!record || record.uid !== uid || !Number.isFinite(record.savedAt) || this.now() - record.savedAt < 0 || this.now() - record.savedAt > 15 * 60 * 1000) {
        this.clear(); return false;
      }
      this.render(record.identity); return true;
    } catch { this.clear(); return false; }
  }
  render(identity) {
    if (!identity || typeof identity !== 'object') return;
    const name = [identity.firstName, identity.middleName, identity.lastName].filter(value => typeof value === 'string').join(' ') || 'Student';
    const initials = [identity.firstName, identity.lastName].map(value => typeof value === 'string' ? value.trim().charAt(0) : '').join('').toUpperCase() || 'ST';
    const photo = typeof identity.photoDataUrl === 'string' && /^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/i.test(identity.photoDataUrl) ? identity.photoDataUrl : '';
    this.document.querySelectorAll('[data-student-name]').forEach(node => { node.textContent = name; });
    this.document.querySelectorAll('[data-student-meta]').forEach(node => { node.textContent = `${identity.course || 'Course pending'} · Section ${identity.section || 'pending'}`; });
    this.document.querySelectorAll('[data-student-first-name]').forEach(node => { node.textContent = identity.firstName || 'Student'; });
    this.document.querySelectorAll('[data-student-initials]').forEach(node => { node.textContent = initials; node.hidden = Boolean(photo); });
    this.document.querySelectorAll('[data-student-photo]').forEach(node => { if (photo) node.src = photo; else node.removeAttribute('src'); node.hidden = !photo; });
  }
  clear() {
    try { this.storage?.removeItem(this.key); } catch {}
  }
}
