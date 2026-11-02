// Owns listener lifetimes and ignores callbacks from a previous view.
export class ScopedSubscriptions {
  constructor({ onError = console.error, isEnabled = () => true, linger = () => 0,
    schedule = (callback, delay) => setTimeout(callback, delay), cancel = timer => clearTimeout(timer) } = {}) {
    this.entries = new Map();
    this.view = null;
    this.onError = onError;
    this.isEnabled = isEnabled;
    Object.assign(this, { linger, schedule, cancel });
  }

  register(key, views, subscribe) {
    if (this.entries.has(key)) throw new Error(`Duplicate subscription: ${key}`);
    this.entries.set(key, { views, subscribe, unsubscribe: null, generation: 0 });
    if (this.view !== null) this.setView(this.view);
  }

  setView(view) {
    this.view = view;
    for (const [key, entry] of this.entries) {
      const needed = this.isEnabled(key) && (entry.views.includes('*') || entry.views.includes(view));
      if (needed && entry.stopTimer != null) { this.cancel(entry.stopTimer); entry.stopTimer = null; }
      if (needed && !entry.unsubscribe) {
        const generation = ++entry.generation;
        const guard = callback => (...args) => {
          if (entry.generation === generation) callback(...args);
        };
        try {
          entry.unsubscribe = entry.subscribe(guard, guard(error => this.onError(error, key))) || (() => {});
        } catch (error) {
          this.onError(error, key);
        }
      } else if (!needed && entry.unsubscribe) {
        const delay = this.isEnabled(key) ? this.linger(key) : 0;
        if (delay > 0) {
          if (entry.stopTimer == null) entry.stopTimer = this.schedule(() => {
            entry.stopTimer = null; ++entry.generation; entry.unsubscribe?.(); entry.unsubscribe = null;
          }, delay);
          continue;
        }
        ++entry.generation;
        entry.unsubscribe();
        entry.unsubscribe = null;
      }
    }
  }

  stop() {
    for (const entry of this.entries.values()) {
      if (entry.stopTimer != null) this.cancel(entry.stopTimer);
      entry.stopTimer = null;
      ++entry.generation;
      entry.unsubscribe?.();
      entry.unsubscribe = null;
    }
    this.view = null;
  }
}
