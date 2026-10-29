# Face reset and upload setup

The website, Apps Script, and Firestore Rules must be updated together. Local changes do not update the live services.

## Deploy

1. Publish `firestore.rules` to the existing Firebase project. The new `faceResetRequests` collection supports owner-scoped result reads and append-only administrator action records. Do not manually create this collection.
2. Replace Apps Script `Code.gs` with the complete contents of `docs/google-apps-script-face-upload.js`.
3. Keep the existing `FIREBASE_API_KEY` and `FACE_FOLDER_ID` Script Properties. The updated upload also requires `FACE_BACKEND_SECRET`; follow [Security hardening](SECURITY-HARDENING.md) for its private setup. Keep the web app configured to execute as the account that owns the face-photo folder.
4. This update calls Google Drive API v3 with the Apps Script account's OAuth token. Enable Google Drive API in the script's associated Google Cloud project if necessary. Existing DriveApp usage supplies Drive authorization; if the project specifies OAuth scopes explicitly, retain `https://www.googleapis.com/auth/drive` and `https://www.googleapis.com/auth/script.external_request`. Reauthorize when prompted. Never paste OAuth tokens or service-account keys into the website.
5. In Manage deployments, edit the existing deployment, select **New version**, and deploy. This preserves the existing web app URL.
6. Publish the updated website assets and HTML, then hard-refresh both dashboards.

## Behavior

- Normal reset: verify the photo is owned by the script account, matches the student's UID, and belongs to the configured folder; move it to recoverable Drive Trash.
- Already trashed: acknowledge it without trying to trash it again.
- Missing photo: do not assume that a Drive 404 proves deletion. Drive also uses 404 for inaccessible files. Super Admin or Head Admin must independently verify removal, select the recovery checkbox, and enter a reason of 10–500 characters. Recovery additionally verifies the configured folder is owned, active, and listable and that no matching replacement photo exists there. This is an explicit administrator override, not automatic proof that the file was deleted.
- Student Manager can perform ordinary resets but cannot authorize missing-photo recovery. Drive 401/403, quota, server, folder-access and ownership errors always block cleanup.
- Registration deletion and the completed action record are one atomic Firestore commit. The registration's original update time is a precondition, protecting a newer registration from an older reset.
- Authenticated errors are recorded for the requesting administrator when Firestore permits it. If authentication or Rules prevent error recording too, use Apps Script execution logs. Opaque POST success alone never proves the reset completed.
- Result documents are immutable under client Rules, but administrators permitted to create them can assert their own actions. They are operational action records, not cryptographically verified server-only audit evidence.
