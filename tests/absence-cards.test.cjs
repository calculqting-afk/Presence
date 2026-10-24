const test = require('node:test');
const assert = require('node:assert/strict');
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const options = { escapeHtml, formatDate: date => date, formatWindow: event => `${event.timeIn} – ${event.timeOut}` };
const morning = { id: 'day', name: 'Intramurals — Morning', sessionGroupId: 'day', sessionBaseName: 'Intramurals', sessionPeriod: 'morning', date: '2026-10-23', timeIn: '07:00', timeOut: '11:00', location: 'Stage', audience: 'Selected sections', audienceSections: ['2A', '2B'] };
const afternoon = { ...morning, id: 'day_afternoon', name: 'Intramurals — Afternoon', sessionPeriod: 'afternoon', timeIn: '13:00', timeOut: '17:00' };

test('linked absent sessions share one event card with ordered session details and actual audience', async () => {
  const { AbsenceCardsPresenter } = await import('../assets/js/controllers/AbsenceCardsPresenter.js');
  const before = JSON.stringify([afternoon, morning]);
  const result = AbsenceCardsPresenter.render([afternoon, morning], options);
  assert.equal(result.eventCount, 1);
  assert.equal((result.markup.match(/<article /g) || []).length, 1);
  assert.equal((result.markup.match(/>Absent</g) || []).length, 2);
  assert.match(result.markup, /2 missed sessions/);
  assert.ok(result.markup.indexOf('>Morning<') < result.markup.indexOf('>Afternoon<'));
  assert.match(result.markup, /Sections 2A, 2B/);
  assert.doesNotMatch(result.markup, /Selected sections|Intramurals — Morning/);
  assert.equal(JSON.stringify([afternoon, morning]), before);
});

test('only confirmed missing sessions render; unlinked events and different dates never merge', async () => {
  const { AbsenceCardsPresenter } = await import('../assets/js/controllers/AbsenceCardsPresenter.js');
  const single = AbsenceCardsPresenter.render([afternoon], options);
  assert.match(single.markup, /1 missed session</);
  assert.doesNotMatch(single.markup, />Morning</);
  const result = AbsenceCardsPresenter.render([morning, { ...afternoon, date: '2026-10-24' }, { ...morning, id: 'separate', sessionGroupId: undefined }], options);
  assert.equal(result.eventCount, 3);
  assert.ok(result.markup.indexOf('2026-10-24') < result.markup.indexOf('2026-10-23'));
});

test('audience supports all students and legacy roster sections without guessing unknown sections', async () => {
  const { AbsenceCardsPresenter: Presenter } = await import('../assets/js/controllers/AbsenceCardsPresenter.js');
  assert.equal(Presenter.audience({ audienceSections: [] }), 'All students');
  assert.equal(Presenter.audience({ audience: 'Selected sections', attendanceRoster: { a: '2B', b: '2A', c: '2A' } }), 'Sections 2A, 2B');
  assert.equal(Presenter.audience({ audience: 'Selected sections' }), 'Sections not specified');
  assert.equal(Presenter.audience({ audience: 'Section 1A' }), 'Section 1A');
});

test('empty absence state and saved event content are safely rendered', async () => {
  const { AbsenceCardsPresenter: Presenter } = await import('../assets/js/controllers/AbsenceCardsPresenter.js');
  assert.equal(Presenter.render([], options).eventCount, 0);
  assert.match(Presenter.render([], options).markup, /No recorded absences/);
  const result = Presenter.render([{ ...morning, sessionBaseName: '<img>', location: '<script>', audienceSections: ['<b>'] }], options);
  assert.match(result.markup, /&lt;img&gt;/);
  assert.match(result.markup, /Sections &lt;b&gt;/);
  assert.doesNotMatch(result.markup, /<script>|<img>|<b>/);
});
