import { collection, query, where, orderBy, limit, startAfter, getDocsFromServer, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { AttendanceToolbarController } from './AttendanceToolbarController.js';

export class AttendanceRepository {
  constructor(db, fetch = getDocsFromServer) { this.db = db; this.fetch = fetch; }
  reference({ from = '', to = '', cursor = null, size = 100 }) {
    const constraints = [orderBy('eventDate', 'desc')];
    if (from) constraints.push(where('eventDate', '>=', from));
    if (to) constraints.push(where('eventDate', '<=', to));
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(size));
    return query(collection(this.db, 'attendance'), ...constraints);
  }
  async page(options) {
    const snapshot = await this.fetch(this.reference(options));
    return { records: snapshot.docs.map(item => ({ id: item.id, ...item.data() })),
      cursor: snapshot.docs.at(-1) || options.cursor, more: snapshot.docs.length === (options.size || 100) };
  }
  watch(options, receive, onError) {
    return onSnapshot(this.reference({ ...options, cursor: null }), { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.metadata.fromCache) receive(snapshot.docs.map(item => ({ id: item.id, ...item.data() })), snapshot.docs.at(-1));
    }, onError);
  }
}

// Dates are server-filtered; other filters apply to the fetched window. Loading
// is explicit and bounded, including when searching sparse historical matches.
export class AttendanceHistoryController {
  constructor({ repository, getStudents, getEvents, summary, render, notify, onStatus = () => {}, pageSize = 20 }) {
    Object.assign(this, { repository, getStudents, getEvents, summary, render, notify, onStatus, pageSize });
    this.records = []; this.generation = 0; this.page = 0; this.more = true;
  }
  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.form = document.querySelector('#attendanceFilters');
    this.info = document.querySelector('#attendancePageInfo');
    this.previous = document.querySelector('#previousAttendancePage');
    this.next = document.querySelector('#nextAttendancePage');
    this.toolbar = new AttendanceToolbarController({ form: this.form, prefix: 'attendance', onClear: () => { void this.reload(); } });
    this.toolbar.initialize();
    this.onFilter = event => {
      event.preventDefault();
      void this.reload();
    };
    this.onPrevious = () => { this.page = Math.max(0, this.page - 1); this.draw(); };
    this.onNext = async () => {
      if (this.busy) return;
      if ((this.page + 1) * this.pageSize < this.filtered().length) this.page++;
      else if (this.more) {
        const previousCount = this.filtered().length;
        const pageWasFull = previousCount >= (this.page + 1) * this.pageSize;
        await this.load();
        if (pageWasFull && this.filtered().length > (this.page + 1) * this.pageSize) this.page++;
      }
      this.draw();
    };
    this.form.addEventListener('submit', this.onFilter);
    this.previous.addEventListener('click', this.onPrevious);
    this.next.addEventListener('click', this.onNext);
  }
  filters() {
    const value = id => document.querySelector(id).value;
    return { from: value('#attendanceFromDate'), to: value('#attendanceToDate'),
      search: value('#attendanceStudentSearch').trim().toLowerCase(), section: value('#attendanceSection'),
      event: value('#adminAttendanceEventFilter'), status: value('#attendanceStatus') };
  }
  filtered() {
    const filters = this.applied || this.filters();
    const students = new Map(this.getStudents().map(student => [student.uid, student]));
    const events = new Map(this.getEvents().map(event => [event.id, event]));
    return this.records.filter(record => {
      const student = students.get(record.studentUid);
      const event = events.get(record.eventId);
      const section = event?.attendanceRoster?.[record.studentUid] ?? student?.section;
      const text = [student?.firstName, student?.middleName, student?.lastName, student?.accountId, student?.email, record.studentId].join(' ').toLowerCase();
      const review = this.summary.needsReview(record, event);
      return (!filters.search || text.includes(filters.search)) && (!filters.section || section === filters.section)
        && (!filters.event || filters.event === 'all' || filters.event === record.eventId)
        && (!filters.status || (filters.status === 'review' ? review
          : filters.status === 'completed' ? Boolean(record.checkedOutAt) : !record.checkedOutAt && !review));
    });
  }
  async reload() {
    const filters = this.filters();
    if (filters.from && filters.to && filters.from > filters.to) {
      this.notify('Invalid date range', 'The start date must not be after the end date.'); return;
    }
    this.applied = filters;
    this.suspend(); this.records = []; this.cursor = null; this.page = 0; this.more = true;
    const generation = this.generation;
    await this.load();
    if (generation !== this.generation || !this.repository.watch) return;
    this.liveIds = new Set(this.records.map(record => record.id));
    this.unsubscribe = this.repository.watch(this.applied, (records, cursor) => {
      if (generation !== this.generation) return;
      const ids = new Set(records.map(record => record.id));
      const hasOlder = this.records.some(record => !this.liveIds.has(record.id));
      const last = records.at(-1);
      const beyondBoundary = record => last && (record.eventDate < last.eventDate
        || (record.eventDate === last.eventDate && record.id < last.id));
      const older = this.records.filter(record => !ids.has(record.id)
        && (!this.liveIds.has(record.id) || (hasOlder && records.length === 100 && beyondBoundary(record))));
      if (!hasOlder) { this.cursor = cursor; this.more = records.length === 100; }
      this.records = [...records, ...older]; this.liveIds = ids;
      this.draw();
    }, error => { if (generation === this.generation) { this.onStatus({ state: 'error', error }); this.notify('Live history unavailable', error.message); } });
  }
  async load() {
    if (this.busy || !this.more) return;
    const generation = this.generation;
    this.onStatus({ state: 'syncing' });
    this.busy = true; this.draw();
    try {
      const result = await this.repository.page({ ...this.applied, cursor: this.cursor });
      if (generation !== this.generation) return;
      const ids = new Set(this.records.map(record => record.id));
      this.records.push(...result.records.filter(record => !ids.has(record.id))); this.cursor = result.cursor; this.more = result.more;
      this.onStatus({ state: 'live', syncedAt: new Date() });
    } catch (error) {
      if (generation === this.generation) { this.onStatus({ state: 'error', error }); this.notify('History unavailable', error.message || 'Please retry.'); }
    } finally {
      if (generation === this.generation) { this.busy = false; this.draw(); }
    }
  }
  draw() {
    const records = this.filtered();
    this.page = Math.min(this.page, Math.max(0, Math.ceil(records.length / this.pageSize) - 1));
    const shown = records.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);
    this.render(shown, { busy: this.busy, partial: this.more, filtered: Object.values(this.applied || {}).some(value => value && value !== 'all') });
    this.info.textContent = this.busy ? 'Loading…' : `${shown.length} shown · ${this.records.length} loaded${this.more ? ' · More available' : ''}`;
    this.info.setAttribute('aria-label', `Page ${this.page + 1}, ${shown.length} shown, ${records.length} matches in ${this.records.length} loaded records${this.more ? ', additional records may match' : ', end of date range'}`);
    document.querySelector('#attendanceCurrentPage').textContent = this.page + 1;
    document.querySelector('#attendancePagination').hidden = !this.busy && !this.more && records.length === 0;
    document.querySelector('#attendancePaginationControls').hidden = !this.more && records.length <= this.pageSize;
    this.previous.disabled = this.busy || this.page === 0;
    this.next.disabled = this.busy || (!this.more && (this.page + 1) * this.pageSize >= records.length);
    this.next.textContent = (this.page + 1) * this.pageSize < records.length ? 'Next' : 'Load more';
  }
  suspend() { this.generation++; this.busy = false; this.unsubscribe?.(); this.unsubscribe = null; }
  dispose() {
    this.suspend();
    if (!this.initialized) return;
    this.toolbar.dispose();
    this.form.removeEventListener('submit', this.onFilter);
    this.previous.removeEventListener('click', this.onPrevious); this.next.removeEventListener('click', this.onNext);
    this.initialized = false;
  }
}
