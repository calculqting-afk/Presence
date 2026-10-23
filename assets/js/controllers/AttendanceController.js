import { collection, onSnapshot, getDocsFromServer } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db } from '../../../config/firebase-config.js?v=20261005-operational-reset';
import { currentUser, currentUserRole, formatEventTime } from '../dashboard.js?v=20261011-optimized';

export class AttendancePolicy {
  constructor(windows) { this.windows = windows; }

  evaluateCheckIn(event, now = new Date()) {
    const { eventOpenDate, eventCheckInCloseDate, eventCheckoutCloseDate } = this.windows;
    if (!event) return { available: false, reason: 'not-open' };
    if (event.checkoutOnlyReopened === true) return { available: false, reason: 'checkout-only-reopened' };
    const open = eventOpenDate(event);
    const lateAfter = eventCheckInCloseDate(event);
    const checkoutClose = eventCheckoutCloseDate(event);
    if (![open, lateAfter, checkoutClose, now].every(value => Number.isFinite(value?.getTime?.())) || open >= lateAfter || lateAfter > checkoutClose) return { available: false, reason: 'invalid-window' };
    if (now < open) return { available: false, reason: "not-open" };
    if (now > checkoutClose) return { available: false, reason: "check-in-closed" };
    return { available: true, arrivalStatus: now >= lateAfter ? "late" : "present" };
  }
}

export class LateCheckInModal {
  constructor(modal) {
    this.modal = modal;
    this.message = modal.querySelector("#lateCheckInMessage");
    this.cancelButton = modal.querySelector("[data-cancel-late-check-in]");
    this.confirmButton = modal.querySelector("#confirmLateCheckIn");
    this.resolve = null;
    const cancel = () => this.close(false);
    this.cancelButton.addEventListener("click", cancel);
    modal.addEventListener("click", (event) => { if (event.target === modal) cancel(); });
    this.confirmButton.addEventListener("click", () => this.close(true));
  }

  open(event, trigger) {
    const cutoff = formatEventTime(event.checkInCutoff || event.timeOut);
    this.trigger = trigger;
    this.message.textContent = `The check-in cutoff was ${cutoff}. Continuing will record your attendance as Late.`;
    this.modal.hidden = false;
    this.confirmButton.focus();
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  close(confirmed) {
    if (this.modal.hidden) return;
    this.modal.hidden = true;
    this.resolve?.(confirmed);
    this.resolve = null;
    if (!confirmed) this.trigger?.focus();
  }
}

export class AttendanceCheckInController {
  constructor({ policy, lateModal }) {
    this.policy = policy;
    this.lateModal = lateModal;
  }

  async begin(event, trigger) {
    const result = this.policy.evaluateCheckIn(event);
    if (!result.available) return result;
    if (result.arrivalStatus === "late" && !(await this.lateModal.open(event, trigger))) return { available: false, cancelled: true };
    return this.policy.evaluateCheckIn(event);
  }
}

export class AttendanceSyncService {
  constructor({ onRecords, onStatus, reference = collection(db, "attendance"), timeoutMs = 15000,
    schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
    cancel = timer => globalThis.clearTimeout(timer) }) {
    Object.assign(this, { timeoutMs, schedule, cancel });
    this.onRecords = onRecords;
    this.onStatus = onStatus;
    this.reference = reference;
    this.unsubscribe = null;
    this.generation = 0;
  }

  start(reference = this.reference) {
    this.stop();
    this.reference = reference;
    const generation = ++this.generation;
    this.onStatus({ state: "connecting" });
    this.cancel(this.verificationTimer);
    this.verificationTimer = this.schedule(() => {
      if (generation === this.generation) this.onStatus({ state: 'error', error: new Error('Attendance verification timed out. Please retry.') });
    }, this.timeoutMs);
    this.verificationTimer?.unref?.();
    this.unsubscribe = onSnapshot(this.reference, { includeMetadataChanges: true }, (snapshot) => {
      if (generation !== this.generation) return;
      if (!snapshot.metadata.fromCache) this.cancel(this.verificationTimer);
      this.onRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      this.onStatus({ state: snapshot.metadata.fromCache ? "cached" : "live", syncedAt: new Date() });
    }, (error) => { this.cancel(this.verificationTimer); if (generation === this.generation) this.onStatus({ state: "error", error }); });
  }

  async syncNow() {
    if (this.pendingSync) return this.pendingSync;
    this.pendingSync = this.verifyNow();
    try { return await this.pendingSync; } finally { this.pendingSync = null; }
  }
  async verifyNow() {
    const generation = this.generation;
    this.onStatus({ state: "syncing" });
    let tokenResult;
    try {
      // Force a fresh ID token so recent sign-in or account changes are reflected
      // when Firestore evaluates the Super Admin / Head Admin Rules.
      const request = async () => {
        tokenResult = await currentUser?.getIdTokenResult(true);
        return getDocsFromServer(this.reference);
      };
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = this.schedule(() => reject(new Error('Attendance verification timed out. Please retry.')), this.timeoutMs);
        timer?.unref?.();
      });
      let snapshot;
      try { snapshot = await Promise.race([request(), deadline]); } finally { this.cancel(timer); }
      if (generation !== this.generation) return;
      this.onRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      this.cancel(this.verificationTimer);
      this.onStatus({ state: "live", syncedAt: new Date() });
    } catch (error) {
      console.error("ATTENDANCE SYNC FAILED", {
        code: error?.code,
        message: error?.message,
        signedInEmail: currentUser?.email || "unknown",
        tokenEmail: tokenResult?.claims?.email || "missing",
        tokenUserId: tokenResult?.claims?.user_id || "missing",
        role: currentUserRole,
        projectId: "presence-a873f"
      });
      if (generation === this.generation) this.onStatus({ state: "error", error });
      throw error;
    }
  }

  stop() {
    ++this.generation;
    this.cancel(this.verificationTimer);
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

export class AttendanceRealtimeBridge {
  constructor(onRecord = () => {}) {
    this.channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("presence-attendance");
    if (this.channel) this.channel.addEventListener("message", (event) => {
      if (event.data?.type === "attendance-saved" && event.data.record?.id) onRecord(event.data.record);
    });
  }

  publish(id, record) {
    if (!this.channel) return;
    const toMillis = (value) => value?.toMillis?.() || (value instanceof Date ? value.getTime() : null);
    this.channel.postMessage({
      type: "attendance-saved",
      record: {
        ...record,
        id,
        attendedAt: toMillis(record.attendedAt),
        checkedInAt: toMillis(record.checkedInAt),
        checkedOutAt: toMillis(record.checkedOutAt)
      }
    });
  }

  close() {
    this.channel?.close();
  }
}
