# Presence v1.8.25

## Password recovery

- A saved password no longer prompts another password change when automatic sign-in fails. Retry sign-in with the same new password, or return to login.
- Unconfirmed password saves show recovery guidance and prevent duplicate password submissions.
- After Firebase reports too many login attempts, Presence pauses further attempts for one minute and explains that Firebase may require a longer wait.

## Clearer Android updates

- A new dark update dialog shows installed and available versions, release notes, and download size when available.
- Download progress and verification are visible, with an option to continue using the app.
- Verified downloads remain ready when the app returns to the foreground. Download failures offer Retry and clearer guidance.
- Installation instructions explain Android permission and reopening Presence after installation.

Automatic update checks remain in place. A manual Check for updates button is planned for later.

## Installation

Download **Presence.apk** below and install it over the existing Presence app. Keep the existing app installed to retain local app data. After installation, reopen Presence.

This release retains the existing signing identity for compatible in-place updates. Android and Play Protect may still apply device-specific installation restrictions.

## Validation

JavaScript regression tests, module checks, Android compilation and unit tests, and APK package/signature/asset verification are performed before publication. Real-phone installation and visual checks still require device testing.
