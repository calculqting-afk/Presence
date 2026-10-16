# Presence Android

Capacitor bundles the public website files. Firebase continues serving live accounts, events and attendance. UI/code changes require rebuilding and distributing the APK.

Package ID: `io.github.calculatingafk.presence` (choose the final ID before publishing). Android 7.0/API 24 or newer. Internet is required for Firebase, remote JavaScript, maps and photo uploads.

## Build

Run `npm run android:sync` after changing web code, then open the `android` folder in Android Studio (`npm run android:open`). Allow Gradle and Android SDK downloads to finish. Use **Build > Generate App Bundles or APKs > Generate APKs**, or run `android/gradlew.bat assembleDebug` from the Android folder with Android Studio's JDK configured.

Alternatively run `npm run android:apk` to sync and build using the portable Java 21 JDK if present, or your `JAVA_HOME` configuration.

Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`. Debug builds are for testing; a signed release build is required for distribution. Never commit signing keys.

Use **Java 21** as the Gradle JDK for this generated project. Android Studio Rabbit ships Java 25, which cannot run the generated Gradle 8.14.3. In Android Studio use **Settings > Build, Execution, Deployment > Build Tools > Gradle > Gradle JDK** to select/download JDK 21. A portable JDK can also be stored locally in the ignored `.android-tools` directory. Keep the generated SDK 36 target and install that SDK if requested during Gradle sync.

## Location

Android uses Capacitor Geolocation with precise foreground permission. The website continues using browser GPS. Requests share one pending operation; a result obtained after leaving the page is discarded. Permission denial, unavailable GPS and timeout have separate messages. After enabling location, return and press Check in/Check out again. Geofence checks and server attendance validation remain in effect. No background location permission is requested.

## Real-phone acceptance tests

- Login, logout, registration and account approval.
- Allow precise location; verify check-in and checkout inside the boundary, and rejection outside it.
- Deny permission, retry after enabling it in app settings, and test device location switched off.
- Repeat-tap attendance and background the app during GPS; verify no unintended attendance write.
- Test face camera consent, capture, image upload and profile photo selection.
- Test Android Back, analytics, event navigation, keyboard and narrow-screen layouts.
- Disconnect internet and check that failures are reported without claiming attendance was saved.

Camera capture keeps the current WebView live-camera workflow; it still requires device testing. The APK has a different local origin from the website, so Firebase authentication storage is separate. Email/password sign-in is retained. Survey links/QR codes to the hosted website open that website; native deep-link routing is not configured.

## Update alerts without Google sign-in (GitHub Releases)

Firebase's tester updater has been replaced. Version 1.2 (3) uses public releases in **calculqting-afk/Presencee** (the verified Git remote). No tester invitation or Google account is needed. Presence student login and Firebase attendance data are unchanged.

Run `npm run android:apk` (debug) or `npm run android:beta` (beta). After a successful build, the output directory contains **Presence.apk** and **presence-update.json**, generated from the actual APK metadata and SHA-256 checksum. Both variants include the updater and retain the existing debug signing identity; release builds disable self-updates for future Google Play distribution.

### Publish each update

1. Increase `versionCode` and `versionName` in `android/app/build.gradle` before every new build (current: 5 / 1.4; next: 6 / 1.5).
2. Build using one of the commands above.
3. Create a GitHub release in **calculqting-afk/Presencee**, for example tag `v1.2.0`, title `Presence 1.2 — Updates without Google sign-in`.
4. Upload **both files from the same build**: `Presence.apk` and `presence-update.json`. Keep those exact asset names. Publish after both uploads complete. Public prereleases are intentionally supported too; drafts are ignored. Publishing a qualifying release makes it eligible for every installed app with a lower version code, so do not use this repository for private test-only updates.
5. Never edit the manifest hash/version manually or replace only one of the assets. Build and publish a new version instead.

The app checks the 20 most recent public releases on launch/resume, at most once every five minutes per process, and picks the highest newer version with both valid assets. Missing assets, rate limiting, offline checks and malformed metadata leave attendance usable. No credentials or GitHub token are shipped in the app. The repository and release downloads must be public.

### One-time switch from the old Firebase APK

Install **Presence 1.2 (3)** over the existing app once using its download link. The old APK cannot use the new checker until updated. Do not uninstall. Subsequent qualifying releases show **Presence update available → Download update → Install → Android confirmation**. Android 8+ may require a one-time **Allow from this source** permission for Presence; returning from settings continues installation. Students can decline and keep using attendance. Android may apply additional device/security restrictions; never disable Play Protect.

### Download safety and testing

Downloads are HTTPS-only, repository-scoped initially, redirect-host allowlisted, size bounded, and checked against the manifest SHA-256. Before installation, the app also verifies package ID, exact newer version code, and the same current signing certificate as the installed APK. Android's installer still independently validates the APK and asks for confirmation. The manifest hash protects integrity, not a compromised release account; keep GitHub access and the signing key secure.

Keep the signing key unchanged and backed up. Current builds still use the existing local Android debug key for compatibility with installed tests. Use durable signing before broad long-term distribution; changing keys can prevent updates in place. Do not ship this debug/beta self-updater as a Google Play build.

Phone acceptance: install 1.2 over 1.1; verify no Firebase testing prompt; publish a higher-code build with both assets; verify the modal, Later, download, unknown-source settings return, installation, and retained app data. Also test offline checks, missing/mismatched checksum assets and a wrong-signature APK. Build/tests alone do not verify real-device installation.

References: https://docs.github.com/en/rest/releases/releases and https://developer.android.com/reference/androidx/core/content/FileProvider
