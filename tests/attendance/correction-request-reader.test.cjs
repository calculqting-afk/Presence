const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
async function moduleWith(sdk={}){
 const context=vm.createContext({console}),cache=new Map();const exports={collection:(...args)=>args,doc:(...args)=>args,query:(...args)=>args,where:(...args)=>({where:args}),orderBy:(...args)=>({orderBy:args}),limit:size=>({limit:size}),startAfter:cursor=>({cursor}),getDocsFromServer:async()=>({docs:[]}),getDocFromServer:async()=>({exists:()=>false}),getCountFromServer:async()=>({data:()=>({count:0})}),...sdk};
 const firebase=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});
 const load=file=>{if(!cache.has(file))cache.set(file,new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file}));return cache.get(file);};
 const entry=load(path.join(root,'assets/js/controllers/attendance/CorrectionRequestReader.js'));await entry.link((specifier,parent)=>specifier.startsWith('https:')?firebase:load(path.resolve(path.dirname(parent.identifier),specifier)));await entry.evaluate();return entry.namespace;
}
function emitter(){const listeners=new Map();return {addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn),emit:type=>{for(const fn of listeners.get(type)||[])fn({});}};}
async function fixture(){
 const {CorrectionRequestReader}=await moduleWith();let clock=100000,view='dashboard',uid='admin';const nodes=new Map();const field=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',hidden:false,disabled:false});return nodes.get(selector);};const document={...emitter(),visibilityState:'visible'};const window={...emitter(),setInterval(){throw Error('Background polling is forbidden');}};
 const calls={pages:[],counts:0,ids:[],decisions:[]};const repository={page:async query=>{calls.pages.push(query);return {rows:Array.from({length:25},(_,i)=>({id:'request-'+i,status:'pending'})),cursor:'page-1',more:true};},count:async()=>{calls.counts++;return 80;},resolveStudentId:async id=>{calls.ids.push(id);return id==='2510004-1'?'student-uid':'';},decision:async id=>{calls.decisions.push(id);return {id,status:'approved',reviewedByName:'Verified Admin'};}};
 const controller={initialized:true,user:{uid:'admin'},getUser:()=>({uid}),role:'attendance_admin',getView:()=>view,root:{ownerDocument:document,querySelector:field},window,requests:[],declineDrafts:new Map(),render(){this.renders=(this.renders||0)+1;},updateBadge(count){this.badgeCount=count;}};
 const reader=new CorrectionRequestReader({controller,repository,now:()=>clock});reader.initialize();const settle=()=>new Promise(resolve=>setImmediate(resolve));
 return {reader,repository,controller,calls,field,document,window,settle,open:async()=>{view='correction-requests';reader.visibility();await settle();},leave:()=>{view='dashboard';reader.visibility();},advance:ms=>clock+=ms,changeUser:value=>{uid=value;reader.visibility();}};
}
test('request queries use 25 newest records, exact UID/status constraints and document cursors',async()=>{
 const queries=[];const docs=Array.from({length:25},(_,i)=>({id:String(i),data:()=>({studentUid:'s'})}));const {CorrectionRequestRepository}=await moduleWith({getDocsFromServer:async query=>{queries.push(query);return {docs};}});const repo=new CorrectionRequestRepository('db');
 const first=await repo.page({status:'approved',studentUid:'s'});assert.equal(first.rows.length,25);assert.equal(first.more,true);assert.equal(first.cursor,docs[24]);
 assert.deepEqual(JSON.parse(JSON.stringify(queries[0].slice(1))),[{where:['status','==','approved']},{where:['studentUid','==','s']},{orderBy:['submittedAt','desc']},{limit:25}]);
 await repo.page({status:'all',cursor:first.cursor});assert.equal(queries[1][2].cursor,docs[24]);assert.equal(queries[1].at(-1).limit,25);
 await assert.rejects(repo.page({status:'forged'}));await repo.resolveStudentId('2510004-1');assert.deepEqual(JSON.parse(JSON.stringify(queries[2].slice(1))),[{where:['accountId','==','2510004-1']},{limit:1}]);await assert.rejects(repo.resolveStudentId('../other'));
});
test('admin queue reads only when visible and reuses pages for 60 seconds without polling',async()=>{
 const f=await fixture();assert.equal(f.calls.pages.length,0);assert.equal(f.calls.counts,0);await f.open();assert.equal(f.calls.pages.length,1);assert.equal(f.calls.counts,1);assert.equal(f.controller.badgeCount,80);assert.equal(f.controller.requests.length,25);
 f.leave();f.advance(59000);await f.open();assert.equal(f.calls.pages.length,1);assert.equal(f.calls.counts,1);
 f.leave();f.advance(1001);await f.open();assert.equal(f.calls.pages.length,2);assert.equal(f.calls.counts,2);assert.equal(f.calls.pages[1].cursor,null);
 f.reader.dispose();assert.equal(f.controller.requests.length,0);assert.equal(f.field('[data-request-list]').innerHTML,'');
});
test('Load more preserves failed-page cursor, deduplicates results and does not refresh the badge',async()=>{
 const f=await fixture();await f.open();f.repository.page=async query=>{f.calls.pages.push(query);throw Error('offline');};await f.reader.load();assert.equal(f.controller.requests.length,25);assert.equal(f.reader.cursor,'page-1');assert.match(f.field('[data-request-sync]').textContent,/Could not load/);
 f.repository.page=async query=>{f.calls.pages.push(query);return {rows:[{id:'request-24'},{id:'older'}],cursor:'page-2',more:false};};await f.reader.load();assert.equal(f.calls.pages.at(-1).cursor,'page-1');assert.equal(f.controller.requests.length,26);assert.equal(f.calls.counts,1);assert.equal(f.field('[data-request-more]').hidden,true);
});
test('Student ID server search resets pagination, keeps status and never falls back to all requests for unknown IDs',async()=>{
 const f=await fixture();await f.open();await f.reader.search('2510004-1','approved');assert.equal(f.calls.ids.length,1);assert.equal(f.calls.pages.at(-1).studentUid,'student-uid');assert.equal(f.calls.pages.at(-1).status,'approved');assert.equal(f.calls.pages.at(-1).cursor,null);
 await f.reader.search('2510004-1','all');assert.equal(f.calls.ids.length,1);assert.equal(f.calls.pages.at(-1).status,'all');const before=f.calls.pages.length;await f.reader.search('unknown','all');assert.equal(f.calls.pages.length,before);assert.equal(f.controller.requests.length,0);assert.match(f.field('[data-request-sync]').textContent,/No student found/);
 await f.reader.search('','pending');assert.equal(f.calls.pages.at(-1).studentUid,'');assert.equal(f.reader.more,true);
});
test('late page and ID responses cannot repaint or change identity after navigation',async()=>{
 const f=await fixture();await f.open();let resolve;f.repository.page=()=>new Promise(done=>resolve=done);const pending=f.reader.load();f.leave();resolve({rows:[{id:'stale'}],more:false});await pending;assert.ok(!f.controller.requests.some(row=>row.id==='stale'));
 f.repository.page=async()=>({rows:[],more:false});await f.open();f.repository.resolveStudentId=()=>new Promise(done=>resolve=done);const search=f.reader.search('2510004-1','all');f.leave();resolve('stale-uid');await search;assert.equal(f.reader.studentUid,'');
});
test('saved decisions reconcile one record, update the global badge and preserve successful saves on read failure',async()=>{
 const f=await fixture();await f.open();await f.reader.decisionSaved('request-0','approved','Verified');assert.equal(f.controller.requests[0].reviewedByName,'Verified Admin');assert.equal(f.calls.decisions.length,1);assert.equal(f.calls.pages.length,1);assert.equal(f.calls.counts,2);
 f.repository.decision=async()=>{throw Error('offline');};f.repository.count=async()=>{throw Error('offline');};await f.reader.decisionSaved('request-1','declined','Not verified');assert.equal(f.controller.requests[1].status,'declined');assert.equal(f.controller.badgeCount,80);assert.match(f.field('[data-request-sync]').textContent,/Decision saved/);
});
test('backgrounding, logout, account substitution and forbidden roles stop reads and clear private results',async()=>{
 const f=await fixture();await f.open();const count=f.calls.pages.length;f.document.visibilityState='hidden';f.document.emit('visibilitychange');await f.reader.load(true);assert.equal(f.calls.pages.length,count);f.document.visibilityState='visible';f.document.emit('visibilitychange');await f.settle();assert.equal(f.calls.pages.length,count);
 f.window.emit('presence:device-signing-out');assert.equal(f.controller.requests.length,0);await f.reader.load(true);assert.equal(f.calls.pages.length,count);f.window.emit('presence:device-signout-failed');await f.settle();assert.equal(f.calls.pages.length,count+1);
 f.changeUser('different');assert.equal(f.controller.requests.length,0);await f.reader.load(true);assert.equal(f.calls.pages.length,count+1);
 const denied=await fixture();denied.controller.role='student_manager';await denied.open();assert.equal(denied.calls.pages.length,0);
});

test('query filter changes and local renders do not repeatedly reread the pending badge',async()=>{
 const f=await fixture();await f.open();await f.reader.search('','all');await f.reader.search('2510004-1','approved');f.controller.render();f.reader.draw();assert.equal(f.calls.counts,1);await f.reader.search('2510004-1','approved',true);assert.equal(f.calls.counts,2);assert.equal(f.calls.ids.length,2);
});
test('returning after an interrupted ID lookup resolves the selected ID before reading requests',async()=>{
 const f=await fixture();await f.open();const resolvers=[];f.repository.resolveStudentId=()=>new Promise(resolve=>resolvers.push(resolve));const before=f.calls.pages.length;
 const first=f.reader.search('2510004-1','all');f.leave();await f.open();assert.equal(resolvers.length,2);assert.equal(f.calls.pages.length,before);
 resolvers[0]('stale-account');await first;assert.equal(f.reader.studentUid,'');resolvers[1]('correct-account');await f.settle();assert.equal(f.calls.pages.at(-1).studentUid,'correct-account');
});
test('late pending counts after logout cannot restore another account badge',async()=>{
 const f=await fixture();await f.open();let resolve;f.repository.count=()=>new Promise(done=>resolve=done);const pending=f.reader.refreshCount(true);f.window.emit('presence:device-signing-out');assert.equal(f.controller.badgeCount,0);resolve(999);await pending;assert.equal(f.controller.badgeCount,0);assert.equal(f.controller.requests.length,0);
});
