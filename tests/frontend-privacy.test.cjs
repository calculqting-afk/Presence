const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function files(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
test('shipped source has no personal administrator email or email-based Super Admin authorization',()=>{
  const config=fs.readFileSync(path.join(root,'config/firebase-config.js'),'utf8');
  for(const file of [...files(path.join(root,'assets/js')),...files(path.join(root,'config'))]){
    const source=fs.readFileSync(file,'utf8');assert.ok(!/SUPER_ADMIN_EMAIL|superAdminEmail|[A-Za-z0-9._%+-]+@gmail\.com/i.test(source),path.relative(root,file));
    assert.ok(!/-----BEGIN (?:RSA )?PRIVATE KEY-----|"private_key"\s*:/.test(source),path.relative(root,file));
  }
  const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');assert.ok(!rules.includes('request.auth.token.email'));assert.ok(rules.includes('request.auth.token.get("superAdmin", false) == true'));
  assert.ok(!config.includes('8uEjAk72BLWKjvnQJEatBdeVAi02')); assert.ok(fs.readFileSync(path.join(root,'workers/admin-api/src/service.js'),'utf8').includes('isSuperAuthority'));
});
test('Hosting exclusions keep local credentials, backend and native build files outside the public site',()=>{
  const ignore=JSON.parse(fs.readFileSync(path.join(root,'firebase.json'),'utf8')).hosting.ignore;
  for(const pattern of ['workers/**','functions/**','docs/**','tools/**','.android-tools/**','android/**','mobile/**','mobile-web/**','**/.*','**/*firebase-adminsdk-*.json','**/presence-a873f-*.json','**/*.pem','**/*.key'])assert.ok(ignore.includes(pattern),pattern);
});
test('preview server rejects traversal, backend, hidden files and private configuration after path normalization',()=>{
  const {publicFile}=require('../tools/serve.cjs');
  for(const requested of ['/index.html','/assets/js/dashboard.js','/pages/admin-dashboard.html','/config/firebase-config.js'])assert.ok(publicFile(requested),requested);
  for(const requested of ['/assets/../workers/admin-api/src/index.js','/assets/../.android-tools/secret.json','/assets/.hidden','/config/private.json','/config/../functions/private.json','/assets/../../private.json','/.git/config','/workers/admin-api/src/index.js'])assert.equal(publicFile(requested),null,requested);
});
