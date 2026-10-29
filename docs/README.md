# Presence maintenance guide

These documents support maintenance and deployment; the website and APK do not load Markdown files at runtime.

| Topic | Guide |
| --- | --- |
| Firebase setup and account behavior | [Firebase setup](FIREBASE_SETUP.md) |
| Android builds, signing and releases | [Android](../ANDROID.md) |
| Current security requirements and private face-service setup | [Security hardening](SECURITY-HARDENING.md) |
| Administrator roles | [Role permissions](ROLE-PERMISSIONS.md) |
| Password resets | [Cloudflare password reset](CLOUDFLARE-PASSWORD-RESET.md) |
| Student ID correction and admin activity history | [Admin tools](ADMIN-ID-AND-ACTIVITY.md) |
| Local recovery tools | [Student ID helper](CORRECT-STUDENT-ID.md), [Password recovery](LOCAL_PASSWORD_RECOVERY.md) |
| Face uploads and resets | [Face service](FACE-RESET.md) |
| Phone push setup | [Phone push](PHONE-PUSH-NOTIFICATIONS.md) |

Optional feature guides, historical reports and testing walkthroughs have been removed. Use the current security guide for live requirements. For basic verification, run `npm.cmd test` and `npm.cmd run check` from the project root.

Keep the actual `tests/` files, build/release tools, vendored license notices and private setup/signing files. The current APK publisher reads `RELEASE_NOTES_v1.8.8.md` at the repository root. Completed local run logs are disposable and can be regenerated when needed.
