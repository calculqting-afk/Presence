# Presence Firebase setup

The browser app is configured for the Firebase project `presence-a873f`.

## One-time Firebase Console setup

1. In **Authentication → Sign-in method**, enable **Email/Password**.
2. Create the Cloud Firestore database.
3. In **Authentication → Users**, preserve the existing Super Admin account and its UID. Use its private email and strong password to sign in.

The pinned UID in `SUPER_ADMIN_UID`, Firestore Rules and backend services identifies the Super Admin. The UID is a public identifier, not a credential; Google-verified authentication establishes ownership. An email address, display name or profile role of `super_admin` cannot grant this access. Deleting/recreating an account gives it a different UID and does not restore Super Admin privileges. The Super Admin can assign Head Admin, Attendance Admin, Student Manager, or Student roles; Viewer is not a supported new role.

Changing the existing account's email does not change its UID or require publishing the address in configuration. Do not change the pinned UID without a deliberate administrator migration across Rules, frontend and backend services.

## Deploy

Install the Firebase CLI, sign in, then from this folder run:

```text
firebase deploy --only firestore:rules,hosting
```

This version works on Firebase's Spark plan and does not require Cloud Functions.

## Account behavior

- Administrators sign in with their Firebase email and password.
- Students sign in with the Student ID and password created by an administrator.
- The admin dashboard uses a separate Firebase Authentication session to create student login accounts without signing out the administrator.
- Firestore rules reserve role assignment, the protected administrator profile, and audit logs for the configured Super Admin. Head Admin is an alternate operational role for events, attendance, and student management.
- Removing a student deletes their Authentication account, Firestore profile, Student ID reservation, attendance, dismissed history, face registration, and presence records after the administrator enters the student's current password.
- If an account was partially removed and only its Firebase Authentication login remains, remove that login from **Firebase Console → Authentication → Users** before registering the Student ID again.
- Authentication accounts created outside the admin panel do not become students automatically.
- Never place an administrator password or a Firebase Admin service-account key in frontend files.
