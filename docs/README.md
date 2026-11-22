# Presence documentation

Choose a topic below. Commands in these guides run from the project root unless a guide says otherwise.

| Topic | Guides |
| --- | --- |
| Android builds and releases | [Android guide](android/ANDROID.md) |
| Deployment and Firebase | [Firebase setup](deployment/FIREBASE_SETUP.md), [password-reset Worker](deployment/CLOUDFLARE-PASSWORD-RESET.md), [phone notifications](deployment/PHONE-PUSH-NOTIFICATIONS.md), [face service](deployment/FACE-RESET.md) |
| Features and roles | [Role permissions](features/ROLE-PERMISSIONS.md), [ID correction and activity](features/ADMIN-ID-AND-ACTIVITY.md), [During attendance](features/during-attendance.md) |
| Security | [Security hardening](security/SECURITY-HARDENING.md) |
| Administrator maintenance | [Student ID helper](maintenance/CORRECT-STUDENT-ID.md), [local password recovery](maintenance/LOCAL_PASSWORD_RECOVERY.md) |
| Release history | [Release notes](releases/) |

The face-service source is [deployment/google-apps-script-face-upload.js](deployment/google-apps-script-face-upload.js). Moving its local file does not redeploy the existing Apps Script service.

## File locations

- Application URLs stay under `assets/`, `pages/`, and the root `index.html`.
- Root configuration files remain in place for Node, Firebase and Capacitor.
- Release notes live in `docs/releases/`; local publishers must read that directory.
- User-facing update highlights stay in `config/update-highlights.json`.
- Build and maintenance commands remain under `tools/`, so existing npm commands keep working.
- Private signing files, credentials and historical task scripts remain under the ignored `.android-tools/` folder. Do not move them into public assets.

Generated folders and logs are hidden in VS Code using `.vscode/settings.json`. This changes only the Explorer view; it does not delete files or change Git tracking. Use the Explorer's Show Excluded Files option or edit `files.exclude` when you need them.

Documentation is excluded from the local preview server, Firebase Hosting and the Android public-file bundle. GitHub can still display these guides as repository files.
