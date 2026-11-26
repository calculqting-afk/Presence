import { collection, doc, query, where, orderBy, limit, startAfter, getDocsFromServer, getDocFromServer, getCountFromServer } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { ControllerScope } from '../../core/shared/ControllerScope.js';
import { hasPermission } from '../../core/security/permissions.js';

export class CorrectionRequestRepository {
  constructor(db) { this.db = db; }
  async page({ status = 'pending', studentUid = '', cursor = null }) {
    if (!['pending', 'approved', 'declined', 'all'].includes(status)) throw Error('Choose a request status.');
    const constraints = [];
    if (status !== 'all') constraints.push(where('status', '==', status));
    if (studentUid) constraints.push(where('studentUid', '==', studentUid));
    constraints.push(orderBy('submittedAt', 'desc'));
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(25));
    const snapshot = await getDocsFromServer(query(collection(this.db, 'attendanceCorrectionRequests'), ...constraints));
    return { rows: snapshot.docs.map(item => ({ ...item.data(), id: item.id })), cursor: snapshot.docs.at(-1) || cursor, more: snapshot.docs.length === 25 };
  }
  async resolveStudentId(id) {
    if (!id || id.length > 100 || /[\u0000-\u001f/]/.test(id)) throw Error('Enter a valid, complete Student ID.');
    const snapshot = await getDocsFromServer(query(collection(this.db, 'students'), where('accountId', '==', id), limit(1)));
    return snapshot.docs[0]?.id || '';
  }
  async count() {
    return (await getCountFromServer(query(collection(this.db, 'attendanceCorrectionRequests'), where('status', '==', 'pending')))).data().count;
  }
  async detail(kind, id) {
    if (!['students', 'events'].includes(kind) || !/^[A-Za-z0-9_-]{1,128}$/.test(id || '')) throw Error('Invalid request details.');
    const snapshot = await getDocFromServer(doc(this.db, kind, id));
    return snapshot.exists() ? { ...snapshot.data(), [kind === 'students' ? 'uid' : 'id']: id } : null;
  }
  async decision(id) {
    const snapshot = await getDocFromServer(doc(this.db, 'attendanceCorrectionRequests', id));
    return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id || id } : null;
  }
}

// Admin-only, server-confirmed pages. No listeners, polling or persistent storage.
export class CorrectionRequestReader {
  constructor({ controller, repository = new CorrectionRequestRepository(controller.db), now = () => Date.now() }) {
    Object.assign(this, { controller, repository, now });
    this.scope = new ControllerScope(); this.generation = 0; this.status = 'pending'; this.studentId = ''; this.studentUid = '';
    this.ownerUid = controller.user.uid; this.more = false; this.metadata = new Map();
    this.supportsMetadata = typeof repository.detail === 'function';
  }
  field(selector) { return this.controller.root.querySelector(selector); }
  active() {
    const c = this.controller;
    return this.scope.initialized && !this.suspended && c.initialized && c.getUser()?.uid === this.ownerUid
      && hasPermission(c.role, 'correctAttendance') && c.getView() === 'correction-requests' && c.root.ownerDocument?.visibilityState !== 'hidden';
  }
  initialize() {
    if (!this.scope.initialize()) return;
    const c = this.controller;
    this.scope.listen(c.window, 'presence:viewchange', () => this.visibility());
    this.scope.listen(c.root.ownerDocument, 'visibilitychange', () => this.visibility());
    this.scope.listen(c.window, 'presence:device-signing-out', () => { this.suspended = true; this.clear(); });
    this.scope.listen(c.window, 'presence:device-signout-failed', () => { this.suspended = false; this.visibility(); });
    this.scope.listen(c.window, 'presence:password-session-start', () => { this.suspended = true; this.stop(); });
    this.scope.listen(c.window, 'presence:password-session-ready', () => { this.suspended = false; this.visibility(); });
    this.visibility();
  }
  stop() { this.generation++; this.loading = false; this.countTask = null; }
  clear() {
    this.stop(); this.metadata.clear(); this.controller.requests = []; this.controller.available = false; this.controller.declineDrafts.clear();
    this.loadedAt = undefined; this.countAt = undefined; this.cursor = null; this.more = false;
    this.studentId = ''; this.studentUid = ''; this.status = 'pending'; this.noStudent = false; this.needsResolution = false;
    const idField = this.field('[data-request-id]'), statusField = this.field('[data-request-filter]');
    if (idField) idField.value = ''; if (statusField) statusField.value = 'pending';
    this.field('[data-request-list]').innerHTML = ''; this.controller.updateBadge(0);
  }
  visibility() {
    if (this.controller.getUser()?.uid !== this.ownerUid) { this.clear(); return; }
    if (!this.active()) { this.stop(); return; }
    if (this.needsResolution) { void this.search(this.studentId, this.status, true); return; }
    if (this.loadedAt !== undefined && this.now() - this.loadedAt < 60000 && !this.stale) {
      this.controller.render(); this.draw(); void this.refreshCount();
    } else void this.load(true);
  }
  async search(id = this.studentId, status = this.status, force = false) {
    if (!this.active() || this.controller.busy) return;
    id = String(id || '').trim();
    if (force) this.metadata.clear();
    if (!['pending', 'approved', 'declined', 'all'].includes(status)) return;
    const reuseUid = id === this.studentId && !force;
    this.stop(); this.status = status; this.studentId = id; this.loadedAt = undefined;
    this.needsResolution = !reuseUid;
    this.controller.requests = []; this.controller.available = false; this.cursor = null; this.more = false;
    this.field('[data-request-list]').innerHTML = '';
    const generation = this.generation;
    this.loading = true; this.error = ''; this.draw();
    try {
      const resolvedUid = reuseUid ? this.studentUid : id ? await this.repository.resolveStudentId(id) : '';
      if (generation !== this.generation || !this.active()) return;
      this.studentUid = resolvedUid; this.needsResolution = false;
      this.noStudent = Boolean(id && !this.studentUid);
      this.loading = false;
      await this.load(true, force);
    } catch (error) {
      if (generation !== this.generation || !this.active()) return;
      this.loading = false; this.error = this.message(error); this.draw();
    }
  }
  async load(reset = false, forceCount = false) {
    if (!this.active() || this.loading || this.needsResolution || this.controller.busy || !reset && !this.more) return;
    if (reset) {
      this.stop(); this.cursor = null; this.more = false; this.controller.requests = []; this.controller.available = false;
      this.field('[data-request-list]').innerHTML = '';
    }
    const generation = this.generation;
    this.loading = true; this.error = ''; this.draw();
    if (reset) void this.refreshCount(forceCount);
    try {
      const result = this.noStudent ? { rows: [], cursor: null, more: false }
        : await this.repository.page({ status: this.status, studentUid: this.studentUid, cursor: this.cursor });
      if (generation !== this.generation || !this.active()) return;
      await this.loadDetails(result.rows, generation, !forceCount);
      if (generation !== this.generation || !this.active()) return;
      const ids = new Set(this.controller.requests.map(item => item.id));
      this.controller.requests.push(...result.rows.filter(item => !ids.has(item.id)));
      this.cursor = result.cursor; this.more = result.more; if (reset || this.loadedAt === undefined) this.loadedAt = this.now(); this.stale = false;
      this.controller.available = true; this.controller.render();
    } catch (error) {
      if (generation === this.generation && this.active()) this.error = this.message(error);
    } finally {
      if (generation === this.generation && this.active()) { this.loading = false; this.draw(); }
    }
  }
  detailValues(kind) {
    const ids = new Set(this.controller.requests.map(item => kind === 'students' ? item.studentUid : item.eventId));
    return [...ids].map(id => this.metadata.get(kind + ':' + id)?.value).filter(Boolean);
  }
  cacheDetail(kind, id, value, at = this.now()) {
    const fields = kind === 'students' ? ['uid','accountId','firstName','middleName','lastName','section','email'] : ['id','name','date','sessionPeriod','sessionGroupId','timeIn','timeOut'];
    this.metadata.set(kind + ':' + id, { at, value: value && Object.fromEntries(fields.map(field => [field, value[field]])) });
  }
  async loadDetails(records, generation, allowSeed = true) {
    if (!this.supportsMetadata) return;
    const missing = new Map();
    for (const record of records) for (const [kind, id] of [['students', record.studentUid], ['events', record.eventId]]) {
      const seed = allowSeed && this.controller.getCachedDetail?.(kind, id);
      if (!this.metadata.has(kind + ':' + id) && seed?.value && this.now() - seed.at >= 0 && this.now() - seed.at < 60000) this.cacheDetail(kind, id, seed.value, seed.at);
      const cached = this.metadata.get(kind + ':' + id);
      if (!cached || this.now() - cached.at >= 60000) missing.set(kind + ':' + id, [kind, id]);
    }
    const entries = [...missing.values()];
    // Bound parallel reads and stop starting more batches after navigation.
    for (let offset = 0; offset < entries.length; offset += 10) {
      if (generation !== this.generation || !this.active()) return;
      const batch = entries.slice(offset, offset + 10);
      const results = await Promise.allSettled(batch.map(([kind, id]) => this.repository.detail(kind, id)));
      if (generation !== this.generation || !this.active()) return;
      results.forEach((result, index) => { if (result.status === 'fulfilled') this.cacheDetail(...batch[index], result.value); });
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
  }
  async reviewDetails(record) {
    if (!this.supportsMetadata) return;
    const generation = this.generation;
    if (!this.active()) throw Error('Return to Correction Requests and refresh before reviewing.');
    const [student, event] = await Promise.all([this.repository.detail('students', record.studentUid), this.repository.detail('events', record.eventId)]);
    if (generation !== this.generation || !this.active()) throw Error('Review cancelled after navigation or session change.');
    if (!student || !event || student.active === false) throw Error('The student or event is unavailable. Refresh the request list.');
    this.cacheDetail('students', record.studentUid, student); this.cacheDetail('events', record.eventId, event);
    return { student, event };
  }
  message(error) {
    return error.code === 'failed-precondition' ? 'Request indexes are not ready. Try Refresh shortly.'
      : error.code === 'permission-denied' ? 'Request access was denied. Sign in again to verify your access.'
        : 'Could not load requests. Check your connection and try again.';
  }
  async refreshCount(force = false) {
    if (!this.active() || this.countTask && !force || !force && this.countAt !== undefined && this.now() - this.countAt < 60000) return;
    const generation = this.generation;
    const task = this.countTask = this.repository.count();
    try {
      const count = await task;
      if (generation === this.generation && this.active() && this.countTask === task) { this.controller.updateBadge(count); this.countAt = this.now(); this.countFailed = false; }
    } catch { if (generation === this.generation && this.active()) this.countFailed = true; }
    finally { if (this.countTask === task) { this.countTask = null; this.draw(); } }
  }
  async decisionSaved(id, status, reason) {
    const c = this.controller;
    const saved = c.requests.find(item => item.id === id);
    // The write already succeeded. Do not present a reconciliation error as a failed save.
    if (saved) { Object.assign(saved, { status, decisionReason: reason, reviewedByName: '', reviewedAt: null }); c.render(); }
    this.stale = true;
    if (!this.active()) return;
    const generation = this.generation;
    void this.refreshCount(true);
    try {
      const record = await this.repository.decision(id);
      if (generation !== this.generation || !this.active()) return;
      const index = c.requests.findIndex(item => item.id === id);
      if (record && index >= 0) c.requests[index] = record;
      c.render();
    } catch { if (generation === this.generation && this.active()) this.error = 'Decision saved. Refresh to verify its latest details.'; }
    this.draw();
  }
  draw() {
    if (!this.scope.initialized || !this.active()) return;
    const updated = this.loadedAt === undefined ? '' : 'Last updated: ' + new Date(this.loadedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) + ' (PH).';
    this.field('[data-request-sync]').textContent = this.loading ? 'Loading requests…' : this.error || (this.studentId ? 'Student ID: ' + this.studentId + '. ' : '') + (this.noStudent ? 'No student found for that exact Student ID. ' : '') + updated + ' Name and section filters search loaded requests only.';
    const count = this.field('[data-request-loaded]');
    if (count) count.textContent = `${this.controller.requests.length} requests loaded${this.more ? ' · More available' : ''}.` + (this.countFailed ? ' Pending count unavailable; its last value is retained.' : '');
    for (const selector of ['[data-request-more]', '[data-request-refresh]', '[data-request-id-submit]', '[data-clear-request-filters]', '[data-request-filter]']) {
      const field = this.field(selector); if (field) field.disabled = Boolean(this.loading || this.controller.busy);
    }
    const more = this.field('[data-request-more]'); if (more) more.hidden = !this.more;
  }
  dispose() { this.clear(); this.scope.dispose(); }
}
