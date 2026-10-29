# Presence v1.8.8

- Added attendance revocation with a required reason, typed confirmation and preserved audit history. Existing fines are unchanged.
- Strengthened attendance time checks: checkout must follow check-in, corrections use the event's Philippine date, and invalid historical records are marked for review. Valid sub-minute attendance displays accurately.
- Improved the correction dialog schedule layout and removed redundant audit-history text.
- New sessions use memory-only Firestore caching and attempt cleanup of the previous offline cache. Close old Presence tabs and reload to finish legacy cleanup.
- Admin temporary passwords now have a 30-minute completion deadline, with backend credential invalidation on the expiry schedule.
- Added backend GPS boundary validation and short-lived location proofs to the updated app. Students can still edit their own course and section.
- Updated vulnerable build and legacy backend dependencies.

## Security rollout status

The Cloudflare Worker update is deployed. Server-owned face confirmations, restricted student-ID index reads and mandatory GPS-proof Firestore Rules are prepared and tested but are **not yet enforced in production**. The existing face-upload Apps Script must first be updated with its private backend setting, and students must install this updated APK before GPS-proof enforcement. Existing APKs do not request those proofs. See `docs/SECURITY-HARDENING.md` for the activation order.

This is the existing beta/debug-signed distribution, with the same application ID and signing identity as v1.8.7. Install over the existing app. The update does not migrate or delete student records.

Validation: 400 application tests and 11 local Firebase emulator suites passed; module/import checks, public mobile build and Worker bundle passed. Physical-device/Apps Script acceptance remains required before the stricter Rules are activated.
