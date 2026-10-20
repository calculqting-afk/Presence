## Morning and Afternoon Attendance

- Choose **Morning only**, **Afternoon only**, or **Both** when setting up an event.
- Event cards show clearly labeled morning and afternoon schedules, including check-in/checkout opening times and cutoffs.
- The current session is marked so students know which attendance buttons apply.
- Morning and afternoon have separate check-in, checkout, late status, completion and report records. Missing morning does not prevent afternoon attendance.
- Session schedules lock once they open, protecting recorded attendance. Existing single-session events and records are preserved.
- Assign events to multiple sections. Other sections can view the event but cannot submit attendance; participant changes update eligible groups.
- Improved event-save validation and replaced stale participant maps correctly when sections are removed.
- Corrected the Android updater's repository address to **calculqting-afk/Presence**.

### Installing this update

Download **Presence.apk** below and install it over the current app. **Do not uninstall first**, so the app's local data and sign-in can be retained. Older versions using the previous repository name may not show the automatic update prompt; install v1.7 manually once.

Android version **1.7**, version code **8**. This GitHub-distributed beta retains the existing debug signing identity for update compatibility; it is not a Google Play production build. Signing does not guarantee that Play Protect will show no warning. Do not disable Play Protect.

The latest Firestore rules must be published for these attendance modes. No Blaze upgrade or Cloud Functions are required; normal Firestore quotas still apply.

Local automated checks and APK signature verification do not replace real-phone testing. After installing, verify login, location and face checks, separate morning/afternoon attendance, and portrait PDF save/share.
