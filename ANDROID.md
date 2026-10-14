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
