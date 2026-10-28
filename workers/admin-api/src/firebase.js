export const PROJECT = 'presence-a873f';
export class SafeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bytes = text => new TextEncoder().encode(text);
const b64 = data => btoa(String.fromCharCode(...new Uint8Array(data))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const un64 = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
const segment = value => b64(bytes(JSON.stringify(value)));
let certificates, certificateUntil = 0, certificateFetched = 0;
export async function verifyToken(token, fetcher = fetch, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 10000) throw Error();
    const parts = token.split('.'); if (parts.length !== 3) throw Error();
    const header = JSON.parse(new TextDecoder().decode(un64(parts[0]))), claims = JSON.parse(new TextDecoder().decode(un64(parts[1])));
    const seconds = now / 1000;
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || claims.aud !== PROJECT || claims.iss !== `https://securetoken.google.com/${PROJECT}`
      || typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub) || !Number.isFinite(claims.exp) || claims.exp <= seconds
      || !Number.isFinite(claims.iat) || claims.iat > seconds + 30 || !Number.isFinite(claims.auth_time) || claims.auth_time > seconds + 30) throw Error();
    if (!certificates || now >= certificateUntil || (!certificates.some(key => key.kid === header.kid) && now - certificateFetched > 60000)) {
      const result = await fetcher('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com', { signal: AbortSignal.timeout(10000) });
      if (!result.ok) throw Error();
      certificates = (await result.json()).keys; certificateUntil = now + 3600000; certificateFetched = now;
    }
    const jwk = certificates.find(key => key.kid === header.kid); if (!jwk) throw Error();
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, un64(parts[2]), bytes(parts[0] + '.' + parts[1]))) throw Error();
    return claims;
  } catch { throw new SafeError(401, 'Sign in again to continue.'); }
}
export const encode = value => value === null ? {nullValue:null} : value instanceof Date ? { timestampValue: value.toISOString() }
  : Array.isArray(value) ? {arrayValue:{values:value.map(encode)}}
    : typeof value === 'object' ? {mapValue:{fields:Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).map(([key,item])=>[key,encode(item)]))}}
  : typeof value === 'boolean' ? { booleanValue: value } : typeof value === 'number' ? { integerValue: String(value) }
    : { stringValue: String(value) };
export const decode = value => 'mapValue' in value ? Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([key,item])=>[key,decode(item)]))
  : 'arrayValue' in value ? (value.arrayValue.values||[]).map(decode) : 'nullValue' in value ? null
    : 'booleanValue' in value ? value.booleanValue : 'integerValue' in value ? Number(value.integerValue)
      : 'timestampValue' in value ? new Date(value.timestampValue) : value.stringValue;
let cachedAccess;
export class FirebaseGateway {
  constructor(secret, fetcher = globalThis.fetch.bind(globalThis), expectedEmail = `presence-password-reset@${PROJECT}.iam.gserviceaccount.com`) {
    try { this.key = JSON.parse(secret); } catch { throw new SafeError(503, 'Reset service is not configured.'); }
    if (this.key.project_id !== PROJECT || this.key.client_email !== expectedEmail) throw new SafeError(503, 'Reset service is not configured.');
    this.fetcher = fetcher;
    this.base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  }
  async access() {
    if (cachedAccess?.id === this.key.private_key_id && cachedAccess.until > Date.now()) return cachedAccess.token;
    const now = Math.floor(Date.now() / 1000);
    const unsigned = segment({ alg: 'RS256', typ: 'JWT' }) + '.' + segment({ iss: this.key.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/identitytoolkit', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const pem = this.key.private_key.replace(/-----[^-]+-----|\s/g, '');
    const key = await crypto.subtle.importKey('pkcs8', un64(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const assertion = unsigned + '.' + b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, bytes(unsigned)));
    const response = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new SafeError(503, 'Firebase authorization is unavailable.');
    const result = await response.json(); if (!result.access_token) throw new SafeError(503, 'Firebase authorization is unavailable.');
    cachedAccess = { id: this.key.private_key_id, token: result.access_token, until: Date.now() + 3000000 }; return result.access_token;
  }
  async call(url, body, allowMissing = false) {
    const response = await this.fetcher(url, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${await this.access()}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    if (allowMissing && response.status === 404) { await response.body?.cancel();return null; }
    if (!response.ok) { await response.body?.cancel();throw new SafeError(response.status === 409 ? 409 : 503, response.status === 409 ? 'Another request changed this account. Retry.' : 'Firebase operation failed. Retry or contact the administrator.'); }
    return response.json();
  }
  async user(uid) {
    const result = await this.call(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, { localId: [uid] });
    return result.users?.find(user => user.localId === uid) || null;
  }
  async userByEmail(email) {
    const result=await this.call(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`,{email:[email]});
    return result.users?.find(user=>user.email?.toLowerCase()===email.toLowerCase())||null;
  }
  async changeEmail(uid,email) {
    await this.call(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`,{localId:uid,email,returnSecureToken:false});
  }
  async password(uid, password, validAfter) {
    await this.call(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { localId: uid, password, validSince: String(validAfter), returnSecureToken: false });
  }
  async get(path, transaction) {
    const params = new URLSearchParams();
    if (transaction) params.set('transaction', transaction);
    if (path.startsWith('students/')) for (const field of ['uid', 'active', 'role', 'firstName', 'middleName', 'lastName', 'accountId', 'accountIdKey', 'authEmail', 'birthday', 'passwordResetRequired', 'passwordResetValidAfter']) params.append('mask.fieldPaths', field);
    const result = await this.call(this.base + '/' + path + (params.size ? '?' + params : ''), undefined, true);
    return result ? { ...Object.fromEntries(Object.entries(result.fields || {}).map(([key, value]) => [key, decode(value)])), _updateTime: result.updateTime } : null;
  }
  write(path, data, { merge = false, exists } = {}) {
    return { update: { name: `projects/${PROJECT}/databases/(default)/documents/${path}`, fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])) },
      ...(merge ? { updateMask: { fieldPaths: Object.keys(data) } } : {}), ...(exists === undefined ? {} : { currentDocument: { exists } }) };
  }
  remove(path) { return {delete:`projects/${PROJECT}/databases/(default)/documents/${path}`}; }
  async matches(field,value,transaction) {
    const result=await this.call(this.base+':runQuery',{...(transaction?{transaction}:{}),structuredQuery:{from:[{collectionId:'students'}],
      select:{fields:[{fieldPath:'uid'}]},where:{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:{stringValue:value}}},limit:2}});
    return result.filter(row=>row.document).map(row=>row.document.name.split('/').at(-1));
  }
  async transaction(fn) {
    const { transaction } = await this.call(this.base + ':beginTransaction', { options: { readWrite: {} } });
    try {
      const get=path=>this.get(path,transaction);
      get.matches=(field,value)=>this.matches(field,value,transaction);
      const writes = await fn(get);
      await this.call(this.base + ':commit', { transaction, writes });
    } catch (error) {
      await this.call(this.base + ':rollback', { transaction }).catch(() => {}); throw error;
    }
  }
}
export async function digest(value) { return b64(await crypto.subtle.digest('SHA-256', bytes(value))); }
export function temporaryPassword() { return 'Pr!' + b64(crypto.getRandomValues(new Uint8Array(20))); }
