# Presence Firebase setup

The browser app is configured for the Firebase project `presence-a873f`.

## One-time Firebase Console setup

1. In **Authentication → Sign-in method**, enable **Email/Password**.
2. Create the Cloud Firestore database.
3. In **Authentication → Users**, create the Super Admin using `mikhailovna2007@gmail.com` and a private strong password.

That exact email is the protected Super Admin identity. No `admins/{UID}` document is needed, so deleting and recreating the account with the same email will not break administrator access. Do not enable public account registration. The Super Admin can assign Head Admin, Attendance Admin, Student Manager, or Student roles; Viewer is not a supported role.

If the Super Admin email changes later, update `SUPER_ADMIN_EMAIL` in `config/firebase-config.js` and update the email in `firestore.rules`, then redeploy.

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
