import { ControllerScope } from '../core/ControllerScope.js';
import { CoursePolicy } from '../core/CoursePolicy.js';
import { GenderPolicy } from '../core/GenderPolicy.js';
import { EventAudiencePolicy } from '../controllers/EventAudiencePolicy.js';
import { EventAudienceController } from '../controllers/EventAudienceController.js';
import { EventSessionController } from '../controllers/EventSessionController.js';
import { EventSessionPolicy } from '../controllers/EventSessionPolicy.js';
import { AttendanceRelativeTime } from '../controllers/AttendanceRelativeTime.js';
import { SurveyConfirmationController } from '../controllers/SurveyConfirmationController.js';
import { AttendanceReportController } from '../controllers/AttendanceReportController.js';
import { StudentPasswordPolicy } from '../core/StudentPasswordPolicy.js';
import { currentUser, activeView, currentUserRole, escapeHtml, ASSIGNABLE_ROLE_LABELS, firebaseErrorCode, roleLabel, roleChangeErrorMessage, formatBirthday, FineModalController, showDashboardToast, createNotification, resetFacePhotoInDrive, waitForFaceRegistration, openView, formatEventDate, formatEventTime, timePlusMinutes, formatTimeWindow, eventOpenDate, eventCloseDate, eventCheckInCloseDate, eventCheckoutCloseDate, isEventFinished, formatAttendanceTimestamp, attendanceDuration, getEventStatus, arrivalStatusBadge, eventStatusBadge, getInitials, formatServiceMinutes, formatFineDate, getFineHistory, fineDetailsMarkup, updateDashboardGreeting, SUPER_ADMIN_EMAIL, auth, db, studentIdToEmail, studentProvisioningAuth, createUserWithEmailAndPassword, deleteUser, signInWithEmailAndPassword, signOut, updatePassword, updateProfile, Timestamp, addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, getDocsFromServer, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, writeBatch } from '../dashboard.js?v=20261011-optimized';
import { ScopedSubscriptions } from '../core/ScopedSubscriptions.js';
import { AttendanceSyncService, AttendanceRealtimeBridge } from '../controllers/AttendanceController.js?v=20261011-optimized';
import { GeofenceController } from '../controllers/GeofenceController.js?v=20261011-optimized';
import { hasPermission } from '../core/permissions.js?v=20261011-optimized';
import { AttendanceCorrectionController } from '../controllers/AttendanceCorrectionController.js?v=20261011-optimized';
import { AttendanceSummaryService } from '../controllers/AttendanceSummaryService.js';
import { FineEligibilityService } from '../controllers/FineEligibilityService.js';
import { getDocFromServer } from '../dashboard.js?v=20261011-optimized';
import { AttendanceHistoryController, AttendanceRepository } from '../controllers/AttendanceHistoryController.js?v=20261011-optimized';
import { AttendanceToolbarController } from '../controllers/AttendanceToolbarController.js';
import { AttendanceRecordProjectionService } from '../controllers/AttendanceRecordProjectionService.js';
import { AttendanceAnalyticsController } from '../controllers/AttendanceAnalyticsController.js';
import { DailyAttendanceClock } from '../controllers/DailyAttendanceClock.js';
import { EventSchedulePresenter } from '../controllers/EventSchedulePresenter.js';
import { AttendanceViews } from '../controllers/AttendanceViews.js';
import { StudentActionsPresenter } from '../controllers/StudentActionsPresenter.js';
import { StudentSectionFilter } from '../controllers/StudentSectionFilter.js';
import { AbsenceCardsPresenter } from '../controllers/AbsenceCardsPresenter.js';
export class AdminDashboard {
  constructor({
    document = globalThis.document,
    window = globalThis.window,
    sessionStorage = globalThis.sessionStorage
  } = {}) {
    this.document = document;
    this.window = window;
    this.sessionStorage = sessionStorage;
    this.scope = new ControllerScope();
    this.can = this.can.bind(this);
    this.applyActionPermissions = this.applyActionPermissions.bind(this);
    this.listen = this.listen.bind(this);
    this.changeSubscriptions = this.changeSubscriptions.bind(this);
    this.onHistoryView = this.onHistoryView.bind(this);
    this.handleCorrection = this.handleCorrection.bind(this);
    this.notifyRoles = this.notifyRoles.bind(this);
    this.updateAttendanceSyncStatus = this.updateAttendanceSyncStatus.bind(this);
    this.setDefaultCutoff = this.setDefaultCutoff.bind(this);
    this.closeRoleChangeModal = this.closeRoleChangeModal.bind(this);
    this.openRoleChangeModal = this.openRoleChangeModal.bind(this);
    this.scheduleStudentsRender = this.scheduleStudentsRender.bind(this);
    this.scheduleAdminEventStatusRefresh = this.scheduleAdminEventStatusRefresh.bind(this);
    this.makeGeofenceEditor = this.makeGeofenceEditor.bind(this);
    this.renderGeofenceEventOptions = this.renderGeofenceEventOptions.bind(this);
    this.loadGeofenceManager = this.loadGeofenceManager.bind(this);
    this.prepareAdminProfilePhoto = this.prepareAdminProfilePhoto.bind(this);
    this.updateAdminPhotoPreview = this.updateAdminPhotoPreview.bind(this);
    this.renderAdminProfile = this.renderAdminProfile.bind(this);
    this.updateDataCleanupState = this.updateDataCleanupState.bind(this);
    this.renderDataCleanupCounts = this.renderDataCleanupCounts.bind(this);
    this.closeDataCleanupModal = this.closeDataCleanupModal.bind(this);
    this.renderAdminAttendance = this.renderAdminAttendance.bind(this);
    this.attendanceLineMarkup = this.attendanceLineMarkup.bind(this);
    this.renderAttendanceLine = this.renderAttendanceLine.bind(this);
    this.renderAdminEvents = this.renderAdminEvents.bind(this);
    this.eventCardMarkup = this.eventCardMarkup.bind(this);
    this.renderPastEvents = this.renderPastEvents.bind(this);
    this.renderFineOptions = this.renderFineOptions.bind(this);
    this.renderAdminFines = this.renderAdminFines.bind(this);
    this.resetFineForm = this.resetFineForm.bind(this);
    this.editFine = this.editFine.bind(this);
    this.setFineServiceDuration = this.setFineServiceDuration.bind(this);
    this.setFineExtensionDuration = this.setFineExtensionDuration.bind(this);
    this.setCommunityServiceExtension = this.setCommunityServiceExtension.bind(this);
    this.getStudentPresence = this.getStudentPresence.bind(this);
    this.setPresenceSessions = this.setPresenceSessions.bind(this);
    this.renderStudents = this.renderStudents.bind(this);
    this.renderSelectedStudent = this.renderSelectedStudent.bind(this);
    this.getStudentAbsences = this.getStudentAbsences.bind(this);
    this.openAdminAbsenceModal = this.openAdminAbsenceModal.bind(this);
    this.fineRecordModalMarkup = this.fineRecordModalMarkup.bind(this);
    this.openAdminFineModal = this.openAdminFineModal.bind(this);
    this.resetStudentFaceRegistration = this.resetStudentFaceRegistration.bind(this);
    this.resetEventForm = this.resetEventForm.bind(this);
    this.duplicateEventSignature = this.duplicateEventSignature.bind(this);
    this.editEvent = this.editEvent.bind(this);
    this.writeInBatches = this.writeInBatches.bind(this);
    this.syncEventRecords = this.syncEventRecords.bind(this);
    this.closePastEventRemovalModal = this.closePastEventRemovalModal.bind(this);
    this.openPastEventRemovalModal = this.openPastEventRemovalModal.bind(this);
    this.removeEventAndRecords = this.removeEventAndRecords.bind(this);
    this.handleEventCardAction = this.handleEventCardAction.bind(this);
    this.resetStudentForm = this.resetStudentForm.bind(this);
    this.editStudent = this.editStudent.bind(this);
    this.closePasswordModal = this.closePasswordModal.bind(this);
    this.closeRemoveModal = this.closeRemoveModal.bind(this);
    this.closeResetFaceModal = this.closeResetFaceModal.bind(this);
    this.openPasswordModal = this.openPasswordModal.bind(this);
    this.openRemoveModal = this.openRemoveModal.bind(this);
    this.openResetFaceModal = this.openResetFaceModal.bind(this);
    this.resetStudentDirectoryPage = this.resetStudentDirectoryPage.bind(this);
    this.handleEventTimeInChange = this.handleEventTimeInChange.bind(this);
    this.handleEventTimeOutChange = this.handleEventTimeOutChange.bind(this);
    this.handleRoleChangeModalClick = this.handleRoleChangeModalClick.bind(this);
    this.handleGeofenceEventSelectChange = this.handleGeofenceEventSelectChange.bind(this);
    this.handleSaveManagerGeofenceClick = this.handleSaveManagerGeofenceClick.bind(this);
    this.handleGeofenceEditEventClick = this.handleGeofenceEditEventClick.bind(this);
    this.handleWireProfileActionsPresenceViewchange = this.handleWireProfileActionsPresenceViewchange.bind(this);
    this.handleAdminProfileFormSubmit = this.handleAdminProfileFormSubmit.bind(this);
    this.handleAdminProfilePhotoChange = this.handleAdminProfilePhotoChange.bind(this);
    this.handleRemoveAdminProfilePhotoClick = this.handleRemoveAdminProfilePhotoClick.bind(this);
    this.handleAdminDisplayNameInput = this.handleAdminDisplayNameInput.bind(this);
    this.handleOpenDataCleanupClick = this.handleOpenDataCleanupClick.bind(this);
    this.handleDataCleanupModalClick = this.handleDataCleanupModalClick.bind(this);
    this.handleWireCleanupAndSyncActionsKeydown = this.handleWireCleanupAndSyncActionsKeydown.bind(this);
    this.handleConfirmDataCleanupClick = this.handleConfirmDataCleanupClick.bind(this);
    this.handleSyncAttendanceNowClick = this.handleSyncAttendanceNowClick.bind(this);
    this.handleFineFormSubmit = this.handleFineFormSubmit.bind(this);
    this.handleAddCommunityServiceClick = this.handleAddCommunityServiceClick.bind(this);
    this.handleAdminFineListClick = this.handleAdminFineListClick.bind(this);
    this.handleCancelFineEditClick = this.handleCancelFineEditClick.bind(this);
    this.handleFineStudentSearchResultsClick = this.handleFineStudentSearchResultsClick.bind(this);
    this.handleEventFormSubmit = this.handleEventFormSubmit.bind(this);
    this.handlePastEventRemovalModalClick = this.handlePastEventRemovalModalClick.bind(this);
    this.handleWireEventActionsKeydown = this.handleWireEventActionsKeydown.bind(this);
    this.handleConfirmPastEventRemovalClick = this.handleConfirmPastEventRemovalClick.bind(this);
    this.handleStudentFormSubmit = this.handleStudentFormSubmit.bind(this);
    this.handleCancelStudentFormClick = this.handleCancelStudentFormClick.bind(this);
    this.handleStudentTableBodyClick = this.handleStudentTableBodyClick.bind(this);
    this.handleStudentTableBodyChange = this.handleStudentTableBodyChange.bind(this);
    this.handleConfirmRoleChangeClick = this.handleConfirmRoleChangeClick.bind(this);
    this.handleStudentMobileCardsClick = this.handleStudentMobileCardsClick.bind(this);
    this.handleAdminStudentDetailClick = this.handleAdminStudentDetailClick.bind(this);
    this.handleManageStudentFinesClick = this.handleManageStudentFinesClick.bind(this);
    this.handleWireStudentAccountActionsKeydown = this.handleWireStudentAccountActionsKeydown.bind(this);
    this.handleWireStudentAccountActionsKeydown2 = this.handleWireStudentAccountActionsKeydown2.bind(this);
    this.handlePasswordChangeFormSubmit = this.handlePasswordChangeFormSubmit.bind(this);
    this.handleConfirmRemoveStudentClick = this.handleConfirmRemoveStudentClick.bind(this);
    this.handleConfirmResetFaceClick = this.handleConfirmResetFaceClick.bind(this);
    this.handlePasswordModalClick = this.handlePasswordModalClick.bind(this);
    this.handleRemoveStudentModalClick = this.handleRemoveStudentModalClick.bind(this);
    this.handleResetFaceModalClick = this.handleResetFaceModalClick.bind(this);
    this.handleWireStudentAccountActionsKeydown3 = this.handleWireStudentAccountActionsKeydown3.bind(this);
    this.handleClearStudentFiltersClick = this.handleClearStudentFiltersClick.bind(this);
    this.handlePreviousStudentPageClick = this.handlePreviousStudentPageClick.bind(this);
    this.handleNextStudentPageClick = this.handleNextStudentPageClick.bind(this);
    this.handleRefreshStudentStatusClick = this.handleRefreshStudentStatusClick.bind(this);
    this.handleWireDirectoryFiltersPresenceViewchange = this.handleWireDirectoryFiltersPresenceViewchange.bind(this);
  }
  dispose() {
    this.window.clearInterval(this.removalCountdownTimer);
    this.adminFineModalController?.dispose?.();
    this.adminAbsenceModalController?.dispose?.();
    this.scope.dispose();
  }
  initialize() {
    if (!this.scope.initialize()) return;
    this.initializeState();
    this.initializeAttendanceTools();
    this.initializeElementsAndGeofences();
    this.wireProfileActions();
    this.wireCleanupAndSyncActions();
    this.wireFineActions();
    this.wireEventActions();
    this.wireStudentAccountActions();
    this.wireDirectoryFilters();
    this.startSubscriptions();
    // The approvals listener also owns the navigation badge on every admin view.
    void this.loadAccountApprovals().catch(() => {});
    void this.loadCorrectionRequests().catch(() => {});
    this.dailyClock = new DailyAttendanceClock({ window: this.window, document: this.document, onDayChange: () => {
      this.renderAdminAttendance();
      this.renderAttendanceLine();
      this.scheduleStudentsRender();
    } });
    this.dailyClock.initialize();
    this.scope.addCleanup(() => this.dailyClock.dispose());
  }
  initializeState() {
    const dashboard = this;
    dashboard.studentActions = new StudentActionsPresenter({
      can: dashboard.can,
      escapeHtml
    });
    dashboard.actionSelectors = {
      changePasswords: '[data-password-student]',
      deleteStudents: '[data-delete-student]',
      resetFace: '[data-reset-face]',
      editStudents: '[data-edit-student]',
      manageFines: '[data-edit-fine], #manageStudentFines',
      deleteFines: '[data-delete-fine]',
      deleteEvents: '[data-delete-event], [data-remove-event]',
      resetData: '#openDataCleanup'
    };
    dashboard.applyActionPermissions();
    dashboard.subscriptions = new ScopedSubscriptions({
      onError: (error, key) => {
        console.error(key, error);
        if (key === 'attendance') dashboard.updateAttendanceSyncStatus({ state: 'error', error });
        if (key === 'students') { dashboard.studentsLoaded = false; dashboard.attendanceReport?.refreshContext(); }
        const message = error?.code === 'permission-denied'
          ? 'Access was denied. Check your signed-in account and deployed database rules.'
          : error?.message || 'Check your connection and reload to retry.';
        showDashboardToast('Data sync unavailable', message);
      }
    });
    dashboard.scope.listen(dashboard.window, 'presence:viewchange', dashboard.changeSubscriptions);
    dashboard.scope.addCleanup(() => {
      dashboard.subscriptions.stop();
      dashboard.window.removeEventListener('presence:viewchange', dashboard.changeSubscriptions);
    });
    dashboard.events = [];
    dashboard.geofencesByEventId = new Map();
    dashboard.students = [];
    dashboard.studentsLoaded = false;
    dashboard.attendanceConfirmed = false;
    dashboard.attendance = [];
    dashboard.attendanceSyncService = undefined;
    dashboard.fines = [];
    dashboard.selectedFineStudentUid = "";
    dashboard.faceRegistrationsByUid = new Map();
    dashboard.presenceByUid = new Map();
    dashboard.legacyPresenceByUid = new Map();
    dashboard.summaryService = new AttendanceSummaryService({
      closeDate: eventCloseDate,
      checkoutCloseDate: eventCheckoutCloseDate
    });
    dashboard.attendanceProjection = new AttendanceRecordProjectionService({
      getEvents: () => dashboard.events,
      getStudents: () => dashboard.students,
      checkoutCloseDate: eventCheckoutCloseDate
    });
    dashboard.fineEligibility = new FineEligibilityService({ summary: dashboard.summaryService,
      loadEvent: async id => {
        const snapshot = await getDocFromServer(doc(db, 'events', id));
        return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null;
      },
      loadAttendance: async uid => (await getDocsFromServer(query(collection(db, 'attendance'), where('studentUid', '==', uid)))).docs.map(item => item.data())
    });
    dashboard.schedulePresenter = new EventSchedulePresenter({
      formatTime: formatEventTime,
      escapeHtml,
      addMinutes: timePlusMinutes
    });
    dashboard.coverageDate = new Date(Date.now() - 30 * 86400000);
    dashboard.recentAttendanceFrom = new Date(dashboard.coverageDate.getTime() - dashboard.coverageDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    dashboard.attendanceCoverageFrom = '';
  }
  initializeAttendanceTools() {
    const dashboard = this;
    dashboard.relativeAttendanceClock = new AttendanceRelativeTime({window:dashboard.window,document:dashboard.document});
    dashboard.relativeAttendanceClock.initialize();
    dashboard.scheduleConfirmation = new SurveyConfirmationController({document:dashboard.document,titleId:'eventScheduleChangeTitle'});
    dashboard.scope.addCleanup(() => { dashboard.relativeAttendanceClock.dispose(); dashboard.scheduleConfirmation.dispose(); });
    dashboard.analyticsController = new AttendanceAnalyticsController({
      document: dashboard.document, repository: new AttendanceRepository(db),
      getEvents: () => dashboard.events, getStudents: () => dashboard.students,
      closeDate: eventCheckoutCloseDate, escapeHtml
    });
    dashboard.analyticsController.initialize();
    dashboard.scope.listen(dashboard.document.querySelector('#retryDashboardAttendance'), 'click', dashboard.handleSyncAttendanceNowClick);
    dashboard.scope.addCleanup(() => dashboard.analyticsController.dispose());
    dashboard.historyController = new AttendanceHistoryController({
      repository: new AttendanceRepository(db),
      requireEvent: true,
      pageSize: 7,
      getStudents: () => dashboard.students,
      getEvents: () => dashboard.events,
      summary: dashboard.summaryService,
      notify: showDashboardToast,
      onStatus: status => dashboard.updateAttendanceSyncStatus({ ...status, history: true }),
      prepareRecords: (records, state) => {
        const filters = dashboard.historyController?.applied || {};
        const projected = state.verified && !state.busy && !state.partial
          ? dashboard.historyController.selectedSessions(filters).flatMap(event => dashboard.attendanceProjection.project(records.filter(record => record.eventId === event.id), { ...filters, eventId: event.id, includePending: filters.sort === 'no-check-in' || dashboard.historyController.combined() }, dashboard.historyController?.records || records))
          : records;
        return dashboard.historyController.sortForDisplay(projected);
      },
      render: (records, state) => {
        if (state.chooseEvent) {
          dashboard.document.querySelector('#adminAttendanceLine').innerHTML = '<div class="attendance-empty" role="status"><h3>Choose an event to view attendance records.</h3><p>Select an event above to get started.</p></div>';
          return;
        }
        if (dashboard.historyController.combined() && records.length) {
          const groups = new Map();
          for (const record of records) { const key = record.studentUid || record.id; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(record); }
          dashboard.document.querySelector('#adminAttendanceLine').innerHTML = [...groups.values()].map(group => `<section class="attendance-student-sessions" aria-label="Student morning and afternoon records">${group.map(record => `<div><p class="attendance-session-label">${AttendanceViews.label(dashboard.events.find(event => event.id === record.eventId) || record)}</p>${dashboard.attendanceLineMarkup([record])}</div>`).join('')}</section>`).join('');
        } else dashboard.document.querySelector('#adminAttendanceLine').innerHTML = records.length ? dashboard.attendanceLineMarkup(records) : AttendanceToolbarController.emptyState(state);
      }
    });
    dashboard.historyController.initialize();
    dashboard.attendanceReport = new AttendanceReportController({ document: dashboard.document, window: dashboard.window, db,
      can: () => dashboard.can('viewAttendance'), summary: dashboard.summaryService, checkoutCloseDate: eventCheckoutCloseDate,
      context: () => ({ filters: dashboard.historyController.filters(), events: dashboard.events, students: dashboard.students, studentsReady: dashboard.studentsLoaded }),
      notify: showDashboardToast });
    dashboard.attendanceReport.initialize();
    dashboard.scope.addCleanup(() => dashboard.attendanceReport.dispose());
    dashboard.document.querySelector('#attendanceFromDate').value = dashboard.recentAttendanceFrom;
    dashboard.scope.listen(dashboard.window, 'presence:viewchange', dashboard.onHistoryView);
    dashboard.scope.addCleanup(() => {
      dashboard.historyController.dispose();
      dashboard.window.removeEventListener('presence:viewchange', dashboard.onHistoryView);
    });
    dashboard.correctionController = new AttendanceCorrectionController({
      db,
      user: currentUser,
      role: currentUserRole,
      getStudents: () => dashboard.students,
      getEvents: () => dashboard.events,
      eligibility: (student, event) => dashboard.summaryService.eligibility(student, event),
      escapeHtml,
      notify: showDashboardToast
    });
    dashboard.correctionController.initialize();
    dashboard.scope.addCleanup(() => {
      dashboard.correctionController.dispose();
    });
    dashboard.scope.listen(dashboard.document.querySelector('#adminAttendanceLine'), 'click', dashboard.handleCorrection);
    dashboard.scope.listen(dashboard.document.querySelector('#adminDashboardAttendanceLine'), 'click', dashboard.handleCorrection);
    dashboard.scope.addCleanup(() => {
      dashboard.document.querySelector('#adminAttendanceLine').removeEventListener('click', dashboard.handleCorrection);
      dashboard.document.querySelector('#adminDashboardAttendanceLine').removeEventListener('click', dashboard.handleCorrection);
    });
  }
  initializeElementsAndGeofences() {
    const dashboard = this;
    dashboard.eventForm = dashboard.document.querySelector("#eventForm");
    dashboard.attendanceSyncStatus = dashboard.document.querySelector("#attendanceSyncStatus");
    dashboard.syncAttendanceNow = dashboard.document.querySelector("#syncAttendanceNow");
    dashboard.canManuallySyncAttendance = dashboard.can('correctAttendance');
    dashboard.attendanceSyncStatus.hidden = !dashboard.canManuallySyncAttendance;
    dashboard.syncAttendanceNow.hidden = !dashboard.canManuallySyncAttendance;
    dashboard.attendanceRealtimeBridge = new AttendanceRealtimeBridge(portableRecord => {
      const fromMillis = value => Number.isFinite(value) ? Timestamp.fromMillis(value) : undefined;
      const record = {
        ...portableRecord,
        attendedAt: fromMillis(portableRecord.attendedAt),
        checkedInAt: fromMillis(portableRecord.checkedInAt),
        checkedOutAt: fromMillis(portableRecord.checkedOutAt)
      };
      dashboard.attendance = [...dashboard.attendance.filter(item => item.id !== record.id), record];
      dashboard.scheduleStudentsRender();
      if (activeView === "dashboard") {
        dashboard.renderAdminAttendance();
        dashboard.renderAttendanceLine();
      }
      if (activeView === "attendance-line") dashboard.renderAttendanceLine();
    });
    dashboard.scope.listen(dashboard.document.querySelector("#eventTimeIn"), "change", dashboard.handleEventTimeInChange);
    dashboard.scope.listen(dashboard.document.querySelector("#eventTimeOut"), "change", dashboard.handleEventTimeOutChange);
    dashboard.studentForm = dashboard.document.querySelector("#studentForm");
    dashboard.eventTableBody = dashboard.document.querySelector("#eventTableBody");
    dashboard.pastEventList = dashboard.document.querySelector("#pastEventList");
    dashboard.pastEventRemovalModal = dashboard.document.querySelector("#pastEventRemovalModal");
    dashboard.selectedPastEventForRemoval = undefined;
    dashboard.studentTableBody = dashboard.document.querySelector("#studentTableBody");
    dashboard.studentMobileCards = dashboard.document.querySelector("#studentMobileCards");
    dashboard.studentSearch = dashboard.document.querySelector("#studentSearch");
    dashboard.studentCourseFilter = dashboard.document.querySelector("#studentCourseFilter");
    dashboard.studentSectionFilter = dashboard.document.querySelector("#studentSectionFilter");
    dashboard.studentFaceFilter = dashboard.document.querySelector("#studentFaceFilter");
    dashboard.studentAccountFilter = dashboard.document.querySelector("#studentAccountFilter");
    dashboard.studentAttendanceFilter = dashboard.document.querySelector("#studentAttendanceFilter");
    dashboard.studentFineFilter = dashboard.document.querySelector("#studentFineFilter");
    dashboard.studentSort = dashboard.document.querySelector("#studentSort");
    dashboard.studentPagination = dashboard.document.querySelector("#studentPagination");
    dashboard.studentPageInfo = dashboard.document.querySelector("#studentPageInfo");
    dashboard.previousStudentPage = dashboard.document.querySelector("#previousStudentPage");
    dashboard.nextStudentPage = dashboard.document.querySelector("#nextStudentPage");
    dashboard.fineForm = dashboard.document.querySelector("#fineForm");
    dashboard.fineStudent = dashboard.document.querySelector("#fineStudent");
    dashboard.fineStudentSearch = dashboard.document.querySelector("#fineStudentSearch");
    dashboard.scope.mount(dashboard.fineStudentSearch, "afterend", '<div class="fine-student-search-results" id="fineStudentSearchResults" role="listbox" hidden></div>');
    dashboard.fineStudentSearchResults = dashboard.document.querySelector("#fineStudentSearchResults");
    dashboard.adminFineModalController = new FineModalController({
      modal: dashboard.document.querySelector("#adminFineModal"),
      content: dashboard.document.querySelector("#adminFineModalContent"),
      title: dashboard.document.querySelector("#adminFineModalTitle"),
      description: dashboard.document.querySelector("#adminFineModalDescription"),
      closeSelector: "[data-close-admin-fines]",
      document: dashboard.document
    });
    dashboard.adminAbsenceModalController = new FineModalController({
      modal: dashboard.document.querySelector("#adminAbsenceModal"),
      content: dashboard.document.querySelector("#adminAbsenceModalContent"),
      title: dashboard.document.querySelector("#adminAbsenceModalTitle"),
      description: dashboard.document.querySelector("#adminAbsenceModalDescription"),
      closeSelector: "[data-close-admin-absences]",
      document: dashboard.document
    });
    dashboard.fineEvent = dashboard.document.querySelector("#fineEvent");
    dashboard.addCommunityService = dashboard.document.querySelector("#addCommunityService");
    dashboard.fineExtensionControls = dashboard.document.querySelector("#fineExtensionControls");
    dashboard.fineExtensionHours = dashboard.document.querySelector("#fineExtensionHours");
    dashboard.fineExtensionMinutes = dashboard.document.querySelector("#fineExtensionMinutes");
    dashboard.fineExtensionReason = dashboard.document.querySelector("#fineExtensionReason");
    dashboard.fineServiceDurationHelp = dashboard.document.querySelector("#fineServiceDurationHelp");
    dashboard.adminFineList = dashboard.document.querySelector("#adminFineList");
    dashboard.fineSearch = dashboard.document.querySelector("#fineSearch");
    dashboard.fineStatusFilter = dashboard.document.querySelector("#fineStatusFilter");
    dashboard.fineDateFilter = dashboard.document.querySelector("#fineDateFilter");
    dashboard.fineSort = dashboard.document.querySelector("#fineSort");
    dashboard.passwordModal = dashboard.document.querySelector("#passwordModal");
    dashboard.removeStudentModal = dashboard.document.querySelector("#removeStudentModal");
    dashboard.resetFaceModal = dashboard.document.querySelector("#resetFaceModal");
    dashboard.roleChangeModal = dashboard.document.querySelector("#roleChangeModal");
    dashboard.roleChangeMessage = dashboard.document.querySelector("#roleChangeMessage");
    dashboard.confirmRoleChange = dashboard.document.querySelector("#confirmRoleChange");
    dashboard.adminStudentDetail = dashboard.document.querySelector("#adminStudentDetail");
    dashboard.selectedPasswordStudent = undefined;
    dashboard.selectedRemovalStudent = undefined;
    dashboard.selectedFaceResetStudent = undefined;
    dashboard.selectedManagedStudentUid = undefined;
    dashboard.pendingRoleChange = undefined;
    dashboard.pendingRoleWrites = new Map();
    dashboard.removalCountdownTimer = undefined;
    dashboard.pendingAdminProfilePhoto = "";
    dashboard.addingCommunityService = false;
    dashboard.studentPageSize = 10;
    dashboard.studentPage = 1;
    dashboard.studentRenderFrame = undefined;
    dashboard.adminEventStatusTimer = undefined;
    dashboard.studentFilterSignature = "";
    dashboard.studentDirectoryMediaQuery = dashboard.window.matchMedia("(max-width: 580px)");
    dashboard.document.querySelectorAll("[data-close-role-change]").forEach(button => dashboard.scope.listen(button, "click", dashboard.closeRoleChangeModal));
    dashboard.scope.listen(dashboard.roleChangeModal, "click", dashboard.handleRoleChangeModalClick);
    dashboard.eventSyncNotice = dashboard.document.querySelector(".notice");
    if (dashboard.eventSyncNotice) dashboard.eventSyncNotice.textContent = "All students can view events. Only assigned sections can take attendance. Save group changes to update participants while the event is upcoming or ongoing; closed-event groups stay locked. Late-added groups are reviewed, not automatically marked absent.";
    dashboard.document.querySelector('#eventAudience').innerHTML = '<option>All students</option><option>Selected sections</option>';
    dashboard.document.querySelector('label[for="eventAudience"]').textContent = 'Attendance participants';
    dashboard.scope.mount(dashboard.document.querySelector('#eventAudience').closest('.field'), 'afterend', `<fieldset id="eventSectionChoices" class="field full" hidden><legend>Sections allowed to take attendance</legend><div class="event-section-choices">${EventAudiencePolicy.sections.map(section => `<label><input type="checkbox" data-event-section value="${section}"> Section ${section}</label>`).join('')}</div><small>Other sections can view the event, but cannot check in or check out without an existing check-in.</small></fieldset>`);
    dashboard.eventAudienceEditor = new EventAudienceController({ document: dashboard.document, scope: dashboard.scope });
    dashboard.eventSessionEditor = new EventSessionController({ document: dashboard.document, scope: dashboard.scope });
    dashboard.studentTableBody.closest("table").querySelectorAll("th")[1].textContent = "Course / Section";
    dashboard.studentTableBody.closest("table").querySelectorAll("th")[2].textContent = "Face / live status";
    dashboard.document.querySelector('label[for="eventNotes"]').textContent = "Description";
    dashboard.document.querySelector("#eventNotes").placeholder = "Write a clear announcement or event description";
    dashboard.scope.mount(dashboard.document.querySelector("#eventLocation").closest(".field"), "beforebegin", '<div class="field"><label for="eventType">Event type</label><select id="eventType" required><option value="Assembly">Assembly</option><option value="Meeting">Meeting</option><option value="Seminar">Seminar</option><option value="Workshop">Workshop</option><option value="School Activity">School Activity</option><option value="Ceremony">Ceremony</option><option value="Sports">Sports</option><option value="Other">Other</option></select></div>');
    dashboard.scope.mount(dashboard.document.querySelector("#eventNotes").closest(".field"), "beforebegin", `<fieldset class="geofence-editor field full"><legend>Attendance area</legend><label class="geofence-toggle"><input id="eventGeofenceEnabled" type="checkbox"> <span>Require location to check in</span></label><p>Choose a circle radius or draw a custom polygon boundary.</p><div class="map-search-row"><input id="eventGeofenceSearch" type="search" placeholder="Search an address or place"><button id="eventGeofenceSearchButton" class="outline-button" type="button">Search</button></div><div id="eventGeofenceMap" class="geofence-map" aria-label="Event attendance area map"></div><div class="geofence-fields"><div class="field"><label for="eventGeofenceRadius">Allowed radius (meters)</label><input id="eventGeofenceRadius" type="number" min="25" max="100000" step="5" value="100"></div><div class="field"><label for="eventGeofenceAddress">Selected address</label><input id="eventGeofenceAddress" type="text" readonly placeholder="Click the map or search for a place"></div><div class="field"><label for="eventGeofenceLatitude">Latitude</label><input id="eventGeofenceLatitude" type="number" step="any" readonly></div><div class="field"><label for="eventGeofenceLongitude">Longitude</label><input id="eventGeofenceLongitude" type="number" step="any" readonly></div></div><small class="geofence-help">Circle: click to set the center. Polygon: add 3–10 points around the area, then close the boundary. Students must allow location access.</small></fieldset>`);
    dashboard.scope.mount(dashboard.document.querySelector(".content"), "beforeend", `<section class="view-section" data-section="geofence" hidden><div class="section-head"><div><p class="eyebrow">Attendance setup</p><h2>Geofence Locations</h2><p>Select an event and update the area where students may check in.</p></div></div><article class="panel geofence-manager-panel"><div class="field"><label for="geofenceEventSelect">Event</label><select id="geofenceEventSelect"><option value="">Select an event</option></select></div><div id="geofenceManagerContent" hidden><div class="geofence-manager-head"><div><strong id="geofenceManagerEventName"></strong><small id="geofenceManagerEventDetails"></small></div><label class="geofence-toggle"><input id="managerGeofenceEnabled" type="checkbox"> <span>Require location to check in</span></label></div><div class="map-search-row"><input id="managerGeofenceSearch" type="search" placeholder="Search an address or place"><button id="managerGeofenceSearchButton" class="outline-button" type="button">Search</button></div><div id="managerGeofenceMap" class="geofence-map" aria-label="Selected event attendance area map"></div><div class="geofence-fields"><div class="field"><label for="managerGeofenceRadius">Allowed radius (meters)</label><input id="managerGeofenceRadius" type="number" min="25" max="100000" step="5" value="100"></div><div class="field"><label for="managerGeofenceAddress">Selected address</label><input id="managerGeofenceAddress" type="text" readonly></div><div class="field"><label for="managerGeofenceLatitude">Latitude</label><input id="managerGeofenceLatitude" type="number" step="any" readonly></div><div class="field"><label for="managerGeofenceLongitude">Longitude</label><input id="managerGeofenceLongitude" type="number" step="any" readonly></div></div><div class="form-actions"><button id="geofenceEditEvent" class="outline-button" type="button">Edit full event</button><button id="saveManagerGeofence" class="primary-button" type="button">Save attendance area</button></div></div><div id="geofenceManagerEmpty" class="empty-state">Select an event to view or change its attendance area.</div></article></section>`);
    dashboard.document.querySelector("#adminProfileEmail").value = currentUser.email || SUPER_ADMIN_EMAIL;
    dashboard.eventGeofenceEditor = dashboard.makeGeofenceEditor("event");
    dashboard.managerGeofenceEditor = dashboard.makeGeofenceEditor("manager");
    dashboard.geofenceEventSelect = dashboard.document.querySelector("#geofenceEventSelect");
    dashboard.geofenceManagerContent = dashboard.document.querySelector("#geofenceManagerContent");
    dashboard.geofenceManagerEmpty = dashboard.document.querySelector("#geofenceManagerEmpty");
    dashboard.scope.listen(dashboard.geofenceEventSelect, "change", dashboard.handleGeofenceEventSelectChange);
    dashboard.scope.listen(dashboard.document.querySelector("#saveManagerGeofence"), "click", dashboard.handleSaveManagerGeofenceClick);
    dashboard.scope.listen(dashboard.document.querySelector("#geofenceEditEvent"), "click", dashboard.handleGeofenceEditEventClick);
  }
  wireProfileActions() {
    const dashboard = this;
    dashboard.scope.listen(dashboard.window, "presence:viewchange", dashboard.handleWireProfileActionsPresenceViewchange);
    dashboard.scope.listen(dashboard.document.querySelector("#adminProfileForm"), "submit", dashboard.handleAdminProfileFormSubmit);
    dashboard.scope.listen(dashboard.document.querySelector("#adminProfilePhoto"), "change", dashboard.handleAdminProfilePhotoChange);
    dashboard.scope.listen(dashboard.document.querySelector("#removeAdminProfilePhoto"), "click", dashboard.handleRemoveAdminProfilePhotoClick);
    dashboard.scope.listen(dashboard.document.querySelector("#adminDisplayName"), "input", dashboard.handleAdminDisplayNameInput);
  }
  wireCleanupAndSyncActions() {
    const dashboard = this;
    dashboard.dataCleanupModal = dashboard.document.querySelector("#dataCleanupModal");
    dashboard.clearEventData = dashboard.document.querySelector("#clearEventData");
    dashboard.clearFineData = dashboard.document.querySelector("#clearFineData");
    dashboard.dataCleanupConfirm = dashboard.document.querySelector("#dataCleanupConfirm");
    dashboard.confirmDataCleanup = dashboard.document.querySelector("#confirmDataCleanup");
    dashboard.scope.listen(dashboard.document.querySelector("#openDataCleanup"), "click", dashboard.handleOpenDataCleanupClick);
    [dashboard.clearEventData, dashboard.clearFineData].forEach(input => dashboard.scope.listen(input, "change", dashboard.updateDataCleanupState));
    dashboard.scope.listen(dashboard.dataCleanupConfirm, "input", dashboard.updateDataCleanupState);
    dashboard.document.querySelectorAll("[data-close-data-cleanup]").forEach(button => dashboard.scope.listen(button, "click", dashboard.closeDataCleanupModal));
    dashboard.scope.listen(dashboard.dataCleanupModal, "click", dashboard.handleDataCleanupModalClick);
    dashboard.scope.listen(dashboard.document, "keydown", dashboard.handleWireCleanupAndSyncActionsKeydown);
    dashboard.scope.listen(dashboard.confirmDataCleanup, "click", dashboard.handleConfirmDataCleanupClick);
    dashboard.scope.listen(dashboard.syncAttendanceNow, "click", dashboard.handleSyncAttendanceNowClick);
  }
  wireFineActions() {
    const dashboard = this;
    dashboard.scope.listen(dashboard.fineForm, "submit", dashboard.handleFineFormSubmit);
    dashboard.scope.listen(dashboard.addCommunityService, "click", dashboard.handleAddCommunityServiceClick);
    dashboard.document.querySelectorAll("[data-adjust-fine-minutes]").forEach(button => {
      dashboard.scope.listen(button, "click", () => {
        const totalMinutes = Number(dashboard.document.querySelector("#fineServiceHours").value) * 60 + Number(dashboard.document.querySelector("#fineServiceMinutes").value);
        dashboard.setFineServiceDuration(totalMinutes + Number(button.dataset.adjustFineMinutes));
      });
    });
    dashboard.document.querySelectorAll("#fineServiceHours, #fineServiceMinutes").forEach(input => {
      dashboard.scope.listen(input, "change", () => dashboard.setFineServiceDuration(Number(dashboard.document.querySelector("#fineServiceHours").value) * 60 + Number(dashboard.document.querySelector("#fineServiceMinutes").value)));
    });
    dashboard.document.querySelectorAll("[data-adjust-extension-minutes]").forEach(button => {
      dashboard.scope.listen(button, "click", () => dashboard.setFineExtensionDuration(Number(dashboard.fineExtensionHours.value) * 60 + Number(dashboard.fineExtensionMinutes.value) + Number(button.dataset.adjustExtensionMinutes)));
    });
    [dashboard.fineExtensionHours, dashboard.fineExtensionMinutes].forEach(input => {
      dashboard.scope.listen(input, "change", () => dashboard.setFineExtensionDuration(Number(dashboard.fineExtensionHours.value) * 60 + Number(dashboard.fineExtensionMinutes.value)));
    });
    dashboard.document.querySelectorAll('[data-view="assign-fine"], [data-go-view="assign-fine"]').forEach(button => {
      dashboard.scope.listen(button, "click", dashboard.resetFineForm);
    });
    dashboard.scope.listen(dashboard.adminFineList, "click", dashboard.handleAdminFineListClick);
    dashboard.scope.listen(dashboard.document.querySelector("#cancelFineEdit"), "click", dashboard.handleCancelFineEditClick);
    dashboard.scope.listen(dashboard.fineStudentSearch, "input", dashboard.renderFineOptions);
    dashboard.scope.listen(dashboard.fineStudent, "change", dashboard.renderFineOptions);
    dashboard.scope.listen(dashboard.fineStudentSearchResults, "click", dashboard.handleFineStudentSearchResultsClick);
    dashboard.scope.listen(dashboard.fineSearch, "input", dashboard.renderAdminFines);
    dashboard.scope.listen(dashboard.fineStatusFilter, "change", dashboard.renderAdminFines);
    dashboard.scope.listen(dashboard.fineDateFilter, "change", dashboard.renderAdminFines);
    dashboard.scope.listen(dashboard.fineSort, "change", dashboard.renderAdminFines);
  }
  wireEventActions() {
    const dashboard = this;
    dashboard.scope.listen(dashboard.eventForm, "submit", dashboard.handleEventFormSubmit);
    dashboard.scope.listen(dashboard.document.querySelector("#clearEventForm"), "click", dashboard.resetEventForm);
    dashboard.scope.listen(dashboard.eventTableBody, "click", dashboard.handleEventCardAction);
    dashboard.scope.listen(dashboard.document.querySelector('#adminEventTimeline'), "click", dashboard.handleEventCardAction);
    dashboard.scope.listen(dashboard.pastEventList, "click", dashboard.handleEventCardAction);
    dashboard.document.querySelectorAll("[data-close-past-event-removal]").forEach(button => dashboard.scope.listen(button, "click", dashboard.closePastEventRemovalModal));
    dashboard.scope.listen(dashboard.pastEventRemovalModal, "click", dashboard.handlePastEventRemovalModalClick);
    dashboard.scope.listen(dashboard.document, "keydown", dashboard.handleWireEventActionsKeydown);
    dashboard.scope.listen(dashboard.document.querySelector("#confirmPastEventRemoval"), "click", dashboard.handleConfirmPastEventRemovalClick);
  }
  wireStudentAccountActions() {
    const dashboard = this;
    for (const type of ['input', 'change']) dashboard.scope.listen(dashboard.document.querySelector('#managedBirthday'), type, () => dashboard.syncBirthdayPassword());
    dashboard.scope.listen(dashboard.studentForm, "submit", dashboard.handleStudentFormSubmit);
    dashboard.scope.listen(dashboard.document.querySelector("#cancelStudentForm"), "click", dashboard.handleCancelStudentFormClick);
    dashboard.scope.listen(dashboard.studentTableBody, "click", dashboard.handleStudentTableBodyClick);
    dashboard.scope.listen(dashboard.studentTableBody, "change", dashboard.handleStudentTableBodyChange);
    dashboard.scope.listen(dashboard.confirmRoleChange, "click", dashboard.handleConfirmRoleChangeClick);
    dashboard.scope.listen(dashboard.studentMobileCards, "click", dashboard.handleStudentMobileCardsClick);
    dashboard.scope.listen(dashboard.adminStudentDetail, "click", dashboard.handleAdminStudentDetailClick);
    dashboard.scope.listen(dashboard.document.querySelector("#manageStudentFines"), "click", dashboard.handleManageStudentFinesClick);
    dashboard.scope.listen(dashboard.document, "keydown", dashboard.handleWireStudentAccountActionsKeydown);
    dashboard.scope.listen(dashboard.document, "keydown", dashboard.handleWireStudentAccountActionsKeydown2);
    dashboard.scope.listen(dashboard.document.querySelector("#passwordChangeForm"), "submit", dashboard.handlePasswordChangeFormSubmit);
    dashboard.scope.listen(dashboard.document.querySelector("#confirmRemoveStudent"), "click", dashboard.handleConfirmRemoveStudentClick);
    dashboard.scope.listen(dashboard.document.querySelector("#confirmResetFace"), "click", dashboard.handleConfirmResetFaceClick);
    dashboard.document.querySelectorAll("[data-close-password]").forEach(button => dashboard.scope.listen(button, "click", dashboard.closePasswordModal));
    dashboard.document.querySelectorAll("[data-close-remove]").forEach(button => dashboard.scope.listen(button, "click", dashboard.closeRemoveModal));
    dashboard.document.querySelectorAll("[data-close-reset-face]").forEach(button => dashboard.scope.listen(button, "click", dashboard.closeResetFaceModal));
    dashboard.scope.listen(dashboard.passwordModal, "click", dashboard.handlePasswordModalClick);
    dashboard.scope.listen(dashboard.removeStudentModal, "click", dashboard.handleRemoveStudentModalClick);
    dashboard.scope.listen(dashboard.resetFaceModal, "click", dashboard.handleResetFaceModalClick);
    dashboard.scope.listen(dashboard.document, "keydown", dashboard.handleWireStudentAccountActionsKeydown3);
  }
  wireDirectoryFilters() {
    const dashboard = this;
    dashboard.studentSectionPicker = new StudentSectionFilter({ root: dashboard.studentSectionFilter, document: dashboard.document, escapeHtml, onChange: dashboard.resetStudentDirectoryPage });
    dashboard.studentSectionPicker.initialize();
    dashboard.scope.addCleanup(() => dashboard.studentSectionPicker.dispose());
    dashboard.document.querySelectorAll("[data-show-student-attendance]").forEach(button => dashboard.scope.listen(button, "click", () => {
      dashboard.openStudentAttendanceDirectory(button.dataset.showStudentAttendance);
    }));
    dashboard.scope.listen(dashboard.studentSearch, "input", () => {
      dashboard.window.clearTimeout(dashboard.studentSearchTimer);
      dashboard.studentSearchTimer = dashboard.window.setTimeout(dashboard.resetStudentDirectoryPage, 200);
    });
    dashboard.scope.addCleanup(() => dashboard.window.clearTimeout(dashboard.studentSearchTimer));
    [dashboard.studentCourseFilter, dashboard.studentFaceFilter, dashboard.studentAccountFilter, dashboard.studentAttendanceFilter, dashboard.studentFineFilter, dashboard.studentSort].forEach(filter => dashboard.scope.listen(filter, "change", dashboard.resetStudentDirectoryPage));
    dashboard.scope.listen(dashboard.document.querySelector("#clearStudentFilters"), "click", dashboard.handleClearStudentFiltersClick);
    dashboard.scope.listen(dashboard.previousStudentPage, "click", dashboard.handlePreviousStudentPageClick);
    dashboard.scope.listen(dashboard.nextStudentPage, "click", dashboard.handleNextStudentPageClick);
    dashboard.scope.listen(dashboard.document.querySelector("#refreshStudentStatus"), "click", dashboard.handleRefreshStudentStatusClick);
    dashboard.scope.listen(dashboard.studentDirectoryMediaQuery, "change", dashboard.scheduleStudentsRender);
    dashboard.scope.listen(dashboard.window, "presence:viewchange", dashboard.handleWireDirectoryFiltersPresenceViewchange);
  }
  openStudentAttendanceDirectory(attendanceFilter) {
    const dashboard = this;
    if (!["present", "absent"].includes(attendanceFilter)) return;
    dashboard.studentSearch.value = "";
    dashboard.studentCourseFilter.value = "all";
    dashboard.studentSectionPicker.reset();
    dashboard.studentFaceFilter.value = "all";
    dashboard.studentAccountFilter.value = "all";
    dashboard.studentAttendanceFilter.value = attendanceFilter;
    dashboard.studentFineFilter.value = "all";
    dashboard.studentSort.value = "name";
    openView("modify-students");
    dashboard.resetStudentDirectoryPage();
  }
  startSubscriptions() {
    const dashboard = this;
    if (dashboard.can('manageGeofences')) dashboard.listen('geofences', ["create", "geofence", "modify-events", "past-events"], collection(db, "eventGeofences"), snapshot => {
      dashboard.geofencesByEventId = new Map(snapshot.docs.map(item => [item.id, item.data()]));
      dashboard.events = dashboard.events.map(event => ({
        ...event,
        geofence: dashboard.geofencesByEventId.get(event.id) || {
          enabled: false
        }
      }));
      if (activeView === "geofence") dashboard.loadGeofenceManager();
      if (["dashboard", "modify-events", "past-events"].includes(activeView)) dashboard.renderAdminEvents();
    });
    dashboard.listen('events', ["*"], query(collection(db, "events"), orderBy("openAt", "asc")), snapshot => {
      dashboard.events = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data(),
        ...(dashboard.can('manageGeofences') ? {
          geofence: dashboard.geofencesByEventId.get(item.id) || {
            enabled: false
          }
        } : {})
      }));
      if (["dashboard", "modify-events"].includes(activeView)) dashboard.renderAdminEvents();
      if (activeView === "past-events") dashboard.renderPastEvents();
      dashboard.renderGeofenceEventOptions();
      if (activeView === "geofence") dashboard.loadGeofenceManager();
      if (activeView === "assign-fine") dashboard.renderFineOptions();
      if (["dashboard", "attendance-line"].includes(activeView)) dashboard.renderAttendanceLine();
      dashboard.scheduleAdminEventStatusRefresh();
      dashboard.correctionRequests?.render();
    });
    dashboard.listen('students', ["dashboard", "create", "modify-events", "past-events", "modify-students", "assign-fine", "attendance-line", "correction-requests", "profile"], collection(db, "students"), snapshot => {
      dashboard.studentsLoaded = !snapshot.metadata?.fromCache && !snapshot.metadata?.hasPendingWrites;
      dashboard.students = snapshot.docs.map(item => CoursePolicy.profile({
        uid: item.id,
        ...item.data()
      }));
      dashboard.scheduleStudentsRender();
      dashboard.correctionRequests?.render();
      if (activeView === "assign-fine") dashboard.renderFineOptions();
      if (activeView === "dashboard") dashboard.renderAdminAttendance();
      if (["dashboard", "attendance-line"].includes(activeView)) dashboard.renderAttendanceLine();
    });
    dashboard.listen('presence-sessions', ["modify-students"], collection(db, "presenceSessions"), snapshot => {
      dashboard.setPresenceSessions(snapshot);
      dashboard.scheduleStudentsRender();
    });
    dashboard.listen('legacy-presence', ["modify-students"], collection(db, "presence"), snapshot => {
      dashboard.legacyPresenceByUid = new Map(snapshot.docs.map(item => [item.id, item.data()]));
      dashboard.scheduleStudentsRender();
    });
    dashboard.attendanceSyncService = new AttendanceSyncService({
      onRecords(records) {
        dashboard.attendance = records;
        dashboard.scheduleStudentsRender();
        if (activeView === "dashboard") {
          dashboard.renderAdminAttendance();
          dashboard.renderAttendanceLine();
        }
        if (activeView === "attendance-line") dashboard.renderAttendanceLine();
        if (activeView === 'assign-fine') dashboard.renderFineOptions();
      },
      reference: collection(db, 'attendance'),
      onStatus: dashboard.updateAttendanceSyncStatus
    });
    dashboard.subscriptions.register('attendance', ['dashboard', 'modify-students', 'modify-events', 'past-events', 'profile', 'assign-fine'], () => {
      dashboard.attendanceSyncService.start();
      return () => dashboard.attendanceSyncService.stop();
    });
    dashboard.scope.addCleanup(() => {
      dashboard.eventGeofenceEditor.dispose();
      dashboard.managerGeofenceEditor.dispose();
      dashboard.attendanceRealtimeBridge.close();
      dashboard.window.clearTimeout(dashboard.adminEventStatusTimer);
      dashboard.window.cancelAnimationFrame(dashboard.studentRenderFrame);
    });
    if (dashboard.can('viewFines')) dashboard.listen('fines', ["assign-fine", "assigned-fines", "modify-students", "profile"], collection(db, "fines"), snapshot => {
      dashboard.fines = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));
      if (activeView === "assigned-fines") dashboard.renderAdminFines();
      if (activeView === "modify-students") dashboard.scheduleStudentsRender();
      if (activeView === "modify-students" && dashboard.selectedManagedStudentUid) dashboard.renderSelectedStudent();
    });
    dashboard.listen('faces', ["modify-students"], collection(db, "faceRegistrations"), snapshot => {
      dashboard.faceRegistrationsByUid = new Map(snapshot.docs.map(item => [item.id, item.data()]));
      dashboard.scheduleStudentsRender();
    });
    if (dashboard.can('adminProfile')) dashboard.listen('admin-profile', ["*"], doc(db, "adminProfiles", currentUser.uid), snapshot => {
      dashboard.renderAdminProfile(snapshot.data());
    });
    dashboard.resetStudentForm();
    dashboard.resetEventForm();
  }
  can(action) {
    const dashboard = this;
    return hasPermission(currentUserRole, action);
  }
  applyActionPermissions() {
    const dashboard = this;
    return Object.entries(dashboard.actionSelectors).forEach(([action, selector]) => {
      dashboard.document.querySelectorAll(selector).forEach(button => {
        button.hidden = !dashboard.can(action);
      });
    });
  }
  listen(key, views, reference, callback) {
    const dashboard = this;
    if (['presence-sessions', 'legacy-presence', 'faces'].includes(key) && !dashboard.can('viewStudents')) return;
    dashboard.subscriptions.register(key, views, (guard, onError) => key === 'students'
    // Readiness depends on fromCache, including server confirmation with unchanged documents.
    ? onSnapshot(reference, {
      includeMetadataChanges: true
    }, guard(callback), onError) : onSnapshot(reference, guard(callback), onError));
  }
  changeSubscriptions(event) {
    const dashboard = this;
    dashboard.subscriptions.setView(event.detail.viewName);
    if (event.detail.viewName === 'account-approvals') void dashboard.loadAccountApprovals();
    if (event.detail.viewName === 'correction-requests') void dashboard.loadCorrectionRequests().catch(() => {});
  }
  async loadCorrectionRequests() {
    if (!this.can('correctAttendance') || this.correctionRequests) return;
    const { CorrectionRequestsController } = await import('../controllers/CorrectionRequestsController.js');
    if (!this.scope.initialized || this.correctionRequests) return;
    this.correctionRequests = new CorrectionRequestsController({ root: this.document.querySelector('#adminCorrectionRequests'),
      badge: this.document.querySelector('#correctionRequestNavCount'), db, user: currentUser, role: currentUserRole,
      getEvents: () => this.events, getStudents: () => this.students, onApprove: record => this.correctionController.open(record), escapeHtml, notify: showDashboardToast });
    this.correctionRequests.initialize();
    this.scope.addCleanup(() => this.correctionRequests.dispose());
  }
  async loadAccountApprovals() {
    const dashboard = this;
    if (!dashboard.can('viewAccountApprovals') || dashboard.accountApprovalController) return;
    const { AccountApprovalController } = await import('../controllers/AccountApprovalController.js');
    if (!dashboard.scope.initialized || dashboard.accountApprovalController) return;
    dashboard.accountApprovalController = new AccountApprovalController({
      document: dashboard.document, db, user: currentUser,
      canApprove: () => dashboard.can('approveAccounts'), studentIdToEmail,
      onApprovedStudent(student) {
        if (!dashboard.students.some(existing => existing.uid === student.uid)) dashboard.students.push(student);
        dashboard.document.querySelector("#registeredCount").textContent = dashboard.students.length;
        if (activeView === "modify-students") dashboard.scheduleStudentsRender();
      },
      notify: showDashboardToast
    });
    dashboard.accountApprovalController.initialize();
    dashboard.scope.addCleanup(() => dashboard.accountApprovalController?.dispose());
  }
  onHistoryView(event) {
    const dashboard = this;
    if (event.detail.viewName === 'attendance-line') void dashboard.historyController.reload();else dashboard.historyController.suspend();
  }
  handleCorrection(event) {
    const dashboard = this;
    const button = event.target.closest('[data-correct-attendance]');
    if (!button || !dashboard.can('correctAttendance')) return;
    const record = dashboard.historyController.records.find(item => item.id === button.dataset.correctAttendance)
      || dashboard.attendance.find(item => item.id === button.dataset.correctAttendance)
      || dashboard.historyController.displayRecords().find(item => item.id === button.dataset.correctAttendance);
    if (record && (!record.displayOnly || (record.status === 'absent' && !record.rosterUnverified && !record.profileMissing))) dashboard.correctionController.open(record);
  }
  async notifyRoles(roles, notification) {
    const dashboard = this;
    const recipients = dashboard.students.filter(student => student.active !== false && roles.includes(student.role)).map(student => ({
      uid: student.uid,
      role: student.role
    }));
    if (roles.includes(currentUserRole) && !recipients.some(recipient => recipient.uid === currentUser.uid)) {
      recipients.push({
        uid: currentUser.uid,
        role: currentUserRole
      });
    }
    const results = await Promise.allSettled(recipients.map(recipient => createNotification({
      ...notification,
      recipientUid: recipient.uid,
      recipientRole: recipient.role
    })));
    const failed = results.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
  }
  updateAttendanceSyncStatus({
    state,
    syncedAt,
    error,
    history = false
  }) {
    const dashboard = this;
    if (!history) {
      dashboard.attendanceConfirmed = state === 'live';
      dashboard.attendanceVerificationState = state;
      // Records arrive before their metadata status. Redraw once that status
      // is known, even when no later document changes occur.
      if (activeView === 'dashboard') dashboard.renderAdminAttendance();
    }
    if (activeView === 'assign-fine') dashboard.renderFineOptions();
    dashboard.scheduleStudentsRender();
    const labels = {
      idle: ["Choose an event", "gray"],
      connecting: ["Connecting…", "gray"],
      syncing: ["Syncing…", "blue"],
      live: [syncedAt ? `Live · synced ${syncedAt.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
      })}` : "Live", "green"],
      offline: ["Offline · showing saved data", "orange"],
      cached: ["Cached data · connecting to server", "orange"],
      error: ["Sync unavailable · Retry", "orange"]
    };
    const [label, color] = labels[state] || labels.connecting;
    dashboard.attendanceSyncStatus.textContent = label;
    dashboard.attendanceSyncStatus.className = `badge ${color}`;
    dashboard.attendanceSyncStatus.title = error?.message || "";
  }
  setDefaultCutoff(timeInputId, cutoffInputId) {
    const dashboard = this;
    const time = dashboard.document.querySelector(timeInputId).value;
    const cutoff = dashboard.document.querySelector(cutoffInputId);
    if (!cutoff.value) cutoff.value = timePlusMinutes(time);
  }
  closeRoleChangeModal() {
    const dashboard = this;
    if (dashboard.pendingRoleChange?.selector) dashboard.pendingRoleChange.selector.value = dashboard.pendingRoleChange.previousRole;
    dashboard.pendingRoleChange = undefined;
    dashboard.roleChangeModal.hidden = true;
  }
  openRoleChangeModal(student, role, selector) {
    const dashboard = this;
    if (!dashboard.can('changeRoles')) return;
    const previousRole = student.role || "student";
    dashboard.pendingRoleChange = {
      student,
      role,
      previousRole,
      selector
    };
    dashboard.roleChangeMessage.textContent = `Change ${student.accountId}'s role from ${roleLabel(previousRole)} to ${roleLabel(role)}? They will need to sign out and sign back in before the new access takes effect.`;
    dashboard.roleChangeModal.hidden = false;
    dashboard.confirmRoleChange.focus();
  }
  scheduleStudentsRender() {
    const dashboard = this;
    if (activeView !== "modify-students") return;
    if (dashboard.studentRenderFrame) return;
    dashboard.studentRenderFrame = dashboard.window.requestAnimationFrame(() => {
      dashboard.studentRenderFrame = undefined;
      dashboard.renderStudents();
    });
  }
  scheduleAdminEventStatusRefresh() {
    const dashboard = this;
    dashboard.window.clearTimeout(dashboard.adminEventStatusTimer);
    const now = Date.now();
    const nextStatusChange = Math.min(...dashboard.events.flatMap(event => [eventOpenDate(event).getTime(), eventCheckInCloseDate(event).getTime(), eventCloseDate(event).getTime(), eventCheckoutCloseDate(event).getTime()]).filter(time => time > now));
    if (!Number.isFinite(nextStatusChange)) return;
    dashboard.adminEventStatusTimer = dashboard.window.setTimeout(() => {
      if (["dashboard", "modify-events"].includes(activeView)) dashboard.renderAdminEvents();
      if (activeView === "past-events") dashboard.renderPastEvents();
      if (['dashboard', 'attendance-line'].includes(activeView)) dashboard.renderAttendanceLine();
      dashboard.scheduleStudentsRender();
      if (activeView === 'assign-fine') dashboard.renderFineOptions();
      dashboard.scheduleAdminEventStatusRefresh();
    }, Math.max(0, nextStatusChange - now) + 50);
  }
  makeGeofenceEditor(prefix) {
    const dashboard = this;
    return new GeofenceController(prefix, {
      showToast: showDashboardToast
    });
  }
  renderGeofenceEventOptions(selectedId = this.geofenceEventSelect.value) {
    const dashboard = this;
    dashboard.geofenceEventSelect.innerHTML = `<option value="">Select an event</option>${dashboard.events.map(event => `<option value="${escapeHtml(event.id)}">${escapeHtml(event.name)} · ${escapeHtml(event.date || "No date")}</option>`).join("")}`;
    dashboard.geofenceEventSelect.value = dashboard.events.some(event => event.id === selectedId) ? selectedId : "";
  }
  loadGeofenceManager(eventId = this.geofenceEventSelect.value) {
    const dashboard = this;
    const selectedEvent = dashboard.events.find(event => event.id === eventId);
    dashboard.geofenceManagerContent.hidden = !selectedEvent;
    dashboard.geofenceManagerEmpty.hidden = Boolean(selectedEvent);
    if (!selectedEvent) return;
    dashboard.geofenceEventSelect.value = selectedEvent.id;
    dashboard.document.querySelector("#geofenceManagerEventName").textContent = selectedEvent.name;
    dashboard.document.querySelector("#geofenceManagerEventDetails").textContent = `${selectedEvent.date || "No date"} · ${selectedEvent.location || "Location not set"}`;
    dashboard.managerGeofenceEditor.set(selectedEvent.geofence || {});
    dashboard.window.setTimeout(() => dashboard.managerGeofenceEditor.invalidate(), 0);
  }
  async prepareAdminProfilePhoto(file) {
    const dashboard = this;
    if (!file.type.match(/^image\/(jpeg|png|webp)$/)) throw new Error("Choose a JPG, PNG, or WebP image.");
    if (file.size > 8 * 1024 * 1024) throw new Error("Choose an image smaller than 8 MB.");
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read this image."));
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = source;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = dashboard.document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 320, 320);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 320, 320);
    const compressed = canvas.toDataURL("image/jpeg", .82);
    if (compressed.length > 350000) throw new Error("The processed image is still too large. Try another photo.");
    return compressed;
  }
  updateAdminPhotoPreview(photoDataUrl = "") {
    const dashboard = this;
    const image = dashboard.document.querySelector("#adminProfilePhotoPreviewImage");
    const initials = dashboard.document.querySelector("#adminProfilePhotoPreviewInitials");
    if (photoDataUrl) {
      image.src = photoDataUrl;
      image.hidden = false;
      initials.hidden = true;
      return;
    }
    image.removeAttribute("src");
    image.hidden = true;
    initials.hidden = false;
    initials.textContent = (dashboard.document.querySelector("#adminDisplayName").value || "School Admin").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase() || "AD";
  }
  renderAdminProfile(profile = {}) {
    const dashboard = this;
    const displayName = profile.displayName || "School Admin";
    const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase() || "AD";
    dashboard.document.querySelector("#adminDisplayName").value = displayName;
    dashboard.document.querySelector("#adminProfileBirthday").value = profile.birthday || "";
    dashboard.document.querySelector("#adminProfilePhone").value = profile.phone || "";
    dashboard.document.querySelectorAll("[data-admin-name]").forEach(element => {
      element.textContent = displayName;
    });
    dashboard.document.querySelectorAll("[data-admin-initials]").forEach(element => {
      element.textContent = initials;
      element.hidden = Boolean(profile.photoDataUrl);
    });
    dashboard.document.querySelectorAll("[data-admin-photo]").forEach(element => {
      if (profile.photoDataUrl) element.src = profile.photoDataUrl;else element.removeAttribute("src");
      element.hidden = !profile.photoDataUrl;
    });
    dashboard.pendingAdminProfilePhoto = profile.photoDataUrl || "";
    dashboard.updateAdminPhotoPreview(dashboard.pendingAdminProfilePhoto);
    updateDashboardGreeting(displayName);
  }
  updateDataCleanupState() {
    const dashboard = this;
    const selected = dashboard.clearEventData.checked || dashboard.clearFineData.checked;
    dashboard.confirmDataCleanup.disabled = !selected || dashboard.dataCleanupConfirm.value.trim() !== "RESET DATA";
  }
  renderDataCleanupCounts() {
    const dashboard = this;
    dashboard.document.querySelector("#dataCleanupCounts").innerHTML = `<div><strong>${dashboard.events.length}</strong><span>Events</span></div><div><strong>${dashboard.attendance.length}</strong><span>Attendance records</span></div><div><strong>${dashboard.fines.length}</strong><span>Assigned fines</span></div>`;
  }
  closeDataCleanupModal() {
    const dashboard = this;
    dashboard.dataCleanupModal.hidden = true;
    dashboard.clearEventData.checked = false;
    dashboard.clearFineData.checked = false;
    dashboard.dataCleanupConfirm.value = "";
    dashboard.updateDataCleanupState();
  }
  renderAdminAttendance() {
    const dashboard = this;
    const localDate = DailyAttendanceClock.dateKey();
    const totals = dashboard.summaryService.today(dashboard.students, dashboard.events, dashboard.attendance, localDate);
    const {
      present,
      expected,
      unverified
    } = totals;
    const pending = dashboard.attendanceConfirmed ? totals.pending : 0,
      rate = dashboard.attendanceConfirmed ? totals.rate : 0;
    dashboard.document.querySelector("#registeredCount").textContent = dashboard.students.length;
    dashboard.document.querySelector("#presentTodayCount").textContent = present;
    const verificationFailed = dashboard.attendanceVerificationState === 'error';
    dashboard.document.querySelector("#presentTodayMeta").textContent = !dashboard.attendanceConfirmed ? verificationFailed ? 'Unable to verify attendance — Retry' : 'Verifying attendance…' : expected ? `${rate}% of ${expected} scheduled participants` : 'No verified participant roster for today';
    dashboard.document.querySelector("#notCheckedInCount").textContent = dashboard.attendanceConfirmed ? pending : '—';
    dashboard.document.querySelector("#notCheckedInMeta").textContent = dashboard.attendanceConfirmed ? `${expected ? 'Scheduled participants without a check-in' : 'No verified attendance requirement today'}${unverified ? ` · ${unverified} legacy eligibility unverified` : ''}` : verificationFailed ? 'Unable to verify attendance — Retry' : 'Waiting for server attendance verification';
    dashboard.document.querySelector('#retryDashboardAttendance').hidden = !verificationFailed;
    dashboard.document.querySelector("#adminAttendancePercent").textContent = dashboard.attendanceConfirmed ? `${rate}%` : '—';
    dashboard.document.querySelector("#adminAttendanceDetail").textContent = `${present} present`;
    dashboard.document.querySelector("#adminAttendanceRing").style.background = `conic-gradient(var(--blue) 0 ${rate}%, var(--ring-track, #e8eef7) ${rate}% 100%)`;
  }
  attendanceLineMarkup(records) {
    const dashboard = this;
    if (!records.length) return '<div class="empty-state">No attendance activity yet.</div>';
    return records.map(record => {
      const student = dashboard.students.find(item => item.uid === record.studentUid);
      const studentName = student ? [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") : record.studentId || "Student";
      const avatar = student?.photoDataUrl ? `<img src="${escapeHtml(student.photoDataUrl)}" alt="">` : escapeHtml(getInitials(student?.firstName || studentName, student?.lastName || ""));
      if (!student) {
        const section = dashboard.events.find(event => event.id === record.eventId)?.attendanceRoster?.[record.studentUid] ?? record.rosterSection ?? record.section;
        return `<article class="attendance-line-item"><div class="attendance-line-person"><span class="mini-avatar">${avatar}</span><div><strong>Deleted/missing student profile</strong><small>${escapeHtml(record.studentId || 'Student ID unavailable')}${section ? ` · ${escapeHtml(section)}` : ''}</small></div></div><div class="attendance-line-event"><strong>${escapeHtml(record.eventName || 'Attendance event')}</strong><small>${escapeHtml(record.eventDate || 'Date unavailable')}</small></div><div class="attendance-line-times"><div><span>IN</span><strong>${escapeHtml(formatAttendanceTimestamp(record.checkedInAt || record.attendedAt))}</strong>${AttendanceRelativeTime.render(record.checkedInAt || record.attendedAt, "in")}</div><div><span>OUT</span><strong>${escapeHtml(formatAttendanceTimestamp(record.checkedOutAt))}</strong>${AttendanceRelativeTime.render(record.checkedOutAt, "out")}</div></div><div class="attendance-line-status"><span class="badge orange">Needs review — profile missing</span></div></article>`;
      }
      if (record.rosterUnverified) return `<article class="attendance-line-item"><div class="attendance-line-person"><span class="mini-avatar">${avatar}</span><div><strong>${escapeHtml(studentName)}</strong><small>${escapeHtml(student?.accountId || '')} · ${escapeHtml(record.rosterSection || student?.section || '')}</small></div></div><div class="attendance-line-event"><strong>${escapeHtml(record.eventName)}</strong><small>${escapeHtml(record.eventDate)}</small></div><div class="attendance-line-times"><p class="attendance-no-record">No attendance recorded</p></div><div class="attendance-line-status"><span class="badge orange">${record.assignmentUnverified ? 'Needs review — assigned after attendance opened' : 'Needs review — registration date unknown'}</span></div></article>`;
      const checkedInAt = record.checkedInAt || record.attendedAt;
      const completed = Boolean(record.checkedOutAt);
      const absent = record.status === 'absent';
      const partial = record.status === 'checkout-only' || (!checkedInAt && completed);
      const inLabel = absent || partial ? 'ABSENT IN' : record.arrivalStatus === 'late' ? 'LATE IN' : 'IN';
      const completionLabel = record.pending ? 'Not yet checked in' : absent ? 'Absent — no attendance' : partial ? 'Partial attendance' : completed ? 'Completed' : dashboard.summaryService.needsReview(record, dashboard.events.find(event => event.id === record.eventId)) ? 'Needs review — missed checkout' : 'Checked in';
      return `<article class="attendance-line-item"><div class="attendance-line-person"><span class="mini-avatar">${avatar}</span><div><strong>${escapeHtml(studentName)}</strong><small>${escapeHtml(student?.accountId || record.studentId || "Student ID unavailable")}${student?.section ? ` · ${escapeHtml(student.section)}` : ""}</small></div></div><div class="attendance-line-event"><strong>${escapeHtml(record.eventName || "Attendance event")}</strong><small>${escapeHtml(record.eventDate || "Date unavailable")}</small></div><div class="attendance-line-times"><div class="${record.arrivalStatus === 'late' ? 'attendance-time-late' : ''}"><span>${inLabel}</span><strong>${escapeHtml(absent || partial ? 'Not recorded' : formatAttendanceTimestamp(checkedInAt))}</strong>${!absent && !partial ? AttendanceRelativeTime.render(checkedInAt, 'in') : ''}</div><div><span>OUT</span><strong>${escapeHtml(absent ? 'Not recorded' : formatAttendanceTimestamp(record.checkedOutAt))}</strong>${!absent ? AttendanceRelativeTime.render(record.checkedOutAt, 'out') : ''}</div><div><span>Duration</span><strong>${escapeHtml(checkedInAt ? attendanceDuration(checkedInAt, record.checkedOutAt) : 'Not available')}</strong></div></div><div class="attendance-line-status">${record.recordSource === "admin-corrected" ? `<span class="badge orange" title="${escapeHtml(`${record.correctedBy || "Administrator"} · ${formatAttendanceTimestamp(record.correctedAt)} · ${record.correctionReason || ""}`)}">Manual correction</span>` : ""}${(!record.displayOnly || (absent && student.active !== false)) && dashboard.can("correctAttendance") ? `<button class="small-button" type="button" data-correct-attendance="${escapeHtml(record.id)}">Correct</button>` : ""}${absent || partial ? '<span class="badge orange">Absent in</span>' : record.pending ? '' : arrivalStatusBadge(record.arrivalStatus)}<span class="badge ${absent || partial || dashboard.summaryService.needsReview(record, dashboard.events.find(event => event.id === record.eventId)) ? "orange" : completed ? "green" : "blue"}">${completionLabel}</span></div>${record.recordSource === "admin-corrected" ? `<p class="attendance-correction-reason"><span>Correction reason:</span> ${escapeHtml(record.correctionReason || "Reason not recorded")}</p>` : ""}</article>`;
    }).join("");
  }
  renderAttendanceLine() {
    const dashboard = this;
    dashboard.attendanceReport?.refreshContext();
    const filter = dashboard.document.querySelector("#adminAttendanceEventFilter");
    const selectedEvent = filter.value || "";
    const eventOptions = AttendanceViews.groups(dashboard.events).map(group => group[0]).map(event => `<option value="${escapeHtml(event.id)}">${escapeHtml(AttendanceViews.title(event))}${event.date ? ` · ${escapeHtml(event.date)}` : ""}</option>`).join("");
    filter.innerHTML = `<option value="">Choose an event…</option>${eventOptions}`;
    const previous = dashboard.events.find(event => event.id === selectedEvent);
    filter.value = previous ? AttendanceViews.related(previous,dashboard.events)[0].id : "";
    dashboard.historyController?.syncSessionControl();
    const records = dashboard.attendance.filter(record => record.eventDate === DailyAttendanceClock.dateKey()).sort((first, second) => (second.checkedInAt?.seconds || second.attendedAt?.seconds || 0) - (first.checkedInAt?.seconds || first.attendedAt?.seconds || 0));
    if (activeView === 'attendance-line') dashboard.historyController.draw();
    dashboard.document.querySelector("#adminDashboardAttendanceLine").innerHTML = dashboard.attendanceLineMarkup(records.slice(0, 5));
  }
  renderAdminEvents() {
    const dashboard = this;
    dashboard.document.querySelector("#eventCount").textContent = dashboard.events.length;
    const timeline = dashboard.document.querySelector("#adminEventTimeline");
    if (!dashboard.events.length) {
      timeline.innerHTML = '<div class="empty-state">No events have been created yet.</div>';
      dashboard.eventTableBody.innerHTML = '<div class="empty-state panel">No events have been created yet.</div>';
      return;
    }
    timeline.innerHTML = dashboard.events.slice(0, 5).map(event => `<button type="button" class="timeline-item timeline-event-button" data-edit-event="${escapeHtml(event.id)}" aria-label="Edit ${escapeHtml(event.name)}" ${dashboard.can("manageEvents") ? "" : "disabled"}><span class="timeline-time">${escapeHtml(formatEventTime(event.timeIn))}</span><span class="timeline-main"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(formatEventDate(event.date))} · ${escapeHtml(formatTimeWindow(event))}</small></span>${eventStatusBadge(getEventStatus(event))}</button>`).join("");
    const currentEvents = AttendanceViews.groups(dashboard.events).filter(group => !AttendanceViews.state(group).closed).map(group => group[0]);
    dashboard.eventTableBody.innerHTML = currentEvents.length ? currentEvents.map(event => dashboard.eventCardMarkup(event, false)).join("") : '<div class="empty-state panel">No current or upcoming events. Open Past Events to manage completed events.</div>';
  }
  eventCardMarkup(event, past) {
    const dashboard = this;
    const sessions = AttendanceViews.related(event, dashboard.events);
    const state = AttendanceViews.state(sessions);
    const actions = sessions.map(session => `<div class="admin-session-actions">${sessions.length > 1 ? `<strong class="admin-session-action-label">${AttendanceViews.label(session)}</strong>` : ''}<div class="admin-event-card-actions">${dashboard.can('manageSurveys') ? `<button class="outline-button" type="button" data-survey-event="${escapeHtml(session.id)}">Survey / QR</button>` : ''}${isEventFinished(session) ? '' : `<button class="outline-button" type="button" data-manage-geofence="${escapeHtml(session.id)}">Attendance area</button>`}<button class="outline-button" type="button" data-edit-event="${escapeHtml(session.id)}">Edit event</button>${dashboard.can('deleteEvents') ? `<button class="small-button danger modal-danger-button" type="button" data-delete-event="${escapeHtml(session.id)}">Remove</button>` : ''}</div></div>`).join('');
    return `<article class="event-card admin-event-card admin-event-card-student-style"><div class="event-accent"></div><div class="event-body"><div class="event-card-kicker"><span class="event-type-badge">${escapeHtml(event.type || "School Event")}</span><span class="event-date">${escapeHtml(formatEventDate(event.date))}</span></div><h3>${escapeHtml(AttendanceViews.title(event))}</h3><div class="event-description"><strong>Description</strong>${escapeHtml(event.description || event.notes || "No description provided.")}</div>${dashboard.schedulePresenter.render(event, dashboard.events)}<div class="admin-event-group-status">${eventStatusBadge(getEventStatus(state.selected || event))}</div><div class="admin-event-session-tools">${actions}</div></div></article>`;
  }
  renderPastEvents() {
    const dashboard = this;
    const pastEvents = AttendanceViews.groups(dashboard.events).filter(group => AttendanceViews.state(group).closed).map(group => group[0]).sort((first, second) => eventCloseDate(second) - eventCloseDate(first));
    dashboard.pastEventList.innerHTML = pastEvents.length ? pastEvents.map(event => dashboard.eventCardMarkup(event, true)).join("") : '<div class="empty-state panel">No past events yet.</div>';
  }
  renderFineOptions() {
    const dashboard = this;
    const selectedStudent = dashboard.fineStudent.value;
    const selectedEvent = dashboard.fineEvent.value;
    const search = dashboard.fineStudentSearch.value.trim().toLowerCase();
    const matchingStudents = dashboard.students.filter(student => {
      const searchable = [student.firstName, student.middleName, student.lastName, student.accountId].filter(Boolean).join(" ").toLowerCase();
      return !search || searchable.includes(search) || student.uid === selectedStudent;
    });
    if (search) {
      dashboard.fineStudentSearchResults.hidden = false;
      dashboard.fineStudentSearchResults.innerHTML = matchingStudents.length ? matchingStudents.map(student => {
        const fullName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
        return `<button class="fine-student-search-result" type="button" role="option" data-select-fine-student="${escapeHtml(student.uid)}"><strong>${escapeHtml(fullName)}</strong><small>Student ID · ${escapeHtml(student.accountId)}</small></button>`;
      }).join("") : '<p class="fine-student-search-empty">No student matches that name or Student ID.</p>';
    } else {
      dashboard.fineStudentSearchResults.hidden = true;
      dashboard.fineStudentSearchResults.innerHTML = "";
    }
    const emptyOption = matchingStudents.length ? "" : '<option value="" disabled selected>No students found</option>';
    dashboard.fineStudent.innerHTML = `<option value="" disabled ${selectedStudent ? "" : "selected"}>Select a student</option>${emptyOption}${matchingStudents.map(student => `<option value="${escapeHtml(student.uid)}">${escapeHtml([student.lastName, student.firstName, student.middleName].filter(Boolean).join(", "))} · ${escapeHtml(student.accountId)}</option>`).join("")}`;
    const student = dashboard.students.find(item => item.uid === selectedStudent);
    const candidates = dashboard.fineEligibility.candidates(student, dashboard.events, dashboard.attendance, {
      coverageFrom: dashboard.attendanceCoverageFrom, coverageConfirmed: dashboard.attendanceConfirmed
    });
    const editingFine = dashboard.fines.find(fine => fine.id === dashboard.document.querySelector('#editingFineId').value);
    // Retain a historical assignment while editing its reason/status, not for new fines.
    const retained = editingFine?.studentUid === selectedStudent && editingFine.eventId === selectedEvent
      && !candidates.some(item => item.id === selectedEvent) ? [{ id: selectedEvent, name: editingFine.eventName || 'Previously assigned event', date: editingFine.eventDate }] : [];
    const options = student ? [...candidates, ...retained] : [];
    const eventPrompt = !student ? 'Select a student first' : options.length ? 'Select a missed event'
      : !dashboard.attendanceConfirmed ? 'Waiting for attendance verification' : 'No confirmed missed events';
    dashboard.fineEvent.innerHTML = `<option value="" disabled selected>${eventPrompt}</option>${options.map(event => `<option value="${escapeHtml(event.id)}">${escapeHtml(event.name)}${event.date ? ` · ${escapeHtml(event.date)}` : ""}</option>`).join("")}`;
    dashboard.fineStudent.value = selectedStudent;
    dashboard.fineEvent.value = options.some(item => item.id === selectedEvent) ? selectedEvent : '';
  }
  renderAdminFines() {
    const dashboard = this;
    const search = dashboard.fineSearch.value.trim().toLowerCase();
    const statusFilter = dashboard.fineStatusFilter.value;
    const dateFilter = dashboard.fineDateFilter.value;
    const sort = dashboard.fineSort.value;
    const filteredFines = dashboard.fines.filter(fine => statusFilter === "all" || (fine.status || "Pending") === statusFilter).filter(fine => !search || [fine.studentName, fine.studentId, fine.eventName, fine.reason, fine.status, ...getFineHistory(fine).flatMap(entry => [entry.action, entry.reason, entry.recordedAt, entry.previousMinutes, entry.newMinutes])].join(" ").toLowerCase().includes(search)).filter(fine => !dateFilter || [fine.eventDate, fine.assignedAt?.toDate?.().toISOString().slice(0, 10), ...getFineHistory(fine).map(entry => String(entry.recordedAt || "").slice(0, 10))].includes(dateFilter)).sort((first, second) => {
      if (sort === "oldest") return (first.assignedAt?.seconds || 0) - (second.assignedAt?.seconds || 0);
      if (sort === "student") return String(first.studentName || "").localeCompare(String(second.studentName || ""));
      if (sort === "duration") return Number(second.serviceMinutes || 0) - Number(first.serviceMinutes || 0);
      return (second.assignedAt?.seconds || 0) - (first.assignedAt?.seconds || 0);
    });
    dashboard.document.querySelector("#fineResultCount").textContent = `${filteredFines.length} fine${filteredFines.length === 1 ? "" : "s"} shown`;
    if (!filteredFines.length) {
      dashboard.adminFineList.innerHTML = `<div class="empty-state">${dashboard.fines.length ? "No fines match the current search or filter." : "No fines have been assigned."}</div>`;
      return;
    }
    dashboard.adminFineList.innerHTML = filteredFines.map(fine => {
      const sameReasonCount = dashboard.fines.filter(item => item.studentUid === fine.studentUid && String(item.eventName || "Attendance absence").trim().toLowerCase() === String(fine.eventName || "Attendance absence").trim().toLowerCase()).length;
      const actions = `<div class="history-card-actions"><button class="outline-button" type="button" data-edit-fine="${escapeHtml(fine.id)}">Modify</button><button class="small-button danger" type="button" data-delete-fine="${escapeHtml(fine.id)}">Remove</button></div>`;
      const detailArea = sameReasonCount > 1 ? fineDetailsMarkup(fine, dashboard.can('manageFines')) : dashboard.can('manageFines') ? actions : '';
      return `<article class="fine-record-card"><div class="history-card-top"><span class="event-type-badge">${escapeHtml(fine.studentId || "Student")}</span><span class="badge orange">${escapeHtml(formatServiceMinutes(fine.serviceMinutes))}</span></div><h3>${escapeHtml(fine.studentName || "Student")}</h3><div class="fine-record-event"><span>Missed attendance</span><strong>${escapeHtml(fine.eventName || "Attendance absence")}</strong></div><p>${escapeHtml(fine.reason || "No reason provided.")}</p><div class="fine-record-meta"><div><span>Status</span><strong class="${fine.status === "Completed" ? "is-completed" : ""}">${escapeHtml(fine.status || "Pending")}</strong></div><div><span>Assigned</span><strong>${escapeHtml(formatFineDate(fine.assignedAt))}</strong></div></div>${detailArea}</article>`;
    }).join("");
    dashboard.applyActionPermissions();
  }
  resetFineForm() {
    const dashboard = this;
    dashboard.fineForm.reset();
    dashboard.document.querySelector("#fineServiceHours").value = "0";
    dashboard.document.querySelector("#fineServiceMinutes").value = "30";
    dashboard.fineStudentSearch.value = "";
    dashboard.renderFineOptions();
    dashboard.document.querySelector("#editingFineId").value = "";
    dashboard.document.querySelector("#fineFormTitle").textContent = "Assign a fine";
    dashboard.document.querySelector("#fineSubmitButton").textContent = "Assign fine";
    dashboard.addCommunityService.hidden = true;
    dashboard.fineExtensionControls.hidden = true;
    dashboard.fineExtensionHours.value = "0";
    dashboard.fineExtensionMinutes.value = "30";
    dashboard.fineExtensionReason.value = "";
    dashboard.fineServiceDurationHelp.textContent = "";
    dashboard.addingCommunityService = false;
    dashboard.fineForm.classList.remove("is-extending-service");
    dashboard.addCommunityService.textContent = "Extend community service";
  }
  editFine(fine) {
    const dashboard = this;
    if (!dashboard.can('manageFines')) return;
    if (!fine) return;
    openView("assign-fine");
    dashboard.document.querySelector("#editingFineId").value = fine.id;
    dashboard.fineStudent.value = fine.studentUid || "";
    if (fine.eventId && !dashboard.events.some(event => event.id === fine.eventId)) dashboard.fineEvent.add(new Option(fine.eventName || "Previously selected event", fine.eventId));
    dashboard.fineEvent.value = fine.eventId || "";
    const serviceMinutes = Math.min(600, Math.max(1, Number(fine.serviceMinutes) || 30));
    dashboard.document.querySelector("#fineServiceHours").value = String(Math.floor(serviceMinutes / 60));
    dashboard.document.querySelector("#fineServiceMinutes").value = String(serviceMinutes % 60);
    dashboard.document.querySelector("#fineStatus").value = fine.status || "Pending";
    dashboard.document.querySelector("#fineReason").value = fine.reason || "";
    dashboard.document.querySelector("#fineFormTitle").textContent = `Modify fine for ${fine.studentId || "student"}`;
    dashboard.document.querySelector("#fineSubmitButton").textContent = "Save fine changes";
    dashboard.addCommunityService.hidden = false;
    dashboard.fineExtensionControls.hidden = true;
    dashboard.fineServiceDurationHelp.textContent = "Edit the total requirement, or add extra service time below.";
    dashboard.addingCommunityService = false;
    dashboard.fineForm.classList.remove("is-extending-service");
    dashboard.addCommunityService.textContent = "Extend community service";
    dashboard.fineForm.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
  setFineServiceDuration(totalMinutes) {
    const dashboard = this;
    const normalizedMinutes = Math.min(600, Math.max(1, totalMinutes));
    dashboard.document.querySelector("#fineServiceHours").value = String(Math.floor(normalizedMinutes / 60));
    dashboard.document.querySelector("#fineServiceMinutes").value = String(normalizedMinutes % 60);
  }
  setFineExtensionDuration(totalMinutes) {
    const dashboard = this;
    const normalizedMinutes = Math.min(600, Math.max(1, totalMinutes));
    dashboard.fineExtensionHours.value = String(Math.floor(normalizedMinutes / 60));
    dashboard.fineExtensionMinutes.value = String(normalizedMinutes % 60);
  }
  setCommunityServiceExtension(open) {
    const dashboard = this;
    dashboard.addingCommunityService = open;
    dashboard.fineExtensionControls.hidden = !open;
    dashboard.fineForm.classList.toggle("is-extending-service", open);
    dashboard.addCommunityService.textContent = open ? "Cancel extension" : "Extend community service";
    if (open) {
      dashboard.setFineExtensionDuration(30);
      dashboard.fineExtensionReason.value = "";
    }
  }
  getStudentPresence(uid) {
    const dashboard = this;
    const sessions = [...(dashboard.presenceByUid.get(uid) || [])];
    const legacyPresence = dashboard.legacyPresenceByUid.get(uid);
    if (legacyPresence) sessions.push(legacyPresence);
    const activeSessions = sessions.filter(session => session.online === true && Date.now() - (session.lastSeen?.toMillis?.() || 0) < 135000);
    const latestSession = sessions.reduce((latest, session) => {
      const sessionTime = session.offlineAt?.toMillis?.() || session.lastSeen?.toMillis?.() || 0;
      const latestTime = latest?.offlineAt?.toMillis?.() || latest?.lastSeen?.toMillis?.() || 0;
      return sessionTime > latestTime ? session : latest;
    }, undefined);
    const isOnline = activeSessions.length > 0;
    const inactiveTimestamp = latestSession?.offlineAt?.toDate?.() || latestSession?.lastSeen?.toDate?.();
    const inactiveText = inactiveTimestamp ? `Last active ${new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(inactiveTimestamp)}` : "No activity recorded";
    const deviceText = activeSessions.length > 1 ? `Active on ${activeSessions.length} devices` : "Active now";
    const isLoggedOut = !isOnline && latestSession?.status === "logged-out";
    return {
      isOnline,
      status: isOnline ? "online" : isLoggedOut ? "logged-out" : "offline",
      label: isOnline ? "Online" : isLoggedOut ? "Logged out" : "Offline",
      detail: isOnline ? deviceText : inactiveText
    };
  }
  setPresenceSessions(snapshot) {
    const dashboard = this;
    const nextPresence = new Map();
    snapshot.docs.forEach(item => {
      const session = item.data();
      if (!session.studentUid) return;
      const sessions = nextPresence.get(session.studentUid) || [];
      sessions.push(session);
      nextPresence.set(session.studentUid, sessions);
    });
    dashboard.presenceByUid = nextPresence;
  }
  renderStudents() {
    const dashboard = this;
    if (activeView !== "modify-students") return;
    const search = dashboard.studentSearch.value.trim().toLowerCase();
    const updateFilterOptions = (select, label, values) => {
      const currentValue = select.value;
      select.innerHTML = `<option value="all">All ${label}</option>${values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
      select.value = values.includes(currentValue) ? currentValue : "all";
    };
    const courses = [...new Set(dashboard.students.map(student => student.course).filter(Boolean))].sort();
    const sections = [...new Set(dashboard.students.map(student => student.section).filter(Boolean))].sort();
    const filterSignature = `${courses.join("\u0001")}\u0002${sections.join("\u0001")}`;
    if (filterSignature !== dashboard.studentFilterSignature) {
      dashboard.studentFilterSignature = filterSignature;
      updateFilterOptions(dashboard.studentCourseFilter, "courses", courses);
      dashboard.studentSectionPicker.setOptions(sections);
    }
    const localDate = DailyAttendanceClock.dateKey();
    const presentToday = new Set(dashboard.attendance.filter(record => record.eventDate === localDate).map(record => record.studentUid));
    const pendingService = new Set(dashboard.fines.filter(fine => fine.status !== "Completed").map(fine => fine.studentUid));
    const activityTime = uid => {
      const sessions = [...(dashboard.presenceByUid.get(uid) || [])];
      const legacy = dashboard.legacyPresenceByUid.get(uid);
      if (legacy) sessions.push(legacy);
      return Math.max(0, ...sessions.map(session => session.offlineAt?.toMillis?.() || session.lastSeen?.toMillis?.() || 0));
    };
    const filtered = dashboard.students.filter(student => {
      const hasFaceRegistration = dashboard.faceRegistrationsByUid.get(student.uid)?.registered === true;
      const matchesSearch = !search || [student.firstName, student.middleName, student.lastName, student.accountId, student.email, student.course, student.section].join(" ").toLowerCase().includes(search);
      const matchesCourse = dashboard.studentCourseFilter.value === "all" || student.course === dashboard.studentCourseFilter.value;
      const matchesSection = dashboard.studentSectionPicker.matches(student.section);
      const matchesFace = dashboard.studentFaceFilter.value === "all" || (dashboard.studentFaceFilter.value === "registered" ? hasFaceRegistration : !hasFaceRegistration);
      const matchesAccount = dashboard.studentAccountFilter.value === "all" || (dashboard.studentAccountFilter.value === "active" ? student.active !== false : student.active === false);
      const matchesAttendance = dashboard.studentAttendanceFilter.value === "all" || (dashboard.studentAttendanceFilter.value === "present" ? presentToday.has(student.uid) : !presentToday.has(student.uid));
      const matchesFine = dashboard.studentFineFilter.value === "all" || (dashboard.studentFineFilter.value === "pending" ? pendingService.has(student.uid) : !pendingService.has(student.uid));
      return matchesSearch && matchesCourse && matchesSection && matchesFace && matchesAccount && matchesAttendance && matchesFine;
    }).sort((first, second) => {
      if (dashboard.studentSort.value === "id") return String(first.accountId || "").localeCompare(String(second.accountId || ""), undefined, {
        numeric: true
      });
      if (dashboard.studentSort.value === "newest") return (second.createdAt?.toMillis?.() || 0) - (first.createdAt?.toMillis?.() || 0);
      if (dashboard.studentSort.value === "activity") return activityTime(second.uid) - activityTime(first.uid);
      return [first.lastName, first.firstName, first.middleName].filter(Boolean).join(" ").localeCompare([second.lastName, second.firstName, second.middleName].filter(Boolean).join(" "));
    });
    dashboard.document.querySelector("#registeredCount").textContent = dashboard.students.length;
    const totalPages = Math.max(1, Math.ceil(filtered.length / dashboard.studentPageSize));
    dashboard.studentPage = Math.min(dashboard.studentPage, totalPages);
    const firstResult = filtered.length ? (dashboard.studentPage - 1) * dashboard.studentPageSize + 1 : 0;
    const visibleStudents = filtered.slice(firstResult - 1, firstResult - 1 + dashboard.studentPageSize);
    dashboard.document.querySelector("#studentResultCount").textContent = `${filtered.length} matching student${filtered.length === 1 ? "" : "s"}`;
    dashboard.studentPagination.hidden = filtered.length <= dashboard.studentPageSize;
    dashboard.studentPageInfo.textContent = filtered.length ? `Showing ${firstResult}–${firstResult + visibleStudents.length - 1} of ${filtered.length}` : "No matching students";
    dashboard.previousStudentPage.disabled = dashboard.studentPage <= 1;
    dashboard.nextStudentPage.disabled = dashboard.studentPage >= totalPages;
    if (!filtered.length) {
      const emptyMessage = dashboard.students.length ? "No students match the selected filters." : "No students have been registered yet.";
      dashboard.studentTableBody.innerHTML = `<tr><td colspan="6"><div class="empty-state">${emptyMessage}</div></td></tr>`;
      dashboard.studentMobileCards.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
      dashboard.renderSelectedStudent();
      dashboard.renderAdminAttendance();
      return;
    }
    const studentTableMarkup = visibleStudents.map(student => {
      const avatar = student.photoDataUrl ? `<img src="${escapeHtml(student.photoDataUrl)}" alt="">` : escapeHtml(getInitials(student.firstName, student.lastName));
      const presence = dashboard.getStudentPresence(student.uid);
      const hasFaceRegistration = dashboard.faceRegistrationsByUid.get(student.uid)?.registered === true;
      const role = student.role === "viewer" ? "student" : student.role || "student";
      const roleControl = dashboard.can('changeRoles') ? `<select class="role-select" data-role-select="${escapeHtml(student.uid)}" aria-label="Role for ${escapeHtml(student.accountId)}">${Object.entries(ASSIGNABLE_ROLE_LABELS).map(([value, label]) => `<option value="${value}"${value === role ? " selected" : ""}>${label}</option>`).join("")}</select>` : `<span class="badge blue">${escapeHtml(roleLabel(role))}</span>`;
      return `<tr><td><div class="student-cell"><span class="mini-avatar">${avatar}</span><div><strong>${escapeHtml([student.lastName, student.firstName, student.middleName].filter(Boolean).join(", "))}</strong><small>${escapeHtml(student.accountId)}</small></div></div></td><td><strong>${escapeHtml(student.course || "Not assigned")}</strong><br><small>Section ${escapeHtml(student.section)}</small></td><td><span class="badge ${hasFaceRegistration ? "green" : "gray"}">${hasFaceRegistration ? "Registered" : "Not registered"}</span><small class="presence-time presence-status is-${presence.status}"><i class="presence-dot"></i>${escapeHtml(presence.label)}</small></td><td>${escapeHtml(student.email || "Not provided")}</td><td>${roleControl}</td><td><div class="table-actions">${dashboard.studentActions.render({
        uid: student.uid,
        hasFaceRegistration
      })}</div></td></tr>`;
    }).join("");
    const studentMobileMarkup = visibleStudents.map(student => {
      const fullName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
      const avatar = student.photoDataUrl ? `<img src="${escapeHtml(student.photoDataUrl)}" alt="">` : escapeHtml(getInitials(student.firstName, student.lastName));
      const presence = dashboard.getStudentPresence(student.uid);
      const hasFaceRegistration = dashboard.faceRegistrationsByUid.get(student.uid)?.registered === true;
      return `<article class="student-mobile-card"><div class="student-mobile-card-head"><span class="mini-avatar">${avatar}</span><div><h3>${escapeHtml(fullName)}</h3><p>${escapeHtml(student.accountId)}</p></div><span class="badge ${hasFaceRegistration ? "green" : "gray"}">${hasFaceRegistration ? "Registered" : "Not registered"}</span></div><div class="student-mobile-card-details"><div><span>Course / Section</span><strong>${escapeHtml(student.course || "Not assigned")} · ${escapeHtml(student.section || "Not assigned")}</strong></div><div><span>Live status</span><strong class="presence-status is-${presence.status}"><i class="presence-dot"></i>${escapeHtml(presence.label)}</strong></div><div class="student-mobile-card-email"><span>Email</span><strong>${escapeHtml(student.email || "Not provided")}</strong></div></div><button class="outline-button" type="button" data-view-student="${escapeHtml(student.uid)}">View profile</button></article>`;
    }).join("");
    if (dashboard.studentDirectoryMediaQuery.matches) {
      dashboard.studentTableBody.innerHTML = "";
      dashboard.studentMobileCards.innerHTML = studentMobileMarkup;
    } else {
      dashboard.studentTableBody.innerHTML = studentTableMarkup;
      dashboard.studentMobileCards.innerHTML = "";
    }
    dashboard.renderSelectedStudent();
    dashboard.renderAdminAttendance();
  }
  renderSelectedStudent() {
    const dashboard = this;
    const student = dashboard.students.find(item => item.uid === dashboard.selectedManagedStudentUid);
    if (!student) {
      dashboard.adminStudentDetail.hidden = true;
      dashboard.adminStudentDetail.innerHTML = "";
      return;
    }
    const fullName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
    const presence = dashboard.getStudentPresence(student.uid);
    const avatar = student.photoDataUrl ? `<img src="${escapeHtml(student.photoDataUrl)}" alt="${escapeHtml(fullName)} profile photo">` : escapeHtml(getInitials(student.firstName, student.lastName));
    const studentAttendance = dashboard.attendance.filter(record => record.studentUid === student.uid).sort((a, b) => (b.attendedAt?.seconds || 0) - (a.attendedAt?.seconds || 0));
    const absenceCount = dashboard.can('viewAbsences') ? dashboard.getStudentAbsences(student).length : 0;
    const attendedCards = studentAttendance.length ? studentAttendance.map(record => `<article class="attended-event-box"><strong>${escapeHtml(record.eventName || "Attendance event")}</strong><span>${escapeHtml(record.eventDate || "Date unavailable")} · ${escapeHtml(record.location || "Location not provided")}</span><span>${escapeHtml(record.timeIn || "")} ${record.timeOut ? `– ${escapeHtml(record.timeOut)}` : ""}</span></article>`).join("") : '<div class="empty-state">This student has not attended an event yet.</div>';
    const hasFaceRegistration = dashboard.faceRegistrationsByUid.get(student.uid)?.registered === true;
    dashboard.adminStudentDetail.innerHTML = `<article class="panel admin-student-overview"><button class="modal-close" type="button" data-close-student-detail aria-label="Close student details">×</button><div class="profile-avatar">${avatar}</div><h3>${escapeHtml(fullName)}</h3><p>Student ID · ${escapeHtml(student.accountId)}</p><p class="profile-course-line" style="margin-top:-4px;color:var(--muted);font-size:.82rem;">Course Registered · <strong>${escapeHtml(student.course || "Not assigned")}</strong></p><span class="badge ${presence.isOnline ? "green" : "gray"}"><i class="presence-dot"></i>${presence.label}</span><small class="presence-profile-time">${escapeHtml(presence.detail)}</small><div class="admin-student-actions">${dashboard.studentActions.render({
      uid: student.uid,
      hasFaceRegistration,
      profile: true
    })}</div></article><article class="panel admin-student-information"><div class="panel-head"><div><h3>Student information</h3><p>Profile details and recorded attendance.</p></div><span class="badge blue">${studentAttendance.length} attended</span></div><div class="student-info-boxes"><div class="student-info-box"><span>Student ID</span><strong>${escapeHtml(student.accountId)}</strong></div><div class="student-info-box"><span>Course Registered</span><strong>${escapeHtml(student.course || "Not assigned")}</strong></div><div class="student-info-box"><span>Section</span><strong>${escapeHtml(student.section)}</strong></div><div class="student-info-box"><span>Face registration</span><strong>${hasFaceRegistration ? "Registered" : "Not registered"}</strong></div><div class="student-info-box"><span>Email address</span><strong>${escapeHtml(student.email || "Not provided")}</strong></div><div class="student-info-box"><span>Phone number</span><strong>${escapeHtml(student.phone || "Not provided")}</strong></div><div class="student-info-box"><span>Live status</span><strong>${presence.label}</strong><small>${escapeHtml(presence.detail)}</small></div><div class="student-info-box"><span>Account access</span><strong>${student.active === false ? "Inactive" : "Active"}</strong></div></div><div class="panel-head"><div><h3>Attended events</h3><p>All attendance records saved for this student.</p></div></div><div class="attended-event-grid">${attendedCards}</div></article>`;
    const fineCount = dashboard.fines.filter(fine => fine.studentUid === student.uid).length;
    const profileActions = dashboard.adminStudentDetail.querySelector(".admin-student-actions");
    if (dashboard.can("viewFines")) profileActions?.insertAdjacentHTML("afterbegin", `<button class="outline-button" type="button" data-check-student-fines="${escapeHtml(student.uid)}">Check attendance fines${fineCount ? ` (${fineCount})` : ""}</button>`);
    if (dashboard.can('viewAbsences')) profileActions?.insertAdjacentHTML("afterbegin", `<button class="outline-button" type="button" data-view-student-absences="${escapeHtml(student.uid)}">View absences${absenceCount ? ` (${absenceCount})` : ""}</button>`);
    dashboard.adminStudentDetail.querySelector(".student-info-boxes")?.insertAdjacentHTML("afterbegin", `<div class="student-info-box"><span>Birthday</span><strong>${escapeHtml(formatBirthday(student.birthday))}</strong></div>`);
    dashboard.adminStudentDetail.hidden = false;
    dashboard.adminStudentDetail.querySelector('.student-info-boxes')?.insertAdjacentHTML('afterbegin', `<div class="student-info-box"><span>Gender</span><strong>${GenderPolicy.label(student.gender)}</strong></div>`);
    dashboard.applyActionPermissions();
  }
  getStudentAbsences(student) {
    const dashboard = this;
    return dashboard.summaryService.summarize(student, dashboard.events, dashboard.attendance, {
      coverageFrom: dashboard.attendanceCoverageFrom,
      coverageConfirmed: dashboard.attendanceConfirmed
    }).absences.sort((first, second) => eventCloseDate(second).getTime() - eventCloseDate(first).getTime());
  }
  async openAdminAbsenceModal(student, trigger) {
    const dashboard = this;
    if (!dashboard.can('viewAbsences') || !student) return;
    const studentName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") || "Student";
    let result;
    try {
      const snapshot = await getDocsFromServer(query(collection(db, 'attendance'), where('studentUid', '==', student.uid)));
      result = dashboard.summaryService.summarize(student, dashboard.events, snapshot.docs.map(item => item.data()));
    } catch {
      showDashboardToast('Absence verification unavailable', 'No absence decision was made. Check your connection and retry.');
      return;
    }
    const absences = result.absences;
    const { markup: records, eventCount } = AbsenceCardsPresenter.render(absences, {
      escapeHtml, formatDate: formatEventDate, formatWindow: formatTimeWindow
    });
    dashboard.adminAbsenceModalController.open({
      title: `${studentName}'s absences`,
      description: `${absences.length} confirmed session absences across ${eventCount} event${eventCount === 1 ? '' : 's'} · ${result.unverified.length} historical sessions unverified.`,
      markup: `<section class="community-service-section"><div class="community-service-section-heading"><h3>Missed events</h3><p>Confirmed roster participants only. Historical events without eligibility records are unverified. Missed checkout needs review, not an automatic absence.</p></div>${records}</section>`,
      trigger
    });
  }
  fineRecordModalMarkup(fine) {
    const dashboard = this;
    const status = fine.status === "Completed" ? "Completed" : "Needs review";
    return `<article class="community-service-record"><div class="community-service-record-top"><strong>${escapeHtml(fine.eventName || "Attendance absence")}</strong><span class="badge ${fine.status === "Completed" ? "green" : "orange"}">${escapeHtml(status)}</span></div><div class="fine-detail-grid"><div><span>Attendance date</span><strong>${escapeHtml(fine.eventDate || "Not recorded")}</strong></div><div><span>Service required</span><strong>${escapeHtml(formatServiceMinutes(fine.serviceMinutes))}</strong></div><div><span>Recorded</span><strong>${escapeHtml(formatFineDate(fine.assignedAt))}</strong></div><div class="fine-detail-full"><span>Reason</span><strong>${escapeHtml(fine.reason || "No reason provided.")}</strong></div></div></article>`;
  }
  openAdminFineModal(student, trigger) {
    const dashboard = this;
    if (!dashboard.can('viewFines')) return;
    if (!student) return;
    dashboard.selectedFineStudentUid = student.uid;
    const studentFines = dashboard.fines.filter(fine => fine.studentUid === student.uid);
    const currentRecords = studentFines.filter(fine => fine.status !== "Completed");
    const reviewedRecords = studentFines.filter(fine => fine.status === "Completed");
    const studentName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") || "Student";
    dashboard.adminFineModalController.open({
      title: `${studentName}'s attendance fines`,
      description: dashboard.can("manageFines") ? "Review attendance-fine records, then use Manage fines to update them." : "Read-only attendance-fine records.",
      markup: `<section class="community-service-section"><div class="community-service-section-heading"><h3>Current records</h3><p>Records that still need attention.</p></div>${currentRecords.length ? currentRecords.map(dashboard.fineRecordModalMarkup).join("") : '<div class="community-service-empty">No current attendance fines recorded.</div>'}</section><section class="community-service-section"><div class="community-service-section-heading"><h3>Reviewed records</h3><p>Records marked as completed.</p></div>${reviewedRecords.length ? reviewedRecords.map(dashboard.fineRecordModalMarkup).join("") : '<div class="community-service-empty">No reviewed attendance fines recorded.</div>'}</section>`,
      trigger
    });
  }
  async resetStudentFaceRegistration(student, options = {}) {
    const dashboard = this;
    if (!dashboard.can('resetFace')) return;
    if (!student || !dashboard.faceRegistrationsByUid.get(student.uid)?.registered) return false;
    try {
      await resetFacePhotoInDrive(student.uid, options);
      const registration = await waitForFaceRegistration(student.uid, false);
      if (!registration) throw new Error("Reset was not confirmed. Refresh student status before retrying. If still registered, check the Apps Script execution logs and deployed version.");
      // Notification delivery must not hold an already-confirmed reset open.
      Promise.resolve().then(() => createNotification({
        recipientUid: student.uid,
        recipientRole: "student",
        category: "face",
        title: "Face registration reset",
        message: "Your administrator reset your face registration. You may now register one new photo.",
        targetView: "face",
        studentName: [student.firstName, student.lastName].filter(Boolean).join(" "),
        studentId: student.accountId,
        section: student.section
      })).catch(error => console.warn("Face reset notification could not be delivered", error));
      Promise.resolve().then(() => dashboard.notifyRoles(["super_admin", "head_admin", "student_manager"], {
        category: "face",
        title: "Face registration reset",
        message: `${student.accountId}'s face registration was reset.`,
        targetView: "modify-students",
        studentName: [student.firstName, student.lastName].filter(Boolean).join(" "),
        studentId: student.accountId,
        section: student.section
      })).catch(error => console.warn("Face reset role notifications could not be delivered", error));
      showDashboardToast("Face registration reset", `${student.accountId} can now register one new photo.`);
      return true;
    } catch (error) {
      showDashboardToast("Unable to reset face", error.message || "Try again after checking the Drive upload service.");
      return false;
    }
  }
  resetEventForm() {
    const dashboard = this;
    dashboard.eventForm.reset();
    delete dashboard.eventForm.dataset.rosterVersion;
    dashboard.eventAudienceEditor?.set();
    dashboard.eventSessionEditor?.set();
    dashboard.eventGeofenceEditor.clear();
    dashboard.document.querySelector("#editingEventId").value = "";
    dashboard.document.querySelector("#eventFormTitle").textContent = "Event details";
    dashboard.document.querySelector("#eventSubmitButton").textContent = "Create event";
    delete dashboard.eventForm.dataset.returnView;
  }
  duplicateEventSignature(event) {
    const dashboard = this;
    const normalized = value => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
    return [event.sessionBaseName || event.name, event.sessionPeriod || 'morning', event.date, event.location, EventAudiencePolicy.selected(event).join(','), event.timeIn, event.checkInCutoff, event.timeOut, event.checkOutCutoff].map(normalized).join("\u001f");
  }
  async editEvent(id) {
    const dashboard = this;
    if (!dashboard.can('manageEvents')) return;
    const event = dashboard.events.find(item => item.id === id);
    if (!event) return;
    if (event.sessionPeriod === 'afternoon' && event.sessionGroupId !== id) {
      if (!dashboard.events.some(item => item.id === event.sessionGroupId)) return showDashboardToast('Morning session unavailable', 'Refresh the event list. The linked morning event must be available before editing this group.');
      return dashboard.editEvent(event.sessionGroupId);
    }
    try {
      const snapshot = await getDoc(doc(db, "eventGeofences", id));
      event.geofence = snapshot.data() || {
        enabled: false
      };
    } catch (error) {
      showDashboardToast("Attendance area unavailable", "The current area could not be loaded. Retry before editing this event.");
      return;
    }
    dashboard.document.querySelector("#editingEventId").value = event.id;
    dashboard.document.querySelector("#eventName").value = event.sessionBaseName || event.name;
    dashboard.document.querySelector("#eventDate").value = event.date;
    dashboard.document.querySelector("#eventLocation").value = event.location;
    dashboard.document.querySelector("#eventType").value = event.type || "Other";
    dashboard.document.querySelector("#eventTimeIn").value = event.timeIn;
    dashboard.document.querySelector("#eventTimeOut").value = event.timeOut;
    dashboard.document.querySelector("#eventCheckInCutoff").value = event.checkInCutoff || timePlusMinutes(event.timeIn) || event.timeOut;
    dashboard.document.querySelector("#eventCheckOutCutoff").value = event.checkOutCutoff || timePlusMinutes(event.timeOut);
    dashboard.eventAudienceEditor.set(event);
    dashboard.eventSessionEditor?.set(event, dashboard.events.find(item => item.id === EventSessionPolicy.afternoonId(event.id)));
    dashboard.eventForm.dataset.rosterVersion = String(event.rosterVersion || 0);
    dashboard.document.querySelector("#eventNotes").value = event.description || event.notes || "";
    dashboard.eventGeofenceEditor.set(event.geofence || {});
    dashboard.document.querySelector("#eventFormTitle").textContent = "Modify event";
    dashboard.document.querySelector("#eventSubmitButton").textContent = "Save changes";
    dashboard.eventForm.dataset.returnView = isEventFinished(event) ? "past-events" : "modify-events";
    openView("create");
  }
  async writeInBatches(documents, write) {
    const dashboard = this;
    for (let start = 0; start < documents.length; start += 450) {
      const batch = writeBatch(db);
      documents.slice(start, start + 450).forEach(item => write(batch, item));
      await batch.commit();
    }
  }
  async syncEventRecords(eventId, event) {
    const dashboard = this;
    const [attendanceSnapshot, fineSnapshot] = await Promise.all([getDocs(query(collection(db, "attendance"), where("eventId", "==", eventId))), dashboard.can('manageFines') ? getDocs(query(collection(db, "fines"), where("eventId", "==", eventId))) : Promise.resolve({
      docs: []
    })]);
    const attendanceUpdate = {
      eventName: event.name,
      eventType: event.type || "School Event",
      eventDescription: event.description || "",
      eventDate: event.date,
      timeIn: event.timeIn,
      timeOut: event.timeOut,
      location: event.location,
      audience: event.audience || "All students"
    };
    const fineUpdate = {
      eventName: event.name,
      eventDate: event.date,
      eventTimeIn: event.timeIn,
      eventTimeOut: event.timeOut,
      eventLocation: event.location,
      eventRemoved: false
    };
    await Promise.all([dashboard.writeInBatches(attendanceSnapshot.docs, (batch, item) => batch.set(item.ref, attendanceUpdate, {
      merge: true
    })), dashboard.writeInBatches(fineSnapshot.docs, (batch, item) => batch.set(item.ref, fineUpdate, {
      merge: true
    }))]);
    return attendanceSnapshot.size;
  }
  async syncEventRecordsAfterSave(eventId, event) {
    const dashboard = this;
    try {
      await dashboard.syncEventRecords(eventId, event);
      return { synced: true };
    } catch (error) {
      console.error("Event saved but linked attendance records could not be synchronized", {
        eventId,
        code: firebaseErrorCode(error),
        message: error?.message
      });
      return { synced: false, error };
    }
  }
  closePastEventRemovalModal() {
    const dashboard = this;
    dashboard.pastEventRemovalModal.hidden = true;
    dashboard.selectedPastEventForRemoval = undefined;
  }
  openPastEventRemovalModal(eventId) {
    const dashboard = this;
    if (!dashboard.can('deleteEvents')) return;
    const event = dashboard.events.find(item => item.id === eventId);
    if (!event) return;
    dashboard.selectedPastEventForRemoval = event;
    const attendanceCount = dashboard.attendance.filter(record => record.eventId === event.id).length;
    dashboard.document.querySelector("#pastEventRemovalMessage").textContent = `Removing ${event.name} will permanently remove ${attendanceCount} student attendance record${attendanceCount === 1 ? "" : "s"} from My Attendances, Event History, and the Attendance Line. Linked fines will remain as administrative records.`;
    dashboard.pastEventRemovalModal.hidden = false;
    dashboard.document.querySelector("#confirmPastEventRemoval").focus();
  }
  async removeEventAndRecords(event) {
    const dashboard = this;
    if (event.sessionPeriod === 'morning') {
      const afternoon = await getDocFromServer(doc(db, 'events', EventSessionPolicy.afternoonId(event.id)));
      if (afternoon.exists()) throw new Error('This morning session has a linked afternoon session. Keep it for editing the event group, or remove the afternoon session first. No attendance was removed.');
    }
    const [attendanceSnapshot, dismissedSnapshot, fineSnapshot] = await Promise.all([getDocs(query(collection(db, "attendance"), where("eventId", "==", event.id))), getDocs(query(collection(db, "dismissedHistory"), where("eventId", "==", event.id))), getDocs(query(collection(db, "fines"), where("eventId", "==", event.id)))]);
    await Promise.all([dashboard.writeInBatches(attendanceSnapshot.docs, (batch, item) => batch.delete(item.ref)), dashboard.writeInBatches(dismissedSnapshot.docs, (batch, item) => batch.delete(item.ref)), dashboard.writeInBatches(fineSnapshot.docs, (batch, item) => batch.set(item.ref, {
      eventRemoved: true,
      eventRemovedAt: serverTimestamp()
    }, {
      merge: true
    }))]);
    await deleteDoc(doc(db, "events", event.id));
    return attendanceSnapshot.size;
  }
  async handleEventCardAction(clickEvent) {
    const dashboard = this;
    const manageGeofence = clickEvent.target.closest("[data-manage-geofence]");
    const edit = clickEvent.target.closest("[data-edit-event]");
    const remove = clickEvent.target.closest("[data-delete-event]");
    if (manageGeofence) {
      dashboard.renderGeofenceEventOptions(manageGeofence.dataset.manageGeofence);
      openView("geofence");
      dashboard.loadGeofenceManager(manageGeofence.dataset.manageGeofence);
    }
    if (edit) dashboard.editEvent(edit.dataset.editEvent);
    if (remove) dashboard.openPastEventRemovalModal(remove.dataset.deleteEvent);
  }
  syncBirthdayPassword() {
    if (this.document.querySelector('#originalStudentId').value) return;
    const password = this.document.querySelector('#managedPassword');
    try { password.value = StudentPasswordPolicy.birthdayPassword(this.document.querySelector('#managedBirthday').value); }
    catch { password.value = ''; }
  }
  resetStudentForm() {
    const dashboard = this;
    dashboard.studentForm.reset();
    dashboard.document.querySelector("#originalStudentId").value = "";
    dashboard.document.querySelector("#managedStudentId").disabled = false;
    dashboard.document.querySelector("#managedBirthday").required = true;
    dashboard.document.querySelector("#managedPassword").required = true;
    dashboard.document.querySelector("#managedPassword").disabled = false;
    dashboard.document.querySelector("#managedPassword").value = "";
    dashboard.document.querySelector("#managedPassword").placeholder = "Choose a birthday first";
    dashboard.document.querySelector("#managedPasswordHelp").textContent = "Birthday in MMDDYYYY format (January 2, 2005 → 01022005). The student must choose a new password on first login.";
    dashboard.document.querySelector("#studentPageTitle").textContent = "Add Student";
    dashboard.document.querySelector("#studentFormTitle").textContent = "Student information";
    dashboard.document.querySelector("#studentSubmitButton").textContent = "Add student";
  }
  editStudent(uid) {
    const dashboard = this;
    if (!dashboard.can('editStudents')) return;
    const student = dashboard.students.find(item => item.uid === uid);
    if (!student) return;
    dashboard.document.querySelector("#originalStudentId").value = student.uid;
    dashboard.document.querySelector("#managedStudentId").value = student.accountId;
    dashboard.document.querySelector("#managedStudentId").disabled = false;
    dashboard.document.querySelector("#managedFirstName").value = student.firstName;
    dashboard.document.querySelector("#managedMiddleName").value = student.middleName || "";
    dashboard.document.querySelector("#managedBirthday").value = student.birthday || "";
    dashboard.document.querySelector("#managedGender").value = GenderPolicy.normalize(student.gender);
    dashboard.document.querySelector("#managedBirthday").required = false;
    dashboard.document.querySelector("#managedLastName").value = student.lastName;
    dashboard.document.querySelector("#managedSection").value = student.section;
    dashboard.document.querySelector("#managedCourse").value = CoursePolicy.normalize(student.course);
    dashboard.document.querySelector("#managedEmail").value = student.email || "";
    dashboard.document.querySelector("#managedPhone").value = student.phone || "";
    dashboard.document.querySelector("#managedPassword").required = false;
    dashboard.document.querySelector("#managedPassword").disabled = true;
    dashboard.document.querySelector("#managedPassword").value = "";
    dashboard.document.querySelector("#managedPassword").placeholder = "Use the Password button in Modify Students";
    dashboard.document.querySelector("#managedPasswordHelp").textContent = "Use the Password action in the student list to change this password.";
    dashboard.document.querySelector("#studentPageTitle").textContent = "Modify Student";
    dashboard.document.querySelector("#studentFormTitle").textContent = "Update student information";
    dashboard.document.querySelector("#studentSubmitButton").textContent = "Save changes";
    openView("add-student");
  }
  closePasswordModal() {
    const dashboard = this;
    dashboard.passwordModal.hidden = true;
    dashboard.selectedPasswordStudent = undefined;
    dashboard.document.querySelector("#passwordChangeForm").reset();
  }
  closeRemoveModal() {
    const dashboard = this;
    dashboard.window.clearInterval(dashboard.removalCountdownTimer);
    dashboard.removeStudentModal.hidden = true;
    dashboard.selectedRemovalStudent = undefined;
    dashboard.document.querySelector("#removeStudentPassword").value = "";
    dashboard.document.querySelector("#removeStudentCountdown").textContent = "Review this action carefully.";
    const confirmButton = dashboard.document.querySelector("#confirmRemoveStudent");
    confirmButton.disabled = true;
    confirmButton.textContent = "Wait 5 seconds";
  }
  closeResetFaceModal() {
    const dashboard = this;
    dashboard.resetFaceModal.hidden = true;
    dashboard.selectedFaceResetStudent = undefined;
  }
  openPasswordModal(student) {
    const dashboard = this;
    if (!dashboard.can('changePasswords')) return;
    dashboard.selectedPasswordStudent = student;
    if (!dashboard.selectedPasswordStudent) return;
    dashboard.document.querySelector("#passwordStudentName").textContent = `Change the password for ${dashboard.selectedPasswordStudent.firstName} ${dashboard.selectedPasswordStudent.lastName}. Enter the current password to continue.`;
    dashboard.passwordModal.hidden = false;
    dashboard.document.querySelector("#currentStudentPassword").focus();
  }
  openRemoveModal(student) {
    const dashboard = this;
    if (!dashboard.can('deleteStudents')) return;
    dashboard.selectedRemovalStudent = student;
    if (!dashboard.selectedRemovalStudent) return;
    dashboard.window.clearInterval(dashboard.removalCountdownTimer);
    dashboard.document.querySelector("#removeStudentMessage").textContent = `${dashboard.selectedRemovalStudent.firstName} ${dashboard.selectedRemovalStudent.lastName} (${dashboard.selectedRemovalStudent.accountId})'s account and saved records will be completely removed from Firebase and logged out.`;
    dashboard.document.querySelector("#removeStudentPassword").value = "";
    dashboard.removeStudentModal.hidden = false;
    const countdown = dashboard.document.querySelector("#removeStudentCountdown");
    const confirmButton = dashboard.document.querySelector("#confirmRemoveStudent");
    let seconds = 5;
    countdown.textContent = `Account removal confirmation unlocks in ${seconds}s…`;
    confirmButton.disabled = true;
    confirmButton.textContent = `Wait ${seconds} seconds`;
    dashboard.removalCountdownTimer = dashboard.window.setInterval(() => {
      seconds -= 1;
      if (seconds > 0) {
        countdown.textContent = `Account removal confirmation unlocks in ${seconds}s…`;
        confirmButton.textContent = `Wait ${seconds} second${seconds === 1 ? "" : "s"}`;
        return;
      }
      dashboard.window.clearInterval(dashboard.removalCountdownTimer);
      countdown.textContent = "Countdown complete (5s–1s timer finished). Confirm to permanently remove this account from Firebase.";
      confirmButton.disabled = false;
      confirmButton.textContent = "Remove account completely";
    }, 1000);
    dashboard.document.querySelector("#removeStudentPassword").focus();
  }
  openResetFaceModal(student) {
    const dashboard = this;
    if (!dashboard.can('resetFace')) return;
    if (!student || !dashboard.faceRegistrationsByUid.get(student.uid)?.registered) return;
    dashboard.selectedFaceResetStudent = student;
    dashboard.document.querySelector('#faceMissingRecovery').hidden = !['super_admin', 'head_admin'].includes(currentUserRole);
    dashboard.document.querySelector('#recoverMissingFace').checked = false;
    dashboard.document.querySelector('#faceRecoveryReason').value = '';
    const studentName = [student.firstName, student.lastName].filter(Boolean).join(" ") || "this student";
    dashboard.document.querySelector("#resetFaceMessage").textContent = `Reset ${studentName}'s face registration? Their current face photo will be moved to Drive Trash, and they will be allowed to register one new photo.`;
    dashboard.resetFaceModal.hidden = false;
    dashboard.document.querySelector("#confirmResetFace").focus();
  }
  resetStudentDirectoryPage() {
    const dashboard = this;
    dashboard.studentPage = 1;
    dashboard.renderStudents();
  }
  handleEventTimeInChange() {
    const dashboard = this;
    return dashboard.setDefaultCutoff("#eventTimeIn", "#eventCheckInCutoff");
  }
  handleEventTimeOutChange() {
    const dashboard = this;
    return dashboard.setDefaultCutoff("#eventTimeOut", "#eventCheckOutCutoff");
  }
  handleRoleChangeModalClick(event) {
    const dashboard = this;
    if (event.target === dashboard.roleChangeModal) dashboard.closeRoleChangeModal();
  }
  handleGeofenceEventSelectChange() {
    const dashboard = this;
    return dashboard.loadGeofenceManager();
  }
  async handleSaveManagerGeofenceClick() {
    const dashboard = this;
    if (!dashboard.can('manageGeofences')) return;
    const selectedEvent = dashboard.events.find(event => event.id === dashboard.geofenceEventSelect.value);
    if (!selectedEvent) return;
    let geofence;
    try {
      geofence = dashboard.managerGeofenceEditor.validate();
    } catch (error) {
      return showDashboardToast('Choose a valid attendance area', error.message);
    }
    try {
      const batch = writeBatch(db);
      const group = selectedEvent.sessionGroupId;
      const sessions = group ? dashboard.events.filter(event => event.sessionGroupId === group) : [selectedEvent];
      for (const session of sessions) {
        batch.set(doc(db, "eventGeofences", session.id), geofence);
        batch.set(doc(db, "events", session.id), { requiresGeofence: geofence.enabled, updatedAt: serverTimestamp() }, { merge: true });
      }
      await batch.commit();
      showDashboardToast("Attendance area saved", `${selectedEvent.name} now uses the updated location rule.`);
    } catch (error) {
      showDashboardToast("Unable to save area", error.message);
    }
  }
  handleGeofenceEditEventClick() {
    const dashboard = this;
    const id = dashboard.geofenceEventSelect.value;
    if (id) dashboard.editEvent(id);
  }
  handleWireProfileActionsPresenceViewchange({
    detail
  }) {
    const dashboard = this;
    if (detail.viewName === "create") dashboard.window.setTimeout(() => dashboard.eventGeofenceEditor.invalidate(), 0);
    if (detail.viewName === "geofence") dashboard.window.setTimeout(() => dashboard.managerGeofenceEditor.invalidate(), 0);
  }
  async handleAdminProfileFormSubmit(event) {
    const dashboard = this;
    if (!dashboard.can('adminProfile')) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    try {
      await setDoc(doc(db, "adminProfiles", currentUser.uid), {
        displayName: dashboard.document.querySelector("#adminDisplayName").value.trim(),
        birthday: dashboard.document.querySelector("#adminProfileBirthday").value,
        phone: dashboard.document.querySelector("#adminProfilePhone").value.trim(),
        photoDataUrl: dashboard.pendingAdminProfilePhoto,
        email: currentUser.email,
        updatedAt: serverTimestamp()
      }, {
        merge: true
      });
      showDashboardToast("Profile updated", "Your changes are now live.");
    } catch (error) {
      showDashboardToast("Unable to update profile", error.code === "permission-denied" ? "Publish the latest database rules first." : error.message);
    }
  }
  async handleAdminProfilePhotoChange(event) {
    const dashboard = this;
    const [file] = event.target.files;
    if (!file) return;
    try {
      dashboard.pendingAdminProfilePhoto = await dashboard.prepareAdminProfilePhoto(file);
      dashboard.updateAdminPhotoPreview(dashboard.pendingAdminProfilePhoto);
    } catch (error) {
      event.target.value = "";
      showDashboardToast("Unable to use photo", error.message);
    }
  }
  handleRemoveAdminProfilePhotoClick() {
    const dashboard = this;
    dashboard.pendingAdminProfilePhoto = "";
    dashboard.document.querySelector("#adminProfilePhoto").value = "";
    dashboard.updateAdminPhotoPreview();
  }
  handleAdminDisplayNameInput() {
    const dashboard = this;
    if (!dashboard.pendingAdminProfilePhoto) dashboard.updateAdminPhotoPreview();
  }
  handleOpenDataCleanupClick() {
    const dashboard = this;
    if (!dashboard.can('resetData')) return;
    dashboard.renderDataCleanupCounts();
    dashboard.dataCleanupModal.hidden = false;
    dashboard.clearEventData.focus();
  }
  handleDataCleanupModalClick(event) {
    const dashboard = this;
    if (event.target === dashboard.dataCleanupModal) dashboard.closeDataCleanupModal();
  }
  handleWireCleanupAndSyncActionsKeydown(event) {
    const dashboard = this;
    if (event.key === "Escape" && !dashboard.dataCleanupModal.hidden) dashboard.closeDataCleanupModal();
  }
  async handleConfirmDataCleanupClick() {
    const dashboard = this;
    if (!dashboard.can('resetData')) return;
    if (dashboard.confirmDataCleanup.disabled) return;
    dashboard.confirmDataCleanup.disabled = true;
    dashboard.confirmDataCleanup.textContent = "Resetting data…";
    try {
      const clearEvents = dashboard.clearEventData.checked;
      const clearFines = dashboard.clearFineData.checked;
      const [eventSnapshot, attendanceSnapshot, dismissedSnapshot, geofenceSnapshot, fineSnapshot] = await Promise.all([clearEvents ? getDocs(collection(db, "events")) : Promise.resolve(null), clearEvents ? getDocs(collection(db, "attendance")) : Promise.resolve(null), clearEvents ? getDocs(collection(db, "dismissedHistory")) : Promise.resolve(null), clearEvents ? getDocs(collection(db, "eventGeofences")) : Promise.resolve(null), clearFines ? getDocs(collection(db, "fines")) : Promise.resolve(null)]);
      await Promise.all([eventSnapshot ? dashboard.writeInBatches(eventSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve(), attendanceSnapshot ? dashboard.writeInBatches(attendanceSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve(), dismissedSnapshot ? dashboard.writeInBatches(dismissedSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve(), geofenceSnapshot ? dashboard.writeInBatches(geofenceSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve(), fineSnapshot ? dashboard.writeInBatches(fineSnapshot.docs, (batch, item) => batch.delete(item.ref)) : Promise.resolve()]);
      const counts = {
        events: eventSnapshot?.size || 0,
        attendance: attendanceSnapshot?.size || 0,
        fines: fineSnapshot?.size || 0
      };
      dashboard.closeDataCleanupModal();
      const eventFollowUp = clearEvents ? " Linked event areas and dismissed-event history were also removed." : "";
      showDashboardToast("Operational data reset", `${counts.events || 0} event${counts.events === 1 ? "" : "s"}, ${counts.attendance || 0} attendance record${counts.attendance === 1 ? "" : "s"}, and ${counts.fines || 0} fine${counts.fines === 1 ? "" : "s"} were removed.${eventFollowUp}`);
    } catch (error) {
      const code = firebaseErrorCode(error);
      showDashboardToast("Unable to reset data", code === "permission-denied" ? "Only the Super Admin can reset operational data. Deploy the latest Firestore Rules, then sign in again." : error.message || "Try again after refreshing the dashboard.");
      dashboard.updateDataCleanupState();
    } finally {
      dashboard.confirmDataCleanup.textContent = "Reset selected data";
    }
  }
  async handleSyncAttendanceNowClick() {
    const dashboard = this;
    if (!dashboard.canManuallySyncAttendance) return;
    if (!dashboard.attendanceSyncService) return;
    dashboard.syncAttendanceNow.disabled = true;
    try {
      if (activeView === 'attendance-line') await dashboard.historyController.reload();else await dashboard.attendanceSyncService.syncNow();
      showDashboardToast("Attendance synced", "The Attendance Line was refreshed from Firestore.");
    } catch (error) {
      const message = firebaseErrorCode(error) === "permission-denied" ? "Firestore denied this server refresh. Confirm the deployed rules recognize your active attendance-management role, then sign out and sign in again." : "Firestore could not refresh attendance. Check your connection and try again.";
      showDashboardToast("Attendance sync failed", message);
    } finally {
      dashboard.syncAttendanceNow.disabled = false;
    }
  }
  async handleFineFormSubmit(event) {
    event.preventDefault();
    if (this.fineAssignmentPending) return;
    this.fineAssignmentPending = true;
    try {
      return await this.submitFine(event);
    } finally {
      this.fineAssignmentPending = false;
    }
  }
  async submitFine(event) {
    const dashboard = this;
    if (!dashboard.can('manageFines')) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const student = dashboard.students.find(item => item.uid === dashboard.fineStudent.value);
    if (!student) {
      showDashboardToast("Select a student", "Choose the student who missed attendance.");
      return;
    }
    let attendanceEvent = dashboard.events.find(item => item.id === dashboard.fineEvent.value);
    const editingFineId = dashboard.document.querySelector("#editingFineId").value;
    const editingFine = dashboard.fines.find(fine => fine.id === editingFineId);
    if (!attendanceEvent && !editingFineId) {
      showDashboardToast("Select a missed event", "Create or select an event before assigning this fine.");
      return;
    }
    const preservesAssignment = editingFine && editingFine.studentUid === student.uid && editingFine.eventId === dashboard.fineEvent.value;
    if (!preservesAssignment) {
      try {
        attendanceEvent = await dashboard.fineEligibility.verify(student, dashboard.fineEvent.value);
      } catch (error) {
        showDashboardToast('Fine assignment blocked', error.message || 'Unable to verify attendance online. Retry when connected.');
        return;
      }
    }
    const enteredServiceMinutes = dashboard.addingCommunityService ? Math.min(600, Math.max(1, Number(dashboard.fineExtensionHours.value) * 60 + Number(dashboard.fineExtensionMinutes.value))) : Math.min(600, Math.max(1, Number(dashboard.document.querySelector("#fineServiceHours").value) * 60 + Number(dashboard.document.querySelector("#fineServiceMinutes").value)));
    const serviceMinutes = editingFineId && dashboard.addingCommunityService ? Math.min(600, (Number(editingFine?.serviceMinutes) || 0) + enteredServiceMinutes) : enteredServiceMinutes;
    if (!dashboard.addingCommunityService) dashboard.setFineServiceDuration(enteredServiceMinutes);
    const fineData = {
      studentUid: student.uid,
      studentId: student.accountId,
      studentName: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
      eventId: attendanceEvent?.id || (editingFine?.eventId === dashboard.fineEvent.value ? editingFine.eventId : ""),
      eventName: attendanceEvent?.name || (editingFine?.eventId === dashboard.fineEvent.value ? editingFine.eventName : ""),
      eventDate: attendanceEvent?.date || (editingFine?.eventId === dashboard.fineEvent.value ? editingFine.eventDate : ""),
      eventTimeIn: attendanceEvent?.timeIn || (editingFine?.eventId === dashboard.fineEvent.value ? editingFine.eventTimeIn || "" : ""),
      eventTimeOut: attendanceEvent?.timeOut || (editingFine?.eventId === dashboard.fineEvent.value ? editingFine.eventTimeOut || "" : ""),
      eventLocation: attendanceEvent?.location || (editingFine?.eventId === dashboard.fineEvent.value ? editingFine.eventLocation || "" : ""),
      serviceMinutes,
      reason: dashboard.document.querySelector("#fineReason").value.trim(),
      status: dashboard.document.querySelector("#fineStatus").value
    };
    try {
      if (editingFineId) {
        const previousMinutes = Number(editingFine?.serviceMinutes) || 0;
        const historyEntry = dashboard.addingCommunityService ? {
          action: "Added",
          previousMinutes,
          addedMinutes: enteredServiceMinutes,
          newMinutes: serviceMinutes,
          reason: dashboard.fineExtensionReason.value.trim(),
          recordedAt: new Date().toISOString()
        } : {
          action: "Updated",
          previousMinutes,
          newMinutes: serviceMinutes,
          reason: fineData.reason,
          recordedAt: new Date().toISOString()
        };
        await setDoc(doc(db, "fines", editingFineId), {
          ...fineData,
          assignmentHistory: [...getFineHistory(editingFine), historyEntry],
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.uid
        }, {
          merge: true
        });
        dashboard.notifyRoles(["super_admin", "head_admin", "student_manager"], {
          category: "service",
          title: "Community service updated",
          message: `${student.accountId}'s service requirement was updated.`,
          targetView: "assigned-fines",
          studentName: fineData.studentName,
          studentId: student.accountId,
          section: student.section
        }).catch(() => {});
        showDashboardToast(dashboard.addingCommunityService ? "Community service added" : "Fine updated", dashboard.addingCommunityService ? `${formatServiceMinutes(enteredServiceMinutes)} was added to this fine.` : `${student.accountId}'s fine was updated.`);
      } else {
        await addDoc(collection(db, "fines"), {
          ...fineData,
          assignmentHistory: [{
            action: "Assigned",
            addedMinutes: serviceMinutes,
            newMinutes: serviceMinutes,
            reason: fineData.reason,
            recordedAt: new Date().toISOString()
          }],
          assignedAt: serverTimestamp(),
          assignedBy: currentUser.uid
        });
        dashboard.notifyRoles(["super_admin", "head_admin", "student_manager"], {
          category: "service",
          title: "Community service assigned",
          message: `${student.accountId} was assigned a community-service requirement.`,
          targetView: "assigned-fines",
          studentName: fineData.studentName,
          studentId: student.accountId,
          section: student.section
        }).catch(() => {});
        showDashboardToast("Fine assigned", `${student.accountId} was assigned a new community-service requirement.`);
      }
      dashboard.resetFineForm();
      openView("assigned-fines");
    } catch (error) {
      showDashboardToast("Unable to assign fine", error.code === "permission-denied" ? "Publish the latest database rules, then try again." : error.message);
    }
  }
  handleAddCommunityServiceClick() {
    const dashboard = this;
    if (!dashboard.document.querySelector("#editingFineId").value) return;
    dashboard.setCommunityServiceExtension(!dashboard.addingCommunityService);
    dashboard.fineServiceDurationHelp.textContent = "";
  }
  async handleAdminFineListClick(event) {
    const dashboard = this;
    const editButton = event.target.closest("[data-edit-fine]");
    const button = event.target.closest("[data-delete-fine]");
    if (editButton) {
      dashboard.editFine(dashboard.fines.find(fine => fine.id === editButton.dataset.editFine));
      return;
    }
    if (!button || !dashboard.can("deleteFines")) return;
    try {
      await deleteDoc(doc(db, "fines", button.dataset.deleteFine));
      showDashboardToast("Fine removed", "The community-service requirement was removed.");
    } catch (error) {
      showDashboardToast("Unable to remove fine", error.message);
    }
  }
  handleCancelFineEditClick() {
    const dashboard = this;
    return dashboard.window.setTimeout(dashboard.resetFineForm);
  }
  handleFineStudentSearchResultsClick(event) {
    const dashboard = this;
    const result = event.target.closest("[data-select-fine-student]");
    if (!result) return;
    dashboard.fineStudent.value = result.dataset.selectFineStudent;
    dashboard.fineStudentSearch.value = "";
    dashboard.renderFineOptions();
    dashboard.fineStudent.focus();
  }
  async handleEventFormSubmit(submitEvent) {
    const dashboard = this;
    if (!dashboard.can('manageEvents')) {
      submitEvent.preventDefault();
      return;
    }
    submitEvent.preventDefault();
    if (!dashboard.studentsLoaded) return showDashboardToast('Participant roster not ready', 'Wait for the student directory to load before publishing an event.');
    const timeIn = dashboard.document.querySelector("#eventTimeIn").value;
    const timeOut = dashboard.document.querySelector("#eventTimeOut").value;
    const checkInCutoff = dashboard.document.querySelector("#eventCheckInCutoff").value;
    const checkOutCutoff = dashboard.document.querySelector("#eventCheckOutCutoff").value;
    const date = dashboard.document.querySelector("#eventDate").value;
    if (timeOut <= timeIn) return showDashboardToast("Invalid attendance window", "Time Out must be later than Time In.");
    if (checkInCutoff <= timeIn || checkInCutoff > timeOut) return showDashboardToast("Invalid check-in cutoff", "The check-in cutoff must be after check-in opens and no later than check-out opens.");
    if (checkOutCutoff <= timeOut) return showDashboardToast("Invalid checkout cutoff", "The checkout cutoff must be after Time Out.");
    const id = dashboard.document.querySelector("#editingEventId").value;
    let requestedGeofence;
    try {
      requestedGeofence = dashboard.eventGeofenceEditor.validate();
    } catch (error) {
      return showDashboardToast('Choose a valid attendance area', error.message);
    }
    const geofence = requestedGeofence.enabled ? requestedGeofence : {
      enabled: false
    };
    let record = {
      name: dashboard.document.querySelector("#eventName").value.trim(),
      type: dashboard.document.querySelector("#eventType").value,
      date,
      location: dashboard.document.querySelector("#eventLocation").value.trim(),
      timeIn,
      checkInCutoff,
      timeOut,
      checkOutCutoff,
      audience: dashboard.document.querySelector("#eventAudience").value,
      description: dashboard.document.querySelector("#eventNotes").value.trim(),
      requiresGeofence: geofence.enabled,
      openAt: Timestamp.fromDate(new Date(`${date}T${timeIn}`)),
      checkInClosesAt: Timestamp.fromDate(new Date(`${date}T${checkInCutoff}`)),
      closeAt: Timestamp.fromDate(new Date(`${date}T${timeOut}`)),
      checkOutClosesAt: Timestamp.fromDate(new Date(`${date}T${checkOutCutoff}`)),
      updatedAt: serverTimestamp()
    };
    let sessionPlan, afternoonPrevious, eventReference;
    try {
      let previousEvent;
      if (id) {
        const saved = await getDocFromServer(doc(db, 'events', id));
        if (!saved.exists()) throw new Error('This event is unavailable. Refresh the event list.');
        previousEvent = { ...saved.data(), id };
        if (dashboard.eventForm.dataset.rosterVersion !== undefined && Number(dashboard.eventForm.dataset.rosterVersion) !== (previousEvent.rosterVersion || 0)) throw new Error('Participants changed while this editor was open. Reopen the event, review its groups and save again.');
      }
      const sections = dashboard.eventAudienceEditor.read();
      if (previousEvent && (isEventFinished(previousEvent) || previousEvent.checkoutOnlyReopened)) {
        if (JSON.stringify([...sections].sort()) !== JSON.stringify([...EventAudiencePolicy.selected(previousEvent)].sort())) throw new Error('Closed-event groups cannot be changed. Create a new event for additional sections.');
        record.audience = previousEvent.audience;
      } else Object.assign(record, EventAudiencePolicy.assignment(dashboard.students, sections, previousEvent, { timestamp: serverTimestamp }));
      if (dashboard.eventSessionEditor) {
        const sessionInput = dashboard.eventSessionEditor.read();
        eventReference = id ? doc(db, 'events', id) : doc(collection(db, 'events'));
        if (id && sessionInput.enabled) {
          const saved = await getDocFromServer(doc(db, 'events', EventSessionPolicy.afternoonId(id)));
          afternoonPrevious = saved.exists() ? saved.data() : undefined;
          if ((afternoonPrevious?.rosterVersion ?? null) !== (dashboard.eventSessionEditor.afternoonVersion ?? null)) throw new Error('The afternoon participants changed. Reopen the event before saving.');
        }
        sessionPlan = EventSessionPolicy.prepare({ id: eventReference.id, record, previous: previousEvent, afternoon: afternoonPrevious,
          ...sessionInput, students: dashboard.students, sections, timestamp: serverTimestamp, fromDate: value => Timestamp.fromDate(value) });
        record = sessionPlan.primary;
      }
      EventSessionPolicy.assertSchedule(record, previousEvent);
      const changedOngoing = EventSessionPolicy.needsScheduleConfirmation(record, previousEvent)
        || (sessionPlan?.afternoon && EventSessionPolicy.needsScheduleConfirmation(sessionPlan.afternoon, afternoonPrevious));
      if (changedOngoing) {
        const reopening = record.checkoutOnlyReopened || sessionPlan?.afternoon?.checkoutOnlyReopened;
        const confirmed = await dashboard.scheduleConfirmation.open(true, {title:reopening ? 'Extend checkout for this session?' : 'Change an ongoing attendance schedule?',
          message:reopening ? 'Only students with a saved check-in can check out during the reopened window. New check-ins and checkout-only attendance are blocked. Existing timestamps, arrival labels, completed records and fines are preserved. The date, other times and participants stay locked; morning cannot overlap afternoon.' : 'The new times will apply to subsequent check-ins and checkouts. Existing attendance timestamps, late/present labels and completed records will not be changed. Moving the checkout cutoff earlier can close attendance immediately. Morning and afternoon must not overlap.',label:reopening ? 'Extend checkout' : 'Save new schedule'});
        if (!confirmed) return;
      }
    } catch (error) { return showDashboardToast('Unable to update participants', error.message || 'Refresh and try again.'); }
    const duplicate = dashboard.events.find(event => event.id !== id && dashboard.duplicateEventSignature(event) === dashboard.duplicateEventSignature(record));
    if (duplicate) {
      return showDashboardToast("Duplicate event", `An event named ${record.name} already uses this date, location, audience, and attendance schedule. Change one of those details before saving.`);
    }
    let linkedRecordsSynced = true;
    try {
      if (id) {
        const batch = writeBatch(db);
        batch.set(doc(db, "events", id), record, {
          // Replace assignment maps, including removed sections and students.
          mergeFields: Object.keys(record)
        });
        batch.set(doc(db, "eventGeofences", id), geofence);
        dashboard.stageAfternoonSession?.(batch, id, sessionPlan, afternoonPrevious, geofence);
        await batch.commit();
        linkedRecordsSynced = (await dashboard.syncEventRecordsAfterSave(id, record)).synced;
        if (sessionPlan?.afternoon && afternoonPrevious) linkedRecordsSynced = (await dashboard.syncEventRecordsAfterSave(EventSessionPolicy.afternoonId(id), sessionPlan.afternoon)).synced && linkedRecordsSynced;
        dashboard.notifyAfternoonSession?.(id, sessionPlan, afternoonPrevious);
        if (!isEventFinished(record)) {
          const recipients = dashboard.students.filter(student => EventAudiencePolicy.canAttend(student, record));
          Promise.allSettled(recipients.map(student => createNotification({
            recipientUid: student.uid,
            recipientRole: "student",
            category: "attendance",
            title: "Event updated",
            message: `${record.name} was updated. Review the latest event details.`,
            targetView: "events",
            eventId: id,
            studentName: [student.firstName, student.lastName].filter(Boolean).join(" "),
            studentId: student.accountId,
            section: student.section
          }))).catch(() => {});
          dashboard.notifyRoles(["super_admin", "head_admin", "attendance_admin"], {
            category: "system",
            title: "Event updated",
            message: `${record.name} was updated. Review the latest event details.`,
            targetView: "modify-events",
            eventId: id
          }).catch(() => {});
        }
      } else {
        eventReference ||= doc(collection(db, "events"));
        const batch = writeBatch(db);
        batch.set(eventReference, {
          ...record,
          createdAt: serverTimestamp(),
          createdBy: currentUser.uid
        });
        batch.set(doc(db, "eventGeofences", eventReference.id), geofence);
        dashboard.stageAfternoonSession?.(batch, eventReference.id, sessionPlan, afternoonPrevious, geofence);
        await batch.commit();
        dashboard.notifyAfternoonSession?.(eventReference.id, sessionPlan, afternoonPrevious);
        if (!isEventFinished(record)) {
          const recipients = dashboard.students.filter(student => EventAudiencePolicy.canAttend(student, record));
          Promise.allSettled(recipients.map(student => createNotification({
            recipientUid: student.uid,
            recipientRole: "student",
            category: "attendance",
            title: "New event published",
            message: `${record.name} is scheduled for ${formatEventDate(record.date)}.`,
            targetView: "events",
            eventId: eventReference.id,
            studentName: [student.firstName, student.lastName].filter(Boolean).join(" "),
            studentId: student.accountId,
            section: student.section
          }))).catch(() => {});
          dashboard.notifyRoles(["super_admin", "head_admin", "attendance_admin"], {
            category: "system",
            title: "New event published",
            message: `${record.name} is scheduled for ${formatEventDate(record.date)}.`,
            targetView: "modify-events",
            eventId: eventReference.id
          }).catch(() => {});
        }
      }
      const returnView = dashboard.eventForm.dataset.returnView || "modify-events";
      dashboard.resetEventForm();
      openView(returnView);
      const message = id
        ? linkedRecordsSynced
          ? "The event and linked attendance records were synced."
          : "The event was saved, but existing attendance records could not be updated. Their original event details were kept."
        : "The event and attendance window were saved and synced.";
      showDashboardToast(id ? "Event updated" : "Event created", message);
    } catch (error) {
      const message = firebaseErrorCode(error) === "permission-denied" ? "Firestore rejected the event or its location settings. Refresh, sign in again, and reopen the event. If it still fails, confirm the published rules match this app version and your account has event-management access." : error.message || "The event could not be saved. Please try again.";
      showDashboardToast("Unable to save event", message);
    }
  }
  stageAfternoonSession(batch, id, plan, previous, geofence) {
    if (!plan?.afternoon) return;
    const reference = doc(db, 'events', EventSessionPolicy.afternoonId(id));
    if (previous) batch.set(reference, plan.afternoon, { mergeFields: Object.keys(plan.afternoon) });
    else batch.set(reference, { ...plan.afternoon, createdAt: serverTimestamp(), createdBy: currentUser.uid });
    batch.set(doc(db, 'eventGeofences', reference.id), geofence);
  }
  notifyAfternoonSession(id, plan, previous) {
    const event = plan?.afternoon;
    if (!event || isEventFinished(event)) return;
    // Closed-session saves omit roster fields; these notifications only concern
    // an open/upcoming session with a fresh, independently captured roster.
    const recipients = this.students.filter(student => EventAudiencePolicy.canAttend(student, event));
    Promise.allSettled(recipients.map(student => createNotification({ recipientUid: student.uid, recipientRole: 'student',
      category: 'attendance', title: previous ? 'Afternoon session updated' : 'Afternoon attendance added',
      message: `${event.name} is scheduled for ${formatEventDate(event.date)}. Check in and check out separately from the morning session.`,
      targetView: 'events', eventId: EventSessionPolicy.afternoonId(id),
      studentName: [student.firstName, student.lastName].filter(Boolean).join(' '), studentId: student.accountId, section: student.section
    }))).catch(() => {});
  }
  handlePastEventRemovalModalClick(event) {
    const dashboard = this;
    if (event.target === dashboard.pastEventRemovalModal) dashboard.closePastEventRemovalModal();
  }
  handleWireEventActionsKeydown(event) {
    const dashboard = this;
    if (event.key === "Escape" && !dashboard.pastEventRemovalModal.hidden) dashboard.closePastEventRemovalModal();
  }
  async handleConfirmPastEventRemovalClick() {
    const dashboard = this;
    if (!dashboard.can('deleteEvents')) return;
    if (!dashboard.selectedPastEventForRemoval) return;
    const event = dashboard.selectedPastEventForRemoval;
    const button = dashboard.document.querySelector("#confirmPastEventRemoval");
    button.disabled = true;
    button.textContent = "Removing event…";
    try {
      const removedRecords = await dashboard.removeEventAndRecords(event);
      dashboard.closePastEventRemovalModal();
      showDashboardToast("Event removed", `${event.name} and ${removedRecords} linked attendance record${removedRecords === 1 ? "" : "s"} were removed.`);
    } catch (error) {
      showDashboardToast("Unable to remove event", error.message || "Try again.");
    } finally {
      button.disabled = false;
      button.textContent = "Remove event";
    }
  }
  async handleStudentFormSubmit(submitEvent) {
    const dashboard = this;
    if (!dashboard.can('addStudents') || !dashboard.can('editStudents')) {
      submitEvent.preventDefault();
      return;
    }
    submitEvent.preventDefault();
    if (dashboard.studentAccountBusy) return;
    const uid = dashboard.document.querySelector("#originalStudentId").value;
    const student = {
      accountId: dashboard.document.querySelector("#managedStudentId").value.trim(),
      firstName: dashboard.document.querySelector("#managedFirstName").value.trim(),
      middleName: dashboard.document.querySelector("#managedMiddleName").value.trim(),
      lastName: dashboard.document.querySelector("#managedLastName").value.trim(),
      birthday: dashboard.document.querySelector("#managedBirthday").value,
      gender: GenderPolicy.normalize(dashboard.document.querySelector("#managedGender").value),
      course: CoursePolicy.normalize(dashboard.document.querySelector("#managedCourse").value),
      section: dashboard.document.querySelector("#managedSection").value,
      password: dashboard.document.querySelector("#managedPassword").value,
      email: dashboard.document.querySelector("#managedEmail").value.trim(),
      phone: dashboard.document.querySelector("#managedPhone").value.trim()
    };
    if (!/^[A-Za-z0-9._-]+$/.test(student.accountId)) {
      showDashboardToast("Invalid Student ID", "Use only letters, numbers, periods, underscores, or dashes.");
      return;
    }
    if (!uid) {
      try { student.password = StudentPasswordPolicy.birthdayPassword(student.birthday); }
      catch (error) { showDashboardToast('Birthday required', error.message); return; }
    }
    dashboard.studentAccountBusy = true;
    dashboard.document.querySelector('#studentSubmitButton').disabled = true;
    try {
      if (uid) {
        const studentIdKey = student.accountId.toLowerCase();
        const {
          password,
          ...profile
        } = student;
        const existingStudent = dashboard.students.find(s => s.uid === uid);
        const oldKey = (existingStudent?.accountIdKey || existingStudent?.accountId || "").toLowerCase();
        if (oldKey !== studentIdKey) {
          const idSnap = await getDoc(doc(db, "studentIds", studentIdKey));
          if (idSnap.exists() && idSnap.data().uid !== uid) {
            showDashboardToast("Student ID taken", "This Student ID is already registered by another student.");
            return;
          }
        }
        const studentBatch = writeBatch(db);
        studentBatch.set(doc(db, "students", uid), {
          ...profile,
          accountIdKey: studentIdKey,
          grade: deleteField(),
          adviser: deleteField(),
          updatedAt: serverTimestamp()
        }, {
          merge: true
        });
        if (oldKey !== studentIdKey) {
          if (oldKey) studentBatch.delete(doc(db, "studentIds", oldKey));
          studentBatch.set(doc(db, "studentIds", studentIdKey), {
            studentId: student.accountId,
            uid,
            createdAt: serverTimestamp()
          });
        }
        await studentBatch.commit();
      } else {
        const studentIdKey = student.accountId.toLowerCase();
        const idReference = doc(db, "studentIds", studentIdKey);
        const idSnapshot = await getDoc(idReference);
        if (idSnapshot.exists()) {
          const indexedUid = idSnapshot.data()?.uid;
          if (typeof indexedUid === "string" && indexedUid) {
            const indexedProfile = await getDoc(doc(db, "students", indexedUid));
            if (indexedProfile.exists()) {
              showDashboardToast("Student ID taken", "This Student ID is already registered by another student.");
              return;
            }
          }
          await deleteDoc(idReference);
        }
        const authEmail = studentIdToEmail(student.accountId);
        let credential;
        try {
          credential = await createUserWithEmailAndPassword(studentProvisioningAuth, authEmail, student.password);
          await updateProfile(credential.user, {
            displayName: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ")
          });
          const {
            password,
            ...profile
          } = student;
          const registration = writeBatch(db);
          registration.set(doc(db, "students", credential.user.uid), {
            ...profile,
            accountIdKey: studentIdKey,
            uid: credential.user.uid,
            authEmail,
            active: true,
            role: "student",
            mustChangePassword: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          registration.set(idReference, {
            studentId: student.accountId,
            uid: credential.user.uid,
            createdAt: serverTimestamp()
          });
          await registration.commit();
        } catch (error) {
          if (credential?.user) await deleteUser(credential.user).catch(() => {});
          throw error;
        } finally {
          await signOut(studentProvisioningAuth).catch(() => {});
        }
      }
      dashboard.resetStudentForm();
      openView("modify-students");
      showDashboardToast(uid ? "Student updated" : "Student created", uid ? `${student.accountId} was updated. The password is unchanged.` : `${student.accountId} can sign in with their birthday (MMDDYYYY), then create a new password.`);
    } catch (error) {
      console.error("FULL FIREBASE ERROR:", error);
      const messages = {
        "auth/email-already-in-use": "This Student ID already has a Firebase login. Remove it from Firebase Authentication, or use the student’s password to clear the account first.",
        "auth/invalid-email": "The Student ID could not be used as a login.",
        "auth/weak-password": "The password must contain at least 6 characters.",
        "permission-denied": "Registration was rejected. Deploy the latest Firestore rules, then try again.",
        "firestore/permission-denied": "Registration was rejected. Deploy the latest Firestore rules, then try again."
      };
      const message = messages[error.code] || error.message || "The student could not be saved.";
      showDashboardToast("Unable to save student", message);
    } finally {
      dashboard.studentAccountBusy = false;
      dashboard.document.querySelector('#studentSubmitButton').disabled = false;
    }
  }
  handleCancelStudentFormClick() {
    const dashboard = this;
    const editingUid = dashboard.document.querySelector("#originalStudentId").value;
    if (editingUid) {
      const studentToReset = dashboard.students.find(s => s.uid === editingUid);
      if (studentToReset) {
        dashboard.openRemoveModal(studentToReset);
        return;
      }
    }
    dashboard.resetStudentForm();
  }
  handleStudentTableBodyClick(clickEvent) {
    const dashboard = this;
    const view = clickEvent.target.closest("[data-view-student]");
    const passwordButton = clickEvent.target.closest("[data-password-student]");
    const remove = clickEvent.target.closest("[data-delete-student]");
    const resetFace = clickEvent.target.closest("[data-reset-face]");
    if (view) {
      dashboard.selectedManagedStudentUid = view.dataset.viewStudent;
      dashboard.renderSelectedStudent();
      dashboard.adminStudentDetail.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
    if (passwordButton) dashboard.openPasswordModal(dashboard.students.find(student => student.uid === passwordButton.dataset.passwordStudent));
    if (resetFace) dashboard.openResetFaceModal(dashboard.students.find(student => student.uid === resetFace.dataset.resetFace));
    if (remove) dashboard.openRemoveModal(dashboard.students.find(student => student.uid === remove.dataset.deleteStudent));
  }
  async handleStudentTableBodyChange(changeEvent) {
    const dashboard = this;
    const selector = changeEvent.target.closest("[data-role-select]");
    if (!selector || !dashboard.can('changeRoles')) return;
    const student = dashboard.students.find(item => item.uid === selector.dataset.roleSelect);
    if (!student) return;
    const pendingWrite = dashboard.pendingRoleWrites.get(student.uid);
    if (pendingWrite) {
      selector.value = pendingWrite.role;
      showDashboardToast("Role update still syncing", `${student.accountId}'s role change is still waiting for Firestore confirmation. Do not submit it again yet.`);
      return;
    }
    const previousRole = student.role || "student";
    const role = selector.value;
    dashboard.openRoleChangeModal(student, role, selector);
  }
  async handleConfirmRoleChangeClick() {
    const dashboard = this;
    if (!dashboard.can('changeRoles')) return;
    if (!dashboard.pendingRoleChange) return;
    const {
      student,
      role,
      previousRole,
      selector
    } = dashboard.pendingRoleChange;
    selector.disabled = true;
    dashboard.confirmRoleChange.disabled = true;
    dashboard.confirmRoleChange.textContent = "Updating role…";
    const roleWrite = setDoc(doc(db, "students", student.uid), {
      role,
      roleUpdatedAt: serverTimestamp(),
      roleUpdatedBy: currentUser.uid
    }, {
      merge: true
    });
    let syncTimer;
    try {
      const acknowledged = await Promise.race([roleWrite.then(() => true), new Promise(resolve => {
        syncTimer = dashboard.window.setTimeout(() => resolve(false), 10000);
      })]);
      if (!acknowledged) {
        dashboard.pendingRoleWrites.set(student.uid, {
          role,
          previousRole,
          selector
        });
        dashboard.pendingRoleChange = undefined;
        dashboard.roleChangeModal.hidden = true;
        showDashboardToast("Role update still syncing", `${student.accountId}'s change was queued locally and is waiting for Firestore. Do not submit it again; Presence will confirm once the server responds.`);
        roleWrite.then(() => {
          dashboard.pendingRoleWrites.delete(student.uid);
          showDashboardToast("Role updated", `${student.accountId} is now ${roleLabel(role)}. They must sign out and sign back in for the new access to apply.`);
        }).catch(error => {
          dashboard.pendingRoleWrites.delete(student.uid);
          if (selector.value === role) selector.value = previousRole;
          showDashboardToast("Unable to update role", roleChangeErrorMessage(error));
        });
        return;
      }
      dashboard.pendingRoleChange = undefined;
      dashboard.roleChangeModal.hidden = true;
      showDashboardToast("Role updated", `${student.accountId} is now ${roleLabel(role)}. They must sign out and sign back in for the new access to apply.`);
    } catch (error) {
      selector.value = previousRole;
      dashboard.pendingRoleChange = undefined;
      dashboard.roleChangeModal.hidden = true;
      showDashboardToast("Unable to update role", roleChangeErrorMessage(error));
    } finally {
      dashboard.window.clearTimeout(syncTimer);
      selector.disabled = false;
      dashboard.confirmRoleChange.disabled = false;
      dashboard.confirmRoleChange.textContent = "Update role";
    }
  }
  handleStudentMobileCardsClick(clickEvent) {
    const dashboard = this;
    const view = clickEvent.target.closest("[data-view-student]");
    if (!view) return;
    dashboard.selectedManagedStudentUid = view.dataset.viewStudent;
    dashboard.renderSelectedStudent();
    dashboard.adminStudentDetail.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
  handleAdminStudentDetailClick(clickEvent) {
    const dashboard = this;
    const close = clickEvent.target.closest("[data-close-student-detail]");
    const edit = clickEvent.target.closest("[data-edit-student]");
    const passwordButton = clickEvent.target.closest("[data-password-student]");
    const remove = clickEvent.target.closest("[data-delete-student]");
    const resetFace = clickEvent.target.closest("[data-reset-face]");
    const checkFines = clickEvent.target.closest("[data-check-student-fines]");
    const viewAbsences = clickEvent.target.closest("[data-view-student-absences]");
    if (close) {
      dashboard.selectedManagedStudentUid = undefined;
      dashboard.renderSelectedStudent();
    }
    if (edit) dashboard.editStudent(edit.dataset.editStudent);
    if (checkFines) dashboard.openAdminFineModal(dashboard.students.find(student => student.uid === checkFines.dataset.checkStudentFines), checkFines);
    if (viewAbsences) dashboard.openAdminAbsenceModal(dashboard.students.find(student => student.uid === viewAbsences.dataset.viewStudentAbsences), viewAbsences);
    if (passwordButton) dashboard.openPasswordModal(dashboard.students.find(student => student.uid === passwordButton.dataset.passwordStudent));
    if (resetFace) dashboard.openResetFaceModal(dashboard.students.find(student => student.uid === resetFace.dataset.resetFace));
    if (remove) dashboard.openRemoveModal(dashboard.students.find(student => student.uid === remove.dataset.deleteStudent));
  }
  handleManageStudentFinesClick() {
    const dashboard = this;
    if (!dashboard.can("manageFines")) return;
    const student = dashboard.students.find(item => item.uid === dashboard.selectedFineStudentUid);
    if (!student) return;
    dashboard.fineSearch.value = [student.firstName, student.middleName, student.lastName, student.accountId].filter(Boolean).join(" ");
    dashboard.adminFineModalController.close();
    openView("assigned-fines");
    dashboard.renderAdminFines();
  }
  handleWireStudentAccountActionsKeydown(event) {
    const dashboard = this;
    if (event.key === "Escape" && !dashboard.document.querySelector("#adminFineModal").hidden) dashboard.adminFineModalController.close();
  }
  handleWireStudentAccountActionsKeydown2(event) {
    const dashboard = this;
    if (event.key === "Escape" && !dashboard.document.querySelector("#adminAbsenceModal").hidden) dashboard.adminAbsenceModalController.close();
  }
  async handlePasswordChangeFormSubmit(submitEvent) {
    const dashboard = this;
    if (!dashboard.can('changePasswords')) {
      submitEvent.preventDefault();
      return;
    }
    submitEvent.preventDefault();
    if (!dashboard.selectedPasswordStudent) return;
    const currentPassword = dashboard.document.querySelector("#currentStudentPassword").value;
    const newPassword = dashboard.document.querySelector("#newStudentPassword").value;
    try {
      await signOut(studentProvisioningAuth).catch(() => {});
      const credential = await signInWithEmailAndPassword(studentProvisioningAuth, dashboard.selectedPasswordStudent.authEmail || studentIdToEmail(dashboard.selectedPasswordStudent.accountId), currentPassword);
      if (credential.user.uid !== dashboard.selectedPasswordStudent.uid) throw new Error("The current password does not match this student.");
      await updatePassword(credential.user, newPassword);
      await signOut(studentProvisioningAuth);
      const accountId = dashboard.selectedPasswordStudent.accountId;
      dashboard.closePasswordModal();
      showDashboardToast("Password changed", `${accountId} can now use the new password.`);
    } catch (error) {
      await signOut(studentProvisioningAuth).catch(() => {});
      const message = error.code === "auth/invalid-credential" ? "The current password is incorrect." : error.code === "auth/weak-password" ? "The new password must contain at least 6 characters." : error.message || "The password could not be changed.";
      showDashboardToast("Unable to change password", message);
    }
  }
  async handleConfirmRemoveStudentClick() {
    const dashboard = this;
    if (!dashboard.can('deleteStudents')) return;
    if (!dashboard.selectedRemovalStudent) return;
    const currentPassword = dashboard.document.querySelector("#removeStudentPassword").value.trim();
    if (currentPassword.length < 6) {
      showDashboardToast("Student password required", "Enter the student's current password before clearing the account.");
      dashboard.document.querySelector("#removeStudentPassword").focus();
      return;
    }
    const studentToRemove = dashboard.selectedRemovalStudent;
    const confirmButton = dashboard.document.querySelector("#confirmRemoveStudent");
    confirmButton.disabled = true;
    confirmButton.textContent = "Removing account…";
    try {
      await signOut(studentProvisioningAuth).catch(() => {});
      const credential = await signInWithEmailAndPassword(studentProvisioningAuth, studentToRemove.authEmail || studentIdToEmail(studentToRemove.accountId), currentPassword);
      if (credential.user.uid !== studentToRemove.uid) throw new Error("The password does not match this student account.");
      const [dismissedSnapshot, presenceSnapshot] = await Promise.all([getDocs(query(collection(db, "dismissedHistory"), where("studentUid", "==", studentToRemove.uid))), getDocs(query(collection(db, "presenceSessions"), where("studentUid", "==", studentToRemove.uid)))]);
      await deleteUser(credential.user);
      const cleanup = writeBatch(db);
      cleanup.delete(doc(db, "students", studentToRemove.uid));
      cleanup.delete(doc(db, "studentIds", studentToRemove.accountIdKey || studentToRemove.accountId.toLowerCase()));
      cleanup.delete(doc(db, "faceRegistrations", studentToRemove.uid));
      cleanup.delete(doc(db, "presence", studentToRemove.uid));
      dashboard.attendance.filter(record => record.studentUid === studentToRemove.uid).forEach(record => cleanup.delete(doc(db, "attendance", record.id)));
      dismissedSnapshot.docs.forEach(record => cleanup.delete(record.ref));
      presenceSnapshot.docs.forEach(record => cleanup.delete(record.ref));
      await cleanup.commit();
      await signOut(studentProvisioningAuth).catch(() => {});
      if (dashboard.selectedManagedStudentUid === studentToRemove.uid) dashboard.selectedManagedStudentUid = undefined;
      dashboard.resetStudentForm();
      dashboard.closeRemoveModal();
      showDashboardToast("Account Completely Removed", `${studentToRemove.accountId} and all saved student data were removed from Firebase.`);
    } catch (error) {
      await signOut(studentProvisioningAuth).catch(() => {});
      confirmButton.disabled = false;
      confirmButton.textContent = "Remove account completely";
      const message = error.code === "auth/invalid-credential" || error.code === "auth/wrong-password" ? "The current student password is incorrect." : error.message || "An error occurred while removing the account.";
      showDashboardToast("Unable to remove account", message);
    }
  }
  async handleConfirmResetFaceClick() {
    const dashboard = this;
    if (!dashboard.can('resetFace')) return;
    if (!dashboard.selectedFaceResetStudent || dashboard.faceResetPending) return;
    const studentToReset = dashboard.selectedFaceResetStudent;
    const confirmButton = dashboard.document.querySelector("#confirmResetFace");
    const options = { recoverMissing: dashboard.document.querySelector('#recoverMissingFace').checked,
      recoveryReason: dashboard.document.querySelector('#faceRecoveryReason').value.trim() };
    if (options.recoverMissing && options.recoveryReason.length < 10) {
      showDashboardToast('Recovery reason required', 'Explain how you verified removal (at least 10 characters).');
      return;
    }
    confirmButton.disabled = true;
    confirmButton.textContent = "Resetting…";
    dashboard.faceResetPending = true;
    try {
      const resetComplete = await dashboard.resetStudentFaceRegistration(studentToReset, options);
      if (resetComplete && dashboard.selectedFaceResetStudent === studentToReset) dashboard.closeResetFaceModal();
    } catch (error) {
      showDashboardToast("Unable to reset face", error.message || "Refresh student status before retrying.");
    } finally {
      dashboard.faceResetPending = false;
      confirmButton.disabled = false;
      confirmButton.textContent = "Reset face registration";
    }
  }
  handlePasswordModalClick(event) {
    const dashboard = this;
    if (event.target === dashboard.passwordModal) dashboard.closePasswordModal();
  }
  handleRemoveStudentModalClick(event) {
    const dashboard = this;
    if (event.target === dashboard.removeStudentModal) dashboard.closeRemoveModal();
  }
  handleResetFaceModalClick(event) {
    const dashboard = this;
    if (event.target === dashboard.resetFaceModal) dashboard.closeResetFaceModal();
  }
  handleWireStudentAccountActionsKeydown3(event) {
    const dashboard = this;
    if (event.key !== "Escape") return;
    if (!dashboard.passwordModal.hidden) dashboard.closePasswordModal();
    if (!dashboard.removeStudentModal.hidden) dashboard.closeRemoveModal();
    if (!dashboard.resetFaceModal.hidden) dashboard.closeResetFaceModal();
  }
  handleClearStudentFiltersClick() {
    const dashboard = this;
    dashboard.studentSearch.value = "";
    dashboard.studentCourseFilter.value = "all";
    dashboard.studentSectionPicker.reset();
    dashboard.studentFaceFilter.value = "all";
    dashboard.studentAccountFilter.value = "all";
    dashboard.studentAttendanceFilter.value = "all";
    dashboard.studentFineFilter.value = "all";
    dashboard.studentSort.value = "name";
    dashboard.resetStudentDirectoryPage();
  }
  handlePreviousStudentPageClick() {
    const dashboard = this;
    if (dashboard.studentPage <= 1) return;
    dashboard.studentPage -= 1;
    dashboard.renderStudents();
  }
  handleNextStudentPageClick() {
    const dashboard = this;
    dashboard.studentPage += 1;
    dashboard.renderStudents();
  }
  async handleRefreshStudentStatusClick(event) {
    const dashboard = this;
    const button = event.currentTarget;
    const originalText = button.textContent;
    button.disabled = true;
    button.classList.add("is-refreshing");
    button.textContent = "↻ Refreshing…";
    try {
      const [studentSnapshot, presenceSnapshot, legacyPresenceSnapshot, attendanceSnapshot] = await Promise.all([getDocsFromServer(collection(db, "students")), getDocsFromServer(collection(db, "presenceSessions")), getDocsFromServer(collection(db, "presence")), getDocsFromServer(collection(db, "attendance"))]);
      dashboard.students = studentSnapshot.docs.map(item => CoursePolicy.profile({
        uid: item.id,
        ...item.data()
      }));
      dashboard.setPresenceSessions(presenceSnapshot);
      dashboard.legacyPresenceByUid = new Map(legacyPresenceSnapshot.docs.map(item => [item.id, item.data()]));
      dashboard.attendance = attendanceSnapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));
      dashboard.renderStudents();
      showDashboardToast("Student status refreshed", "Online, offline, and last-active information is up to date.");
    } catch (error) {
      showDashboardToast("Unable to refresh status", error.code === "permission-denied" ? "Publish the latest database rules first." : "Check your internet connection and try again.");
    } finally {
      button.disabled = false;
      button.classList.remove("is-refreshing");
      button.textContent = originalText;
    }
  }
  handleWireDirectoryFiltersPresenceViewchange(event) {
    const dashboard = this;
    const viewName = event.detail?.viewName;
    if (viewName === "dashboard") {
      dashboard.renderAdminAttendance();
      dashboard.renderAdminEvents();
      dashboard.renderAttendanceLine();
    }
    if (viewName === "attendance-line") dashboard.renderAttendanceLine();
    if (viewName === "modify-students") dashboard.scheduleStudentsRender();
    if (viewName === "modify-events") dashboard.renderAdminEvents();
    if (viewName === "past-events") dashboard.renderPastEvents();
    if (viewName === "geofence") {
      dashboard.renderGeofenceEventOptions();
      dashboard.loadGeofenceManager();
    }
    if (viewName === "assign-fine") dashboard.renderFineOptions();
    if (viewName === "assigned-fines") dashboard.renderAdminFines();
  }
}
