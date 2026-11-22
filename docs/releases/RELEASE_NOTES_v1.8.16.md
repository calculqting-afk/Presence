Presence v1.8.16 includes the pending stability and permissions fixes for the website and Android APK.

- Admin dashboards skip the student agreement prompt while retaining account, role and device-session verification.
- Fix profile-save and role-assignment permission checks without granting students administrative access.
- Reduce startup blocking and prevent login forms from submitting credentials in the page URL.
- Improve student ID correction feedback and retain the current verified session after reauthentication.
- Retry inaccurate outside-boundary GPS readings while preserving the existing location requirements.
- Keep the student and missed event fixed when editing an assigned fine; add a five-second removal confirmation.
- Improve survey selection, current-event creation, archive permissions and status messages; keep tabs responsive during refresh.
- Prevent the old notification checkmark from flashing behind the mascot.

Validation: 481 automated tests passed, plus Firebase Emulator checks for device sessions, security hardening and student provisioning. JavaScript/import checks passed. APK package, signing certificate and bundled public files verified before publication.

Install Presence.apk over the existing app to retain its data. The matching presence-update.json enables the existing in-app update checker. Real-phone GPS and installation behavior still require device testing.
