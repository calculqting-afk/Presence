export class DashboardSessionService {
  constructor({
    auth,
    subscribe,
    loadStudent,
    superAdminEmail,
    dashboardRole,
    onState
  }) {
    Object.assign(this, {
      auth,
      subscribe,
      loadStudent,
      superAdminEmail,
      dashboardRole,
      onState
    });
    this.user = null;
    this.role = 'student';
    this.profile = {};
    this.unsubscribe = null;
    this.generation = 0;
  }
  waitForUser() {
    return new Promise(resolve => {
      this.resolve = resolve;
      // Handle test/adapters that invoke the initial callback synchronously too.
      let received = false;
      const unsubscribe = this.subscribe(this.auth, user => {
        received = true;
        this.user = user;
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.resolve = null;
        resolve(user);
      });
      if (received) unsubscribe();else this.unsubscribe = unsubscribe;
    });
  }
  async verifyRole(user) {
    if (!user) return false;
    const generation = ++this.generation;
    const isSuperAdmin = user.email?.toLowerCase() === this.superAdminEmail;
    const snapshot = isSuperAdmin ? null : await this.loadStudent(user.uid);
    if (generation !== this.generation) return false;
    this.user = user;
    this.profile = snapshot?.data() || {};
    const storedRole = this.profile.role || 'student';
    this.role = isSuperAdmin ? 'super_admin' : storedRole === 'viewer' ? 'student' : storedRole;
    this.onState?.({
      user: this.user,
      profile: this.profile,
      role: this.role
    });
    return this.dashboardRole === 'admin' ? ['super_admin', 'head_admin', 'attendance_admin', 'student_manager'].includes(this.role) : this.role === 'student' && snapshot.exists() && this.profile.active === true;
  }
  dispose() {
    this.generation++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resolve?.(null);
    this.resolve = null;
  }
}
