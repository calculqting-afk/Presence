# Presence v1.8.26

## More reliable app updates

- Added Check for updates and the installed version to the Android login page.
- Checks show clear results for an available update, an up-to-date app, or a connection/server failure.
- Failed checks retry after 60 seconds while the app is open, respecting longer server-requested waits. Manual checks bypass the normal five-minute interval after success.
- Update discovery reads one small manifest from the latest stable release instead of scanning multiple release files.
- Backgrounding retains pending update offers and results. Older status responses cannot overwrite newer results.
- Login and attendance stay accessible while checking or downloading updates. Existing download checksum, package and signing checks are retained.

## Installation

Install **Presence.apk** over the existing app, then reopen Presence. The new login-page update button becomes available after installing this version. Your currently installed updater handles this installation.

This build retains the existing signing identity for compatible in-place updates. Android permissions and device-specific security restrictions may still affect installation; do not disable Play Protect.

## Validation

564 regression tests and 7 Android tests passed before release preparation. Android compilation, the mobile bundle and APK package/signature/asset checks are verified before publication. Real-phone installation and visual checks still require testing.
