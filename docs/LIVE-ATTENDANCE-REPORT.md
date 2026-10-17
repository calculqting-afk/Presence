# Live attendance report and PDF export

## Use

In the admin Attendance Line, select an event, then choose **Live report / PDF**. The report watches the selected event's attendance, independently of the Attendance Line's paged history. Check-ins, checkouts and corrections update the open preview automatically. Existing section, status, search, date and name-sort controls apply. Date filters must include the selected event.

The preview shows 50 rows per page. Download PDF uses A4 portrait pages and includes every matching row, not just the preview page. Columns wrap to fit portrait width and table headings repeat on each page. A downloaded/saved PDF is a fixed snapshot as of the export click; it does not update afterward. Download again for a newer snapshot. A PDF being generated is not changed by subsequent check-ins.

Reports include event details, student ID/name/course/section, check-in/out times, arrival/completion, matching-row totals, export/update timestamps and page numbers. PDF dates/times are formatted for readers in Philippine time (Asia/Manila); the internal snapshot retains UTC ISO timestamps. Unused filters, internal sort codes and zero-duplicate notices are hidden from the PDF header. Passwords, birthdays, face data, email addresses and GPS are not exported. Student names/course use current profiles; section uses the historical event roster where available. Manual corrections are labelled. Late/completed totals overlap present totals.

During an ongoing event, students without a check-in remain pending. After checkout closes, the existing projection policy determines absences; a missed checkout or unverifiable legacy eligibility is marked for review, not automatically absent. Deleted/missing student profiles remain in the historical roster with their saved section and are marked **Needs review - profile missing**, never counted as confirmed absent or pending. Existing saved attendance IDs/names/timestamps remain available; no identity is inferred from another student's name or section. Restoring the matching profile restores normal classification. This feature never writes absence records or changes attendance.

## Verification and limits

Each PDF page footer shows the event's check-in time/cutoff and checkout time/cutoff, with page numbers on the right. Saved schedule timestamps take priority; legacy events use the existing schedule cutoff fallbacks. The previous snapshot/timezone footer text is removed.

- Attendance Line access and the existing `viewAttendance` permission are required. Firestore rules remain authoritative.
- Export waits for server-confirmed event, attendance and student-directory snapshots, with no pending local writes. Offline/cache-only/error states disable export; stale rows may remain visible with a warning. Retry verification after a connection/permission failure.
- Event queries include known legacy duplicate event IDs for the same schedule (maximum 30 IDs). Multiple attendance documents for one student are consolidated using the latest correction/update/attendance timestamp, then document ID as a deterministic tie-breaker.
- A query is bounded to 5,001 documents. Above 5,000 event attendance documents, a complete export is blocked, never silently truncated. Preview/export also refuses more than 5,000 matching roster rows. Row/page/10 MB limits and unsupported font characters produce explicit errors. Reduce section/search filters for an oversized roster/PDF; an oversized source event needs administrator review.
- The report attaches two additional listeners only while open: selected event metadata and event-scoped attendance. It reuses the existing student directory. Filter changes do not reread attendance unless the event/duplicate-ID scope changes. Closing, navigating away or disposing stops report listeners. The 5-second local timer refreshes schedule phase only; it is not database polling.
- Firestore reads still consume the project's quota. There is no unlimited-free guarantee. No Functions, new server service, rule deployment or billing upgrade is required by this feature.

## Web and Android

Web: a local PDF Blob starts the browser download. PDF libraries, font and logo are loaded lazily from bundled local assets, not a runtime CDN. No PDF upload or server generation occurs.

Android: the `AttendancePdf` Capacitor plugin uses the system Create Document picker for **Save PDF**, and a read-granted FileProvider URI with the Android chooser for **Share PDF**. No broad storage permission is added. Cancelling the save picker is handled normally. Shared PDFs remain in private app cache until Android or the user clears that cache; saved/shared copies are outside Presence's control. Share only with authorized recipients.

The source and native plugin must ship together. Website publishing is separate from APK delivery. Increment the Android version code/name and rebuild a signed APK for a future release; an already-built APK does not acquire these changes. This implementation synced web assets and compiled `:app:compileBetaJavaWithJavac`, without rebuilding/replacing the existing v1.5 APK or release JSON.

## Verification performed

- Existing regression suite plus new report-service, repository, controller, file-bridge and real PDF-generation tests.
- Local browser fixtures (no Firebase calls/writes): live update, pagination, offline blocking, desktop/mobile, light/dark themes and actual 90-row PDF download.
- Eight-page PDF text inspection: all 90 IDs, accented names and page numbers; rendered pages visually reviewed.
- Android Java compile successful. Real-device save destination, share recipient, cancellation and WebView integration still require a newly built APK and device smoke test.

## Local PDF assets

| Asset | Version/source | SHA-256 |
| --- | --- | --- |
| `assets/vendor/pdf-lib.min.js` | pdf-lib 1.17.1, jsDelivr npm package, MIT notice alongside | `0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f` |
| `assets/vendor/fontkit.umd.min.js` | @pdf-lib/fontkit 1.1.1, jsDelivr npm package; upstream Hopding/fontkit README license retained | `d8df561b9fba98e24f2e5130e40948809281bbbc55a20c412359f1a0a5eb35a6` |
| `assets/fonts/NotoSans-Regular.ttf` | notofonts/noto-fonts `hinted/ttf/NotoSans/NotoSans-Regular.ttf`; OFL notice alongside | `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5` |

Sources: `https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js`, `https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js`, `https://github.com/Hopding/fontkit`, `https://github.com/notofonts/noto-fonts`.
