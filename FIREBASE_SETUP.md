# Presence Firebase setup

The browser app is configured for the Firebase project `presence-a873f`.

## One-time Firebase Console setup

1. In **Authentication → Sign-in method**, enable **Email/Password**.
2. Create the Cloud Firestore database.
3. In **Authentication → Users**, create the administrator using `mikhailovna2007@gmail.com` and a private strong password.

That exact email is the single administrator identity. No `admins/{UID}` document is needed, so deleting and recreating the account with the same email will not break administrator access. Do not enable public account registration.

If the administrator email changes later, update `ADMIN_EMAIL` in `firebase-config.js` and update the email in `firestore.rules`, then redeploy.

## Deploy

Install the Firebase CLI, sign in, then from this folder run:

```text
firebase deploy --only firestore:rules,hosting
```

This version works on Firebase's Spark plan and does not use Cloud Functions.

## Account behavior

- Administrators sign in with their Firebase email and password.
- Students sign in with the Student ID and password created by an administrator.
- The admin dashboard uses a separate Firebase Auth session to create student login accounts without signing out the administrator.
- Firestore rules allow only the configured administrator email to create, modify, or remove authorized student profiles.
- On the Spark plan, changing a student's password or deleting their Authentication account must be done in **Firebase Console → Authentication → Users**. Removing a student in the dashboard immediately removes their app access, even if their unused Authentication account remains.
- Authentication accounts created outside the admin panel do not become students automatically.
- Never place an administrator password or a Firebase Admin service-account key in frontend files.
