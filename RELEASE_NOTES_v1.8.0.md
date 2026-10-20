# Attendance Tools and Course Filters

- Added Time Since labels beneath recorded check-in and checkout times, refreshing while the app is visible without extra Firestore reads.
- Attendance Line defaults to latest check-in first, with earliest-first, no-check-in-first, and existing name sorting options. Checkout does not change arrival order.
- Added a separate Course filter: All courses, BSA, BS Info Tech, BSMB, and BSFI. It combines with section/status/search and applies to live reports and portrait PDF exports.
- No-check-in-first can show eligible students as Not yet checked in during open sessions, without creating attendance records or marking them absent prematurely. Roster-only rows require a complete server-verified history window; load remaining records when More available is shown.
- Standardized course dropdowns and recognized the legacy BSInfo Tech spelling as BS Info Tech across profiles, filters, approvals and reports. Existing database values are not bulk-rewritten; saving an edited profile uses the standardized spelling. Unknown course names remain unchanged.
- Authorized admins can edit ongoing session times after confirmation. Existing attendance timestamps and recorded statuses are preserved. Closed-session times remain locked; session ordering and overlap validation remain enforced.
- Circle geofences support a maximum radius of 100,000 meters (100 km), while smaller radii remain available and polygon limits are unchanged. Large circles permit off-campus attendance.
- Made No attendance recorded text compact and readable.

## Installing

Download **Presence.apk** below and install over the existing app. **Do not uninstall first.** Android version **1.8**, version code **9**, package `io.github.calculatingafk.presence`.

This GitHub-distributed beta retains the existing debug signing identity for update compatibility. It is not a Google Play production build, and signing does not guarantee the absence of Play Protect warnings. Do not disable Play Protect.

The updated Firestore rules for ongoing schedule edits and the 100 km circle limit must be published. The project owner confirmed publication before this release. No Blaze upgrade or Cloud Functions are required; normal Firestore quotas apply.

Automated checks and APK signature verification do not replace real-phone testing. Verify installation over v1.7, retained login, registration/course selection, morning/afternoon attendance, location and face checks, ongoing schedule edits, sorting/course filters, and portrait PDF save/share.
