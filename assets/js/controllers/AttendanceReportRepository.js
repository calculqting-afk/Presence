import { collection, doc, query, where, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

// A report must verify the complete event, not the Attendance Line's paged window.
export class AttendanceReportRepository {
  static maximumRecords = 5000;
  constructor(db) { this.db = db; }
  watch(eventId, eventIds, receive, fail) {
    if (!eventId || eventIds.length > 30) throw new Error('Too many duplicate event schedules. Review the events before exporting.');
    const stops = [];
    try {
      stops.push(onSnapshot(doc(this.db, 'events', eventId), { includeMetadataChanges: true }, snapshot => {
        receive({ kind: 'event', exists: snapshot.exists(), event: snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null,
          verified: !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites });
      }, fail));
      const filter = eventIds.length === 1 ? where('eventId', '==', eventId) : where('eventId', 'in', eventIds);
      stops.push(onSnapshot(query(collection(this.db, 'attendance'), filter, limit(AttendanceReportRepository.maximumRecords + 1)),
        { includeMetadataChanges: true }, snapshot => receive({ kind: 'attendance',
          records: snapshot.docs.map(item => ({ ...item.data(), id: item.id })),
          verified: !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites,
          oversized: snapshot.docs.length > AttendanceReportRepository.maximumRecords
        }), fail));
    } catch (error) { stops.forEach(stop => stop()); throw error; }
    return () => stops.forEach(stop => stop());
  }
}
