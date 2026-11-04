import { SurveyRepository } from './SurveyRepository.js';
import { FeatureReadClient } from './FeatureReadClient.js';

// First migration stage: organizer response pages use D1.
// Own progress and every write retain Firestore transactions and Security Rules.
export class SurveyReadRepository extends SurveyRepository {
  constructor({ getUser, reader = new FeatureReadClient(getUser), ...options }) { super(options); this.reader = reader; }

  responses(eventId, cursor) { return this.reader.responses(eventId, cursor); }
  async changed(eventId, write) {
    const result = await write();
    // Invalidation failure must never report an acknowledged transaction as lost.
    // Other browsers' shared pages also expire after one minute.
    try { await this.reader.invalidate(eventId); } catch { /* Bounded cache expiry. */ }
    return result;
  }
  saveConfig(id, config) { return this.changed(id, () => super.saveConfig(id, config)); }
  setEnabled(id, enabled) { return this.changed(id, () => super.setEnabled(id, enabled)); }
  review(id, uid, decision, note) { return this.changed(id, () => super.review(id, uid, decision, note)); }
  setArchived(id, archived) { return this.changed(id, () => super.setArchived(id, archived)); }
  beginDeletion(id) { return this.changed(id, () => super.beginDeletion(id)); }
  finishDeletion(id) { return this.changed(id, () => super.finishDeletion(id)); }
}
