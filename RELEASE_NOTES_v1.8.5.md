# Attendance Opening Alerts, Student Summary and Excel Export

- Adds check-in-opening reminders for eligible students without a saved check-in, and checkout-opening reminders for students who checked in but have not checked out. Existing 10- and 5-minute final-cutoff warnings remain. Completed attendance cancels outstanding reminders when synced.
- The Attendance reminders settings card is removed. In-app alerts work automatically while Presence is open. APK phone reminders use Android notification permission; an eligible future reminder triggers a one-time foreground permission request when needed. Denial never blocks attendance or in-app alerts.
- Reminders are locally scheduled after the app syncs. They do not provide immediate server-push announcements when new events are created. Reopen/sync after remote schedule or attendance changes. Android battery restrictions, force-stop, permissions and lock-screen settings may delay or prevent display. Opening notifications include the actual scheduled time; in-app opening banners expire after two minutes to avoid replaying old openings.
- Student My Attendances includes a Summary view filtered by month, event and session. Morning and afternoon share one event card with separate status/time details and correction targets. Present/Late describe arrival; Incomplete describes missed checkout and can overlap. Unverified history is not automatically absent.
- Correction requests and history appear only under Summary, not Records. Request correction prefills the existing form without submitting automatically.
- Attendance Line / Live Report adds Excel export alongside unchanged PDF controls. The workbook respects report filters, preserves Student IDs as text, includes names/course/year-section/check-in-out/status, and separates morning/afternoon sheets for Both sessions. Passwords and private profile fields are excluded. Android supports native Excel Save As.

## Install and test

Android **1.8.5**, version code **14**. Install **Presence.apk** over the existing app; **do not uninstall first**. The release includes the matching **presence-update.json** for the existing in-app updater. This GitHub-distributed beta retains the existing debug signing identity and is not a Google Play production build. Do not disable Play Protect.

Open the app and sync an eligible future session before testing background notifications. Allow Android notification permission if prompted. Verify opening alerts, cutoff alerts, denial, completion cancellation, morning/afternoon isolation, offline resync, logout, Excel save/cancellation and summary correction requests on a real device.

No paid Firebase plan, Cloud Functions or server-push setup is added. Existing Firebase quotas apply. No attendance/fine data is changed by reminders or summary views. Existing correction-request features require the previously provided Firestore rules; this release does not deploy rules automatically.
