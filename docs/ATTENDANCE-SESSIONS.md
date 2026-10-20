# Morning and optional afternoon attendance

## Admin workflow

The existing four schedule inputs are Morning attendance. Afternoon attendance
is off by default. Turn it on to enter another check-in opening/cutoff and
checkout opening/cutoff. Morning check-in must be before noon; afternoon
check-in must be at or after noon, after morning checkout closes. All times
must be on the event's date. Overnight/more-than-two-session events are not
part of this feature.

Both sessions use the form's selected participant sections and location area.
They are saved atomically: an invalid afternoon cannot leave only morning
published. The Geofence Locations manager updates both session areas together.
Students receive a separate afternoon notification, even if morning has ended.

Editing either session opens the same event-group form. Each schedule locks
when its check-in opens (a deliberately stronger safeguard than waiting for
the first attendance submission). An unused afternoon can still be added while
morning is ongoing, provided afternoon check-in is in the future. Published
afternoon sessions cannot be disabled with the checkbox; they retain their
attendance and history. Closed-session participant groups cannot change.
If morning has closed, its group lock therefore also prevents changing the
shared groups in this form. Create a separate event for different participants.

## Student cards, records and reports

The student attendance-card HTML/layout and actions are unchanged. Titles end
in Morning or Afternoon. Open/upcoming sessions appear as separate existing-
format cards; after morning finishes it moves into history independently.

Check-in, late arrival, checkout, partial attendance, completion, review and
absence are evaluated per session. Missing morning does not block afternoon.
Morning completion does not complete afternoon. With afternoon off, there is
no afternoon document or attendance requirement. Existing fine eligibility is
also evaluated per session; no new automatic fine creation is introduced.

Live preview/PDF use each session's own event selector entry, name and four
schedule times. Portrait PDF layout is unchanged. Report scopes do not merge
the two sessions into one attendance record or conflate their totals.

## Storage and compatibility

Morning retains the original event ID. Afternoon uses `<morningId>_afternoon`.
Each is an ordinary event document with its own roster and geofence document,
so existing attendance keys `uid_eventId`, rules, corrections, report listeners,
face verification and student history continue to apply without migration.
Session metadata is `sessionPeriod`, `sessionGroupId` and `sessionBaseName`.
The new rules validate identity/linkage, reject overlapping session schedules,
prevent early afternoon creation/submission, and lock opened session schedules.

Legacy events remain single-session documents and keep their event and
attendance IDs. They are not automatically split or assigned afternoon
absences. Enabling afternoon on a legacy event preserves its morning record ID.
Removing a morning event from the admin UI is blocked while its afternoon
exists, before any attendance deletion, to avoid orphaning the group editor.
The existing separately authorized operational-data reset remains unchanged.

This uses normal Firestore listeners and writes, not Cloud Functions or a new
backend. It is compatible with Spark, subject to its ordinary quotas. An
enabled afternoon adds one event, one geofence, and its own attendance records,
notifications and listener/read usage.

## Deploy and test

1. Publish the updated `firestore.rules` before using the new form:

   ```powershell
   firebase.cmd deploy --only firestore:rules --project presence-a873f
   ```

2. Publish the updated web files and hard-refresh the admin/student pages.
3. For Android, bump versionName/versionCode, sync the mobile web files, and
   build/test a new APK with the existing signing key. Do not replace an old
   released APK with a different binary under the same version.
4. Test morning-only creation: no afternoon appears and no afternoon absence
   is counted.
5. Test two sessions with 2A and 2B: both use the selected area; 1A is view-only.
6. Check in/out independently in each session. Verify no cross-session updates,
   and that a student without morning attendance can attend afternoon.
7. Confirm schedules lock after opening; verify upcoming afternoon edits and
   rejection of missing, overlapping or unordered times.
8. Export each session from the live report; confirm title, participants,
   totals and footer use only that session's data. Test Android separately.

Automated checks: `npm.cmd test`, `npm.cmd run check`, `npm.cmd run mobile:build`.
The existing local demo Firestore emulator test also exercises atomic four-
document saves, maximum ten-point polygons, Super/Attendance Admin permissions,
identity/time protection and independent student attendance. No production
rules deployment or signed APK build is performed by these checks.
