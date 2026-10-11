import { SurveyController } from './SurveyController.js?v=20261011-optimized';
import { SurveyRepository } from './SurveyRepository.js?v=20261011-survey-archive';
import { SurveyDeletionService } from './SurveyDeletionService.js';
import { SurveyLocationService } from './SurveyLocationService.js?v=20261010-location-retry';
import { QrCodeLoader } from './QrCodeLoader.js';

export function createSurveyFeature({ db, uid, profile, ...options }) {
  const repository = new SurveyRepository({ db, uid, profile });
  const qrLoader = new QrCodeLoader({ document: options.document, window: options.window });
  return new SurveyController({ ...options, repository, profile: () => ({ ...profile(), uid }),
    qr: () => qrLoader.load(),
    locationService: new SurveyLocationService({ loadBoundary: eventId => repository.boundary(eventId) }),
    deletionService: new SurveyDeletionService({ repository }) });
}
