Presence v1.8.19 is an attendance QR testing update using the existing beta signing identity. Production signing is deferred until real-phone QR attendance testing passes.

- My Attendance QR displays your student code immediately, without choosing an event.
- A countdown above the code shows when it renews. Codes expire after 30 minutes and renew while the page is open.
- Download a PNG with your name, Student ID and Philippine-time expiry. Android uses its system save dialog; no storage permission is added.
- Authorized attendance administrators choose the event/session and action, verify the student in person, then confirm attendance. The backend continues to enforce eligibility, session validity, attendance windows and duplicate protection.
- Existing event-specific QR codes remain supported.

Validation: 505 automated web tests passed; Android compilation and unit checks passed. Packaged assets and signing integrity are verified during release. Real-phone QR scanning, attendance and PNG saving require acceptance testing.

Install Presence.apk over the existing app to retain local app data. This is the current beta/debug-derived signing identity, not the planned production release. Never disable Play Protect to install the app.
