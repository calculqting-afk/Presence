// The server remains authoritative. Deterministic IDs + preflight/reconciliation
// make retries safe without allowing a student to overwrite a check-in.
export class AttendanceSubmissionService {
  constructor({ read, write, onWaiting = () => {}, waitMs = 12000 }) {
    Object.assign(this, { read, write, onWaiting, waitMs }); this.pending = new Set();
  }
  async submit({ reference, matches, payload, options, validatePrevious = () => {} }) {
    if (this.pending.has(reference.id)) return { state: 'busy' };
    this.pending.add(reference.id);
    try {
      let previous;
      try { previous = await this.read(reference); }
      catch (error) { error.attendanceStage = 'preflight'; throw error; }
      if (previous.exists() && matches(previous.data())) return { state: 'existing', snapshot: previous };
      validatePrevious(previous);
      const timer = setTimeout(() => this.onWaiting(reference), this.waitMs);
      try { await this.write(reference, payload, options); }
      catch (error) {
        // Another tab may have won the write, or the acknowledgement was lost.
        try {
          const saved = await this.read(reference);
          if (saved.exists() && matches(saved.data())) return { state: 'existing', snapshot: saved };
        } catch {
          if (['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(error.code)) return { state: 'unknown' };
        }
        error.attendanceStage = 'write';
        throw error;
      } finally { clearTimeout(timer); }
      try {
        const saved = await this.read(reference);
        if (saved.exists() && matches(saved.data())) return { state: 'saved', snapshot: saved };
      } catch { /* The acknowledged write succeeded even if the extra read failed. */ }
      return { state: 'confirmation-pending' };
    } finally { this.pending.delete(reference.id); }
  }
}
