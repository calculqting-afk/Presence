# Fixed role permissions

Super Admin authority comes from the server-issued Firebase `superAdmin: true` claim, not a built-in UID, email or editable student role. Only trusted Firebase administration can grant it.

The policy lives in `assets/js/core/permissions.js`. It is a reviewed code policy, not a user-editable toggle screen. Navigation, buttons and action handlers use that map. Firestore independently enforces database operations; changing only the JavaScript map does **not** grant database permission.

| Action | Super Admin | Head Admin | Attendance Manager | Student Manager |
| --- | --- | --- | --- | --- |
| Register/edit student information | Yes | Yes | No | Yes |
| Reset face registration | Yes | Yes | No | Yes |
| Change an existing student's password | Yes | Yes | No | No |
| Clear student account / change roles | Yes | No | No | No |
| Create/edit events and attendance areas | Yes | Yes | Yes | No |
| Set/correct attendance with reason | Yes | Yes | Yes | No |
| View student fines and absences | Yes | Yes | No | Yes, read-only |
| Assign/edit fines or service requirements | Yes | Yes | No | No |
| Delete events/fines or bulk-reset operational data | Yes | No | No | No |

Attendance Manager retains the stored role ID `attendance_admin`, so existing assignments do not require migration. Active stored roles are checked by Firestore. Signing out and back in refreshes the frontend role after an assignment change. Database authorization does not wait for that refresh.

Administrator dashboards still read the student directory for attendance identity, event-notification recipients and summary counts. This policy restricts **actions**, not field-level confidentiality; Firestore cannot return only selected fields from a document. Do not treat hidden student-management navigation as a prohibition on all directory reads.

## Attendance corrections

Attendance Line has **Set attendance / manual correction** and **Correct** on existing records. Choose student/event, actual check-in and optional check-out, arrival status and a reason (5–1000 characters). An existing correction cannot change the student/event identity. Students must be active and belong to the event audience. Times cannot be in the future, and checkout cannot precede check-in. A manual correction intentionally does not require a face/GPS check or the current live event window: it records an administrator's verified exception, not a student check-in.

One Firestore transaction writes the attendance and an immutable document at `attendance/{studentUid}_{eventId}/corrections/{correctionId}` containing full `before`/`after` snapshots, `by`, server `at` and `reason`. The latest record also carries a manual-correction label and actor/reason/time. Rules reject corrections without the matching audit, a forged actor, or audit updates/deletion. Student checkout may subsequently update a corrected record; an audit snapshot describes the record at the correction time, not its later state.

Audit documents remain when Super Admin deletes their parent attendance records; Firestore deletes are not recursive. Keep them for accountability. If the same student/event record is recreated, the previous audit trail remains. Retention/deletion of those audit documents requires a separately designed trusted administrative process, not browser writes.

## Publishing and security boundaries

1. Publish **the complete `firestore.rules`** in the Firebase console (Firestore Database → Rules), or use your existing Firebase CLI workflow. This implementation does not publish rules automatically.
2. Replace the deployed face-upload Apps Script source with `docs/google-apps-script-face-upload.js`. Deploy a **new version of the existing web-app deployment**, preserving its URL and Script Properties. Otherwise Head Admin/Student Manager face reset will still be rejected by the old Super-Admin-only script. The script verifies the caller's token and reads the caller's active stored role; a role sent by the browser is not trusted.
3. Hard-refresh both test browsers and sign back in with separate roles. No paid Cloud Functions were added; attendance corrections use Firestore transactions. Each correction adds two document writes plus transaction reads and normal listener updates; the extra audit history consumes storage/quota.

Firestore Rules do not govern Firebase Authentication directly. Admin password resets now use the authenticated Cloudflare backend, with current-role checks, temporary-password expiry and audit records; see [Password reset](CLOUDFLARE-PASSWORD-RESET.md) and [Security hardening](SECURITY-HARDENING.md). Account deletion still has its own credential and authorization requirements.

The optional legacy `functions/index.js` account-deletion endpoint has also been tightened to Super Admin. It is not deployed or required by this Spark frontend.
