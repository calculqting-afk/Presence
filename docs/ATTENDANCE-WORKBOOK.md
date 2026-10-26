# Multi-session attendance workbook

Attendance Line → choose an event → Live report / PDF → Export Excel opens a separate session selector. Select sessions across dates (for example Days 1–5, Morning/Afternoon), optionally filter course/section, then Preview selected sessions and Download Excel. Up to 30 selected sessions and 5,000 student rows total are supported. Selection starts with the Attendance Line's current event/session; all dates are available in the selector. Select all includes every displayed event, so review the selection before previewing.

The selector ignores the Attendance Line's search/status/date filters: its purpose is to export all attendance outcomes for the explicitly selected sessions. Course/section initially match the Attendance Line and can be changed separately. PDF and its existing filters remain unchanged.

One `.xlsx` file contains only the selected session worksheets, ordered by date and then Morning/Afternoon. Day-number names are used when present in the title; other titles are shortened to Excel's 31-character limit and deduplicated. Each sheet has bold event and column headings, student names in Last name, First name Middle name order, course/year (year derived from section when available), male/female when stored in the profile's sex/gender field, attended/arrival and Philippine-time in/out columns. Missing sex/year information stays blank; nothing is guessed. No new profile fields are collected by this change. Names/course/sex use current profiles, not historical snapshots.

The existing report service verifies event and full attendance snapshots through Firestore, with the existing student-directory readiness gate. The export does not rely on Attendance Line pagination. Confirmed roster absence is No/Absent only after session closure; pending and unverified history are explicitly labeled. Saved check-in is Yes, with On time/Late separately; missing checkout is Not recorded. Course/section filter the resulting session rows. Late overlaps attended in the preview totals.

Selection/filter changes, closing the dialog, offline transitions, failed verification, and oversized queries invalidate the preview. Duplicate downloads are blocked during generation/native save. User-provided values are stored as literal inline text, never formulas or external links. Passwords, birth dates, face data and internal UIDs are excluded.

Each worksheet also shows its own check-in opens/cutoff and check-out opens/cutoff above the student list, using the verified session schedule in Philippine time. The check-in cutoff is the on-time/late threshold; it is distinct from the final checkout cutoff. Missing schedule values show Not set.

Landscape printing fits each sheet to one page wide with unrestricted height, so larger rosters can span multiple printed pages. Freeze panes keep the first seven rows visible, including the schedule; filters start at the column heading row. This is a fixed export, not a live workbook.

The existing Android Excel Save As bridge is reused. Source changes apply to the next APK build; this change does not publish an APK or deploy Firebase rules.

Manual checks: select Day 1 Morning/Afternoon through Day 5, preview ten session counts, export and open in Excel/LibreOffice. Confirm only selected sheets, correct student names and missing sex values, statuses/times, alphabetical rows, frozen headings and landscape printing. Change course/section and preview again. Test no selection, offline, denied access, oversized selection, native save cancellation and dialog close during generation. PDF must continue to use its existing preview and export path.
