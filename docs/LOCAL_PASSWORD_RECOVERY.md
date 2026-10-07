# Local student password recovery

This Spark-plan tool resets a student's Firebase Authentication password from a trusted school administrator's laptop. It does not place Firebase Admin credentials in the website and never stores the temporary password in Firestore.

## One-time setup

1. In Firebase Console, open **Project settings** > **Service accounts**.
2. Generate a new private key for `presence-a873f`.
3. Save the JSON key in a private folder outside this repository and OneDrive.
4. Install the existing local dependency from the project `functions` folder:

```powershell
cd "C:\Users\ACER\OneDrive\Desktop\Porjects\Presence\functions"
npm install
```

## Resetting a student password

1. Check the student's physical school ID against their Presence record.
2. In PowerShell, run:

```powershell
cd "C:\Users\ACER\OneDrive\Desktop\Porjects\Presence\functions"
$env:PRESENCE_SERVICE_ACCOUNT_KEY = "C:\Private\presence-a873f-service-account.json"
node .\recover-student-password.cjs
Remove-Item Env:PRESENCE_SERVICE_ACCOUNT_KEY
```

3. Enter your administrator email, the Student ID, and type `VERIFY` only after checking the physical ID.
4. Enter a unique 6-8 digit temporary password twice and provide the final confirmation phrase.
5. Give the temporary password to the student privately. The tool immediately replaces the old Firebase Authentication password, revokes existing sessions, marks the account as requiring a password change, and writes an audit event without recording the password. If the matching Authentication account was previously deleted while the Firestore profile remains, the tool clearly warns you and can restore that account with the same UID after an additional `RESTORE <Student ID>` confirmation.
6. On the student's next sign-in, Presence shows a required password-change modal. They create their own new password before using the dashboard.

Never place the service-account JSON key in this repository, Firebase Hosting files, Firestore, Git, email, or a shared cloud folder.
