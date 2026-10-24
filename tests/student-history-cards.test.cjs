const test = require('node:test');
const assert = require('node:assert/strict');
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const options = { escapeHtml, formatDate: date => date, formatWindow: event => `${event.timeIn} – ${event.timeOut}` };
const morning = { id: 'day', sessionGroupId: 'day', sessionBaseName: 'Intramurals', name: 'Intramurals — Morning', date: '2026-10-23', type: 'Activity', description: 'School activities', sessionPeriod: 'morning', timeIn: '07:00', timeOut: '11:00', location: 'Stage', audience: 'Selected sections', audienceSections: ['2A', '2B'] };
const afternoon = { ...morning, id: 'day_afternoon', name: 'Intramurals — Afternoon', sessionPeriod: 'afternoon', timeIn: '13:00', timeOut: '17:00' };

test('student history combines linked sessions into one card and keeps exact dismissal IDs', async () => {
  const { StudentHistoryPresenter: Presenter } = await import('../assets/js/controllers/StudentHistoryPresenter.js');
  const rows = [{ event: afternoon, status: 'Absent' }, { event: morning, status: 'Absent' }], before = JSON.stringify(rows);
  const html = Presenter.render(rows, options);
  assert.equal((html.match(/<article /g) || []).length, 1);
  assert.equal((html.match(/<h3>/g) || []).length, 1);
  assert.equal((html.match(/<span>Date<\/span>/g) || []).length, 1);
  assert.ok(html.indexOf('>Morning<') < html.indexOf('>Afternoon<'));
  assert.match(html, /data-dismiss-history="day"/); assert.match(html, /data-dismiss-history="day_afternoon"/);
  assert.match(html, /Sections 2A, 2B/); assert.doesNotMatch(html, /Selected sections/);
  assert.equal(JSON.stringify(rows), before);
});
test('different session outcomes remain separate and do not falsely mark the full event attended', async () => {
  const { StudentHistoryPresenter: Presenter } = await import('../assets/js/controllers/StudentHistoryPresenter.js');
  const html = Presenter.render([{ event: morning, status: 'Attended' }, { event: afternoon, status: 'Needs review' }], options);
  assert.match(html, /Mixed attendance/); assert.match(html, /Needs review/); assert.match(html, />Attended</);
  const unverified = Presenter.render([{ event: morning, status: 'Eligibility unverified' }, { event: afternoon, status: 'Absent' }], options);
  assert.match(unverified, /Eligibility unverified/); assert.match(unverified, />Absent</);
});
test('single or already-filtered sessions remain compact and hidden sessions are not brought back', async () => {
  const { StudentHistoryPresenter: Presenter } = await import('../assets/js/controllers/StudentHistoryPresenter.js');
  const html = Presenter.render([{ event: afternoon, status: 'Attended' }], options);
  assert.equal((html.match(/<article /g) || []).length, 1);
  assert.doesNotMatch(html, />Morning<|data-dismiss-history="day"/);
  assert.match(html, /data-dismiss-history="day_afternoon"/);
});
test('unrelated events and different dates never merge and newest dates come first', async () => {
  const { StudentHistoryPresenter: Presenter } = await import('../assets/js/controllers/StudentHistoryPresenter.js');
  const html = Presenter.render([
    { event: morning, status: 'Absent' },
    { event: { ...afternoon, date: '2026-10-24' }, status: 'Absent' },
    { event: { ...morning, id: 'other', sessionGroupId: undefined }, status: 'Attended' }
  ], options);
  assert.equal((html.match(/<article /g) || []).length, 3);
  assert.ok(html.indexOf('2026-10-24') < html.indexOf('2026-10-23'));
});
test('history empty state and all saved content are safely rendered', async () => {
  const { StudentHistoryPresenter: Presenter } = await import('../assets/js/controllers/StudentHistoryPresenter.js');
  assert.match(Presenter.render([], options), /No finished event history/);
  const html = Presenter.render([{ event: { ...morning, id: 'id" onclick="evil', sessionBaseName: '<img>', description: '<script>', location: '<b>', audienceSections: ['<u>'] }, status: 'Absent' }], options);
  assert.match(html, /&lt;img&gt;/); assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Sections &lt;u&gt;/); assert.match(html, /id&quot; onclick=&quot;evil/);
  assert.doesNotMatch(html, /<script>|<img>|<u>|<b>/);
});
