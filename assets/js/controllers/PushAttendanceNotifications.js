// Android only. Website never requests browser notification permission.
const ENDPOINT='https://presence-notifications.mikhailovna2007.workers.dev';
let active;
export async function stopAttendancePush(user) {
  const previous=active;active=null;
  await previous?.stop(user);
}
export class PushAttendanceNotifications {
  constructor({getUser,getStudent,onOpen,notify,native=globalThis.PresenceNative,storage=globalThis.localStorage,window=globalThis.window,fetcher=(...args)=>globalThis.fetch(...args)}) {
    Object.assign(this,{getUser,getStudent,onOpen,notify,native,storage,window,fetcher});this.handles=[];this.seen=new Set();this.stopped=false;
  }
  async call(path,body,user=this.getUser()) {
    if(!user)throw Error('Sign in required');
    const response=await this.fetcher(ENDPOINT+path,{method:'POST',headers:{Authorization:`Bearer ${await user.getIdToken(true)}`,'Content-Type':'application/json'},
      body:JSON.stringify(body),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Push registration unavailable');
    return response.json();
  }
  async initialize() {
    if(!this.native?.isNative || !this.native.pushNotifications || this.initialized || this.getStudent()?.passwordResetRequired || this.getStudent()?.mustChangePassword)return;
    this.initialized=true;active=this;
    try { this.installationId=this.storage?.getItem('presencePushInstallation'); } catch {}
    if(!/^[a-f0-9-]{36}$/.test(this.installationId||'')) {
      this.installationId=crypto.randomUUID();try{this.storage?.setItem('presencePushInstallation',this.installationId);}catch{}
    }
    const push=this.native.pushNotifications;
    for(const [name,callback] of [
      ['registration', token=>{this.token=token.value;void this.bind().catch(()=>{});}],
      ['registrationError',()=>{this.native.pushActive=false;}],
      ['pushNotificationReceived',notification=>this.received(notification)],
      ['pushNotificationActionPerformed',action=>this.open(action.notification)]
    ]) {
      const handle=await push.addListener(name,callback);if(this.stopped){await handle.remove();return;}this.handles.push(handle);
    }
    await push.createChannel({id:'attendance-updates',name:'Attendance updates',description:'Event announcements and attendance milestones',importance:4,visibility:0,vibration:true});
    this.focus=()=>{if(this.token)void this.bind().catch(()=>{});else void this.register(false).catch(()=>{});};
    this.window.addEventListener('focus',this.focus);
    await this.register(true);
  }
  async register(ask) {
    if(this.stopped)return;
    const push=this.native.pushNotifications;
    let permission=await push.checkPermissions();
    let prompted=false;try{prompted=this.storage?.getItem('presencePushPrompted')==='1';}catch{}
    if(ask&&!prompted&&permission.receive==='prompt') {
      try{this.storage?.setItem('presencePushPrompted','1');}catch{}
      permission=await push.requestPermissions();
    }
    if(this.stopped)return;
    if(permission.receive==='granted')await push.register();
    else {this.native.pushActive=false;await push.unregister().catch(()=>{});}
  }
  async bind() {
    if(this.stopped||!this.token||this.binding||this.getStudent()?.passwordResetRequired||this.getStudent()?.mustChangePassword)return;
    if(this.boundToken===this.token && Date.now()-(this.boundAt||0)<3600000)return;
    const token=this.token,user=this.getUser();if(!user)return;
    this.binding=true;
    try {
      this.registrationRequest=this.call('/v1/device/register',{token,installationId:this.installationId},user);
      await this.registrationRequest;
      if(this.stopped||this.getUser()?.uid!==user.uid)return;
      this.boundToken=token;this.boundAt=Date.now();this.native.pushActive=true;
      // Remove only our legacy local alarms after server registration succeeds.
      const local=this.native.localNotifications;
      if(local) {
        const pending=(await local.getPending()).notifications.filter(item=>item.extra?.presenceAttendance===true);
        if(pending.length)await local.cancel({notifications:pending.map(({id})=>({id}))});
      }
    }finally{this.binding=false;if(!this.stopped&&this.token!==token)void this.bind().catch(()=>{});}
  }
  valid(notification) {
    const data=notification?.data;
    return data?.presenceAttendance==='true' && data.recipientUid===this.getUser()?.uid &&
      /^[A-Za-z0-9_-]{1,128}$/.test(data.eventId||'') && Number(data.expiresAt)>Date.now() && !this.stopped &&
      !this.getStudent()?.passwordResetRequired && !this.getStudent()?.mustChangePassword;
  }
  received(notification) {
    if(!this.valid(notification)||this.seen.has(notification.data.key))return;
    this.seen.add(notification.data.key);
    if(this.seen.size>100)this.seen.delete(this.seen.values().next().value);
    this.notify(notification.title||'Attendance update',notification.body||'Open Events to view the latest schedule.');
  }
  open(notification) {
    // A tap opens the current schedule, including when the notice has expired.
    const data=notification?.data;
    if(data?.presenceAttendance==='true'&&data.recipientUid===this.getUser()?.uid&&/^[A-Za-z0-9_-]{1,128}$/.test(data.eventId||'')&&!this.stopped &&
      !this.getStudent()?.passwordResetRequired && !this.getStudent()?.mustChangePassword)this.onOpen(data.eventId);
  }
  async stop(user=this.getUser()) {
    this.stopped=true;this.native.pushActive=false;
    this.window.removeEventListener('focus',this.focus);
    await Promise.allSettled(this.handles.map(handle=>handle.remove()));this.handles=[];
    // Finish an in-flight registration before removing it, so logout cannot
    // race with a late HTTP response and accidentally reactivate the device.
    await this.registrationRequest?.catch(()=>{});
    // Delete the native FCM token even if backend unregister cannot reach the network.
    await Promise.allSettled([
      this.token&&user?this.call('/v1/device/unregister',{token:this.token,installationId:this.installationId},user):Promise.resolve(),
      this.native.pushNotifications.unregister(),this.native.pushNotifications.removeAllDeliveredNotifications()
    ]);
  }
  dispose() {
    this.stopped=true;this.window.removeEventListener('focus',this.focus);
    for(const handle of this.handles)void handle.remove().catch(()=>{});this.handles=[];
  }
}
