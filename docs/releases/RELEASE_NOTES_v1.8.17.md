Presence v1.8.17 fixes live student status and valid attendance rejection.

- Refresh online status automatically when a student's device session changes, with bounded short follow-ups for the first heartbeat. Idle polling remains once per minute, and leaving Modify Students stops polling.
- Reduce duplicated Firestore rule evaluations that could reject valid attendance for section-restricted events and accounts with password-reset metadata. Required fields, timestamps, arrival status, device sessions, face registration and trusted location proofs remain enforced.

Validation: 482 automated tests passed. Attendance and device-session emulator regressions passed, including valid on-time/late check-in, duplicate rejection, malformed/missing GPS fields and expired or mismatched location proofs. Attendance rules were deployed separately before this release. APK signing and bundled public files verified before publication.

Install Presence.apk over the existing app to retain its data. The matching presence-update.json supports the existing in-app update checker. This update retains the existing signing identity and beta distribution build for update compatibility; it does not claim to resolve a Play Protect warning. Real-phone installation and attendance still need device testing.
