# Presence tests

Regular tests are grouped by feature; existing filenames are preserved.

| Folder | Coverage |
| --- | --- |
| `attendance/` | Check-in/out, QR, During attendance, reporting, history and corrections |
| `accounts/` | Registration, passwords, face reset, device sessions and agreements |
| `students/` | Personal information, courses, sections and student IDs |
| `admin/` | Administrator services and approval navigation |
| `events/` | Event audiences and sessions |
| `fines/` | Fine eligibility |
| `surveys/` | Survey behavior |
| `notifications/` | Push notifications |
| `mobile/` | Android update artifacts and login update controls |
| `data/` | D1 services, feature reads and optimization |
| `security/` | Frontend privacy and attendance security |
| `ui/` | Layouts, themes, launch intro and mascot |
| `integration/` | Dashboard composition, shared controllers and test discovery |
| `emulator/` | Firestore Rules suites using dummy local emulator accounts |

## Regular tests

Run from the project root:

```powershell
npm test
npm test -- attendance
npm test -- attendance-qr
npm test -- --list
```

`tools/run-tests.cjs` recursively discovers `.test.cjs` files, excluding `emulator/`. Group names or existing filenames without `.test.cjs` can narrow the run. Unknown selections fail rather than silently skipping tests. The runner sets the working directory to the project root, including when called from another folder.

Tests are now one directory deeper. File-relative imports use `../../assets/...` or similar; root calculations use `path.resolve(__dirname, '../..')`. Paths inside source-module fixtures retain their original meaning. Application files, URLs and database schemas are unchanged.

## Firestore emulator tests

Emulator suites remain separate from `npm test`, retain their local-only guards, and run sequentially because they use shared demo data.

```powershell
npm run test:emulator -- --list
```

To start an isolated emulator with the existing rules/configuration, use an installed Firebase CLI:

```powershell
firebase emulators:exec --only firestore --project demo-presence-audience --config firebase.audience-test.json "npm run test:emulator"
```

With a local emulator already running:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089'
npm run test:emulator
npm run test:emulator -- password-reset
```

The runner refuses to execute emulator suites without a local address. The suites hard-code the demo project; no production credentials are needed. A listing only reports filenames and does not connect to any database.

Native Android tests stay under `android/app/src/test/` and run through Gradle, as described in the [Android guide](../docs/android/ANDROID.md).
