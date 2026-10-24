# Student attendance summary

Open **My Attendances > Summary**. The existing Records view is preserved. The correction-request form and saved request history appear only in Summary, not Records; requests and drafts are not deleted when switching tabs. Month defaults to the current month in Philippine time. Filter by month, event and Morning/Afternoon/Both. Clear shows all months and events. The event picker groups linked morning/afternoon events, while summary rows and totals count each session separately.

Counts:

- **Present (on time)**: a valid saved check-in whose arrival is not Late, following existing legacy arrival display.
- **Late**: a valid saved check-in marked Late.
- **Absent**: a closed session with verified roster eligibility and no check-in, confirmed by server-backed event and attendance snapshots.
- **Incomplete**: valid check-in, no checkout, session's final checkout cutoff has passed, with verified data. This needs review and never creates an absence or fine.

Arrival and completion are separate dimensions. Present/Late can overlap with Incomplete. Their counts must not be summed as mutually exclusive totals. Open sessions with check-ins show Awaiting checkout, including at the exact cutoff. Unstarted/open sessions without check-ins remain pending, not absent. Legacy/provisional eligibility, invalid schedules, deleted events, checkout-only records, invalid/reversed timestamps and unverified closed records show Needs review.

One card shows each linked event/date, with Morning and Afternoon sections inside it. The Session dropdown selects Morning, Afternoon or Both and applies to the cards and counters together. Single-session events show only their actual session. Each session retains its own status, Philippine check-in/out times and correction target. Pagination keeps complete cards together, with 12 event cards per page and a footer showing event/session counts. Unrelated events with matching names are not merged. Duplicate saved records for one event/session are consolidated deterministically using the latest update/correction/timestamps. Only the authenticated student's records are considered. Other students' data is never displayed.

Eligible absent/incomplete rows offer **Request correction**. This scrolls to the existing form, selects the session/problem and focuses Reason. It does not submit or change attendance. Existing requests are not duplicated; the student is directed to the saved request/decision. Transaction and Firestore validation remain authoritative.

The view updates on existing event, profile and attendance snapshots, navigation, focus, connection changes and a 30-second timer. Pending local writes/cached/failed reads cannot confirm absences or incomplete checkouts. Rendering uses textContent, not student/event HTML. There are no new Firestore queries, writes, rules changes, scheduled jobs or paid services. Dashboard counters, reports/PDF/Excel, attendance actions and the ongoing Excel-export changes are preserved.

Not pushed or included in a published APK by this implementation. Acceptance: test an on-time and a late completed session, an awaiting checkout at the cutoff, a missed checkout after the cutoff, verified absence vs legacy/provisional eligibility, month/session filters, duplicate records, offline/cache state, and correction form prefill with an already-submitted request. Check narrow screens and both themes.
