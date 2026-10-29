import { auth, db, studentIdToEmail } from '../../../config/firebase-config.js';
import { hasSuperAdminClaim } from '../core/SuperAdminAuthority.js';
import { browserLocalPersistence, browserSessionPersistence, setPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { doc, getDocFromServer } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

/** Authentication/profile access only; no DOM, navigation, or UI state. */
export class LoginSessionService {
  constructor({ auth: authentication = auth,
    studentEmail = studentIdToEmail, loadStudent = uid => getDocFromServer(doc(db, 'students', uid)),
    persist = setPersistence, localPersistence = browserLocalPersistence,
    sessionPersistence = browserSessionPersistence, signIn = signInWithEmailAndPassword,
    logOut = signOut, subscribe = onAuthStateChanged } = {}) {
    Object.assign(this, { auth: authentication, studentEmail, loadStudent,
      persist, localPersistence, sessionPersistence, signIn, logOut, subscribe });
  }

  isSuperAdmin(user) { return hasSuperAdminClaim(user); }

  async resolveExistingRole(user) {
    if (await this.isSuperAdmin(user)) return 'admin';
    const snapshot = await this.loadStudent(user.uid);
    const profile = snapshot.data();
    if (!snapshot.exists() || profile.active !== true) return null;
    if (['head_admin', 'attendance_admin', 'student_manager'].includes(profile.role)) return 'admin';
    return !profile.role || ['student','viewer'].includes(profile.role) ? 'student' : null;
  }

  async authenticate({ accountId, password, remember, completeRegistration }) {
    await this.persist(this.auth, remember ? this.localPersistence : this.sessionPersistence);
    const email = accountId.includes('@') ? accountId : this.studentEmail(accountId);
    const credential = await this.signIn(this.auth, email, password);
    const user = credential.user;
    const isSuperAdmin = await this.isSuperAdmin(user);
    let profile = {}, role = 'admin';
    if (!isSuperAdmin) {
      let snapshot = await this.loadStudent(user.uid);
      if (!snapshot.exists()) {
        const completed = await completeRegistration({ user, accountId });
        if (completed) snapshot = await this.loadStudent(user.uid);
      }
      profile = snapshot.data() || {};
      if(!snapshot.exists()||profile.active!==true){await this.logOut(this.auth);throw new Error('This account is not a registered student.');}
      const assignedRole = profile.role === 'viewer' ? 'student' : profile.role || 'student';
      if(!['student','head_admin','attendance_admin','student_manager'].includes(assignedRole)){await this.logOut(this.auth);throw new Error('This account has an unsupported role. Contact an administrator.');}
      if (['head_admin', 'attendance_admin', 'student_manager'].includes(assignedRole)) role = 'admin';
      else if (snapshot.exists() && profile.active === true) role = 'student';
      else {
        await this.logOut(this.auth);
        throw new Error('This account is not a registered student.');
      }
    }
    return { user, profile, session: {
      role, uid: user.uid, accountId: role === 'student' ? profile.accountId : '',
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
