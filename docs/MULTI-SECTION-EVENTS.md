# Multi-section attendance assignment

## User behavior

All active students can see open/upcoming events in Events and the dashboard. This does not create attendance records. Only assigned participants can check in or record checkout-only attendance; other students see a disabled **View only** action and the assigned sections. My Attendances still lists actual saved attendance, not every announcement.

In the event editor choose **All students**, or **Selected sections** and check one or more sections. Single-section legacy events restore correctly in the editor. Save changes to refresh assignment while the event is upcoming or ongoing. The existing event listener refreshes student cards without signing out. Closed-event groups are locked; create a new event rather than rewriting history.

Saving an ongoing legacy event with mismatched audience text (for example All students but a 2A-only roster) rebuilds its eligible roster from the selected groups. Simply installing the new website/APK does not migrate existing data: an authorized admin must review and save the event. No bulk migration or live-data edits are performed by the implementation.

## Safety and historical records

- New/edited active events store `audienceSections` (empty means all eight sections), `sectionAssignedAt`, and increasing `rosterVersion`, alongside the existing roster.
- The editor verifies the saved event from the server before updating it. Rules reject stale revision writes, so concurrent admins must refresh/retry instead of silently overwriting an assignment.
- Legacy participant timestamps are derived from actual roster membership, not potentially stale audience text. Retained sections preserve assignment times; a removed-and-readded section gets a new timestamp.
- Newly assigned groups after opening, and students approved after opening, are provisional for absence calculation. With no attendance they require review, not an automatic absence/fine. If they actually check in, the existing schedule's Present/Late rules apply; assigning a group does not reset the event clock.
- Existing check-ins/checkouts are never deleted by assignment changes. A removed participant with a saved check-in can still finish checkout during the checkout window, including access to required geofence configuration. Removal does not grant a new check-in or checkout-only record.
- Registration/face, schedule, geofence and server validation remain required. Disabled buttons are presentation only; Firestore rules enforce authorization.
- Notifications for new/updated events go to assigned active participants. An old notification is historical, not a grant of access. Survey availability uses the same assignment policy; survey response/data rules otherwise remain unchanged.
- Summaries, projections, analytics and PDF reports use multi-section eligibility. Real records remain visible even when the student's group is later removed. Historical section/profile behavior is otherwise unchanged.

## Deployment (manual; not performed)

1. Run `npm.cmd test` and `npm.cmd run check`.
2. Deploy the updated Firestore rules: `firebase.cmd deploy --only firestore:rules --project presence-a873f`.
3. Publish the matching web code. Do not deploy the new editor alone against old rules: saves will be rejected. Rules are backward-compatible with legacy attendance data; old editors must not be used to manage multi-section assignments.
4. Increment the Android version before building a new signed APK. Do not overwrite the published v1.6 assets. Distribute the new APK/update JSON together after device testing. Older APKs will not show the new all-student/view-only experience consistently.
5. Review/re-save the affected ongoing event, selecting the intended groups. Check a selected student and an unselected student, then removal/re-addition and checkout for an already-checked-in student.

No Cloud Functions, Blaze plan, paid hosting or new service is required. Reads, writes, notifications and live listeners still consume the existing Spark quotas. No automatic roster-refresh listener or per-student background write fan-out is added; membership refresh is explicit on admin Save. The existing 5,000-participant roster cap remains.

## Local security tests

Use Java 21 and Firebase CLI. This starts only a local demo project, with no production credentials or deployment:

```powershell
firebase.cmd emulators:exec --config firebase.audience-test.json --project demo-presence-audience --only firestore "node tests/event-audience.emulator.cjs"
```

The test script refuses non-loopback hosts and hardcodes the demo project. It tests server-side rejection of unassigned attendance, acceptance of assigned attendance, ongoing roster edits, removed-participant checkout, stale revisions, invalid sections, student edits and closed-event roster changes.

Validation completed: application regression tests; local Firestore emulator tests (including All students and Attendance Manager authorization); browser section-selection/legacy-restore checks in light/dark themes at 320, 390 and 1280 pixels; and the mobile web bundle build. No production records, rules, releases or installed apps were changed during validation.
