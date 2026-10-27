import { SafeError, verifyToken } from '../../admin-api/src/firebase.js';
export function endpoint({verify=verifyToken,service}) {
  return async(request,env)=>{
    const origin=request.headers.get('Origin');const allowed=(env.ALLOWED_ORIGINS||'').split(',').includes(origin);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin',
      ...(allowed?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
    const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
    try {
      if(origin&&!allowed) throw new SafeError(403,'Origin not allowed.');
      if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
      const url=new URL(request.url);
      if(url.pathname==='/health'&&request.method==='GET') return response({service:'presence-notifications',enabled:env.PUSH_ENABLED==='true',configured:Boolean(env.PUSH_FIREBASE_SERVICE_ACCOUNT)});
      if(!['/v1/device/register','/v1/device/unregister'].includes(url.pathname)||url.search) throw new SafeError(404,'Not found.');
      if(env.PUSH_ENABLED!=='true') throw new SafeError(503,'Phone push notifications are not enabled yet.');
      if(request.method!=='POST') throw new SafeError(405,'POST required.');
      const token=/^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization')||'')?.[1];
      if(!token) throw new SafeError(401,'Sign in again.');
      if(!(request.headers.get('Content-Type')||'').startsWith('application/json')) throw new SafeError(415,'JSON required.');
      const reader=request.body?.getReader();if(!reader) throw new SafeError(400,'JSON required.');
      let text='',size=0;const decoder=new TextDecoder();
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>6000){await reader.cancel();throw new SafeError(413,'Request too large.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
      let body;try{body=JSON.parse(text);}catch{throw new SafeError(400,'Invalid JSON.');}
      if(!body||typeof body!=='object'||Array.isArray(body))throw new SafeError(400,'Invalid request.');
      const claims=await verify(token);
      return response(await service(env).device(claims,body,url.pathname.endsWith('/unregister')));
    }catch(error){return response({error:error instanceof SafeError?error.message:'Phone notification service unavailable.'},error instanceof SafeError?error.status:503);}
  };
}
