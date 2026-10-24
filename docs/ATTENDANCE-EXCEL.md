# Attendance Excel export

Open **Attendance Line**, choose an event and session, then set the course, section, dates, search and status filters. Open **Live report / PDF / Excel** and select **Export Excel** after server verification finishes. Existing PDF save/share is unchanged.

The `.xlsx` contains all matching report rows, not just the 50-row preview. Summary records the event, filters, server verification time, totals and qualifications. A single-session export includes an Attendance sheet. Both sessions produces separate Morning and Afternoon sheets.

Columns: Student ID, Name, Course, Year level, Section, Event, Event date, Session, Check-in (PH), Check-out (PH), Arrival, Attendance status. Year level is derived from the event roster section (for example, 2A = year 2). Unknown sections leave year blank rather than guessing. Course/name use current profile values, consistent with the PDF report.

Student IDs are text so leading zeros are retained. Dates/times are sortable Excel dates displayed in Philippine time (UTC+08:00). Missing check-ins/checkouts say Not recorded. Pending records are not counted as absences; combined totals count session records, not unique students. The workbook is a fixed snapshot and does not update after download.

Security: reuses the report's existing role and server-verification gates. Offline, unverified, errored and out-of-date-range reports cannot export. PDF/Excel share a busy lock. Only explicitly allowed report fields enter the XLSX. Passwords, birthday/temporary-password data, Firebase credentials, UIDs, GPS, contact details, face images and other private profile fields are excluded. User-provided text is written as inline text, never formulas or hyperlinks. No new network library or server writes are used.

Website: standard browser download. Android: native Save As via the new AttendanceSpreadsheet plugin, with no broad storage permission. This requires a newly built APK containing that plugin; the already-released v1.8.4 APK does not include Excel export. No APK release or GitHub push is part of this implementation request.

Limits: 5,000 session rows and 10 MB. Narrow the filters if necessary. Only export is implemented; there is no student import or account provisioning feature.

Verification: automated tests check ZIP/OOXML structure and checksums, text IDs, typed PH date/times, both-session isolation, all-row export, sensitive-field exclusion, formula-like text, report gates, duplicate clicks and Android cancellation/old-APK fallback. An independent openpyxl reader also validated a three-sheet workbook, parsed all XML and verified the exact PH date/time values. A real Excel/phone acceptance check should confirm download, opening, filtering and Save As cancellation before a release.

Format reference: [Microsoft SpreadsheetML structure](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document). XLSX is generated locally as an Open XML package, with no external spreadsheet-library download.
