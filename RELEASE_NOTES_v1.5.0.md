# Presence v1.5 — Animated Intro and Student Account Improvements

- Added a four-second intro with expanding blue rings, a rotating logo and animated Presence lettering.
- Newly admin-created student accounts now prompt students to choose a personal password on first login. Existing accounts are unchanged.
- Added a five-second countdown and explicit confirmation before removing an entry from student event history. Attendance records and school events are not deleted.
- Centered mobile dashboard modals and retained internal scrolling for taller dialogs.
- Retained reduced-motion support and the existing GitHub update workflow.

## Installation

Install the new APK over your existing Presence app; do not uninstall first. Android will ask you to confirm installation.

## Publisher checklist

- Suggested tag: `v1.5.0`; target the commit containing these updates and version code **6**.
- Upload both `Presence.apk` and `presence-update.json` from `android/app/build/outputs/apk/beta/` together.
- Publish only after both assets have uploaded. Do not reuse an older update manifest.
- Test on a phone before broad distribution: update in place, login, intro, first-login password change for a new test account, history-removal countdown, and centered logout modal.
- This build retains the existing debug signing identity for compatibility with the currently distributed test APKs; it is not a Google Play production release.
- Building these files does not publish GitHub or deploy Firebase. No new Cloud Functions are required by these changes.
