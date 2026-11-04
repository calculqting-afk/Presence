import { getCountFromServer } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

// Full request documents are subscribed only while their page is visible.
// Closed pages use an aggregate count at most once every five minutes.
export class PendingRequestsWatch {
  constructor({ document, window = document?.defaultView, view, currentView = () => '', reference, count, open, close, now = () => Date.now() }) {
    Object.assign(this, { document, window, view, currentView, reference, count, open, close, now });
    this.changed = event => { this.viewName = event.detail.viewName; this.update(); };
    this.visibility = () => this.update();
  }
  initialize() {
    this.alive = true;
    this.viewName = this.currentView();
    this.window?.addEventListener('presence:viewchange', this.changed);
    this.document?.addEventListener?.('visibilitychange', this.visibility);
    this.timer = this.window?.setInterval(() => this.update(), 300000);
    this.update();
  }
  update() {
    if (!this.alive) return;
    const active = this.document?.visibilityState !== 'hidden' && this.viewName === this.view;
    if (active !== this.active) { this.active = active; if (active) this.open(); else this.close(); }
    if (!active && this.document?.visibilityState !== 'hidden') void this.refresh();
  }
  async refresh() {
    if (!this.alive || this.busy || this.lastRead !== undefined && this.now() - this.lastRead < 300000) return;
    this.busy = true; this.lastRead = this.now();
    try {
      const snapshot = await getCountFromServer(this.reference);
      if (this.alive && !this.active) this.count(snapshot.data().count);
    } catch { /* A failed count is not proof that there are zero pending requests. */ }
    finally { this.busy = false; }
  }
  dispose() {
    this.alive = false; this.close();
    this.window?.clearInterval(this.timer);
    this.window?.removeEventListener('presence:viewchange', this.changed);
    this.document?.removeEventListener?.('visibilitychange', this.visibility);
  }
}
