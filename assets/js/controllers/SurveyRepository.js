import { collection, doc, getDocFromServer, getDocsFromServer, query, where, limit, orderBy, startAfter, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { SurveyPolicy } from './SurveyPolicy.js';

export class SurveyRepository {
  constructor({ db, uid, profile = () => ({}), policy = new SurveyPolicy() }) { Object.assign(this, { db, uid, profile, policy }); }
  configRef(eventId) { return doc(this.db, 'eventSurveys', eventId); }
  attemptRef(eventId, uid = this.uid) { return doc(this.db, 'eventSurveys', eventId, 'responses', uid); }
  async load(eventId) {
    const [config, attempt] = await Promise.all([getDocFromServer(this.configRef(eventId)), getDocFromServer(this.attemptRef(eventId))]);
    return { config: config.exists() ? config.data() : null, attempt: attempt.exists() ? attempt.data() : null };
  }
  async events() {
    const snapshot = await getDocsFromServer(query(collection(this.db, 'events'), orderBy('openAt', 'desc'), limit(100)));
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  }
  async boundary(eventId) { const snapshot = await getDocFromServer(doc(this.db, 'eventGeofences', eventId)); return snapshot.data(); }
  async event(eventId) { const snapshot = await getDocFromServer(doc(this.db, 'events', eventId)); return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null; }
  async saveConfig(eventId, config) {
    this.policy.validate(config);
    return runTransaction(this.db, async transaction => {
      const ref = this.configRef(eventId), snapshot = await transaction.get(ref);
      // Definitions are immutable after publication. Pausing is a separate action.
      if (snapshot.exists()) throw new Error('This survey is already published. Questions and windows are locked to protect saved answers.');
      transaction.set(ref, { ...config, revision: 1, eventId, createdBy: this.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      transaction.update(doc(this.db, 'events', eventId), { hasSurvey: true, updatedAt: serverTimestamp() });
    });
  }
  async setEnabled(eventId, enabled) {
    return runTransaction(this.db, async transaction => {
      const ref = this.configRef(eventId), snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('Survey not found.');
      transaction.update(ref, { enabled, updatedAt: serverTimestamp() });
    });
  }
  async submit(eventId, config, question, value, evidence) {
    value = this.policy.validateAnswer(question, value);
    return runTransaction(this.db, async transaction => {
      const configSnapshot = await transaction.get(this.configRef(eventId));
      const ref = this.attemptRef(eventId), snapshot = await transaction.get(ref);
      const current = configSnapshot.data(), previous = snapshot.data();
      if (!current || current.revision !== config.revision) throw new Error('Survey changed; reload before answering.');
      // A retry from another tab or a lost acknowledgement must not overwrite an answer.
      if (previous?.answers?.[question.id]) return { existing: true, attempt: previous };
      this.policy.assertOpen(current);
      if (this.policy.nextQuestion(current, previous)?.id !== question.id) throw new Error('Your progress changed in another tab. Refresh the survey.');
      const stage = this.policy.locationStage(current, previous);
      if (stage && !evidence && !this.policy.reviewApproved(previous, stage)) throw new Error('A fresh location check or approved review is required.');
      const count = (previous?.answerCount || 0) + 1;
      const data = { ...(previous || {}), studentUid: this.uid, eventId, surveyRevision: current.revision,
        ...(previous ? {} : { studentId: this.profile().accountId || '', studentName: [this.profile().firstName, this.profile().lastName].filter(Boolean).join(' ') }),
        answers: { ...(previous?.answers || {}), [question.id]: { value, answeredAt: serverTimestamp() } }, answerCount: count,
        status: count === current.questions.length ? 'completed' : 'in-progress', updatedAt: serverTimestamp(),
        ...(previous ? {} : { startedAt: serverTimestamp() }) };
      if (stage) data[`${stage}Evidence`] = { ...(evidence || { result: 'reviewed', method: 'browser', boundaryType: 'review', accuracy: 0 }), checkedAt: serverTimestamp() };
      if (count === 1 && current.questions.length === 1 && current.locationMode === 'start-finish') data.finishEvidence = data.startEvidence;
      transaction.set(ref, data);
      return { existing: false };
    });
  }
  async requestReview(eventId, reason, issue) {
    if (!reason?.trim() || reason.length > 1000) throw new Error('Explain why you need review (1–1000 characters).');
    return runTransaction(this.db, async transaction => {
      const configSnapshot = await transaction.get(this.configRef(eventId));
      const ref = this.attemptRef(eventId), snapshot = await transaction.get(ref);
      const config = configSnapshot.data(), previous = snapshot.data();
      if (!config || previous?.status === 'completed') throw new Error('Review is unavailable for this attempt.');
      const stage = this.policy.locationStage(config, previous);
      transaction.set(ref, { ...(previous || { studentUid: this.uid, studentId: this.profile().accountId || '', studentName: [this.profile().firstName, this.profile().lastName].filter(Boolean).join(' '), eventId, surveyRevision: config.revision, answers: {}, answerCount: 0, startedAt: serverTimestamp() }),
        status: 'needs-review', reviewReason: reason.trim(), reviewIssue: issue || 'unavailable', reviewStage: stage || 'other', reviewRequestedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
  }
  async responses(eventId, cursor) {
    const constraints = [orderBy('updatedAt', 'desc'), ...(cursor ? [startAfter(cursor)] : []), limit(25)];
    const snapshot = await getDocsFromServer(query(collection(this.db, 'eventSurveys', eventId, 'responses'), ...constraints));
    return { rows: snapshot.docs.map(item => ({ id: item.id, ...item.data() })), cursor: snapshot.docs.at(-1), more: snapshot.docs.length === 25 };
  }
  async review(eventId, uid, decision, note) {
    if (!['approved', 'declined'].includes(decision) || !note?.trim() || note.length > 1000) throw new Error('Choose a decision and provide a reason (1–1000 characters).');
    const auditRef = doc(collection(this.db, 'eventSurveys', eventId, 'responses', uid, 'reviews'));
    return runTransaction(this.db, async transaction => {
      const ref = this.attemptRef(eventId, uid), snapshot = await transaction.get(ref);
      if (snapshot.data()?.status !== 'needs-review') throw new Error('This review request is no longer pending.');
      transaction.update(ref, { reviewDecision: decision, reviewNote: note.trim(), reviewedBy: this.uid, reviewAuditId: auditRef.id, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp(), status: 'in-progress' });
      transaction.set(auditRef, { actorUid: this.uid, decision, note: note.trim(), stage: snapshot.data().reviewStage, requestedAt: snapshot.data().reviewRequestedAt, reviewedAt: serverTimestamp() });
    });
  }
}
