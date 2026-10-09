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

## Firestore rule testing

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

## Official testing references

- [Firebase: test Cloud Firestore Security Rules](https://firebase.google.com/docs/firestore/security/test-rules-emulator)
- [Firebase: connect to the Firestore emulator and inspect requests/coverage](https://firebase.google.com/docs/emulator-suite/connect_firestore)
- [Firebase: build rules unit tests](https://firebase.google.com/docs/rules/unit-tests)
- [Chrome DevTools: Network reference, cache controls, and throttling](https://developer.chrome.com/docs/devtools/network/reference/)

Record the date, browser/device, account role, test event ID, steps, expected result, actual result, and any console/rules errors for each manual test. Commit/deploy only after the relevant role/device checks pass.
