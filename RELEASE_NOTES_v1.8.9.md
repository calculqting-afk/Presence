# Presence v1.8.9

- Super Admin login and dashboard routing now use the server-issued Firebase `superAdmin` claim. Knowing an account UID or changing a student profile role cannot grant Super Admin access.
- Sensitive admin actions now request password confirmation when authentication is stale. Matching live Firestore Rules independently enforce the five-minute authentication limit for role changes and protected deletions.
- Protected actions include role changes, clearing student accounts, removing events/fines, revoking attendance and resetting operational data. Cancelling password confirmation makes no change.
- Includes the current claim-based backend integration and existing attendance, GPS-proof, password-reset and face-registration flows. Student course/section self-edits remain available.
- Preserves existing account identities, attendance records, fines and face registrations. The existing Super Admin account keeps its UID and password.

The website, Cloudflare admin Worker and Firestore Rules were deployed separately. The face-service Apps Script deployment was completed by the operator. MFA is not included or enabled in this release.

This is the existing beta/debug-signed distribution, using the same application ID and signing identity as v1.8.8. Install it over your existing Presence app. No uninstall or database migration is required.

Validation: 403 application tests, 12 dummy-account Firebase emulator suites, JavaScript/module checks and Android beta build/unit tests. Physical-device acceptance remains a separate check.
