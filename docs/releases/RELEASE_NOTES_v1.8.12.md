## Changes
- Add attendance readiness checks for connection, face registration, location permission and GPS.
- Show login/logout success messages after redirects, once per completed action.
- Add one active device session per account with an explicit Cancel / Transfer choice on the new device.
- Block transferred-out sessions through Firestore Rules and protected backend endpoints.
- Keep same-browser tabs on one session and filter future server notifications by the active session.

## Rollout
Accounts enroll when signing in through the updated client. Install this APK over the existing app. Older clients cannot transfer an enrolled account and need this update. Offline devices sign out when connected; server authorization blocks their old session.

## Android
Version 1.8.12 (21). Existing package and signing certificate retained. Both Presence.apk and its matching SHA-256 update manifest are included.
