# Attendance alerts

Two separate features, available in **Events > Attendance reminders**:

- In-app alerts (on by default): visible banner while Presence is open, with an Open Events action. No browser permission or server write. Checked every 15 seconds and on focus/data changes. No alert after the session expires.
- Android phone notifications (off by default): explicit opt-in and OS notification permission, locally scheduled with Capacitor Local Notifications. Works without a hosted push sender or Firebase Functions. Not remote push and not a guaranteed alarm. The website does not schedule background phone/browser notifications.

Reminders are 10 and 5 minutes before `checkOutClosesAt`, per real session event ID. Thresholds before the action opens are skipped (a checkout window shorter than five minutes has no 10/5-minute warning). This is intentional: the current AttendancePolicy permits late check-in until this final cutoff, not just until the on-time/late threshold. An unchecked student receives check-in warnings; after a saved check-in these are replaced with checkout warnings. Completed attendance receives none. Checkout reminders preserve access for previously checked-in students even if their section was removed. Checkout-only reopened events never invite a new check-in.

Only active students with synced event and attendance snapshots are scheduled. Morning and afternoon stay separate. Permissions and choices are device-local and per account. Event and attendance listeners stay active across student views, which can add reads when schedules/attendance change; no reminder documents are written to Firestore. No rules deployment or service account is required.

Android uses inexact notifications without requesting special exact-alarm access. Battery saving, force-stop, denied permissions and OS policies can delay/prevent delivery. Future reminders are bounded to the nearest 60, replenished when the app syncs. A new APK containing the plugin is required; a website update alone cannot add native support to an already installed APK.

Local reminders cannot observe remote edits, deletion, eligibility changes, or attendance completed on another device while the app is closed. Reopen/sync to cancel or reschedule them. Notification content includes the event title (potentially visible on the lock screen), but not student names/IDs/reasons. Logout cancels pending and delivered attendance notifications; opening the login page also clears them. Closing/backgrounding the app intentionally keeps scheduled reminders.

## Manual checks

1. Web: use an active eligible student with an event ending 11 minutes from now. Open Events and Attendance reminders; verify in-app on and phone unavailable. Keep the page open and verify the 10- and 5-minute banner. Complete check-in and verify the next alert says Checkout. Complete checkout and verify no further banner.
2. Repeat for non-eligible, inactive, completed, missing/invalid schedule and checkout-only reopened sessions. No new-check-in reminders should appear. Verify separate morning/afternoon IDs.
3. Android: build/sync the updated APK, install, sign in, enable phone notifications, and allow permission. Background the app before the thresholds. Timing may be delayed. Tap the notification to open Presence; Events provides attendance actions. If permission is denied, in-app reminders still work.
4. While open, change the cutoff, remove an event, complete checkout, disable phone reminders, or log out. Confirm stale pending notifications are removed. Log into another account and verify no previous-account reminders remain.
5. Change the schedule from another device while the phone app is closed. Confirm the documented limitation: existing local reminders may remain until the phone app is reopened and synced. No claim of background server synchronization is made.

Automated tests cover policy, native reconciliation, opt-in denial, banner lifecycle and logout queue ordering; physical phone delivery still requires device testing.
