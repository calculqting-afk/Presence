// Local-only timings exposed through the browser Performance panel/API.
export class DashboardPerformanceController {
  constructor({ role, performance = globalThis.performance } = {}) {
    Object.assign(this, { role, performance }); this.pending = new Set();
  }
  start(stage) {
    if (this.pending.has(stage)) return;
    this.pending.add(stage);
    this.performance?.mark?.(`presence:${this.role}:${stage}:start`);
  }
  finish(stage) {
    if (!this.pending.delete(stage)) return;
    const name = `presence:${this.role}:${stage}`;
    try {
      this.performance?.mark?.(`${name}:end`);
      this.performance?.measure?.(name, `${name}:start`, `${name}:end`);
      this.performance?.clearMarks?.(`${name}:start`); this.performance?.clearMarks?.(`${name}:end`);
    } catch {}
  }
}
