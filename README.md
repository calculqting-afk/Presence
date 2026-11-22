PRESENCE WEB/APP SYSTEM

    
## Project navigation

Start with the [documentation index](docs/README.md).

| Folder or file | Purpose |
| --- | --- |
| `index.html` | Sign-in page and login dialogs |
| `pages/` | Admin/student dashboards and policy pages |
| `assets/js/student/`, `assets/js/admin/` | Role-specific dashboard code |
| `assets/js/controllers/`, `assets/js/core/` | Shared controllers and policies |
| `assets/css/`, `assets/images/`, `assets/vendor/` | Styles, images and third-party browser libraries |
| `config/` | Browser Firebase configuration and short update highlights |
| `mobile/` | Capacitor bridge and Android login update controls |
| `android/` | Native Android app, updater, permissions and build settings |
| `workers/` | Cloudflare admin API and notification services |
| `functions/` | Trusted maintenance utilities and legacy Firebase backend source |
| `tests/` | Regression tests |
| `tools/` | Build, preview and administrator maintenance commands |
| `docs/` | Guides grouped by Android, deployment, features, security, maintenance and releases |
| `Pictures/` | Original design artwork; not the app's published image directory |

## Common tasks

Run these commands from this project folder:

```powershell
npm run serve          # Local website preview on port 4173
npm test               # Regression tests
npm run check          # JavaScript syntax and import checks
npm run mobile:build   # Generate the Android website bundle
npm run android:sync   # Generate bundle and sync Capacitor
npm run android:beta   # Build the current compatible APK distribution variant
```

The preview and app use the configured Firebase project. Follow the [Android release guide](docs/android/ANDROID.md) before publishing. Build commands generate files; they do not publish a release by themselves.

## Guides

- [Deployment](docs/deployment/)
- [Features and permissions](docs/features/)
- [Security requirements](docs/security/SECURITY-HARDENING.md)
- [Administrator maintenance](docs/maintenance/)
- [Release notes](docs/releases/)

## Generated files

VS Code hides `node_modules/`, `mobile-web/`, `.android-tools/`, `.firebase/`, build folders and debug logs to keep the Explorer readable. They still exist on disk. The APK build generates `mobile-web/` and native public assets; edit the source folders above, not generated copies.

Keep credentials, signing keys and private task files out of public folders. Preserve the existing application paths when reorganizing, and update references together whenever a guide or tool moves.

Test files are grouped by feature: see [tests/README.md](tests/README.md). `npm test -- attendance` runs one group; `npm test -- --list` lists the regular suites. Firestore emulator tests use the separate `npm run test:emulator` command and require a local emulator.
