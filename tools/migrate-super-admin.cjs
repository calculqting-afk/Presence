// Operator-only migration. Never imported by the website or APK.
const fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module');
const projectId = 'presence-a873f';
async function main() {
  const uid = process.argv[process.argv.indexOf('--uid') + 1];
  if (!process.argv.includes('--uid') || !/^[A-Za-z0-9_-]{1,128}$/.test(uid || '')) throw Error('Provide --uid EXISTING_ADMIN_UID [--apply].');
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw Error('Do not mix emulator and production credentials.');
  const configPath = path.resolve(__dirname, '../.android-tools/student-id-helper.config.json');
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const keyPath = process.env.PRESENCE_SERVICE_ACCOUNT_KEY || config.serviceAccountPath;
  if (!keyPath || !fs.existsSync(keyPath)) throw Error('Configure a valid local service-account path first.');
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  if (key.project_id !== projectId) throw Error('Wrong Firebase project.');
  const sdk = createRequire(path.resolve(__dirname, '../functions/package.json'));
  const { initializeApp, cert, deleteApp } = sdk('firebase-admin/app');
  const { getAuth } = sdk('firebase-admin/auth');
  const { getFirestore, FieldValue } = sdk('firebase-admin/firestore');
  const app = initializeApp({ credential: cert(key), projectId }, 'super-admin-migration');
  try {
    const auth = getAuth(app), db = getFirestore(app), user = await auth.getUser(uid);
    if (user.disabled || !user.email) throw Error('An enabled existing administrator account is required.');
    const profile = await db.doc('adminProfiles/' + uid).get();
    if (!profile.exists) throw Error('Existing admin profile not found. Refusing to grant authority to an unverified target.');
    console.log(JSON.stringify({ project: projectId, uid, existingAdminProfile: true, claimAlreadySet: user.customClaims?.superAdmin === true, apply: process.argv.includes('--apply') }));
    if (!process.argv.includes('--apply')) return;
    // Reserve the account before granting; existing claims are retained.
    await db.doc('superAdminAccounts/' + uid).set({ active: true, updatedAt: FieldValue.serverTimestamp(), migration: 'custom-claim-v1' }, { merge: true });
    await auth.setCustomUserClaims(uid, { ...user.customClaims, superAdmin: true });
    if ((await auth.getUser(uid)).customClaims?.superAdmin !== true) throw Error('Claim verification failed. Do not deploy claim-only authorization.');
    await db.doc('auditLogs/super-admin-claim-migration_' + uid).set({ action: 'super-admin-claim-migrated', subjectUid: uid,
      source: 'trusted-local-operator', createdAt: FieldValue.serverTimestamp(), claim: 'superAdmin', granted: true });
    console.log('Verified: existing account now has the server-issued Super Admin claim. No password or account data changed.');
  } finally { await deleteApp(app); }
}
if (require.main === module) main().catch(error => { console.error('Migration stopped. Check local credentials, account profile and Firebase permissions. Code: ' + (error.code || error.status || 'unavailable')); process.exitCode = 1; });
