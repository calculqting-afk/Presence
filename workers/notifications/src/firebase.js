import { FirebaseGateway, PROJECT, SafeError } from '../../admin-api/src/firebase.js';
const decode = value => 'mapValue' in value ? Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k,v])=>[k,decode(v)]))
  : 'arrayValue' in value ? (value.arrayValue.values || []).map(decode)
    : 'timestampValue' in value ? new Date(value.timestampValue)
      : 'integerValue' in value ? Number(value.integerValue) : 'doubleValue' in value ? value.doubleValue
        : 'booleanValue' in value ? value.booleanValue : 'nullValue' in value ? null : value.stringValue;
const document = item => item ? {...Object.fromEntries(Object.entries(item.fields||{}).map(([k,v])=>[k,decode(v)])), id:item.name.split('/').at(-1)} : null;
const field = value => typeof value==='number' ? {integerValue:String(value)} : typeof value==='boolean' ? {booleanValue:value} : {stringValue:value};
export class PushGateway extends FirebaseGateway {
  constructor(secret, fetcher) { super(secret,fetcher,`presence-notifications@${PROJECT}.iam.gserviceaccount.com`); }
  async get(path, transaction) {
    const result=await this.call(this.base+'/'+path+(transaction?'?transaction='+encodeURIComponent(transaction):''),undefined,true);
    return document(result);
  }
  async query(collection, filters=[], {limit=25,after,order='__name__'}={}) {
    const clauses=filters.map(([name,op,value])=>({fieldFilter:{field:{fieldPath:name},op,value:field(value)}}));
    const structuredQuery={from:[{collectionId:collection}],limit,orderBy:[{field:{fieldPath:order},direction:'ASCENDING'}],
      ...(clauses.length ? {where:clauses.length===1?clauses[0]:{compositeFilter:{op:'AND',filters:clauses}}}:{}),
      ...(after?{startAt:{values:[{referenceValue:`projects/${PROJECT}/databases/(default)/documents/${collection}/${after}`}],before:false}}:{})};
    const rows=await this.call(this.base+':runQuery',{structuredQuery});return rows.filter(row=>row.document).map(row=>document(row.document));
  }
  async batchGet(paths) {
    if (!paths.length) return new Map();
    const rows=await this.call(this.base+':batchGet',{documents:[...new Set(paths)].map(path=>`projects/${PROJECT}/databases/(default)/documents/${path}`),
      mask:{fieldPaths:['active','role','section','createdAt','passwordResetRequired','mustChangePassword','passwordResetValidAfter','checkedInAt','attendedAt','checkedOutAt','status','studentUid','eventId']}});
    return new Map(rows.map(row=>[String(row.found?.name||row.missing).split('/documents/')[1],document(row.found)]));
  }
  async commit(writes) { await this.call(this.base+':commit',{writes}); }
  async send(token, notification, data, tag, expiresAt) {
    const access=await this.access();
    if(expiresAt<=Date.now())return 'expired';
    const response=await this.fetcher(`https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`,{method:'POST',
      headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),
      body:JSON.stringify({message:{token,notification,data,android:{priority:'HIGH',ttl:`${Math.max(0,Math.floor((expiresAt-Date.now())/1000))}s`,
        collapse_key:'presence-attendance',notification:{channel_id:'attendance-updates',icon:'ic_stat_attendance',tag,default_sound:true}}}})});
    if (response.ok) { await response.text();return 'sent'; }
    // Only UNREGISTERED invalidates a token. A generic INVALID_ARGUMENT can mean
    // a malformed payload and must not erase a perfectly valid installation.
    const result=await response.json().catch(()=>({}));
    if (result.error?.details?.some(item=>item.errorCode==='UNREGISTERED')) return 'unregistered';
    throw new SafeError(503,'Push delivery unavailable.');
  }
}
