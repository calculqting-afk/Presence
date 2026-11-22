Presence v1.8.20 fixes QR renewal after refreshing and improves Android QR downloads.

- Pull-to-refresh keeps the current student QR and its original remaining countdown within the same login session.
- Expired codes renew automatically while the QR page is open. A different login session receives a fresh code; logout clears the cached QR.
- Android Download QR saves PNG images to Pictures/Presence for Photos/Gallery, with a clear saved message. Android 10 and newer need no storage permission; Android 7–9 request legacy write permission only when saving.
- Save failures are reported without claiming the photo was saved. Downloaded images still expire and become unusable when their login session ends.

Validation: 507 automated web tests passed, JavaScript checks passed, Android compilation and unit checks passed. APK signature and packaged files are verified during release. Real-phone gallery visibility and QR attendance still require acceptance testing.

Install Presence.apk over the existing app. This uses the existing beta/debug-derived signing identity for compatibility. Production signing remains deferred until real-phone attendance testing passes. Never disable Play Protect to install an app.
