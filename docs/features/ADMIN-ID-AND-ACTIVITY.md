# Dashboard Student ID corrections and activity history

## Correct ID

Super Admin and active Head Admin: open **Modify Students → Correct ID** beside an active ordinary student. Privileged/disabled targets and the reviewer's own account are rejected. Enter the corrected ID and a 5–500 character reason, then **Preview correction**. Preview checks the current profile, ID indexes, registration requests, directory duplicates and Firebase Auth email without writing.

Review the student name, old ID and new ID. Enter **your own administrator password**, type the new ID exactly, and confirm. The Worker verifies the Firebase token, current role, recent authentication and a five-minute HMAC-signed preview tied to the profile revision. Five attempts per administrator per fifteen minutes limit changes. Changing any preview input requires a new preview.

The backend reserves the new ID, updates only the Firebase Auth login email, and completes the profile/index/approved-registration migration. The UID and password remain unchanged. Attendance, fines, surveys, face registrations and historical ID snapshots are preserved. The student's contact Gmail is not changed. The student should sign out and sign in with the corrected ID and their existing password. Existing issued sessions are not forcibly revoked by this operation.

Authentication and Firestore cannot commit in one transaction. An interrupted operation keeps its journal and ID reservations, and never reports success prematurely. Wait two minutes, reopen **Correct ID** and preview/confirm the prefilled old/new correction to resume. Do not delete locks or edit indexes manually. Password resets and ID corrections cannot run simultaneously. Profile edits and role changes are blocked while the ID lock exists. A stale profile preview is rejected.

Student ID fields in student/admin profile editors are read-only. Server Rules reject direct client edits to login identity fields. Creating a new student still accepts an ID normally. The terminal helper remains available for trusted recovery, rejects active dashboard leases, and uses the same deterministic correction journal. Avoid running the helper and dashboard concurrently.

## Activity History

Cutoff-based label adjustments are also recorded as **Arrival recalculated**, with preview, protected-record checks and retry handling.

**Super Admin only → Activity History**. Search loaded records by reviewer name/UID, student name/UID/old or new ID, event, or action. Apply dates to query the server; dates use Philippine time. Each request loads at most 50 entries from each of `activityLogs` and `auditLogs`; use **Load older activity** to extend searches. Refresh retrieves new activity. Search is over loaded records, not a server-wide full-text search.

New event creations/edits, role changes and manual attendance corrections save an immutable activity entry in the same client batch/transaction. Event edits and role changes require a reason. Rules validate the actor UID, server timestamp and before/after snapshots against the saved record. Existing password-reset and new ID-correction backend audit entries are included. The list displays reviewer names and only approved fields; password values/hashes and credentials are never copied to these activity entries or displayed.

Older event/role/attendance changes are not reconstructed. These records begin with this update. Older backend entries may lack a name or reason. Client Rules reject editing/deleting activity entries, including by Super Admin. Firebase project owners/service accounts can bypass Rules; this is not an external compliance archive. Legacy clients/direct-console writes are not required to create a central activity entry, so the history is not a guarantee that every possible external or old-client action was captured. The existing immutable per-attendance correction history remains intact.

## Backend setup

Uses the existing `presence-admin-api` Worker and dedicated `presence-password-reset` service account. Its custom IAM role needs these eight permissions:

```
firebaseauth.users.get
firebaseauth.users.update
datastore.databases.get
datastore.entities.get
datastore.entities.list
datastore.entities.create
datastore.entities.update
datastore.entities.delete
```

The two additions to the password-reset role are `datastore.entities.list` (duplicate checks) and `datastore.entities.delete` (obsolete ID/request/lock removal). IAM grants are project/database scoped, not individual-document scoped; Worker authorization is essential. The notification service account stays separate. No new Firebase billing upgrade is introduced.

Set a cryptographically random, at least 32-character **`ID_PREVIEW_SECRET`** with `wrangler secret put ID_PREVIEW_SECRET --config workers/admin-api/wrangler.jsonc`. Keep it outside Git/browser/APK assets. Existing `FIREBASE_SERVICE_ACCOUNT` stays a Cloudflare secret. Deploy tested Firestore Rules and Worker code, verify IAM/query/transaction access, then enable `ID_CORRECTION_ENABLED=true` and redeploy. `/health` reports the flag without exposing credentials. Leave the flag false until setup passes. Do not test by silently changing a real student's ID.
