# Attendance Line sorting

Course is a separate filter (All courses, BSA, BS Info Tech, BSMB, BSFI), not a sort option. It combines with section/status/search and the chosen arrival/name ordering. Legacy BSInfo Tech values match BS Info Tech. The report/PDF carries the same course filter. Clear restores All courses.

- Latest check-in first is the default. Earliest check-in first and No check-in first are available alongside all existing name sorts.
- Arrival ordering uses exact checkedInAt timestamps, falling back to legacy attendedAt, never checkout/update time or the rounded Time Since text. Ties use name and record identity for stable ordering.
- Missing/invalid arrival times go last in arrival sorts, first in No check-in first. Changing sort resets pagination to page one and keeps other filters. Incoming live records use the selected order.
- No check-in first can include eligible roster members as display-only Not yet checked in rows while a session is open. These are not absences and are not written to Firestore. Existing missing-profile and roster-review safeguards remain in place. Closed sessions retain the existing absence/review policy.
- Sorting is local to the loaded date-window records. If More available is shown, load the remaining pages for a complete comparison. Roster-only rows are added only after the full window is loaded and server-verified. The existing realtime query window is unchanged.
- The full live report/PDF uses the same sort choices. Its existing full-report verification and size limits remain unchanged.
- No additional Firestore reads, Functions, billing changes, or Rules changes are needed for sorting. Publish the web files and rebuild the APK to distribute this UI change. Other pending features may separately require Rules deployment.
