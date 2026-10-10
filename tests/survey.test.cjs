const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const moduleAt = name => import(pathToFileURL(path.join(root, 'assets/js/controllers', `${name}.js`)));
const config = (mode = 'start-only', size = 3) => ({ eventId: 'event', revision: 1, enabled: true, locationMode: mode, opensAt: new Date(1000), closesAt: new Date(100000), questions: Array.from({ length: size }, (_, index) => ({ id: `q${index}`, text: `Agenda ${index + 1}`, type: 'choice', choices: ['Yes', 'No'] })) });

test('survey policy validates questions/windows and only requests selected location stages', async () => {
  const { SurveyPolicy } = await moduleAt('SurveyPolicy');
  const policy = new SurveyPolicy({ now: () => 5000 });
  policy.validate(config()); policy.assertOpen(config());
  assert.equal(policy.locationStage(config(), null), 'start');
  assert.equal(policy.locationStage(config(), { answerCount: 1 }), null);
  assert.equal(policy.locationStage(config('start-finish'), { answerCount: 1 }), null);
  assert.equal(policy.locationStage(config('start-finish'), { answerCount: 2 }), 'finish');
  assert.throws(() => policy.validate({ ...config(), questions: [] }), /1 and 20/);
  assert.throws(() => policy.validate({ ...config(), closesAt: new Date(0) }), /closing time/);
  assert.throws(() => policy.validate({ ...config(), questions: [{ id: 'q0', text: 'Agenda', type: 'choice', choices: ['Same', 'Same'] }] }), /distinct/);
  assert.throws(() => policy.assertOpen({ ...config(), enabled: false }), /not open/);
  assert.throws(() => policy.validateAnswer(config().questions[0], 'forged'), /answer/);
  assert.throws(() => policy.nextQuestion(config(), { surveyRevision: 2 }), /changed/);
  assert.equal(policy.reviewApproved({ reviewDecision: 'approved', reviewStage: 'start', reviewedAt: new Date(5000), reviewRequestedAt: new Date(6000) }, 'start'), false);
});

test('QR links preserve GitHub project paths and reject injected event IDs', async () => {
  const { SurveyLinkService } = await moduleAt('SurveyLinkService');
  const service = new SurveyLinkService({ href: 'https://school.github.io/Presence/pages/admin-dashboard.html?v=old#x' });
  assert.equal(service.url('event_1'), 'https://school.github.io/Presence/index.html?survey=event_1');
  assert.equal(new SurveyLinkService({ href: service.url('event_1') }).eventId(), 'event_1');
  assert.equal(new SurveyLinkService({ href: 'https://school.test/?survey=https://bad.test' }).eventId(), null);
  assert.throws(() => service.url('../bad'), /Invalid/);
});

test('survey location uses fresh precise GPS and rejects insecure, outside, stale and poor-accuracy reports', async () => {
  const { SurveyLocationService } = await moduleAt('SurveyLocationService');
  let requests = 0;
  const position = { coords: { latitude: 10, longitude: 124, accuracy: 5 }, timestamp: 5000 };
  const geo = { getCurrentPosition(resolve, reject, options) { requests++; assert.equal(options.maximumAge, 0); assert.equal(options.enableHighAccuracy, true); resolve(position); } };
  const service = new SurveyLocationService({ secure: true, geolocation: geo, now: () => 5000, loadBoundary: async () => ({ enabled: true, latitude: 10, longitude: 124, radiusMeters: 100 }) });
  const evidence = await service.check('event'); assert.equal(evidence.result, 'inside'); assert.equal(evidence.method, 'browser'); assert.ok(!Object.hasOwn(evidence, 'latitude'));
  position.coords.longitude = 125;
  await assert.rejects(service.check('event'), error => error.surveyIssue === 'outside');
  position.coords.longitude = 124; position.coords.accuracy = 100;
  await assert.rejects(service.check('event'), /precise/);
  position.coords.accuracy = 5; position.timestamp = -100000;
  await assert.rejects(service.check('event'), /stale/);
  const insecure = new SurveyLocationService({ ...service, secure: false });
  const before = requests; await assert.rejects(insecure.check('event'), /HTTPS/); assert.equal(requests, before);
  const polygon = new SurveyLocationService({ secure: true, geolocation: { getCurrentPosition(resolve) { resolve({ coords: { latitude: 10.0005, longitude: 124.0005, accuracy: 5 }, timestamp: 5000 }); } }, now: () => 5000, loadBoundary: async () => ({ enabled: true, type: 'polygon', vertices: [{ latitude: 10, longitude: 124 }, { latitude: 10, longitude: 124.001 }, { latitude: 10.001, longitude: 124.001 }, { latitude: 10.001, longitude: 124 }] }) });
  assert.equal((await polygon.check('event')).boundaryType, 'polygon');
});

test('location retries once for coarse GPS, reports measured accuracy, and never relaxes the limit', async () => {
  const { SurveyLocationService } = await moduleAt('SurveyLocationService');
  let reads = 0, denied = false, outside = false, cancelled = false;
  let accuracies = [381, 5];
  const progress = [];
  const service = new SurveyLocationService({ secure: true, now: () => 5000,
    loadBoundary: async () => ({ enabled: true, latitude: 10, longitude: 124, radiusMeters: 100 }),
    geolocation: { getCurrentPosition(resolve, reject) {
      reads++;
      if (denied) return reject({ code: 1 });
      resolve({ coords: { latitude: 10, longitude: outside ? 125 : 124, accuracy: accuracies.shift() }, timestamp: 5000 });
    } }
  });
  assert.equal((await service.check('event', { onProgress: label => progress.push(label) })).accuracy, 5);
  assert.equal(reads, 2); assert.match(progress[0], /381 m/);
  accuracies = [381, 381]; reads = 0;
  await assert.rejects(service.check('event'), error => error.locationReason === 'accuracy' && /381 m; required 50 m/.test(error.message));
  assert.equal(reads, 2);
  denied = true; reads = 0;
  await assert.rejects(service.check('event'), /permission was denied/); assert.equal(reads, 1);
  denied = false; outside = true; accuracies = [5]; reads = 0;
  await assert.rejects(service.check('event'), error => error.surveyIssue === 'outside'); assert.equal(reads, 1);
  outside = false; accuracies = [381, 5]; reads = 0;
  await assert.rejects(service.check('event', { isCancelled: () => cancelled, onProgress: () => { cancelled = true; } }), /cancelled/);
  assert.equal(reads, 1);
});

async function repositoryHarness() {
  const context = vm.createContext({ console, Date, Object, Error, globalThis: {} });
  const documents = new Map(), writes = [], modules = new Map();
  const timestamp = new Date(5000);
  const snapshot = reference => ({ exists: () => documents.has(reference.path), data: () => documents.get(reference.path), id: reference.path.split('/').at(-1) });
  const sdk = {
    doc: (db, ...parts) => ({ path: parts.length ? parts.join('/') : `${db.path}/audit-id`, id: parts.length ? parts.at(-1) : 'audit-id' }),
    collection: (db, ...parts) => ({ path: parts.join('/') }), serverTimestamp: () => timestamp,
    getDocFromServer: async reference => snapshot(reference), getDocsFromServer: async () => ({ docs: [] }),
    query: (...args) => args, where: (...args) => args, limit: n => n, orderBy: (...args) => args, startAfter: cursor => cursor,
    runTransaction: async (db, action) => {
      const pending = [];
      const result = await action({ get: async reference => snapshot(reference), set: (reference, data) => pending.push([reference.path, data]), update: (reference, data) => pending.push([reference.path, { ...documents.get(reference.path), ...data }]) });
      pending.forEach(([key, value]) => { documents.set(key, value); writes.push(key); }); return result;
    }
  };
  const remote = new vm.SyntheticModule(Object.keys(sdk), function() { Object.entries(sdk).forEach(([key, value]) => this.setExport(key, value)); }, { context });
  const load = filename => { if (!modules.has(filename)) modules.set(filename, new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename })); return modules.get(filename); };
  const entry = load(path.join(root, 'assets/js/controllers/SurveyRepository.js'));
  await entry.link((specifier, referencing) => specifier.startsWith('https:') ? remote : load(path.resolve(path.dirname(referencing.identifier), specifier)));
  await entry.evaluate();
  const policy = { now: () => 5000 };
  const policyModule = modules.get(path.join(root, 'assets/js/controllers/SurveyPolicy.js'));
  const repository = new entry.namespace.SurveyRepository({ db: {}, uid: 'student', profile: () => ({ accountId: 'ID-1', firstName: 'Apollo', lastName: 'Paderes' }), policy: new policyModule.namespace.SurveyPolicy(policy) });
  return { repository, documents, writes, timestamp };
}

test('saved sequential answers resume across retries without overwriting, and final location is required', async () => {
  const { repository, documents, writes } = await repositoryHarness();
  const survey = config('start-finish'); documents.set('eventSurveys/event', survey);
  const evidence = { result: 'inside', method: 'browser', accuracy: 5, boundaryType: 'circle' };
  await repository.submit('event', survey, survey.questions[0], 'Yes', evidence);
  let saved = documents.get('eventSurveys/event/responses/student');
  assert.equal(saved.answerCount, 1); assert.equal(saved.studentId, 'ID-1');
  const count = writes.length;
  const retried = await repository.submit('event', survey, survey.questions[0], 'No', evidence);
  assert.equal(retried.existing, true); assert.equal(writes.length, count); assert.equal(saved.answers.q0.value, 'Yes');
  await assert.rejects(repository.submit('event', survey, survey.questions[2], 'Yes', evidence), /another tab/);
  await repository.submit('event', survey, survey.questions[1], 'No');
  await assert.rejects(repository.submit('event', survey, survey.questions[2], 'Yes'), /location check/);
  await repository.submit('event', survey, survey.questions[2], 'Yes', evidence);
  saved = documents.get('eventSurveys/event/responses/student'); assert.equal(saved.status, 'completed'); assert.equal(saved.answerCount, 3); assert.ok(saved.finishEvidence);
  assert.ok(writes.every(key => key.startsWith('eventSurveys/')));
});

test('review requests preserve progress, record an immutable audit and waive only their location stage', async () => {
  const { repository, documents } = await repositoryHarness();
  const survey = config('start-finish', 2); documents.set('eventSurveys/event', survey);
  await repository.requestReview('event', 'Poor GPS', 'unavailable');
  assert.equal(documents.get('eventSurveys/event/responses/student').answerCount, 0);
  await repository.review('event', 'student', 'approved', 'School ID and venue presence checked');
  assert.ok(documents.has('eventSurveys/event/responses/student/reviews/audit-id'));
  await repository.submit('event', survey, survey.questions[0], 'Yes');
  assert.equal(documents.get('eventSurveys/event/responses/student').startEvidence.result, 'reviewed');
  await assert.rejects(repository.submit('event', survey, survey.questions[1], 'Yes'), /location check/);
  documents.set('eventSurveys/event', { ...survey, closesAt: new Date(2000) });
  await assert.rejects(repository.submit('event', survey, survey.questions[1], 'Yes', { result: 'inside' }), /not open/);
});

test('published survey definitions cannot be rewritten and pause preserves responses', async () => {
  const { repository, documents } = await repositoryHarness();
  documents.set('events/event', { name: 'Meeting' });
  await repository.saveConfig('event', config());
  await assert.rejects(repository.saveConfig('event', config()), /already published/);
  await repository.setEnabled('event', false); assert.equal(documents.get('eventSurveys/event').enabled, false);
  assert.equal(documents.get('events/event').hasSurvey, true);
});

test('survey role grants and rules preserve owner access, immutable answers and server windows', async () => {
  const permissions = await import(pathToFileURL(path.join(root, 'assets/js/core/permissions.js')));
  for (const role of ['super_admin', 'head_admin', 'attendance_admin']) assert.equal(permissions.hasPermission(role, 'manageSurveys'), true);
  for (const role of ['student_manager', 'student', 'unknown']) assert.equal(permissions.hasPermission(role, 'manageSurveys'), false);
  assert.ok(permissions.ROLE_VIEWS.student.includes('surveys'));
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  assert.match(rules, /match \/eventSurveys\/\{eventId\}/);
  assert.match(rules, /request.time >= config.opensAt && request.time <= config.closesAt/);
  assert.match(rules, /data.answers.diff\(previous.answers\).affectedKeys\(\).hasOnly\(\[question.id\]\)/);
  assert.match(rules, /resource.data.status != "completed"/);
  assert.match(rules, /match \/reviews\/\{reviewId\}/);
  // Structural checks only: run authorization cases in a Firestore emulator as well.
});

test('vendored QR generator produces a real local QR matrix and scalable SVG', () => {
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(root, 'assets/vendor/qrcode-generator.js'), 'utf8'), context);
  const code = context.qrcode(0, 'M'); code.addData('https://school.test/index.html?survey=event'); code.make();
  assert.ok(code.getModuleCount() >= 21); assert.match(code.createSvgTag({ scalable: true, margin: 4 }), /<svg/);
  assert.equal(code.isDark(0, 0), true);
});

test('survey login routing is idempotent and cancels stale authentication results', async () => {
  const { SurveyEntryController } = await moduleAt('SurveyEntryController');
  let callback, subscriptions = 0, cleanups = 0, resolveRole;
  const redirects = [];
  const controller = new SurveyEntryController({ auth: {},
    subscribe(auth, listener) { subscriptions++; callback = listener; return () => cleanups++; },
    resolveRole: () => new Promise(resolve => { resolveRole = resolve; }),
    window: { location: { href: 'https://school.test/index.html?survey=event', replace: url => redirects.push(url) } }
  });
  controller.initialize(); controller.initialize(); assert.equal(subscriptions, 1);
  const pending = controller.resume({ uid: 'student' });
  await controller.resume(null); resolveRole('student'); await pending;
  assert.equal(redirects.length, 0);
  const accepted = controller.resume({ uid: 'student' }); resolveRole('student'); await accepted;
  assert.deepEqual(redirects, ['pages/student-dashboard.html?survey=event']);
  const disposed = controller.resume({ uid: 'admin' }); controller.dispose(); resolveRole('admin'); await disposed;
  assert.equal(redirects.length, 1); assert.equal(cleanups, 1); assert.equal(typeof callback, 'function');
});

test('survey controller guards duplicate saves and cancels submissions after leaving during GPS', async () => {
  const { SurveyController } = await moduleAt('SurveyController');
  const { SurveyPolicy } = await moduleAt('SurveyPolicy');
  let releaseLocation, saves = 0;
  const messages = [];
  const controller = new SurveyController({ repository: { uid: 'student', submit: async () => saves++ },
    locationService: { check: () => new Promise(resolve => { releaseLocation = resolve; }) },
    profile: () => ({}), canManage: false, escapeHtml: value => value, openView() {},
    showToast: (...args) => messages.push(args), document: {},
    window: { location: { href: 'https://school.test/pages/student-dashboard.html' } },
    policy: new SurveyPolicy({ now: () => 5000 })
  });
  controller.visible = true; controller.selectedEvent = { id: 'event' }; controller.config = config();
  controller.workspace = { querySelector: () => null };
  const labels = [];
  controller.loading = { start: (key, button, label) => labels.push(label), update: (key, label) => labels.push(label), reset() {}, finish() {} };
  const form = { matches: selector => selector.includes('[data-survey-answer]'), querySelector: () => ({}), elements: { answer: { value: 'Yes' } } };
  const event = { target: form, preventDefault() {} };
  const pending = controller.handleSubmit(event);
  assert.equal(controller.busy, true); await controller.handleSubmit(event);
  controller.generation++; controller.visible = false;
  releaseLocation({ result: 'inside' }); await pending;
  assert.equal(saves, 0); assert.equal(controller.busy, false);
  assert.ok(labels.includes('Checking location…')); assert.match(messages[0][1], /view changed/);
});

test('survey screens keep concise location notice and move guidance into accessible instructions', async () => {
  const { SurveyController } = await moduleAt('SurveyController');
  const { SurveyPolicy } = await moduleAt('SurveyPolicy');
  const controller = new SurveyController({ repository: { uid: 'student' }, locationService: {},
    profile: () => ({}), canManage: false, escapeHtml: value => String(value).replaceAll('<', '&lt;'),
    openView() {}, showToast() {}, document: {},
    window: { location: { href: 'https://school.test/' }, localStorage: { getItem: () => 'Yes' } },
    policy: new SurveyPolicy({ now: () => 5000 }) });
  controller.workspace = { innerHTML: '' }; controller.selectedEvent = { id: 'event', name: '<Meeting>' }; controller.config = config();
  controller.renderStudent();
  const html = controller.workspace.innerHTML;
  assert.match(html, /&lt;Meeting>/); assert.match(html, /<details class="survey-instructions"><summary>How it works<\/summary>/);
  assert.match(html, /Location: first answer · Submission times recorded/);
  assert.match(html, /<dl class="survey-window">/); assert.match(html, /value="Yes" checked/);
  assert.match(html, /data-survey-message role="status" hidden/);
  assert.doesNotMatch(html, /Only submitted answers are saved to your account/);
  controller.canManage = true; controller.loadResponses = async () => {};
  await controller.renderAdmin();
  assert.match(controller.workspace.innerHTML, /How it works/); assert.match(controller.workspace.innerHTML, /survey-results-heading">Responses/);
  const css = fs.readFileSync(path.join(root, 'assets/css/dashboard.css'), 'utf8');
  assert.match(css, /event-card-actions > \.badge \{ flex-shrink: 0; white-space: nowrap;/);
});
