# Multi-session Excel Workbooks and Student Gender

- Attendance Line → Live report / PDF → Export Excel now offers session selection across dates. Select Day 1 Morning/Afternoon through Day 5 or other sessions; preview server-verified counts before downloading one Excel workbook with one worksheet per session. Course/section filters are available separately; attendance-status/search filters are excluded to include all attendance outcomes.
- Worksheets show bold headings, Last name, First name Middle name, course/year, male/female, attended, arrival and Philippine-time in/out columns. Each worksheet also shows its own check-in opening/cutoff and checkout opening/cutoff. The check-in cutoff is the on-time/late threshold. Confirmed absences are distinguished from pending/unverified attendance; missing checkout shows Not recorded. Unknown year/gender is not guessed.
- Up to 30 sessions and 5,000 student rows total; alphabetical student rows, chronological day/session sheets, frozen headings, column filters and landscape printing. Large rosters can span multiple printed pages. PDF remains available. Existing native Excel Save As supports Android download/cancellation.
- Adds optional Gender (Male/Female/Not specified) to registration, review/approval, admin student creation/editing, and student profile display/editing. Approval and reapplication preserve the field; older accounts without it remain valid. Saved gender populates Excel's Male/Female column. No passwords, birth dates or face data are exported.
- The gender Firestore Rules were deployed to presence-a873f after local emulator checks for allowed values, legacy accounts, self/admin edits and unauthorized changes. No account migration or attendance/role/password changes are performed by this release.

## Install

Android **1.8.6**, version code **15**, package **io.github.calculatingafk.presence**. Install **Presence.apk** over the existing installation; do not uninstall first. This GitHub beta retains the existing signing identity and includes **presence-update.json** for the in-app updater. It is not a Google Play production build.

## Validation

338 automated tests passed before release packaging, including Excel layout/session ordering, safe text, gender validation and server-gated export. Firestore provisioning/gender emulator tests passed. A ten-sheet generated workbook was independently read to verify columns, formatting and print settings. Test registration/approval/profile editing and Android Excel Save As on a real device after installing; physical-device acceptance remains manual. No paid Firebase setup or new server-push notifications are added.
