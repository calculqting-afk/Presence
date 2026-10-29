# Attendance time validation

Manual corrections require checkout strictly after check-in; checkout remains optional. Both timestamps must be on the event's date in Philippine time and cannot be in the future. The form preserves seconds, shows the selected schedule and before/after preview, and disables saving invalid times. Reasons and immutable before/after audit entries remain required.

Regular student checkout also requires a saved earlier check-in and timestamps on the selected event date. Firestore Rules enforce these constraints independently of the browser. A genuine positive duration under 60 seconds is valid and displays as Less than 1 minute; no artificial one-minute minimum is imposed.

Existing equal/reversed timestamps and date mismatches are flagged for review in attendance views, summary, and report exports. Needs review filters include these records; Completed filters exclude them. The simple workbook's Attended cell carries the review reason. Existing participation and saved timestamps are not rewritten, removed or converted into absences. Closed sessions with invalid timestamps can use the existing Incorrect attendance correction-request flow, subject to its one-request/history policy.

Test with equal times, reversed times, an event-date mismatch, 30 seconds of genuine attendance, check-in only, and a verified correction with a reason. The selected event's date is authoritative, rather than the date the administrator performs the correction.

Validation: npm.cmd test, npm.cmd run check, npm.cmd run mobile:build, plus attendance-time, correction-requests, admin-activity, and arrival-recalculation demo Firestore emulator suites. No automated test modifies production student records. Installing the currently published APK does not include later local form/display changes; APK distribution is a separate action.
