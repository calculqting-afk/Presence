# Presence v1.3 — Registration and Camera Improvements

- Scrollable registration dialogs so every field and action stays reachable.
- Centered registration/status buttons, with Cancel or Close below the primary action.
- Clear red missing-field errors before password validation.
- Cleaner login page with fewer distractions and less spacing.
- Matching selfie-style live and captured-photo previews during face registration; saved image pixels remain unchanged.
- Object-oriented login and shared dashboard refactor with regression coverage.
- Existing GitHub update alerts remain available without Firebase tester enrollment or extra Google sign-in.

## Installation

Download **Presence.apk** and install it over your existing Presence app. **Do not uninstall.** Android will ask you to confirm the update. Existing version 1.2 users can also receive the update prompt after this release is published and the app checks again.

`presence-update.json` is required for the app updater; students do not need to download it manually.

## Release assets

Upload **Presence.apk** and **presence-update.json** from the same successful version 1.3 (version code 4) build. Keep both filenames unchanged.

Real-phone acceptance testing is still required for the full update/install flow and camera behavior. Automated tests do not replace device testing.
