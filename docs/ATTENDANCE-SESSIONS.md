# Morning, afternoon-only and two-session attendance

## Admin workflow

The Enable attendance selector offers Morning only, Afternoon only, or Both.
Morning only is the default. With either single-session option, the existing
four time fields describe that session; there is no hidden second requirement.
Both displays morning fields plus another afternoon check-in opening/cutoff
and checkout opening/cutoff. Morning check-in must be before noon; afternoon
check-in must be at or after noon, after morning checkout closes for Both. All times
must be on the event's date. Overnight/more-than-two-session events are not
part of this feature.

Both sessions use the form's selected participant sections and location area.
They are saved atomically: an invalid afternoon cannot leave only morning
published. The Geofence Locations manager updates both session areas together.
Students receive a separate afternoon notification, even if morning has ended.

Editing either session opens the same event-group form. Authorized admins may
edit time windows while a session is ongoing, after explicit confirmation.
New attendance actions use the new schedule. Previously saved check-in/out
timestamps, arrival labels and completion statuses are preserved. The event
date and attendance mode stay locked after opening. Finished sessions may
extend only their checkout cutoff to reopen checkout for existing check-ins;
see [Reopen checkout](REOPEN-CHECKOUT.md). An unused afternoon can still be added while
morning is ongoing, provided afternoon check-in is in the future. Published
two-session events cannot be switched to single-session mode in this form; they retain their
attendance and history. Closed-session participant groups cannot change.
If morning has closed, its group lock therefore also prevents changing the
shared groups in this form. Create a separate event for different participants.

## Student cards, records and reports

The student attendance-card layout and check-in/checkout actions are retained.
Cards now show an Attendance mode label (Morning only, Afternoon only, or Both)
and clearly headed Morning and Afternoon schedule blocks, each with all four
times. A two-session card shows both schedules even after morning finishes;
Current session identifies which schedule its buttons control. Both student
and admin event cards use the same presentation. Titles end in Morning or
Afternoon. Open/upcoming sessions appear as separate existing-format cards;
after morning finishes its own attendance entry moves into history independently.

Check-in, late arrival, checkout, partial attendance, completion, review and
absence are evaluated per session. Missing morning does not block afternoon.
Morning completion does not complete afternoon. With afternoon off, there is
no afternoon document or attendance requirement. Afternoon only creates one
afternoon event and no morning requirement. Existing fine eligibility is
also evaluated per session; no new automatic fine creation is introduced.

Live preview/PDF use each session's own event selector entry, name and four
schedule times. Portrait PDF layout is unchanged. Report scopes do not merge
the two sessions into one attendance record or conflate their totals.

## Storage and compatibility

For Both, morning retains the original event ID and afternoon uses
`<morningId>_afternoon`. Single-session events (including Afternoon only) use
the original event ID and set sessionGroupId to that same ID. Single-session
mode changes are permitted only before the saved session opens; published
two-session groups cannot silently discard either session.
Each is an ordinary event document with its own roster and geofence document,
so existing attendance keys `uid_eventId`, rules, corrections, report listeners,
face verification and student history continue to apply without migration.
Session metadata is `sessionPeriod`, `sessionGroupId` and `sessionBaseName`.
The new rules validate identity/linkage, reject overlapping session schedules,
prevent early attendance submissions, and lock opened session schedules.

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
5. Test Afternoon only: there is one afternoon attendance card and no morning
   absence or requirement. Test Both with 2A and 2B: both use the selected area;
   1A is view-only. Confirm both schedules remain visible on the afternoon card.
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
