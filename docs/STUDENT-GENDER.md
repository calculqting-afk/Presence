# Student gender

Gender is optional: Male, Female or Not specified (stored as an empty string). Existing records and older app clients without the field remain valid. No migration, automatic guessing, password change or role change is performed.

Available in registration Personal details and Security review; pending Account Approvals; admin Add/Modify Student; the student's profile display and Edit profile. Both admin approval and the fallback approved-registration completion preserve gender. Declined reapplications can update it. The existing role permissions still control student management; students can edit only their own profile.

Firestore Rules allow only the supported string values when present in student profiles and registration requests/reapplications. The student-manager and student-own-profile update allowlists include gender. Deploy `firestore.rules` before trying the updated forms against production; old deployed Rules reject this field.

The multi-session Excel workbook reads saved gender into the MALE/FEMALE column. Not specified remains blank; names never determine gender. This change does not add gender to PDF or change attendance eligibility.

Verification: unit tests for normalization, registration validation and Excel mapping; local provisioning emulator checks allowed values, legacy creation/approval, self/manager editing, unauthorized profile edits and declined reapplications. Manually test register → approve → profile; edit/save from student and admin; confirm the saved value in Excel. Updated APK requires a later APK build/release.
