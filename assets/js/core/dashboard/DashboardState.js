/** Single owner for shared session/view state; export adapters are read-only snapshots. */
export class DashboardState {
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    this.user = undefined;
    this.role = 'student';
    this.profile = {};
    this.activeView = undefined;
    this.previousView = 'dashboard';
    this.mediaStream = null;
    this.presenceHeartbeatTimer = null;
    this.presenceSessionId = null;
    this.presenceWrite = null;
    this.studentLoggedOut = false;
    this.dashboard = null;
  }
  setSession(session) {
    for (const key of ['user', 'role', 'profile']) if (key in session) this[key] = session[key];
    this.onChange(this);
  }
  setView(view) {
    for (const key of ['activeView', 'previousView']) if (key in view) this[key] = view[key];
    this.onChange(this);
  }
}
