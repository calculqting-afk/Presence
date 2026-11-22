Presence v1.8.22 improves security and attendance reliability:

- Protect account approval rendering and validate registration IDs.
- Complete first-login password setup through the authenticated backend; prevent direct password-setup flag changes.
- Add per-account backend request budgets to reduce quota abuse.
- Load historical events only in views that need them and stop attendance listeners while hidden.
- Require fresh attendance GPS readings (within 30 seconds) with accuracy of 50 metres or better; preserve admin QR attendance as the fallback.
- Preserve older event-notification links to attendance summaries.

Install this APK over the existing version. Older APKs must update before using the stricter GPS verification. Server attendance records remain unchanged.

This build retains the existing beta signing identity for compatible updates. Automated tests passed; physical-device GPS, QR scanning, and installation still require acceptance testing. GPS readings remain device-reported and free service quotas still apply.
