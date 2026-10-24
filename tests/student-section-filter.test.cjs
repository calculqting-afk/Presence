const test=require('node:test');
const assert=require('node:assert/strict');
function node(){const listeners=new Map();return {listeners,innerHTML:'',textContent:'',open:false,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),emit(name,event){listeners.get(name)?.(event);}};}
async function fixture(){
  const {StudentSectionFilter}=await import('../assets/js/controllers/StudentSectionFilter.js');
  const root=node(),document=node(),label=node(),options=node(),summary={focus(){this.focused=true;}};
  root.querySelector=selector=>selector==='summary'?summary:selector==='[data-section-options]'?options:label;
  root.contains=target=>target===root||target.inside===true;
  let changes=0;
  const picker=new StudentSectionFilter({root,document,escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),onChange:()=>changes++});
  picker.initialize();picker.initialize();picker.setOptions(['1A','2A','2B']);
  const choose=(value,checked)=>root.emit('change',{target:{dataset:{sectionOption:''},value,checked}});
  const action=value=>root.emit('click',{target:{closest:()=>({dataset:{sectionAction:value}})}});
  return {picker,root,document,label,options,summary,choose,action,changes:()=>changes};
}
test('directory section picker supports OR selection, select all, clear and preserved choices',async()=>{
  const f=await fixture();assert.equal(f.label.textContent,'All sections');assert.equal(f.picker.matches('3A'),true);
  f.choose('2A',true);assert.equal(f.label.textContent,'Section 2A');assert.equal(f.picker.matches('1A'),false);
  f.choose('2B',true);assert.equal(f.label.textContent,'2 sections selected');
  assert.equal(f.picker.matches('2A'),true);assert.equal(f.picker.matches('2B'),true);
  assert.equal(f.picker.matches('1A'),false);assert.equal(f.changes(),2);
  f.choose('forged',true);assert.equal(f.changes(),2);
  f.picker.setOptions(['1A','2A']);assert.equal(f.picker.matches('2B'),true,'a removed section stays selected rather than broadening results');
  f.action('all');assert.equal(f.label.textContent,'All sections');assert.equal((f.options.innerHTML.match(/ checked/g)||[]).length,3);
  f.action('clear');assert.equal(f.picker.selected.size,0);assert.equal(f.picker.matches('1A'),true);
  f.choose('2A',true);f.root.open=true;f.picker.reset();assert.equal(f.label.textContent,'All sections');assert.equal(f.root.open,false);
});
test('directory section picker escapes labels, closes with Escape/outside click, and cleans listeners',async()=>{
  const f=await fixture();f.picker.setOptions(['2A"><img src=x>']);
  assert.doesNotMatch(f.options.innerHTML,/<img/);assert.match(f.options.innerHTML,/&quot;&gt;|&quot;>/);
  f.root.open=true;f.document.emit('click',{target:{inside:true}});assert.equal(f.root.open,true);
  f.document.emit('click',{target:{}});assert.equal(f.root.open,false);
  f.root.open=true;f.root.emit('keydown',{key:'Escape'});assert.equal(f.root.open,false);assert.equal(f.summary.focused,true);
  f.picker.dispose();f.picker.dispose();assert.equal(f.root.listeners.size,0);assert.equal(f.document.listeners.size,0);
});
