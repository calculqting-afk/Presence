# Attendance Views and Dashboard Improvements

- Linked morning and afternoon sessions now share one student event card. The current session determines the attendance action; between sessions, the event stays visible with the next opening time.
- Attendance Line supports Morning, Afternoon, or Both sessions, with paired student records and matching live reports/PDFs.
- Manual attendance corrections display the recorded reason. Confirmed absent students can receive an audited correction for the selected session.
- Improved event cards, spacing, dashboard event navigation, and grouped survey management with session selection.
- The Checked in filter includes students with a saved check-in, including completed, late, and review records.
- Authorized admins can extend a finished session's checkout cutoff on the original event date. Reopened checkout requires an existing check-in; it does not reopen check-in or change saved attendance timestamps.
- Keep me signed in now restores an eligible authenticated account from the login page. Explicit logout still signs out.
- Admin student filters support selecting multiple sections together.
- Student and admin greeting banners show the floating Presence logo. Confirmed student check-in/check-out saves also show the animated logo. Reduce Motion uses a static image.

## Installing this update

Download **Presence.apk** and install it over the existing app. **Do not uninstall first**, so local data and sign-in can be retained. The release includes the matching **presence-update.json** for the in-app updater.

Android version **1.8.3**, version code **12**. This GitHub-distributed beta retains the existing debug signing identity for update compatibility; it is not a Google Play production build. Do not disable Play Protect.

Deploy the latest repository Firestore rules before using reopened checkout. This release does not deploy Firebase rules automatically. No new Cloud Functions or paid Firebase services are introduced; normal Firebase quotas apply.

Automated checks and APK verification do not replace real-phone testing. After installing, verify login restoration and logout, morning/afternoon attendance, face/location checks, manual corrections, reports/PDF save/share, multi-section filtering, and the animated logo with Reduce Motion enabled and disabled.
