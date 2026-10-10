export class SurveyPolicy {
  constructor({ now = () => Date.now() } = {}) { this.now = now; }
  time(value) { return value?.toMillis?.() ?? value?.toDate?.().getTime() ?? new Date(value).getTime(); }
  eligible(profile, event) {
    if (!profile || profile.active !== true) return false;
    return event.attendanceRoster ? Object.hasOwn(event.attendanceRoster, profile.uid)
      : event.audience === 'All students' || event.audience === `Section ${profile.section}`;
  }
  validate(config) {
    if (!['start-only', 'start-finish'].includes(config.locationMode)) throw new Error('Choose a location verification mode.');
    if (!Number.isFinite(this.time(config.opensAt)) || !Number.isFinite(this.time(config.closesAt)) || this.time(config.opensAt) >= this.time(config.closesAt)) throw new Error('Survey closing time must follow its opening time.');
    if (!Array.isArray(config.questions) || config.questions.length < 1 || config.questions.length > 20) throw new Error('Add between 1 and 20 agenda questions.');
    config.questions.forEach((question, index) => {
      if (question.id !== `q${index}` || !question.text?.trim() || question.text.length > 500) throw new Error('Each agenda needs a question of at most 500 characters.');
      if (!['choice', 'text'].includes(question.type)) throw new Error('Choose a supported question type.');
      if (question.type === 'choice' && (!Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 8 || question.choices.some(choice => !choice.trim() || choice.length > 160) || new Set(question.choices).size !== question.choices.length)) throw new Error('Choice questions need 2–8 distinct answers, at most 160 characters each.');
      if (question.type === 'text' && question.choices.length) throw new Error('Text questions cannot contain choices.');
    });
    return config;
  }
  assertOpen(config) {
    if (!config.enabled || this.now() < this.time(config.opensAt) || this.now() > this.time(config.closesAt)) throw new Error('This survey is not open. Saved answers remain available; ask an organizer if you need help.');
  }
  nextQuestion(config, attempt) {
    if (attempt && attempt.surveyRevision !== config.revision) throw new Error('This survey changed. Ask an organizer to review your saved attempt.');
    return config.questions[attempt?.answerCount || 0];
  }
  locationStage(config, attempt) {
    if (!(attempt?.answerCount > 0)) return 'start';
    return config.locationMode === 'start-finish' && attempt.answerCount === config.questions.length - 1 ? 'finish' : null;
  }
  reviewApproved(attempt, stage) {
    return attempt?.reviewDecision === 'approved' && attempt.reviewStage === stage
      && this.time(attempt.reviewedAt) >= this.time(attempt.reviewRequestedAt);
  }
  validateAnswer(question, value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 1000 || (question.type === 'choice' && !question.choices.includes(value))) throw new Error('Choose or enter an answer before continuing.');
    return value.trim();
  }
}
