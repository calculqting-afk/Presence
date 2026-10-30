# Security hardening — 2026-10-29

## Admin recent-login checks — 2026-10-30

The dashboard now checks the signed Firebase token's `auth_time` before changing roles, deleting student accounts, removing events/fines, revoking attendance or resetting operational data. If authentication is four minutes old, it asks for the current administrator's password in a separate modal. Cancel or failed authentication makes no write. Passwords are cleared immediately after the attempt and never saved in application storage or activity logs. The existing Firebase keep-signed-in preference stays unchanged.

The matching Rules require authentication less than five minutes old for role changes and the protected deletions. Refreshing a token alone does not satisfy this requirement: Firebase reauthentication updates `auth_time`. Missing, future and expired authentication times are rejected. Existing role/permission checks remain required; a fresh ordinary student login cannot perform these actions. Password resets and ID corrections already enforce recent authentication in the Worker.

Publish these Rules with the updated dashboard. Older website/APK versions can be denied these admin actions after five minutes until they sign in again or update. Student attendance and personal course/section editing do not require admin password confirmation. Existing multi-batch cleanup is still non-atomic: if network/authentication expires during a large cleanup, some batches may have completed; no automatic retry bypasses the Rules.

Super Admin authority now uses a server-issued `superAdmin: true` Firebase claim. The Worker checks both the signed token and the current Auth account claim; Rules check the signed claim. No UID or email grants authority. MFA and a sign-out-all-devices button remain separate work. Existing immutable role and attendance activity records remain in place; this change does not claim new audit coverage for every legacy deletion path.

Verification: `npm.cmd test`, `npm.cmd run check`, and `tests/admin-recent-login.emulator.cjs` plus the existing emulator suites. Dummy emulator tests do not modify production accounts or records.

## Super Admin migration — 2026-10-30

The existing account was given the claim through the trusted local operator helper. Other custom claims, UID, password, student records and admin profile were retained. A server-only protected-account reservation lives in `superAdminAccounts`; clients cannot read/write it or create a student profile for a reserved UID. Assigning a student profile's `role` never grants this claim. There is no public endpoint or dashboard control for granting Super Admin.

Operator recovery/migration: configure `PRESENCE_SERVICE_ACCOUNT_KEY` privately, run `node tools/migrate-super-admin.cjs --uid EXISTING_ADMIN_UID` to preview, and add `--apply` only for the verified existing administrator profile. Preserve other claims. On removal/recovery, use trusted Firebase administration to remove the claim and revoke refresh tokens; old signed tokens can remain valid in Rules until expiry, while the Worker rejects removed current claims immediately. This migration does not revoke existing sessions.

Website routing forces token refresh to receive the new claim. The admin password modal and claim-based login are included in APK v1.8.9. Existing APKs retain their packaged UI until the update is installed. Existing accounts and attendance are preserved. The legacy Functions source was updated but was not deployed or enabled as a new paid service.

Apps Script is separately deployed. Replace Code.gs with the complete `docs/google-apps-script-face-upload.js`, retain all Script Properties, then edit the existing deployment and choose New version. The local source uses Firebase's authenticated account lookup to read current custom claims. The operator reported completing the Apps Script deployment on 2026-10-30. Browser automation could not safely determine the current URL, so live face upload/reset acceptance has not been independently verified here.

## Production activation

The stricter Firestore Rules were activated on 2026-10-29 following the user's explicit request. Server-owned face acknowledgements, restricted student-ID index reads and mandatory backend location proofs for geofenced attendance are now enforced. APK v1.8.8 or newer is required for geofenced student attendance. The activation order below is retained as the setup/migration reference, not a statement that enforcement is still pending.

Students can still edit their own personal information, including course and section. That is an intentional product decision. Captured event rosters remain authoritative where available; section changes can affect eligibility for legacy/unrostered events and some newly enrolled profiles.

## Changes

- Face acknowledgement is server-owned in the new Rules. The existing Apps Script uploads a JPEG/PNG to its private Drive folder, then calls the authenticated Worker with a private shared secret. The Worker verifies the Firebase session, active/unrestricted profile and saved-file reference, and creates the acknowledgement once. The secret never enters website/APK assets. Direct student create/update requests are denied. Existing registrations remain intact; this does not retrospectively attest their original upload or add per-check-in identity/liveness verification.
- The student-ID index is readable only by Super Admin, Head Admin and Student Manager. Login derives the Firebase login identity from the typed ID and does not need index access. Existing admin duplicate checks and approved registration index creation remain supported.
- New website/APK sessions use Firestore memory cache. Startup attempts to delete the previous IndexedDB cache before starting Firestore. Older tabs can block deletion; close all old Presence tabs and reload. Firebase Auth's explicit keep-signed-in option is separate and remains available. This does not wipe browser password-manager data or downloaded exports.
- Newly issued admin temporary passwords expire after 30 minutes. Completion rejects them at the exact deadline. A one-minute Worker schedule replaces expired credentials with an undisclosed random password and revokes sessions; the student remains restricted and must request a new reset. Firebase Auth invalidation can lag the deadline until a scheduled run succeeds, but expired password completion remains denied. A failed Auth/network operation keeps the lock and is retried. Older ledgers without `expiresAt` have their deadline derived from issue time for completion; use a fresh admin reset for those accounts. The cron only queries new expiration-bearing ledgers.
- GPS remains collected by the device. The Worker checks circle/polygon geometry against the current saved boundary, current attendance window, caller eligibility or a valid previous check-in for checkout, and a maximum 20-meter accuracy allowance. It issues a private proof valid for 30 seconds, matching the exact submitted coordinates, action and boundary. Rules require the proof and keep existing server timestamp, roster, duplicate and lifecycle checks. Boundary edits invalidate old proofs. No-geofence events do not need a proof. This closes direct-write bypass of geometry validation; it does not detect every GPS-spoofing method or establish physical presence.
- Patched dependency lockfiles: root audit fix; legacy Functions upgraded to `firebase-admin ^14.5.0` and `firebase-functions ^7.4.0`. Both npm audits report zero known vulnerabilities at update time. Legacy Functions are not deployed by this update; Node 22 remains their configured deployment runtime.

## Activation order

1. Deploy the updated admin Worker with its existing Firebase service-account secret and a new **FACE_REGISTRATION_SECRET**. It adds `/v1/student/attendance-location`, `/v1/internal/face-registration`, and a one-minute expiration cron. Existing password-reset and ID-correction endpoints remain available. The existing service account already needs the previously configured Firestore get/create/update/list permissions. The cron adds about 1,440 small expiration queries daily, plus actual expiration writes; this consumes the existing Firestore/Worker allowances.
2. In the existing face-upload Apps Script, replace the source with `docs/google-apps-script-face-upload.js`. Preserve existing Script Properties **FIREBASE_API_KEY** and **FACE_FOLDER_ID**. Add **FACE_BACKEND_SECRET**, using the exact private value stored locally in `.android-tools/face-backend-secret.txt`, matching the Worker secret. Do not paste it into chat, GitHub, browser-source files or screenshots. Deploy a new version of the existing web-app deployment so its `/exec` URL remains unchanged. Keep the current execution identity and Drive folder ownership.
3. Using a deliberately selected test student, verify an actual photo upload, acknowledged registration and admin reset. Existing uploaded records should remain readable. Server confirmation acknowledges a saved upload; the existing face-detection UI is not replaced with a new biometric system.
4. Publish the updated website and release/install an APK containing `StudentAttendanceController`'s proof request. Verify real-device GPS check-in and checkout, login, expired-password handling and logout/cache cleanup.
5. Only then deploy the stricter `firestore.rules`. Older APKs do not request GPS proofs and will be denied attendance writes for geofenced events after enforcement. They need the updated APK. Do not deploy the GPS Rules while deliberately keeping those old APKs in attendance use. Old face-upload script versions also cannot acknowledge uploads once the new face Rules are enforced.

Worker deployment, Apps Script deployment, website push, APK release and Rules enforcement are separate operations; verify each rather than assuming a GitHub push activates everything. Rules enforcement was subsequently activated as recorded above; real-device and Apps Script acceptance checks remain separate.

## Verification

- Application tests cover Worker authorization, malformed/outside coordinates, polygon validation, proof lifetime, actor limits, private face acknowledgement, reset expiry and invalidation, and retained academic self-edits.
- `tests/security-hardening.emulator.cjs` checks direct face-write denial, protected ID reads, academic self-edits, forged/expired/mismatched proofs, valid check-in/checkout and duplicate rejection.
- All existing emulator suites continue to run. The event-audience fixture now derives the Philippine event date from its simulated clock instead of using an expired hardcoded date.
- The module checker, mobile web build and Worker bundle validate imports/syntax. Real Apps Script/phone acceptance remains necessary before Rules activation.

No existing student account, attendance record, face photo or fine is automatically rewritten by the tests or migration. The expiry cron intentionally invalidates newly issued temporary credentials after their deadline.
