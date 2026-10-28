# Browser-visible configuration and administrator privacy

## Implemented protections

The frontend no longer contains the administrator's personal email address or email-based Super Admin checks. `SUPER_ADMIN_UID` is the public, pinned Firebase account identifier. Login and dashboard role resolution use the authenticated Firebase user's UID; Firestore Rules and the existing Workers independently enforce that identity. A matching email, display name or stored `super_admin` student role grants no access. The existing Super Admin UID was verified to exist and be enabled before removing the email fallback.

Assigned staff/student roles are loaded from the server, not accepted from a stale local profile cache. Inactive accounts and unsupported roles are rejected. New administrator login session metadata no longer stores the email in `presenceSession.accountId`. The actual signed-in user's email may still appear in their own account/profile or Firebase Auth network responses; data already received by a browser cannot be hidden from that browser's DevTools.

Private `adminProfiles` and audit/activity records remain readable only by the pinned Super Admin under the existing policy. Students cannot list other profiles or read private administrator records. The Super Admin UID cannot be created/updated as a student profile, including through a mismatched profile UID. Student-visible reviewer display names in their own correction decisions remain intentional; they do not require reading private administrator profiles.

Firebase Hosting exclusions explicitly cover backend code, documentation/templates, hidden files, local tooling, native build folders, logs and credential/key filename patterns. Hosting headers include `nosniff` and a strict cross-origin referrer policy. These configuration changes apply at the next Hosting deployment; they do not configure GitHub Pages or VS Code Live Server. The project's custom preview server now checks the normalized public path, so encoded path traversal cannot expose backend/local files. Native web assets are built from the existing public-file allowlist.

The legacy Cloud Functions source and Google Apps Script face-upload template also use the pinned UID. They are not deployed by a Rules-only deployment. An existing Apps Script deployment must be updated/redeployed separately from its template if it is still used. The current Cloudflare password-reset/ID/notification backends already use UID/server role checks and keep service-account credentials server-side.

## Live configuration review (2026-10-28)

A read-only inspection found the existing Firebase browser key has both browser restrictions and API target restrictions. Those were preserved to avoid disrupting current website and Android clients. The allowlist is the existing broad Firebase-service list, not a newly minimized service list; review unused service targets before adding unrelated paid/AI products. Never reuse this public Firebase key as a secret credential for another service.

The project returned no App Check service configurations. No App Check enforcement or provider setup was enabled: current website/APK clients do not initialize an attestation provider, and enforcement would reject legitimate requests. Roll out compatible web/native providers, validate domains/package/signing configuration, release a compatible APK, monitor verified traffic, then deliberately enable enforcement. No billing upgrade was introduced.

Official references:

- [Firebase API keys](https://firebase.google.com/docs/projects/api-keys): public configuration is not a database access credential; authorization depends on authentication, Rules and backend checks.
- [App Check rollout guidance](https://firebase.google.com/docs/app-check/monitor-metrics): monitor clients before enforcing.

## Scope and validation

This change does not hide the Firebase project/API key, the current user's own Auth response, or information intentionally returned to an authorized user. It does not erase earlier Git commits, cached files, screenshots or installed APK assets. Private service-account JSON, signing secrets and passwords must never enter public bundles or API responses.

Tests cover UID-based login across email changes, inactive/forged staff roles, public-source/Hosting exclusions, normalized path traversal, and local demo Firestore privacy checks. Existing registration, correction, recalculation, reset and audit emulator suites also pass. Automated checks do not change real student records or passwords.
