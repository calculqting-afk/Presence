# Attendance Views

Linked morning and afternoon sessions appear as one student event card. Both schedules remain visible, with Current session shown only during an open session. Between sessions, the card stays in Events with a disabled button and the next opening time. After the final checkout cutoff, it leaves Events. History and attendance records retain their individual session details and existing removal confirmation.

In Attendance Line, choose the event once, then select Both sessions, Morning only, or Afternoon only. Selecting an event defaults to the currently open session, or Both sessions outside its windows. Single-session events hide this extra control. Both sessions groups each student's morning and afternoon rows together, including across pagination. Existing course, section, status, search, sorting and correction controls remain available.

Live report / PDF follows the selected session view. Both sessions labels every row and includes both schedules in the portrait PDF footer. Totals count session records, not unique students. Each session independently determines pending, absent, completed and review status. Export requires server verification for every selected session.

This is presentation grouping, not a data migration. Original event IDs, attendance documents, timestamps and authorization remain unchanged. No Firestore Rules deployment, Cloud Functions or Blaze upgrade is needed. Both-session reports attach two event/attendance listeners per session while open; normal Firestore read quotas apply.

## Smoke test

1. Open an event configured for Both: one card, both schedules, correct Current session and action target.
2. After morning closes but before afternoon opens: same card, no Current session, disabled action showing afternoon opening time; no finished morning entry in History yet.
3. During afternoon: Current session and check-in/out apply only to afternoon, regardless of morning attendance.
4. After afternoon closes: event leaves Events; history retains the session outcomes.
5. In Attendance Line, compare Morning, Afternoon and Both, including filters, time sorting, corrections and pagination.
6. Open Live report / PDF in Both: verify session labels, independent statuses and both footer schedules; disconnect to confirm export is blocked.

Automated regression tests cover session boundaries, legacy cutoff fallback, action routing, grouped pagination, report totals, PDF labels and multi-session server verification. Browser and real-phone smoke testing are still required. These source changes have not been published or packaged into a new APK.
