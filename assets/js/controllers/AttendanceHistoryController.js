import { collection, query, where, orderBy, limit, startAfter, getDocsFromServer, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { AttendanceToolbarController } from './AttendanceToolbarController.js';
import { AttendanceSort } from './AttendanceSort.js';
import { CoursePolicy } from '../core/CoursePolicy.js';

export class AttendanceRepository {
  constructor(db, fetch = getDocsFromServer) { this.db = db; this.fetch = fetch; }
  reference({ from = '', to = '', event = '', cursor = null, size = 100 }) {
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
  constructor({ repository, getStudents, getEvents, summary, render, notify, onStatus = () => {}, pageSize = 20, requireEvent = false, prepareRecords = records => records }) {
    Object.assign(this, { repository, getStudents, getEvents, summary, render, notify, onStatus, pageSize, requireEvent, prepareRecords });
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
    // Searching and selecting from already-loaded history should feel instant.
    // Date windows are server-backed, so only they restart the subscription.
    this.onLocalFilter = () => {
      this.applied = this.filters();
      this.page = 0;
      this.draw();
    };
    this.onDateFilter = () => { void this.reload(); };
    this.eventControl = document.querySelector('#adminAttendanceEventFilter');
    this.onEventFilter = () => {
      const selected = this.getEvents().find(event => event.id === this.eventControl.value);
      if (selected?.date) {
        document.querySelector('#attendanceFromDate').value = selected.date;
        document.querySelector('#attendanceToDate').value = selected.date;
      }
      void this.reload();
    };
    this.localFilterControls = [
      { control: document.querySelector('#attendanceStudentSearch'), event: 'input' },
      { control: document.querySelector('#attendanceSection'), event: 'change' },
      { control: document.querySelector('#attendanceCourse'), event: 'change' },
      { control: document.querySelector('#attendanceStatus'), event: 'change' },
      { control: document.querySelector('#attendanceSort'), event: 'change' }
    ];
    this.dateFilterControls = ['#attendanceFromDate', '#attendanceToDate']
      .map(selector => document.querySelector(selector));
    this.onNext = async () => {
      if (this.busy) return;
      if ((this.page + 1) * this.pageSize < this.displayRecords().length) this.page++;
      else if (this.more) {
        const previousCount = this.displayRecords().length;
        const pageWasFull = previousCount >= (this.page + 1) * this.pageSize;
        await this.load();
        if (pageWasFull && this.displayRecords().length > (this.page + 1) * this.pageSize) this.page++;
      }
      this.draw();
    };
    this.form.addEventListener('submit', this.onFilter);
    this.eventControl.addEventListener('change', this.onEventFilter);
    this.previous.addEventListener('click', this.onPrevious);
    this.next.addEventListener('click', this.onNext);
    this.localFilterControls.forEach(({ control, event }) => control.addEventListener(event, this.onLocalFilter));
    this.dateFilterControls.forEach(control => control.addEventListener('change', this.onDateFilter));
  }
  filters() {
    const value = id => document.querySelector(id).value;
    return { from: value('#attendanceFromDate'), to: value('#attendanceToDate'),
      search: value('#attendanceStudentSearch').trim().toLowerCase(), section: value('#attendanceSection'),
      course: value('#attendanceCourse'),
      event: value('#adminAttendanceEventFilter'), status: value('#attendanceStatus'), sort: value('#attendanceSort') };
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
      const review = !student || record.rosterUnverified || this.summary.needsReview(record, event);
      return (!filters.search || text.includes(filters.search)) && (!filters.section || section === filters.section)
        && (!filters.course || CoursePolicy.normalize(record.studentCourse || student?.course) === filters.course)
        && (!filters.event || filters.event === 'all' || filters.event === record.eventId)
        && (!filters.status || (filters.status === 'absent' ? record.status === 'absent' && !review
          : filters.status === 'late' ? record.arrivalStatus === 'late'
          : filters.status === 'review' ? review
          : filters.status === 'completed' ? Boolean(record.checkedOutAt) && !review : !record.checkedOutAt && !review));
    });
  }
  sortForDisplay(records) {
    const sort = (this.applied || this.filters()).sort || 'check-in-desc';
    const byLastName = sort.startsWith('last-name-');
    const students = new Map(this.getStudents().map(student => [student.uid, student]));
    const nameFor = record => {
      const student = students.get(record.studentUid);
      const names = byLastName
        ? [student?.lastName, student?.firstName, student?.middleName]
        : [student?.firstName, student?.middleName, student?.lastName];
      return [...names, record.studentId]
        .filter(Boolean).join(' ').toLocaleLowerCase();
    };
    return [...records].sort((first, second) => AttendanceSort.compare(first, second, {
      sort, name: nameFor,
      key: record => String(record.id || `${record.eventId}:${record.studentUid}`)
    }));
  }
  async reload() {
    const filters = this.filters();
    if (filters.from && filters.to && filters.from > filters.to) {
      this.notify('Invalid date range', 'The start date must not be after the end date.'); return;
    }
    this.applied = filters;
    this.suspend(); this.records = []; this.cursor = null; this.page = 0; this.more = true;
    this.verified = false;
    if (this.requireEvent && (!filters.event || filters.event === 'all')) {
      this.more = false; this.onStatus({ state: 'idle' }); this.draw(); return;
    }
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
      this.verified = true;
      this.onStatus({ state: 'live', syncedAt: new Date() });
    } catch (error) {
      if (generation === this.generation) { this.onStatus({ state: 'error', error }); this.notify('History unavailable', error.message || 'Please retry.'); }
    } finally {
      if (generation === this.generation) { this.busy = false; this.draw(); }
    }
  }
  displayRecords() {
    return this.prepareRecords(this.filtered(), { busy: this.busy, partial: this.more, verified: this.verified });
  }
  draw() {
    if (this.requireEvent && (!(this.applied || this.filters()).event || (this.applied || this.filters()).event === 'all')) {
      this.render([], { chooseEvent: true });
      this.info.textContent = '';
      document.querySelector('#attendancePagination').hidden = true;
      return;
    }
    const records = this.displayRecords();
    this.page = Math.min(this.page, Math.max(0, Math.ceil(records.length / this.pageSize) - 1));
    const shown = records.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);
    this.render(shown, { busy: this.busy, partial: this.more, verified: this.verified, filtered: Object.values(this.applied || {}).some(value => value && value !== 'all') });
    this.info.textContent = this.busy ? 'Loading…' : `${records.length ? this.page * this.pageSize + 1 : 0}–${this.page * this.pageSize + shown.length} of ${records.length} students${this.more ? ' · More available' : ''}`;
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
    this.eventControl.removeEventListener('change', this.onEventFilter);
    this.previous.removeEventListener('click', this.onPrevious); this.next.removeEventListener('click', this.onNext);
    this.localFilterControls?.forEach(({ control, event }) => control.removeEventListener(event, this.onLocalFilter));
    this.dateFilterControls?.forEach(control => control.removeEventListener('change', this.onDateFilter));
    this.initialized = false;
  }
}
