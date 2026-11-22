import { collection, doc, query, where, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

// A report must verify the complete event, not the Attendance Line's paged window.
export class AttendanceReportRepository {
  static maximumRecords = 5000;
  constructor(db) { this.db = db; }
  watchSessions(sessions, idsFor, receive, fail) {
    const events = new Map(), records = new Map(), stops = [];
    try {
      for (const session of sessions) stops.push(this.watch(session.id, idsFor(session), update => {
        if (update.kind === 'event') {
          events.set(session.id, update);
          receive({ kind: 'event', exists: [...events.values()].every(item => item.exists),
            event: events.get(sessions[0].id)?.event || null,
            events: sessions.map(item => events.get(item.id)?.event).filter(Boolean),
            verified: events.size === sessions.length && [...events.values()].every(item => item.verified && item.exists) });
        } else {
          records.set(session.id, update);
          const combined = sessions.flatMap(item => (records.get(item.id)?.records || []).map(record => ({ ...record, reportSessionId: item.id })));
          receive({ kind: 'attendance', records: combined,
            verified: records.size === sessions.length && [...records.values()].every(item => item.verified),
            oversized: combined.length > AttendanceReportRepository.maximumRecords || [...records.values()].some(item => item.oversized) });
        }
      }, fail));
    } catch (error) { stops.forEach(stop => stop()); throw error; }
    return () => stops.forEach(stop => stop());
  }
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
