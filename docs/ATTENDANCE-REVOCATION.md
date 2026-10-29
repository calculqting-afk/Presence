
# Attendance revocation

Authorized roles: Super Admin, Head Admin and Attendance Admin, using the existing correctAttendance permission. Revoke is shown beside saved attendance in Attendance Line and Live attendance. Display-only absent/pending rows cannot be revoked.

Revoke opens a confirmation modal showing the student, event and original timestamps. A 5–1000 character reason and typed REVOKE confirmation are required. Cancel writes nothing. Close/cancel are blocked during the pending operation; failures leave the dialog open for review.

One Firestore transaction re-reads and checks the selected record, archives its full original values in attendanceRevocations/{attendanceId}, appends an immutable history/{operation} entry, writes an Attendance revoked activity entry, and deletes only the active attendance document. The latest archive may advance if a replacement record is revoked later; earlier history entries cannot be overwritten or deleted through client Rules. Existing attendance corrections remain in their original subcollection. Student/archive reads remain scoped by the existing attendance-report permissions and ownership.

Active queries, summaries and PDF/Excel exports no longer count the revoked record. Normal roster/date rules determine whether the student appears absent, pending or unverified. An eligible student may record new attendance while the session is open. Existing fines, correction-request decisions, and other student records are not changed. A later manual correction creates a new active record and keeps the revocation archive. Activity History includes the revocation reason and before values for Super Admin.

Rules enforce that the exact active record is archived together with history and activity before a revocation delete is allowed. Existing Super Admin data-reset/delete authority is unchanged. Tests use demo records only; no production attendance is automatically revoked.
