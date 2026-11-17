Presence v1.8.24 adds optional During attendance checkpoints.

- Admins can enable one checkpoint per Morning or Afternoon session, set its name and opening/closing times, or leave the feature off.
- Checked-in students can confirm presence during the checkpoint window using the existing face-registration and location requirements. Admin QR scanning also supports During attendance with in-person identity confirmation.
- Checkpoint confirmations preserve check-in, checkout, arrival status, and duration. Missed checkpoints are marked for review without automatically creating fines.
- A clearer modal groups the enable switch, checkpoint details, guidance, and save controls. Students who have not checked in see “Check in first” while the checkpoint is open.
- Event schedule edits cannot exclude an enabled checkpoint. Pending verification cancels on navigation, logout, account/session changes, or checkpoint replacement. Already-sent requests reconcile through attendance syncing.
- Server authorization, time windows, duplicate protection, GPS checks, and database rules protect checkpoint configuration and confirmations.

Install over the existing APK. This build retains the existing beta signing identity and updater for compatibility. It is not a switch to production signing.

Validation: 555 automated tests, 11 local database security suites, module checks, APK signature and packaged-asset checks. Real-device GPS, QR camera, notifications, and installation still require acceptance testing.

Suggested test: enable a future checkpoint under Modify Events, check in as a student, confirm During attendance, and check out. Also test QR confirmation, leaving Events during verification, and rejecting schedule edits that exclude the checkpoint.
