Presence v1.8.18 adds assisted QR attendance, a dedicated student QR page, and more focused dashboard data loading.

- Students can open My Attendance QR directly from navigation, choose a current eligible session, and show a QR that refreshes every 30 minutes.
- Authorized attendance administrators can scan, verify the student in person, and confirm check-in or check-out. Attendance remains validated and audited by the backend.
- Page-specific subscriptions stop when leaving or hiding a section; correction requests load only in the visible Summary tab.
- Activity History has clearer labels, compact filters, and readable before/after changes.

Validation: 501 automated web tests passed; JavaScript syntax/import checks passed. APK signing, packaged web files, and download integrity are checked during release. Real-phone camera scanning, attendance and update installation still need device acceptance testing.

Install Presence.apk over the existing app to retain local app data. This uses the existing beta signing identity for compatibility. The website and the APK share the same backend.
