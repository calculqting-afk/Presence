import { DailyAttendanceClock } from './DailyAttendanceClock.js';
import { EventAudiencePolicy } from './EventAudiencePolicy.js';

export class AttendanceAnalyticsController {
  constructor({ document, repository, getEvents, getStudents, closeDate, escapeHtml, now = () => new Date() }) {
    Object.assign(this, { document, repository, getEvents, getStudents, closeDate, escapeHtml, now });
    this.page = 0; this.category = 'present'; this.generation = 0;
  }
  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.trigger = this.document.querySelector('#openAttendanceAnalytics');
    this.onOpen = () => { void this.open(); };
    this.trigger.addEventListener('click', this.onOpen);
  }
  mount() {
    if (this.dialog) return;
    const e = this.escapeHtml;
    this.dialog = this.document.createElement('dialog');
    this.dialog.className = 'attendance-analytics-modal';
    this.dialog.setAttribute('aria-labelledby', 'attendanceAnalyticsTitle');
    this.dialog.innerHTML = `<header><div><h2 id="attendanceAnalyticsTitle">Attendance Analytics</h2><p>Review attendance by date, event, and section.</p></div><button type="button" data-analytics-close aria-label="Close analytics">×</button></header><div class="analytics-filters"><label>Date<input type="date" data-analytics-date></label><label>Event<select data-analytics-event><option value="">All events on this date</option></select></label><label>Section<select data-analytics-section><option value="">All sections</option>${['1A','1B','2A','2B','3A','3B','4A','4B'].map(section => `<option>${e(section)}</option>`).join('')}</select></label></div><p class="analytics-message" role="status" data-analytics-message></p><div class="analytics-totals" data-analytics-totals></div><h3 data-analytics-list-title></h3><div class="analytics-students" data-analytics-students></div><footer><span data-analytics-page role="status"></span><div><button class="outline-button" type="button" data-analytics-previous>Previous</button><button class="primary-button" type="button" data-analytics-next>Next</button></div></footer>`;
    this.document.body.append(this.dialog);
    this.onClick = event => {
      if (event.target.closest('[data-analytics-close]')) this.dialog.close();
      const category = event.target.closest('[data-analytics-category]');
      if (category) { this.category = category.dataset.analyticsCategory; this.page = 0; this.render(); }
      if (event.target.closest('[data-analytics-previous]')) { this.page--; this.render(); }
      if (event.target.closest('[data-analytics-next]')) { this.page++; this.render(); }
    };
    this.onChange = event => {
      this.page = 0;
      if (event.target.matches('[data-analytics-date]')) { this.populateEvents(); void this.load(); }
      else this.render();
    };
    this.onClose = () => { this.generation++; this.trigger.focus(); };
    this.dialog.addEventListener('click', this.onClick);
    this.dialog.addEventListener('change', this.onChange);
    this.dialog.addEventListener('close', this.onClose);
  }
  async open() {
    this.mount();
    const now = this.now();
    this.query('date').value = DailyAttendanceClock.dateKey(now);
    this.page = 0; this.populateEvents(); this.dialog.showModal(); await this.load();
  }
  query(name) { return this.dialog.querySelector(`[data-analytics-${name}]`); }
  populateEvents() {
    const date = this.query('date').value;
    this.query('event').innerHTML = '<option value="">All events on this date</option>' + this.getEvents().filter(event => event.date === date)
      .map(event => `<option value="${this.escapeHtml(event.id)}">${this.escapeHtml(event.name)}</option>`).join('');
  }
  async load() {
    const generation = ++this.generation;
    this.busy = true; this.error = ''; this.records = []; this.render();
    const date = this.query('date').value;
    if (!date) { this.busy = false; this.error = 'Choose a date.'; this.render(); return; }
    try {
      let cursor = null, more = true;
      while (more) {
        const result = await this.repository.page({ from: date, to: date, cursor, size: 100 });
        if (generation !== this.generation) return;
        this.records.push(...result.records); cursor = result.cursor; more = result.more;
      }
    } catch (error) { if (generation === this.generation) this.error = 'Unable to load analytics. Close and reopen to retry.'; }
    if (generation === this.generation) { this.busy = false; this.render(); }
  }
  rows(date, eventId = '', section = '') {
    const students = new Map(this.getStudents().map(student => [student.uid, student]));
    const rows = [];
    for (const event of this.getEvents().filter(event => event.date === date && (!eventId || event.id === eventId))) {
      const own = (this.records || []).filter(record => record.eventId === event.id);
      const roster = { ...(event.attendanceRoster || {}) };
      for (const student of students.values()) {
        if (student.active === false || !EventAudiencePolicy.matches(student, event)) continue;
        if (Array.isArray(event.audienceSections) && !EventAudiencePolicy.canAttend(student, event)) continue;
        if (student.createdAt?.toDate?.() > this.closeDate(event)) continue;
        if (!Object.hasOwn(roster, student.uid)) roster[student.uid] = student.section || '';
      }
      for (const record of own) if (!Object.hasOwn(roster, record.studentUid)) roster[record.studentUid] = students.get(record.studentUid)?.section || '';
      for (const [uid, rosterSection] of Object.entries(roster)) {
        if (section && rosterSection !== section) continue;
        const student = students.get(uid);
        const record = own.find(record => record.studentUid === uid);
        const hasIn = Boolean(record?.checkedInAt || record?.attendedAt), hasOut = Boolean(record?.checkedOutAt);
        const ended = this.now() > this.closeDate(event);
        const verified = (Object.hasOwn(event.attendanceRoster || {}, uid) || Boolean(student?.createdAt?.toDate?.()))
          && !EventAudiencePolicy.addedAfterOpening({ ...student, uid, section: rosterSection }, event);
        rows.push({ student, uid, event, section: rosterSection, present: hasIn, late: hasIn && record?.arrivalStatus === 'late',
          completed: hasIn && hasOut, missed: hasIn && !hasOut && ended, checkout: !hasIn && hasOut,
          absent: !hasIn && !hasOut && ended && verified, review: !hasIn && !hasOut && ended && !verified });
      }
    }
    return rows;
  }
  render() {
    const labels = { present: 'Present IN', late: 'Late IN', completed: 'Completed', missed: 'Missed checkout', checkout: 'Checkout only', absent: 'Did not attend' };
    const rows = this.busy || this.error ? [] : this.rows(this.query('date').value, this.query('event').value, this.query('section').value);
    const unknown = rows.filter(row => row.review).length;
    this.query('message').textContent = this.busy ? 'Loading attendance…' : this.error || (unknown ? `${unknown} participant records need roster review.` : 'Late check-ins are included in Present IN. Absences are finalized after checkout closes.');
    this.query('totals').innerHTML = Object.entries(labels).map(([key, label]) => `<button type="button" data-analytics-category="${key}" aria-pressed="${this.category === key}"><span>${label}</span><strong>${this.busy || this.error ? '—' : rows.filter(row => row[key]).length}</strong></button>`).join('');
    const matches = rows.filter(row => row[this.category]).sort((a, b) => (a.student?.lastName || '').localeCompare(b.student?.lastName || ''));
    this.page = Math.max(0, Math.min(this.page, Math.max(0, Math.ceil(matches.length / 7) - 1)));
    const shown = matches.slice(this.page * 7, (this.page + 1) * 7), e = this.escapeHtml;
    this.query('list-title').textContent = labels[this.category];
    this.query('students').innerHTML = shown.length ? shown.map(row => `<article><strong>${e([row.student?.lastName, row.student?.firstName].filter(Boolean).join(', ') || row.uid)}</strong><span>${e(row.student?.accountId || '')} · Section ${e(row.section)}</span><small>${e(row.event.name)}</small></article>`).join('') : '<p>No matching students.</p>';
    this.query('page').textContent = `${matches.length ? this.page * 7 + 1 : 0}–${this.page * 7 + shown.length} of ${matches.length} participant records`;
    this.query('previous').disabled = this.busy || this.page === 0;
    this.query('next').disabled = this.busy || (this.page + 1) * 7 >= matches.length;
  }
  dispose() {
    this.generation++;
    this.trigger?.removeEventListener('click', this.onOpen);
    this.dialog?.remove(); this.dialog = null; this.initialized = false;
  }
}
