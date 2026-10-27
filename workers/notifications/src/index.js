import { WorkerEntrypoint } from 'cloudflare:workers';
import { PushGateway } from './firebase.js';
import { PushService } from './service.js';
import { endpoint } from './http.js';
const service=env=>new PushService(new PushGateway(env.PUSH_FIREBASE_SERVICE_ACCOUNT));
// RPC methods are service-binding only; they are not HTTP endpoints. The public
// fetch handler exposes only authenticated device registration and health.
export default class Notifications extends WorkerEntrypoint {
  fetch(request) { return endpoint({service})(request,this.env); }
  async scheduled() {
    if(this.env.PUSH_ENABLED!=='true'||!this.env.PUSH_FIREBASE_SERVICE_ACCOUNT)return;
    await service(this.env).tick(this.env.SELF);
  }
  async syncEvent(id) { if(this.env.PUSH_ENABLED==='true') await service(this.env).syncEvent(id); }
  async runJob(id) { if(this.env.PUSH_ENABLED==='true') await service(this.env).runJob(id,(job,shard)=>this.env.SELF.deliver(job,shard,0)); }
  async deliver(job,shard,depth=0) {
    if(this.env.PUSH_ENABLED!=='true')return false;
    return service(this.env).deliver(job,shard,(id,part,next)=>this.env.SELF.deliver(id,part,next),depth);
  }
}
