# Presence security review — 2026-10-29

This records the initial audit, before the subsequent fixes. See [Security hardening](SECURITY-HARDENING.md) for the implementation and staged activation status. The dependency findings below were subsequently patched; mandatory face/index/GPS Rules still require the coordinated rollout described there.

Scope: current working-tree website, Firestore Rules, Cloudflare Workers, legacy Functions sources, dependency lockfiles, and the existing local v1.8.7 beta APK. This is a source review plus automated local tests, not a complete penetration test or certification. Production student records were not modified. Live deployed Rules, Worker versions, IAM, API-key restrictions, App Check enforcement, Apps Script deployment, and backup configuration were not independently verified.

## Findings, in priority order

1. **High — face-registration acknowledgement is client-writable.** `firestore.rules` permits a student to create/update their own `faceRegistrations/{uid}` document with `registered: true`, without a field allowlist or trusted verification evidence. Attendance Rules accept that flag as the face prerequisite. A dummy authenticated student successfully wrote only `{registered:true}` through the emulator. This bypasses the registration prerequisite; it is not evidence of a stolen biometric or another student's account being compromised. Make registration acknowledgement server-owned and validate the upload/verification workflow before issuing it. If per-attendance face identity is required, a registration flag alone does not establish it.

2. **High — GPS evidence is trusted from the client.** `withinSparkGeofence` checks that a geofence exists/enabled and that the submitted coordinates have valid types/ranges, but does not evaluate circle distance/polygon membership or prove device location. Direct writes bypass the frontend distance check. Validate geometry on a trusted endpoint and disallow equivalent direct client writes; device integrity/anti-spoofing is a separate limitation. Client-supplied GPS, even checked on a server, is not proof of physical presence.

3. **Medium — students can change their own section and course.** The self-update allowlist on `students/{uid}` includes both fields. The emulator confirmed an ordinary student changing section from 2A to 2B without approval. Eligibility falls back to current section for events without a roster and for some newly created profiles, so this can affect participation eligibility. Existing captured rosters limit the impact for older students/events; not every roster can be bypassed. Restrict academic assignments to authorized admins or an approval workflow.

4. **Medium — persistent Firestore cache survives logout.** `config/firebase-config.js` enables `persistentLocalCache` across tabs. Logout signs out, disposes the dashboard and clears selected sessionStorage keys, but does not clear Firestore IndexedDB. Previously downloaded information can remain on a shared device. This is a local-device privacy issue, not proof another user can read it from the server. Use memory caching for sensitive/shared-device sessions or implement deliberate cache cleanup with multi-tab handling.

5. **Medium — temporary passwords have no application expiry.** The reset Worker verifies Firebase ID-token expiry, recent admin authentication, roles, revocation, leases, operation replay and rate limits. However, the generated temporary Firebase password has no deadline; the two-minute lease is an operation lock, not password expiry. It remains usable for restricted login until changed or reset again. Add a server-owned temporary-credential expiry and enforce it in the completion flow; fully preventing expired temporary authentication may require invalidating that credential server-side as well. Student ID previews separately have a five-minute signed expiry.

6. **Medium — student-ID index readable by every signed-in account.** `studentIds` allows `read` whenever authenticated, including list access. The emulator confirmed another student's index can be read. It reveals IDs and UID associations, not full private profiles. Review whether this index is needed client-side and move lookups/duplicate checks behind scoped server operations.

7. **Dependency maintenance required.** npm audit reported 3 moderate findings in the root build-tool dependency tree (`@capacitor/cli`, `xcode`, `uuid`) and 10 in `functions` (1 high, 9 moderate). The high advisory is a `body-parser` denial-of-service issue. The Cloudflare Workers do not use that Functions dependency tree. Functions deployment/reachability was not verified, so this is not a confirmed exploitable production endpoint. Some suggested fixes include a major `firebase-admin` upgrade and need regression tests rather than blind force-upgrading.

8. **Test fixture drift.** `tests/event-audience.emulator.cjs` hardcodes the event date to 2026-10-20 while scheduling windows use the current time. The unchanged suite fails at checkout with Rules evaluation errors. An ignored copy using the current Philippine date passes the entire suite. This is not a demonstrated production checkout regression. Make this fixture date dynamic in the next test-maintenance change.

## Checklist results

| Check | Result / evidence |
| --- | --- |
| 1. Firebase Rules | Default deny present; ten suites exercised, with audience date corrected in an ignored test copy. No Realtime Database use found in inspected app imports/config; any separately enabled database remains unverified. |
| 2. Admin access | Student directory/private admin/audit reads and forged Super Admin roles denied in emulator. Broader admin roles intentionally retain directory/report access; least-privilege review still advisable. |
| 3. Authentication | Worker validates Google RS256 signature, project/issuer, expiry and authentication timestamps; account disable/revocation and current roles checked for privileged operations. |
| 4. Role escalation | Self-promotion denied; Super Admin role changes require restricted fields and atomic activity history. |
| 5. Student privacy | Other student profile reads denied; student-ID index and shared-device cache issues above remain. Face documents are readable by all configured admin roles, so field-level minimization needs review. |
| 6. Attendance integrity | Ownership, server timestamps, session windows, status transitions, duplicate record ID, corrections/revocations and fine permissions tested. GPS/face trust gaps remain. |
| 7. Password reset | Strong authorization, no-store response, reset replay/cooldown/actor limits and required password change; temporary-password expiry missing. No email reset-token flow is implemented by this feature. |
| 8. Provisioning | Approved registration and admin creation tested; students cannot assign privileged roles. Public Firebase Auth signup can still create an Auth identity; approval controls application access. |
| 9. XSS / validation | Reviewed render paths use escaping/textContent and backend input bounds. Tests cover hostile text/export handling. This is not exhaustive coverage of every DOM sink or external Apps Script. |
| 10. API security | Workers require bearer authentication and bounded JSON bodies. Durable operation limits exist for resets, ID corrections and push registration. CORS is not authorization; edge/global abuse controls and live configuration were not verified. No App Check initialization found in inspected client sources. |
| 11. QR / face | Deterministic attendance IDs and Rules prevent repeat completion. Survey QR links are navigation, not trusted proof of physical presence. Face acknowledgement and client GPS need stronger server enforcement. |
| 12. Secrets | Pattern scan of 304 tracked files found no PEM private keys, service-account JSON bodies or GitHub-token patterns within the scan limits. Existing v1.8.7 APK: 140 public entries; scanned text entries up to 1.5 MB had no matching secret patterns. No full Git history/binary secret scan or live hosted-file audit performed. Public Firebase/Android config is not a private credential. |
| 13. Sessions/cache | Logout and presence lifecycle have automated regression coverage; persistent Firestore cache remains a privacy gap. Android manifest disables OS app backup. Physical-device logout/offline checks remain outstanding. |
| 14. Audit logs | Client audit/activity updates/deletes denied; corrections, revocations and request decisions require atomic matching history. Backend service accounts bypass client Rules, so IAM and credential custody remain relevant. |
| 15. Backups/dependencies | Dependency findings above confirmed. No automated database backup and tested restore workflow was established from inspected project files. Console backups and externally managed copies were not verified; Excel attendance exports are not full database backups. |

## Verification

- `npm.cmd test`: **390 passed, 0 failed**.
- Existing emulator suites: admin privacy, student provisioning, password reset, push notifications, attendance time, attendance revocation, admin activity, correction requests, arrival recalculation all passed.
- Event audience/session/geofence suite: passed with current-date fixture in an ignored copy; original fixture failure retained in the log.
- Additional emulator probes confirmed the face-flag, own-section and student-ID index permissions described above.
- `npm.cmd audit --json` and `npm.cmd audit --prefix functions --json`: completed against npm's advisory service.
- Review scripts and detailed logs are ignored under `.android-tools/security-review-*`; they never use production Firebase credentials for emulator writes.

No application code, deployed Rules, backend service, GitHub branch or APK release was changed by this review. Earlier uncommitted attendance changes remain intact.

Suggested next implementation order: server-owned face acknowledgement; restrict academic-field edits and index reads; shared-device cache policy; temporary-password expiry; trusted attendance endpoint with geometry checks; tested dependency updates and backup/restore procedure. Coordinate restrictive Rules changes with existing APK compatibility before deployment.

References: [Firebase API keys](https://firebase.google.com/docs/projects/api-keys), [Firebase security checklist](https://firebase.google.com/support/guides/security-checklist), [body-parser advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828), [uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
