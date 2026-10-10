# Presence refactor: verification and testing

## What changed

The shared `assets/js/dashboard.js` authenticates the user, verifies the role, wires common navigation/notifications, and dynamically imports either `StudentDashboard` or `AdminDashboard`. Both dashboard classes retain existing form/render workflows. `StudentAttendanceController` owns GPS verification, check-in, server acknowledgement, and checkout. `AttendanceController.js` contains the attendance policy, late-confirmation controller, sync service, and browser-tab bridge. `GeofenceController` owns the map editor and loads Leaflet when needed. `ScopedSubscriptions` starts/stops listeners as views change and discards callbacks from stopped listeners.

The refactor uses client JavaScript and Firestore APIs already used by the app. It introduces no Firebase Cloud Functions or paid Firebase service. Existing role rules and late-arrival rule changes were preserved. This does not verify which Firebase plan the project is currently on.

## Automated checks (no Firebase credentials, npm dependencies, or database writes)

Run from the Presence project directory using Node.js 22 or later:

```powershell
node tools/check-modules.cjs
node --experimental-vm-modules --test tests/dashboard.test.cjs
```

Equivalent npm commands are `npm run check` and `npm test`. In Windows PowerShell, use `npm.cmd run check` and `npm.cmd test` if the npm PowerShell launcher is restricted. No `npm install` is needed.

The module check validates syntax, local import paths, and the hosting JSON. The tests link the module graph and run controllers with mock browser/Firebase objects. They cover navigation subscription lifetimes, stale callbacks, student/admin initialization, attendance boundaries, late-confirmation cancellation/revalidation, checkout writes and acknowledgement, missing/outside geofence rejection, blank-coordinate rejection, and failed map download retry. Node's VM Modules experimental warning is expected.

These tests do **not** prove that deployed Firestore rules permit/deny requests correctly, or that live camera, GPS, Google Apps Script uploads, and cross-device updates work. Use the browser checks and emulator rules tests below for those layers.

## Browser checks

For the October attendance update, follow [ATTENDANCE-UPDATE.md](ATTENDANCE-UPDATE.md) for roster deployment, accurate summaries, retry/reconciliation, paginated filters and missed-checkout review. CSV export is not part of this update.

Start the local preview:

```powershell
node tools/serve.cjs
```

Open `http://127.0.0.1:4173`. Stop the server with Ctrl+C. This only serves the local frontend: authentication, Firestore, and face uploads still use the configured real services. Use dedicated test accounts/events. Do not use operational-data reset or student removal against real student records as a test.

Use two separate browser profiles: one admin and one student. Also use two separate devices for at least one attendance test. The browser-tab bridge improves same-browser updates but cannot replace cross-device Firestore synchronization. Open DevTools Console and Network and keep a record of errors/results.

| Test | Actions | Expected result |
| --- | --- | --- |
| Role access | Sign in as a student, each admin role, and a signed-out visitor; try opening the other dashboard URL directly. | Correct dashboard/navigation for the role; unauthorized access redirects to sign-in. |
| Student home | Compare dashboard totals with known attendance and fine records. | Correct events attended, absences, days present, and pending-fine warning. |
| Navigation | Visit every permitted screen; use browser Back/Forward and refresh. | Correct title/screen, functional controls, no duplicate actions or console errors. |
| Student directory | Open Modify Students; filter/search/page through results; switch away and back. | Students, faces, presence, attendance filters, and fine filters refresh correctly. |
| Registration/profile | Add a test student; edit its data; sign in and update its permitted profile fields. | Saved fields persist after refresh; existing password requirements still apply. |
| Event creation/editing | Create a test event and edit name, audience, and attendance windows. | Student sees updates; linked records follow the existing synchronization behavior. |
| Before opening | Attempt check-in before Time In. | Check-in unavailable; no attendance document created. |
| Present | Check in between Time In and the check-in cutoff with a registered face. | One record with `arrivalStatus: present`, server timestamps, and correct student/event IDs. |
| Late/cancel | After cutoff but before Time Out, click check-in and cancel confirmation. | No attendance record created. |
| Late/confirm | Repeat and confirm. | One record with `arrivalStatus: late`; late badge on student and admin views. |
| Closed window | Attempt check-in at/after Time Out. | No new check-in permitted. |
| Checkout | Try before Time Out, within the checkout window, and after cutoff. | Only the permitted window accepts checkout; original check-in and arrival status remain intact. |
| Fast repeated clicks | Double-click check-in/confirm and switch views repeatedly. | No duplicate submission from the event grid; deterministic record ID remains unchanged. |
| Face requirement | Try check-in using a test student with no face registration. | Attendance blocked; face-registration screen opens. |
| Face workflow | Consent, start camera, capture, retake, register, refresh; admin resets a test registration. | Upload is confirmed before reporting success; registration/reset state updates. |
| Geofence editor | Open Create Events/Geofence; search, click, drag pin, change radius, save, edit again. | One map per editor, correct pin/radius, saved coordinates preserved. Enabled area cannot save with blank coordinates. |
| GPS checks | Deny location, test inside radius, then clearly outside radius. | Clear permission/error messages; outside check-in/checkout rejected. Use a real device as well as mocked coordinates. |
| Fines | Assign/update/complete a test fine and check student Fines and Profile. | Correct record, history, service duration, status, and pending indicator. |
| Live attendance | Keep admin Attendance Line open while student checks in/out on another device. | Update arrives without manual reload; Sync now works for permitted roles. |
| Reconnect | Go offline after loading records; return online and revisit the relevant view. | Cached data may display offline; fresh records/status return when connected. |
| Logout | Log out after using camera and navigating through screens. | Sign-in page returns, camera stops, presence reports logout, dashboard subscriptions are disposed. |

For boundary testing, create short test windows a few minutes apart. The emulator's server `request.time` determines rule enforcement; changing only the browser's clock does not change that server time.

## Scope and performance checks

| Data feed | Active views |
| --- | --- |
| Student profile, events, own attendance, own fines | All student views: needed for account/password enforcement, summaries, and pending indicators |
| Student dismissed history | Event History |
| Student face registration | Events, Face Registration, Profile; check-in also verifies the registration from the server |
| Admin events, students, super-admin profile | Shared admin feeds |
| Admin presence sessions, legacy presence, face registrations | Modify Students |
| Admin geofences | Create Events, Geofence Locations, Modify Events, Past Events |
| Admin fines | Assign Fine, Assigned Fines, Modify Students, Profile |
| Admin attendance | Dashboard, Attendance Line, Modify Students, Modify Events, Past Events, Profile |

1. In Network, enable Disable cache and reload as a student. `AdminDashboard.js` and `GeofenceController.js` should not download. Reload as an admin: `StudentDashboard.js` and `StudentAttendanceController.js` should not download.
2. On an admin home reload, `leaflet.js`, `leaflet.css`, and map tiles should not download. Open an event map: they should load then. Close/reopen: only one map should exist per editor.
3. Record cold-load bytes and time for both roles using the same network-throttling preset and device. Repeat several times and compare medians; do not treat a single faster reload as proof.
4. Verify listener scope with the automated tests. Firestore uses multiplexed connections, so a persistent Network connection alone does not prove a stopped collection listener is still active. Use emulator Requests/usage observations to investigate data reads.
5. Cache headers remain one-hour revalidation for stable JS/CSS paths; HTML remains `no-cache`. Filename fingerprinting and server-side directory pagination are future work, not part of this refactor. Some shared collection reads remain; quota savings depend on actual navigation and data updates.

## Shared light/dark navy theme

The login, admin and student pages use the same `ThemeController` and device/origin preference (`presence.loginTheme`). Theme switching does not call Firebase or change permissions. Each browser/profile has its own preference.

1. Choose Dark on login, sign in, and confirm the dashboard remains dark. Choose Light in the dashboard toolbar, reload, then log out and confirm login remains light.
2. Open two tabs on the same origin/profile. Toggle one and confirm the other follows. Separate Chrome/Edge profiles intentionally do not share this choice.
3. Check keyboard Tab focus and Enter/Space on the toggle; the accessible action should change to the opposite mode.
4. Check both modes at 320px and normal desktop widths: toolbar controls must remain usable without horizontal overflow. Review notifications, help/logout/profile dialogs, student directory/filter controls, attendance/fine/event cards and forms.
5. Verify maps, camera video and uploaded photos are not color-inverted. Status colors and correction badges must still be distinguishable. Retest normal admin/student actions in both modes.
6. With browser storage disabled, theme switching should still work for the current page. With slow/blocked Firebase requests, the theme toggle should remain independent.

Automated tests cover preference restoration/persistence, shared markup wiring, tab synchronization, lifecycle cleanup, storage failure and navy palette contrast. These checks do not replace real browser/mobile layout testing.

## Firestore rule testing

For the fixed administrator role policy, publishing steps, manual correction audit checks, and Auth limitations, follow [ROLE-PERMISSIONS.md](ROLE-PERMISSIONS.md).

Run security-rule tests in Firebase's Local Emulator Suite using a `demo-*` project ID and `@firebase/rules-unit-testing`. Explicitly load this repository's `firestore.rules`. The current automated suite mocks Firebase; it does not start the emulator, install that library, or connect this browser build to emulators.

Build an emulator test matrix that asserts:

- Signed-out users cannot read/write protected records.
- A student cannot read/write another student's attendance, fines, profile, or registration.
- Attendance creation succeeds inside the event's audience/window with the correct deterministic document ID, server timestamps, and arrival status.
- A forged `present` label after cutoff, a forged `late` label before cutoff, and a check-in at/after event close are rejected.
- Checkout cannot change identity, original check-in, or arrival status; it must follow the checkout window.
- Geofenced events reject missing/outside coordinates according to the deployed rules.
- Each admin role can perform only its allowed operations; unauthorized role assignment, reset, and deletion fail.

Use the emulator Requests tab and rule-coverage report to inspect failures. For camera and Google Apps Script face upload, complete the separate browser/device checks: Firestore emulation does not emulate those external services.

Current limitation to verify: the existing attendance rules require valid location fields and an enabled geofence, while the radius-distance calculation is performed in the browser. A successful browser outside-area test does not prove that a direct SDK request with forged coordinates is blocked. Include that direct-request case in security testing; this refactor did not add server-side distance enforcement.

## Circle and polygon boundary checks

### First check-in and rejection regression

Loading UI: check-in/checkout should disable the action immediately, show Checking in/out, Verifying location (when required), and Saving attendance. Success shows a checkmark; failure and late-consent cancellation restore the original label and allow retry. During GPS/network waits, navigate between Events and My Attendances or allow a live re-render: new buttons for the same operation must remain disabled with current progress. Test reduced-motion mode, light/navy, narrow mobile layout, and screen-reader status announcements. An accepted save awaiting an extra confirmation read must say Saved · refresh, not claim a verified record or keep spinning forever.

Checkout fix: republish the current rules, then test during a new event's checkout window. Checkout validates only its patch and preserves historical check-in metadata, including legacy fields. Verify only `status`, `checkedOutAt`, and optional `checkOutLocation` change. Missing/foreign check-ins, completed-record overwrites, changes to check-in fields, outside-window timestamps, invalid/missing required GPS, and foreign document IDs must remain denied. Repeated checkout must preserve the first checkout timestamp. The browser must refuse a missing or invalid server check-in before submitting. Rule tests here remain structural; emulator/live authorization testing is required.

After publishing the current `firestore.rules`, use a new event with no attendance document for the test student. Verify its initial document GET succeeds with `exists() == false`, then check-in creates exactly one record. Reload/retry and verify the original timestamp is preserved; complete checkout and verify only checkout fields change.

Rules-emulator/Playground cases: active student can GET their own missing `<uid>_<eventId>` document; another student's missing/existing document is denied; logged-out/inactive accounts are denied; owner-constrained attendance queries work, and unfiltered student queries remain denied. Existing records with another owner must stay denied even if their ID begins with the current student's UID. Check-in write restrictions for roster, face registration, server window, identity, timestamps and duplicate overwrites are unchanged.

The missing-document exception accepts the application's alphanumeric/hyphen/underscore UID and event-ID format. It does not permit collection listing or reveal existing foreign records. Automated rules checks here are structural only, not an emulator authorization test.

Also test browser GPS failure/timeout and invalid coordinates, malformed event dates, and permission failures during preflight versus save. Error messages should identify the failing stage without asking a GPS-timeout user to change an already-granted permission.

Publish the updated `firestore.rules` before saving polygon areas. Existing documents without `type` are circles; no data migration is needed.

- As Super Admin, Head Admin, and Attendance Admin, open Create Events and Geofence Locations. Select Circle or Polygon and confirm the relevant controls appear.
- Circle: set a center/radius, save and reload. Confirm the legacy circle still works.
- Polygon: place 3–10 points in boundary order, Close boundary, save, then reopen. Confirm its shape is restored. Undo should reopen it; Clear boundary should remove all vertices.
- Reject fewer than three points, crossed/duplicate/collinear edges, a boundary spanning over 10 km from its first point, and saving an unclosed shape.
- Switching types must show only the selected overlay and save only that type's coordinates. Search in polygon mode should navigate the map without adding a vertex.
- Check student check-in AND checkout inside/outside each boundary. Test polygon edge/vertex, a concave notch, and GPS accuracy over 20 m: the allowance remains capped at 20 m.
- Student Manager and student must not manage geofences, including direct unauthorized Firestore writes. Test these denials in the emulator.
- Verify light/navy and mobile placement; inspect the browser console for map/load errors.

Geometry and shape validation run in the browser. Firestore rules validate vertex count, coordinate types/ranges, and authorized writers, but do not enforce polygon topology or prove physical presence. Direct forged GPS submissions remain a known limitation. Automated Node tests are mocked; they do not replace live-device GPS tests or emulator rule tests. The Firestore emulator was not run here because Java is unavailable on PATH.

Implementation uses the existing [Leaflet polygon API](https://leafletjs.com/reference-1.9.4.html#polygon), without an additional drawing plugin.

## Official testing references

- [Firebase: test Cloud Firestore Security Rules](https://firebase.google.com/docs/firestore/security/test-rules-emulator)
- [Firebase: connect to the Firestore emulator and inspect requests/coverage](https://firebase.google.com/docs/emulator-suite/connect_firestore)
- [Firebase: build rules unit tests](https://firebase.google.com/docs/rules/unit-tests)
- [Chrome DevTools: Network reference, cache controls, and throttling](https://developer.chrome.com/docs/devtools/network/reference/)

Record the date, browser/device, account role, test event ID, steps, expected result, actual result, and any console/rules errors for each manual test. Commit/deploy only after the relevant role/device checks pass.

# Login and logout progress

- Hard refresh login, admin and student pages before testing.
- Submit valid login credentials: the button shows a spinner and “Signing in…”, then “Signed in” while redirecting. Repeated clicks or Enter must not send another login request.
- Submit an incorrect password: the original Continue button is restored and a second attempt works.
- On each dashboard, open Logout and confirm: both the confirmation and menu buttons show “Logging out…”; repeated clicks do nothing. Cancel, backdrop and Escape cannot dismiss the dialog during logout.
- Simulate a failed sign-out with a mocked Firebase rejection: buttons restore, an error appears, and retry is available. Session storage is only cleared after successful sign-out.
- Check light/navy themes, mobile widths, screen-reader progress announcements and reduced-motion mode (static progress indicator).
