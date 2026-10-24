# Attendance Reminders and Registration Improvements

- Student registration now uses three validated steps: Personal, School, and Security. Compact navigation buttons, animated progress circles, and a review of entered details make registration easier to follow. Account approval and first-login password setup remain in place.
- Attendance reminders are available under **Events > Attendance reminders**. In-app banners warn eligible students while Presence is open. Separate, optional Android phone notifications require notification permission.
- Reminders are scheduled 10 and 5 minutes before the final session cutoff, only for an unfinished action. Saved check-in switches reminders to checkout; completed attendance stops them. Morning and afternoon retain separate attendance records. Thresholds before an action opens are skipped.
- Phone reminders use local device scheduling, not server push. Android battery restrictions, force-stop, or permissions can delay/prevent them. Open/sync the app after remote schedule changes or attendance completed on another device. Logout clears attendance reminders.
- Includes the website updates since v1.8.3: audited student attendance correction requests and review history, reviewer display names, pending approval/request navigation badges, grouped student history/absence cards, clearer audience labels, correction request search/section filters, submission loading feedback, and improved request/modal layouts.

## Install

Download **Presence.apk** and install over the existing app. **Do not uninstall first.** Android version **1.8.4**, version code **13**. The matching **presence-update.json** supports the existing in-app updater. This GitHub-distributed beta retains the existing debug signing identity; it is not a Google Play production build. Do not disable Play Protect.

After installing, open Events, expand Attendance reminders, and explicitly enable phone notifications if desired. The website provides in-app reminders only; older APK versions do not contain the new native notification plugin.

Publish the current repository Firestore rules before using attendance correction requests if those rules have not already been deployed. This APK release does not deploy Firebase rules automatically. Reminders themselves need no new Firestore rules, server push service, or paid Firebase infrastructure; normal Firebase quotas apply.

Automated and native build checks do not replace real-phone testing. Verify registration/approval/password setup, check-in and checkout with face/location checks, correction requests, notification permission denial, background reminders, schedule resync, and logout cancellation.
