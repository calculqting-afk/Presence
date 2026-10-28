# Recalculate saved Late/Present labels

Open **Modify Events** or **Past Events → Edit event**. Update the session's **Check-in cutoff** (the “Late after” time), enter a reason, and save. Editing either session's cutoff automatically selects **Preview and recalculate saved Late/Present labels**. You can uncheck it to keep saved labels, or manually select it when repairing labels after an earlier cutoff extension.

The preview shows each session's proposed cutoff, affected student names/IDs, saved check-in times and old/new labels, with totals for Late → Present and Present → Late. Cancel leaves both the event and attendance unchanged. Confirm saves the schedule first, then applies only the previewed changes. Morning and afternoon records stay independent; the preview labels each session explicitly.

Classification uses the original saved `checkedInAt` (falling back to legacy `attendedAt`). A timestamp at or before the cutoff is Present; after it is Late. Original timestamps, completion status, location evidence, face data and fines remain unchanged. No attendance is manufactured for absences or checkout-only records. Manually corrected attendance is protected, including records with legacy correction metadata.

Finished sessions can extend their late cutoff up to checkout opening, without reopening attendance or changing the event date/opening times/checkout cutoff. A finished session's late cutoff cannot be shortened. The existing separate checkout-extension protections still apply. Ongoing sessions can move the cutoff in either direction with explicit preview/confirmation.

Each row is reread in a Firestore transaction along with the event. A changed check-in, arrival label or manual correction is skipped rather than overwritten. If the event cutoff changes during processing, the row is not changed. Each successful transaction updates only the arrival label/recalculation markers and creates an immutable `activityLogs` entry, visible as **Arrival recalculated** in Super Admin Activity History. Rules check the actor, exact classification, unchanged original fields and matching audit entry.

Progress reports saved, skipped and failed rows. Event saving and a large recalculation are not one transaction. On a connection/permission failure, successful rows remain saved; reopen the event, select recalculation and preview again to retry only the remaining differences. Replaying a successful plan does not create duplicate changes. Existing fines require separate administrative review.

Available to Super Admin, Head Admin and Attendance Admin under existing event/attendance permissions. Uses the Firebase client SDK and tested Firestore Rules on the existing Spark setup; no new backend credentials or permissions are needed. Existing listeners update attendance displays as writes are acknowledged. No real student data is changed by automated tests.

Validation: `npm.cmd test`; local demo emulator suites `tests/arrival-recalculation.emulator.cjs`, `tests/admin-activity.emulator.cjs`, `tests/event-audience.emulator.cjs`, and `tests/correction-requests.emulator.cjs`. Test a deliberately selected event in the local dashboard after deploying Rules. A website change does not update installed APK assets; APK publication is separate.
