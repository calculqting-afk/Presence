Presence v1.8.10 adds hometown profiles and smoother dashboard loading.

- Student age is calculated from the birthday in registration, profiles, and account approvals.
- Choose a hometown through a searchable location picker: broad region group, province, city/municipality, and barangay. Philippine location data is bundled with the app.
- Admin and student dashboards display responsive skeleton placeholders while their initial data loads, with a retry option for slow connections.
- Pull down at the top of an Android dashboard, then release to refresh. Short pulls, sideways swipes, open dialogs, active cameras, nested scrolling, and edited forms are protected from accidental refresh.
- Existing attendance behavior and role permissions are preserved.

Validation: 414 automated tests passed, JavaScript/import checks passed, and the APK assets and signing identity were verified. Physical-device gesture and installation testing remains recommended.

Install Presence.apk over the existing app to retain app data. This release uses version code 19 and the existing signing identity. Both Presence.apk and presence-update.json belong to the same build.
