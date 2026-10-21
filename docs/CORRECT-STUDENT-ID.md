# Correct a student's login Student ID locally

This terminal helper updates the Firebase Authentication email and the registered student profile/ID index while keeping the UID and password. Attendance, fines, face registration and historical Student ID snapshots are not rewritten. Only registered, active student accounts are supported; pending/declined registrations and staff accounts require separate review.

## Setup

Use Node.js 22 and install the existing Admin SDK dependency:

```powershell
npm.cmd --prefix functions install
```

Use a private service-account JSON for `presence-a873f` with permission to manage Authentication users and Firestore data. Store it outside this repository and never upload it or share it. This is trusted admin access, not a student's sign-in or a web admin session. Spark does not require a billing upgrade to run this local script. Installing dependencies does not deploy Functions.

The helper also accepts `serviceAccountPath` in `.android-tools/student-id-helper.config.json`. That local configuration is ignored by Git and stores only the path, not the key contents. If configured, no environment variable is needed. `PRESENCE_SERVICE_ACCOUNT_KEY` overrides the local configuration. Update the path if you move the credential file.

```powershell
$env:PRESENCE_SERVICE_ACCOUNT_KEY = 'C:\Private\presence-service-account.json'
node tools/correct-student-id.cjs --old 25100044-1 --new 2510004-1 --dry-run
node tools/correct-student-id.cjs --old 25100044-1 --new 2510004-1
```

Review the name, UID and correction, then type `CHANGE 25100044-1 TO 2510004-1`. Cancellation and dry-run perform no writes. The actual command changes the account in production; the examples are not automatically executed.

The helper rejects duplicate/reserved IDs, conflicting Auth emails, profile/index mismatches, disabled accounts and conflicting registration requests. It preserves the password and UID. Existing approved registration metadata is moved to the corrected ID so status lookup still works. Ask the student to sign out and sign in with the corrected ID; previously issued sessions are not forcibly revoked.

## Partial failure / recovery

Authentication and Firestore do not share a transaction. The helper reserves the new ID and creates a `studentIdCorrections` journal and a `studentIdCorrectionLocks` lock before changing Authentication. Both collections are denied to clients by the existing catch-all rules; only trusted Admin access is used here.

If interrupted, rerun the **same old/new command**. It recognizes an already changed Auth email and completes the Firestore transaction. If the prior attempt committed but its response was lost, it verifies the completed journal instead of starting over. Do not delete or manually replace reservations/locks/journals, run a different correction for the same UID, or edit that student's profile while recovering. A timeout may leave either the old or new login active until recovery finishes. Unexpected competing changes require manual review; errors never claim success.

No new website/APK or Rules deployment is needed. Admin SDK credentials bypass client Rules. Do not run this helper on an untrusted machine or expose it through a web server.
