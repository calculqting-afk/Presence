# Student attendance correction requests

This is a Spark-compatible Firestore workflow. No Cloud Functions or paid hosting are required. Realtime listeners and transactions consume normal Firestore reads/writes; the admin queue currently loads request documents for pending counts and decision history, so archive/pagination planning is appropriate as usage grows.

## Student

Open **My Attendances**, then **Request an attendance correction**. Choose an assigned closed event/session, select Missed check-in, Missed checkout, or Incorrect attendance, and enter a reason (5–1000 characters). The exact morning/afternoon event ID is used. Submitting does not write attendance or fines.

One permanent request is retained per student/session, including its final decision. Duplicate submissions are rejected transactionally and by Rules. After a final decision, further review goes through an administrator, rather than overwriting the original request. Submitted reasons cannot be edited.

## Administrator

Super Admin, Head Admin and Attendance Admin see **Correction Requests** and its pending count. Student Managers cannot review requests. Select Pending, Approved, Declined, or All requests.

Search by student name/ID/email and filter by section and status. Year level appears only as student information on the card; it is not a filter. Clear resets to all students/sections and Pending. These filters run locally and do not add Firestore queries. The navigation badge always counts all pending requests, regardless of filters.

Submit request shows a spinner and disables repeat submission while the transaction is pending. Failure restores the button and retains the typed reason. A success notification is shown only after the save is acknowledged. The admin review/decline buttons also show loading feedback. Decline reasons are expanded on demand to keep the queue compact.

**Review and correct** loads the saved attendance from the server and opens the existing manual correction form, locked to the request's student and session. Enter verified check-in/out times, Present/Late, and an admin decision reason. Saving atomically writes attendance, the existing immutable before/after correction audit, the approved decision, and an immutable decision-history entry. Concurrent or stale reviews fail if the request is no longer pending. Cancelling the form does nothing.

**Decline request** requires an explanation. Its transaction saves the decision and immutable decision history, leaving attendance unchanged. Neither approval nor decline modifies fines. Review fines separately through the existing controls.

Students see their own requests and explanations in My Attendances. Original reasons, submission timestamps, reviewer UIDs, decision reasons/timestamps, and correction IDs are retained. Request history entries cannot be updated or deleted, including by Super Admin. Deleting an event or resetting operational attendance data does not delete these request histories.

New decisions also store `reviewedByName` and history `byName`, validated against the reviewer's saved profile by Rules. Super Admin uses their admin profile display name; assigned Head/Attendance Admin accounts use their student-profile full name. UID fields remain unchanged for audit identity. Renaming a profile does not rewrite a past decision's saved name. Older decisions without a name snapshot show “Administrator”; immutable histories are not migrated automatically. Regular students and Student Managers cannot approve/decline requests, regardless of whether their account originated as a student registration.

## Deploy and test

Publish the updated rules before testing outside the emulator:

```powershell
firebase.cmd deploy --only firestore:rules --project presence-a873f
```

No rule deployment, GitHub push, or APK rebuild is automatically performed by implementing this feature.

Use a test student assigned to a finished test session. Submit one request, check the admin pending badge, approve it with verified times, and check that student status and Attendance Line update. Use a different session to test decline, duplicate prevention, cancellation, and two-admin concurrent review. Confirm an unrelated session and all fines remain unchanged. Test narrow/mobile layouts, dark/light themes, offline submission and rules-denied errors. UI errors must not claim a successful request or correction.

Local tests:

```powershell
npm.cmd test
npm.cmd run check
```

Run `tests/correction-requests.emulator.cjs` only under `firebase emulators:exec --only firestore --project demo-presence-audience --config firebase.audience-test.json`. It uses a local demo project and no production credentials. Run the existing audience/attendance emulator suite as a regression check too.
