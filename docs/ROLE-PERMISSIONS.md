# Fixed role permissions

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

Firestore rules do **not** govern Firebase Authentication `updatePassword` or `deleteUser`. The current app's existing password/deletion flows sign in as the student using the student's current password. The role map blocks unauthorized managers from using these controls, and rules block their database deletion, but anyone with the student's credentials can still act as that student through Firebase Auth directly. Full server-enforced administrator password/deletion policy requires a trusted account-management backend; it is not guaranteed by this Spark/client-only change. Initial passwords during authorized student registration are separate from changing an existing account password.

The optional legacy `functions/index.js` account-deletion endpoint has also been tightened to Super Admin. It is not deployed or required by this Spark frontend.

## Test this update

Use Chrome and Edge (or separate browser profiles), not two windows sharing the same Firebase Auth storage. Use test accounts/data and record expected/actual outcomes.

1. **Student Manager:** see only Dashboard, Add Students, Modify Students and Assigned Fines. Edit profile information; reset a registered face; open profile → View absences / Check attendance fines. Confirm Password, Clear account, role selector, fine Modify/Remove, attendance correction and event controls are absent. Registering a test student may set its initial password, but must not change an existing student's password.
2. **Attendance Manager:** see event/geofence/Attendance Line tools, no student-management/fine tools. Create/edit a test event. Existing linked attendance metadata should sync without querying fines. Set test attendance with a reason, correct it again, and check that both historical snapshots remain in Firestore. Student browser should show Manual correction and the latest values. Empty/short reason, future times, reversed checkout and another section's event must fail without any partial write.
3. **Head Admin:** register/edit students, reset faces, use existing password workflow, create/edit events, correct attendance and assign/edit service requirements. Confirm no account deletion, role changes, event/fine deletion or bulk reset.
4. **Super Admin:** confirm role assignment and existing permitted workflows still work. Avoid destructive tests against real records.
5. **Ordinary student:** repeat normal Present/Late check-in and checkout on a test event. Confirm correction metadata is absent on normal check-ins; manual records are visibly distinct. Verify realtime changes across browsers and that changing tabs does not create repeated permission errors/listeners.
6. **Backend authorization:** in Firebase Rules Playground or a local emulator, test direct SDK writes as each role—not just hidden buttons. Student Manager attendance/fine edits, Attendance Manager fine edits, non-Super-Admin student deletion/role updates, missing audit corrections and audit mutation must be denied. Test a valid atomic correction, a second correction, normal student check-in/out and administrative event-metadata synchronization as allowed cases. Separate audit/main writes must fail.

Run `npm.cmd run check` and `npm.cmd test` locally. These are syntax/module checks and mocked unit tests, not proof that deployed rules or Apps Script work. This environment has no Java runtime for the Firestore emulator, so rule compilation/security behavior and live role/device checks remain deployment-time verification. See `docs/TESTING.md` for official emulator references and broader regression checks.
