import { SUPER_ADMIN_EMAIL, auth, db, studentIdToEmail } from '../../../config/firebase-config.js';
import { browserLocalPersistence, browserSessionPersistence, setPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

/** Authentication/profile access only; no DOM, navigation, or UI state. */
export class LoginSessionService {
  constructor({ auth: authentication = auth, superAdminEmail = SUPER_ADMIN_EMAIL,
    studentEmail = studentIdToEmail, loadStudent = uid => getDoc(doc(db, 'students', uid)),
    persist = setPersistence, localPersistence = browserLocalPersistence,
    sessionPersistence = browserSessionPersistence, signIn = signInWithEmailAndPassword,
    logOut = signOut, subscribe = onAuthStateChanged } = {}) {
    Object.assign(this, { auth: authentication, superAdminEmail, studentEmail, loadStudent,
      persist, localPersistence, sessionPersistence, signIn, logOut, subscribe });
  }

  isSuperAdmin(user) { return user.email?.toLowerCase() === this.superAdminEmail; }

  async resolveExistingRole(user) {
    if (this.isSuperAdmin(user)) return 'admin';
    const snapshot = await this.loadStudent(user.uid);
    const profile = snapshot.data();
    if (!snapshot.exists() || profile.active !== true) return null;
    return ['head_admin', 'attendance_admin', 'student_manager'].includes(profile.role) ? 'admin' : 'student';
  }

  async authenticate({ accountId, password, remember, completeRegistration }) {
    await this.persist(this.auth, remember ? this.localPersistence : this.sessionPersistence);
    const email = accountId.includes('@') ? accountId : this.studentEmail(accountId);
    const credential = await this.signIn(this.auth, email, password);
    const user = credential.user;
    const isSuperAdmin = this.isSuperAdmin(user);
    let profile = {}, role = 'admin';
    if (!isSuperAdmin) {
      let snapshot = await this.loadStudent(user.uid);
      if (!snapshot.exists()) {
        const completed = await completeRegistration({ user, accountId });
        if (completed) snapshot = await this.loadStudent(user.uid);
      }
      profile = snapshot.data() || {};
      const assignedRole = profile.role === 'viewer' ? 'student' : profile.role || 'student';
      if (['head_admin', 'attendance_admin', 'student_manager'].includes(assignedRole)) role = 'admin';
      else if (snapshot.exists() && profile.active === true) role = 'student';
      else {
        await this.logOut(this.auth);
        throw new Error('This account is not a registered student.');
      }
    }
    return { user, profile, session: {
      role, uid: user.uid, accountId: role === 'student' ? profile.accountId : user.email,
      assignedRole: isSuperAdmin ? 'super_admin' : profile.role === 'viewer' ? 'student' : profile.role || 'student'
    } };
  }

  errorMessage(error) {
    const permissionDenied = ['permission-denied', 'firestore/permission-denied'].includes(error.code)
      || error.message?.toLowerCase().includes('insufficient permissions');
    return error.code === 'auth/invalid-credential' ? 'The account or password is incorrect.'
      : error.code === 'auth/too-many-requests' ? 'Too many attempts. Please wait and try again.'
        : permissionDenied ? 'Password accepted, but the latest Firestore rules have not been published yet.'
          : error.message || 'Unable to sign in right now.';
  }
}
