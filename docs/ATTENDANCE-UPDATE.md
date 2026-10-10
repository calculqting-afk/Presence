# Attendance update — 10 October 2026

## Scope and deployment

Implemented accurate shared summaries, safe submission/reconciliation, attendance filters and pagination, and missed-checkout review. CSV export is not included. No automatic fines, face matching, new geofence distance enforcement, event archival, or paid backend was introduced.

Publish the local `firestore.rules` before using the updated frontend to create new events. The rules now require a participant roster for new events and enforce roster-based eligibility. Older events remain compatible. This repository edit does not publish rules or verify your deployed Firebase project/plan. Hard refresh both dashboards after updating frontend files.

New events store `attendanceRoster` (UID → section at publication) and `rosterCapturedAt`. Saving an upcoming event refreshes its roster from the loaded active student directory. Re-save upcoming events after adding participants or changing their sections. Once the original opening time arrives, Firestore rejects roster changes. Already-open legacy events are not automatically backfilled. This policy deliberately preserves event eligibility rather than using later section changes.

## Attendance policy

- Absences are counted only after checkout closes, for confirmed event-roster participants with no saved attendance record.
- Legacy events without historical rosters are unverified, not confirmed absences. Events known to predate enrollment are excluded. Events from unrelated sections are excluded when there is no roster or existing attendance evidence; historical membership cannot be reconstructed from current profiles.
- Cached/pending attendance snapshots do not establish new confirmed absences. The admin absence dialog reads the selected student's records from the server before presenting confirmed results.
- A check-in counts as participation. An overdue missing checkout is **Needs review**, not an automatic absence or fine. Both dashboards show it; admin Attendance Line offers a Needs review filter. Existing authorized corrections require a reason and retain their atomic audit trail. Completing checkout through a correction removes the review flag.
- Today's pending total uses scheduled active roster participants, not every registered account. A day without eligible scheduled participants has zero pending. Legacy eligibility is labelled unverified.

## Loading and filters

Admin Attendance Line defaults to the last 30 days. Date boundaries are queried on Firestore; clear From/To to inspect older dates. Each explicit fetch reads at most 100 documents, displayed 20 per page. Student/name/ID/email, event, section, and review/status filters search **loaded records**; the interface states the match and loaded counts. Load more continues the search. A lack of matches in a partially loaded range does not mean no matching record exists globally.

The first 100 records in the selected date range have a scoped live listener. Older loaded pages are refreshed with Apply filters / Sync now. Section filters use the event roster when available, otherwise the current profile. Leaving Attendance Line stops its live listener and discards stale responses. The existing full admin summary/directory subscriptions remain in other views so counts and cleanup workflows are not silently based on incomplete history. Therefore this update does not eliminate all full-collection reads. Student My Attendances shows 12 filtered records per page; its own-user subscription remains complete for accurate summaries.

The queries use a single `eventDate` order/range plus a document snapshot cursor, not new compound indexes. Existing attendance records require `eventDate` to appear in that history query.

## Browser acceptance tests

Use dedicated accounts/events: Chrome for admin and Edge for student. Different browsers have separate theme/session preferences. Avoid destructive cleanup tests on real student data.

1. Create a short upcoming event for Section 2A. Confirm an active 2A student is included, an inactive student/2B student is not. Save the event again before opening after adding a student; verify the refreshed roster. A save must wait until the student directory is loaded from the server.
2. After opening, move a rostered student to 2B. Their original event remains assigned, attendance access and later absence calculations still use its roster. Attempts to change the opened event's roster must fail in backend rules. Historical legacy events display unverified eligibility rather than fabricated absences.
3. Check in normally, then repeat from another tab/browser session of the same student. Exactly one UID/event document must remain; the second attempt preserves the original check-in/arrival time. Test a competing write while both attempts are in flight.
4. Test GPS crossing the present/late cutoff: late consent must be requested before submission. Cancel creates no record. Crossing event close during GPS creates no new check-in. Crossing checkout close during GPS creates no checkout. Server `request.time` remains authoritative; changing device clocks does not bypass rules.
5. Test lost connection during a write and during the extra confirmation read. An acknowledged write with an unreadable confirmation says **saved — confirmation pending**. An uncertain network failure says **status unknown**, not success. A slow write says **Waiting for the server** and blocks concurrent submission. Refresh and inspect the actual saved record before retrying; never assume a toast alone proves a database write.
6. Check in but skip checkout. After its cutoff, both dashboards show Needs review. It remains participation, no absence/fine is automatically added. Attendance Manager corrects it with a meaningful reason and checkout time. Student Manager may view but cannot correct; student cannot write correction metadata. Verify the correction and immutable before/after audit in Firestore.
7. Test a day with no scheduled event: pending is zero. With three eligible active participants and one check-in, pending is two. Nonparticipants and inactive accounts do not inflate pending. Multiple events on one day count distinct students for the daily summary.
8. Use more than 100 attendance records in a test date range. Verify cursor loading, 20-row admin pages, 12-row student pages, date/section/student/event/status filters, sparse matches with Load more, invalid date ranges, and filter changes while a previous fetch is pending. New live check-ins appear without reloading the admin first window; leaving the view stops that listener.
9. Repeat on a phone-sized viewport in both themes. Check form labels, date fields, pagination buttons, and the manual correction dialog. Clear the console and confirm no new permission or import errors.

## Automated tests and remaining verification

Run `npm test`, `npm run check`, and `git diff --check`. The regression tests use mocked Firebase/browser objects and cover summary eligibility, stale/cache coverage, review semantics, retry reconciliation, GPS timing, bounded queries/cursors, pagination/filtering, role gates, and lifecycle cleanup. They do not verify deployed rules, real GPS, or real browser rendering.

Run actual security tests through the Local Emulator Suite with Java and `@firebase/rules-unit-testing` before production. Add these cases to the matrix in `TESTING.md`: create without roster denied; current-time roster creation allowed for authorized managers; pre-opening roster refresh allowed; post-opening roster edits denied even if the opening time is changed in the same write; wrong/nonparticipant UID denied; rostered student transferred to another section remains eligible; legacy current-section compatibility; student/Student Manager roster writes denied; corrections retain the reason/actor/audit requirements. Java was not available on PATH during this update, so emulator enforcement and deployment are not claimed as tested.
