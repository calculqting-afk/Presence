import { AttendanceToolbarController } from './AttendanceToolbarController.js';

export class StudentAttendanceListController {
  constructor({ summary, getEvents, render, notify = () => {}, pageSize = 12 }) {
    Object.assign(this, { summary, getEvents, render, notify, pageSize }); this.page = 0;
  }
  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.form = document.querySelector('#studentAttendanceFilters');
    this.previous = document.querySelector('#studentAttendancePrevious');
    this.next = document.querySelector('#studentAttendanceNext');
    this.toolbar = new AttendanceToolbarController({ form: this.form, prefix: 'studentAttendance', onClear: () => { this.page = 0; this.render(); } });
    this.toolbar.initialize();
    this.onFilter = event => {
      event.preventDefault();
      const from = document.querySelector('#studentAttendanceFrom').value, to = document.querySelector('#studentAttendanceTo').value;
      if (from && to && from > to) { this.notify('Invalid date range', 'The start date must not be after the end date.'); return; }
      this.page = 0; this.render();
    };
    this.onPrevious = () => { this.page = Math.max(0, this.page - 1); this.render(); };
    this.onNext = () => { this.page++; this.render(); };
    this.form.addEventListener('submit', this.onFilter);
    this.previous.addEventListener('click', this.onPrevious); this.next.addEventListener('click', this.onNext);
  }
  select(records) {
    const value = id => document.querySelector(id).value;
    const from = value('#studentAttendanceFrom'), to = value('#studentAttendanceTo');
    const search = value('#studentAttendanceSearch').trim().toLowerCase(), status = value('#studentAttendanceStatus');
    const matches = records.filter(record => {
      const review = this.summary.needsReview(record, this.getEvents().find(event => event.id === record.eventId));
      return (!from || record.eventDate >= from) && (!to || record.eventDate <= to)
        && (!search || (record.eventName || '').toLowerCase().includes(search))
        && (!status || (status === 'review' ? review : status === 'completed' ? Boolean(record.checkedOutAt) : !record.checkedOutAt && !review));
    });
    this.page = Math.min(this.page, Math.max(0, Math.ceil(matches.length / this.pageSize) - 1));
    this.previous.disabled = this.page === 0;
    this.next.disabled = (this.page + 1) * this.pageSize >= matches.length;
    const shown = matches.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);
    document.querySelector('#studentAttendancePageInfo').textContent = `${matches.length ? this.page * this.pageSize + 1 : 0}–${this.page * this.pageSize + shown.length} of ${matches.length} records`;
    document.querySelector('#studentAttendanceCurrentPage').textContent = this.page + 1;
    document.querySelector('#studentAttendancePagination').hidden = matches.length === 0;
    document.querySelector('#studentAttendancePaginationControls').hidden = matches.length <= this.pageSize;
    return matches.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);
  }
  dispose() {
    if (!this.initialized) return;
    this.toolbar.dispose();
    this.form.removeEventListener('submit', this.onFilter);
    this.previous.removeEventListener('click', this.onPrevious); this.next.removeEventListener('click', this.onNext);
    this.initialized = false;
  }
}
