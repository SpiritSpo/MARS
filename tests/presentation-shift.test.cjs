const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Parse the rendered form so these tests exercise the value/min shown to a
// person as well as the handlers that read those fields on change and submit.
function app() {
 const elements=new Map(),fields=new Map(),storage=new Map(),writes=[],messages=[];
 let modal=null;
 const node=()=>({innerHTML:'',textContent:'',style:{},value:'',min:'',listeners:{},classList:{add(){},remove(){}},focus(){},querySelectorAll(){return [];},addEventListener(name,handler){this.listeners[name]=handler;},setSelectionRange(){}});
 const attrs=source=>Object.fromEntries([...source.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
 const query=selector=>{
  const name=selector.match(/\[name=["']?([^\]"']+)["']?\]/)?.[1];
  if(name&&fields.has(name))return fields.get(name);
  if(!elements.has(selector))elements.set(selector,node());
  return elements.get(selector);
 };
 const mount=(title,html)=>{
  modal={title,html};fields.clear();
  const form=node();form.elements={namedItem:name=>fields.get(name)};
  form.querySelector=query;
  elements.set('#shift-form',form);
  elements.set('#form-error',node());
  for(const match of html.matchAll(/<(input|select|textarea)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)){
   const a=attrs(match[2]);if(!a.name)continue;
   const el=Object.assign(node(),a);
   if(match[1]==='select'){
    el.options=[...match[3].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(m=>({...attrs(m[1]),selected:/\bselected\b/.test(m[1])}));
    el.value=el.options.find(o=>o.selected)?.value??el.options[0]?.value??'';
   }else if(match[1]==='textarea')el.value=match[3]||'';
   fields.set(a.name,el);form.elements[a.name]=el;
   if(a.id)elements.set('#'+a.id,el);
  }
 };
 const FixedDate=class extends Date {
  constructor(...args){super(...(args.length?args:['2026-11-10T12:00:00Z']));}
  static now(){return new Date('2026-11-10T12:00:00Z').getTime();}
 };
 const context=vm.createContext({console,structuredClone,Intl,Date:FixedDate,Math,setTimeout,clearTimeout,mountShiftTest:mount,testMessages:messages,
  document:{querySelector:query,querySelectorAll(){return [];},addEventListener(){},body:{style:{}},activeElement:{tagName:'BODY'}},
  localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){storage.set(key,String(value));writes.push(key);}},
  FormData:class {constructor(form){this.form=form;}get(name){return fields.get(name)?.value??'';}has(name){return fields.has(name);}}
 });
 const run=source=>vm.runInContext(source,context);
 for(const file of ['workshop.js','app.js']){
  const source=fs.readFileSync(path.join(__dirname,'..','dist',file),'utf8');
  run(file==='app.js'?source.replace(/\nrender\(\);\s*$/,''):source);
 }
 run(`replaceState({...initialState(),operatorMachine:'M001',objects:[{id:'o1',name:'Тестовый объект'}],machines:[
  {id:'M001',name:'Тестовая техника 1',type:'Погрузчик',object:'o1',operator:'Машинист 1',meter:100},
  {id:'M002',name:'Тестовая техника 2',type:'Погрузчик',object:'o1',operator:'Машинист 2',meter:20}
 ]});initializeWorkshop();period='all';role='mechanic';render=()=>{};showModal=mountShiftTest;toast=message=>testMessages.push(message);`);
 const change=(name,value)=>{
  const field=fields.get(name);field.value=String(value);
  const handler=field.onchange||field.listeners.change;
  assert.equal(typeof handler,'function',name+' has a change handler');
  handler({target:field});
 };
 const input=(name,value)=>{
  const field=fields.get(name);field.value=String(value);
  const handler=field.oninput||field.listeners.input;
  if(handler)handler({target:field});
 };
 const submit=(values={})=>{
  for(const [name,value] of Object.entries({hours:8,condition:'ok',note:'Тестовая смена',...values}))fields.get(name).value=String(value);
  const form=elements.get('#shift-form');
  form.onsubmit({target:form,preventDefault(){}});
 };
 return {run,fields,elements,storage,writes,messages,change,input,submit,get modal(){return modal;}};
}

test('Shift initial reading uses only finite approved readings for its machine and date, without writes',()=>{
 const a=app();
 a.run(`state.shifts=[
  {id:'prior',machine:'M001',date:'2026-11-01',meter:140,status:'approved'},
  {machine:'M001',date:'2026-11-02',meter:900,status:'pending'},
  {machine:'M001',date:'2026-11-03',meter:950,status:'returned'},
  {machine:'M002',date:'2026-11-01',meter:1000,status:'approved'},
  {machine:'M001',date:'2026-11-11',meter:1100,status:'approved'},
  {machine:'M001',date:'2026-02-30',meter:1200,status:'approved'},
  {machine:'M001',date:'invalid',meter:1300,status:'approved'},
  ...[NaN,Infinity,-1,null,undefined,'1500'].map(meter=>({machine:'M001',date:'2026-11-02',meter,status:'approved'}))
 ];`);
 const before=a.run('JSON.stringify(state)'),writes=a.writes.length;
 a.run('shiftModal();');
 assert.equal(Number(a.fields.get('meter').value),140);
 assert.equal(Number(a.fields.get('meter').min),140);
 assert.equal(a.run('JSON.stringify(state)'),before);
 assert.equal(a.writes.length,writes);
 assert.equal(a.run("machine('M001').meter"),100);
});

test('Invalid catalog baselines and readings cannot poison the visible meter floor',()=>{
 for(const baseline of ['NaN','Infinity','-12','null','undefined',"'999'"]){
  const a=app();
  a.run(`machine('M001').meter=${baseline};state.shifts=[{machine:'M001',date:'2026-11-01',meter:45,status:'approved'},{machine:'M001',date:'2026-11-02',meter:NaN,status:'approved'}];shiftModal();`);
  assert.equal(Number(a.fields.get('meter').value),45,baseline);
  assert.equal(Number(a.fields.get('meter').min),45,baseline);
 }
});

test('An unknown starting reading stays blank, while a confirmed zero is shown as zero',()=>{
 for(const baseline of ['NaN','Infinity','-12','null','undefined',"'999'"]){
  const a=app();
  a.run(`machine('M001').meter=${baseline};state.shifts=[
   ...[NaN,Infinity,-1,null,undefined,'1500'].map(meter=>({machine:'M001',date:'2026-11-02',meter,status:'approved'})),
   {machine:'M001',date:'2026-11-02',meter:200,status:'pending'},
   {machine:'M002',date:'2026-11-02',meter:300,status:'approved'}
  ];shiftModal();`);
  assert.equal(a.fields.get('meter').value,'',baseline);
  assert.equal(Number(a.fields.get('meter').min),0,baseline);
  assert.match(a.modal.html,/Исходное показание неизвестно/i);
  const before=a.run('JSON.stringify(state)');
  a.submit({meter:''});
  assert.equal(a.run('JSON.stringify(state)'),before,'a blank reading must not become a saved zero');
 }
 for(const source of ['catalog','shift']){
  const a=app();
  a.run(source==='catalog'?"machine('M001').meter=0;shiftModal();":"machine('M001').meter=null;state.shifts=[{machine:'M001',date:'2026-11-01',meter:0,status:'approved'}];shiftModal();");
  assert.equal(a.fields.get('meter').value,'0',source+' retains a genuine zero');
  assert.equal(Number(a.fields.get('meter').min),0);
 }
});

test('Date changes recompute the floor, preserve a higher reading, and machine changes use that asset',()=>{
 const a=app();
 a.run(`state.shifts=[
  {machine:'M001',date:'2026-11-02',meter:130,status:'approved'},
  {machine:'M001',date:'2026-11-08',meter:160,status:'approved'},
  {machine:'M002',date:'2026-11-02',meter:35,status:'approved'}
 ];shiftModal();`);
 const before=a.run('JSON.stringify(state)');
 a.fields.get('meter').value='190';
 a.change('date','2026-11-03');
 assert.equal(Number(a.fields.get('meter').min),130);
 assert.equal(Number(a.fields.get('meter').value),190);
 a.input('meter','120');
 assert.equal(Number(a.fields.get('meter').value),120,'manual editing remains visible for validation');
 a.change('date','2026-11-09');
 assert.equal(Number(a.fields.get('meter').min),160);
 assert.equal(Number(a.fields.get('meter').value),160);
 a.change('machine','M002');
 assert.equal(Number(a.fields.get('meter').min),35);
 assert.equal(Number(a.fields.get('meter').value),35,'the previous asset reading is not copied');
 assert.equal(a.run('JSON.stringify(state)'),before);
 assert.equal(a.writes.length,0);
});

test('Returned shift retains its higher reading on open and when its date changes',()=>{
 const a=app();
 a.run(`state.shifts=[
  {id:'prior',machine:'M001',date:'2026-11-01',meter:140,status:'approved'},
  {id:'returned',machine:'M001',date:'2026-11-05',hours:8,meter:180,condition:'ok',note:'Исправить',status:'returned'}
 ];shiftModal('returned');`);
 assert.equal(Number(a.fields.get('meter').min),140);
 assert.equal(Number(a.fields.get('meter').value),180);
 a.change('date','2026-10-31');
 assert.equal(Number(a.fields.get('meter').min),100);
 assert.equal(Number(a.fields.get('meter').value),180);
 assert.equal(a.run("state.shifts.find(s=>s.id==='returned').meter"),180);
});

test('Submit rechecks newly approved data and rejects an obsolete or nonfinite reading atomically',()=>{
 const a=app();a.run('shiftModal();');
 a.run("state.shifts.push({id:'fresh-approved',machine:'M001',date:'2026-11-09',meter:150,status:'approved'});");
 const before=a.run('JSON.stringify(state)');
 a.submit({meter:120});
 assert.match(a.elements.get('#form-error').textContent,/150/);
 assert.equal(Number(a.fields.get('meter').min),150);
 assert.equal(a.run('JSON.stringify(state)'),before);
 assert.equal(a.writes.length,0);
 for(const meter of ['NaN','Infinity']){
  a.submit({meter});
  assert.equal(a.run('JSON.stringify(state)'),before);
 }
 a.submit({meter:155});
 assert.equal(a.run('state.shifts.at(-1).status'),'pending');
 assert.equal(a.run('state.shifts.at(-1).meter'),155);
 assert.equal(a.run("machine('M001').meter"),100);
 assert.equal(a.run('state.operations.length'),0);
 assert.match(a.messages.at(-1),/механик или руководитель/i);
});

test('Only director, mechanic, and the assigned operator can open and submit a shift',()=>{
 for(const role of ['dispatcher','accountant']){
  const a=app();a.run(`role=${JSON.stringify(role)};shiftModal();`);
  assert.equal(a.modal,null,role+' cannot open a shift');
  a.run("role='mechanic';shiftModal();");
  a.run(`role=${JSON.stringify(role)};`);
  const before=a.run('JSON.stringify(state)');
  a.submit({meter:110});
  assert.equal(a.run('JSON.stringify(state)'),before,role+' cannot use a stale handler');
  assert.equal(a.writes.length,0);
 }
 for(const role of ['director','mechanic','operator']){
  const a=app();a.run(`role=${JSON.stringify(role)};shiftModal();`);
  assert.ok(a.modal,role+' may open a shift');
  a.submit({meter:110});
  assert.equal(a.run('state.shifts.length'),1,role+' may submit a shift');
 }
 const a=app();a.run("role='operator';shiftModal();");
 assert.deepEqual(a.fields.get('machine').options.map(o=>o.value),['M001']);
 const before=a.run('JSON.stringify(state)');
 a.submit({machine:'M002',meter:25});
 assert.equal(a.run('JSON.stringify(state)'),before,'forged machine selection is rejected');
 assert.equal(a.writes.length,0);
 a.run("state.shifts.push({id:'other-returned',machine:'M002',date:'2026-11-09',hours:8,meter:25,status:'returned'});");
 const priorModal=a.modal;a.run("shiftModal('other-returned');");
 assert.equal(a.modal,priorModal,'operator cannot edit another machine through a direct call');
});

test('Duplicate dates, future dates, and missing issue descriptions remain rejected',()=>{
 const a=app();
 a.run("state.shifts.push({id:'already',machine:'M001',date:'2026-11-10',meter:110,status:'pending'});shiftModal();");
 const before=a.run('JSON.stringify(state)');
 a.submit({meter:120});
 assert.match(a.elements.get('#form-error').textContent,/уже создана/);
 a.submit({date:'2026-11-11',meter:120});
 assert.match(a.elements.get('#form-error').textContent,/будущую/);
 a.submit({date:'2026-11-09',meter:120,condition:'issue',note:''});
 assert.match(a.elements.get('#form-error').textContent,/Опишите/);
 assert.equal(a.run('JSON.stringify(state)'),before);
 assert.equal(a.writes.length,0);
});

test('Shift guidance assigns entry and approval roles, and issue resubmission creates one repair without finance',()=>{
 const a=app();a.run("state.operations.push({id:'prior-expense',machine:'M001',kind:'expense',amount:77,date:'2026-11-01',category:'Прочие расходы',note:'Сохранённая операция'});role='operator';shiftModal();");
 const finance=a.run('JSON.stringify(state.operations)');
 assert.match(a.modal.html,/механик или руководитель проверяет/i);
 assert.doesNotMatch(a.modal.html,/менеджер[^<]*(?:утвержд|провер)/i);
 assert.match(a.run('shiftsPage()'),/машинист или механик вносит смену/);
 a.submit({meter:110,condition:'issue',note:'Проверить соединение'});
 assert.equal(a.run('state.maintenance.length'),1);
 assert.equal(a.run('JSON.stringify(state.operations)'),finance);
 a.run("state.shifts[0].status='returned';shiftModal(state.shifts[0].id);");
 a.submit({meter:115,condition:'issue',note:'Уточнено замечание к соединению'});
 assert.equal(a.run('state.shifts.length'),1);
 assert.equal(a.run('state.maintenance.length'),1);
 assert.equal(a.run('JSON.stringify(state.operations)'),finance);
 assert.equal(a.run('state.shifts[0].status'),'pending');
});
