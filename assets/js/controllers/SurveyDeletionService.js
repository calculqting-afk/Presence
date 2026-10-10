// Delete descendants before their parent. A durable deleting flag makes retry safe.
export class SurveyDeletionService {
  constructor({ repository }) { this.repository = repository; }
  async remove(eventId, onProgress = () => {}) {
    await this.repository.beginDeletion(eventId);
    let removed = 0;
    for (;;) {
      const responses = await this.repository.deletionPage(eventId);
      if (!responses.length) break;
      for (const response of responses) {
        for (;;) {
          const reviews = await this.repository.deletionPage(eventId, response.id);
          if (!reviews.length) break;
          await this.repository.deleteDocuments(reviews);
          removed += reviews.length; onProgress(removed);
        }
        await this.repository.deleteDocuments([response]);
        removed++; onProgress(removed);
      }
    }
    await this.repository.finishDeletion(eventId);
    return removed;
  }
}
