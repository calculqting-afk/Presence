# Student Account and Password Improvements

- Fixed Add Student and Approve Account permissions to allow the ordinary student role while rejecting elevated roles and role-change metadata during creation. The corrected Firestore rule has been deployed.
- Newly approved student accounts are flagged to choose a new password on first login. Existing approved accounts are not bulk-reset.
- The admin Change Student Password dialog accepts letters, numbers and symbols, with a minimum of 6 and maximum of 15 characters.
- Added a trusted local terminal helper for correcting a registered student's login Student ID while preserving the Firebase UID, password and historical records. Includes duplicate checks, dry-run, confirmation, journaling, verification and resumable partial failure handling. The helper runs on a trusted PC and is not included in the APK. See docs/CORRECT-STUDENT-ID.md in the source repository.

## Installation

Download **Presence.apk** and install over your existing app. **Do not uninstall first.** Version **1.8.2**, version code **11**, retains the existing signing identity.

New approval flags apply when approval/profile creation runs in the updated admin application. The deployed account-creation rule also applies to earlier APKs. Already approved students require a separate targeted flag update if a password change is needed.

This remains the GitHub-distributed beta with the existing debug signing identity. Signing does not guarantee that Play Protect will show no warning. Do not disable Play Protect.

Verify account creation/approval, first-login password setup and installation on a real phone after updating. No Blaze upgrade or hosted backend is required for these changes; normal Firebase quotas apply.
