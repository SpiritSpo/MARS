const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function app() {
  const elements=new Map();
  const node=()=>({innerHTML:'',textContent:'',style:{},value:'',files:[],classList:{add(){},remove(){}},focus(){},querySelectorAll(){return [];},addEventListener(){},setSelectionRange(){}});
  const context=vm.createContext({console,structuredClone,Intl,Date,Math,setTimeout,clearTimeout,failWrites:false,document:{querySelector(s){if(!elements.has(s))elements.set(s,node());return elements.get(s);},querySelectorAll(){return [];},addEventListener(){},body:{style:{}},activeElement:{tagName:'BODY'}},localStorage:{getItem(){return null;},setItem(){if(context.failWrites)throw new Error('QuotaExceededError');}},FormData:class {constructor(form){this.values=form.values;}get(key){return this.values[key]??'';}has(key){return key in this.values;}}});
  const run=source=>vm.runInContext(source,context);
  const root=path.join(__dirname,'..','dist');
  run(fs.readFileSync(path.join(root,'workshop.js'),'utf8'));
  run(fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\nrender\(\);\s*$/,''));
  run('render=()=>{};toast=()=>{};openRepair=()=>{};');
  return {run,elements,context};
}

function close(a,values={}) {
  a.run("completeRepairForm('service-101')");
  const form=a.elements.get('#repair-close-form');
  form.values={result:'Тестовый ремонт: соединение заменено и проверено',labor:'1200',external:'0',...Object.fromEntries(a.run('state.stock.map(p=>p.id)').flatMap(id=>[['qty-'+id,'0'],['price-'+id,'0']])),...values};
  form.onsubmit({target:form,preventDefault(){}});
  return form;
}

test('Migration preserves existing browser records and does not duplicate seeded history',()=>{
  const a=app();
  a.run("state=initialState();state.operations.push({id:'preserved'});state.stock[0].qty=19;state.maintenance[0].status='done';initializeWorkshop();initializeWorkshop();");
  assert.equal(a.run('state.operations[0].id'),'preserved');
  assert.equal(a.run('state.stock[0].qty'),19);
  assert.equal(a.run('state.maintenance[0].status'),'done');
  assert.equal(a.run("state.maintenance.filter(r=>r.id==='service-demo-closed').length"),1);
});

test('Completing a repair records one expense, issues parts once and preserves another stop',()=>{
  const a=app();
  a.run("state.maintenance.push(newRepairRecord({machine:'M008',type:'Второй тестовый ремонт',blocking:true}));syncMachineStatuses();");
  const form=close(a,{'qty-part-1':'1','price-part-1':'650'});
  assert.equal(a.run("state.stock.find(p=>p.id==='part-1').qty"),3);
  assert.equal(a.run('state.stockMoves.length'),1);
  assert.equal(a.run('state.operations.length'),1);
  assert.equal(a.run('state.operations[0].amount'),1850);
  assert.equal(a.run("state.maintenance.find(r=>r.id==='service-101').status"),'done');
  assert.equal(a.run("machine('M008').status"),'repair');
  form.onsubmit({target:form,preventDefault(){}});
  assert.equal(a.run('state.operations.length'),1);
  assert.equal(a.run('state.stockMoves.length'),1);
});

test('Insufficient stock blocks the whole completion',()=>{
  const a=app();close(a,{'qty-part-1':'99','price-part-1':'650'});
  assert.equal(a.run('state.operations.length'),0);
  assert.equal(a.run('state.stockMoves.length'),0);
  assert.equal(a.run("state.maintenance.find(r=>r.id==='service-101').status"),'progress');
  assert.match(a.elements.get('#form-error').textContent,/количество/);
});

test('Storage failure rolls back stock, finance and repair status together',()=>{
  const a=app();a.context.failWrites=true;close(a,{'qty-part-1':'1','price-part-1':'650'});
  assert.equal(a.run('state.operations.length'),0);
  assert.equal(a.run('state.stockMoves.length'),0);
  assert.equal(a.run('state.stock[0].qty'),4);
  assert.equal(a.run("state.maintenance.find(r=>r.id==='service-101').status"),'progress');
  assert.match(a.elements.get('#form-error').textContent,/Данные не изменены/);
});

test('A shift issue creates one linked repair while shift approval remains separate',()=>{
  const a=app();a.run("role='operator';shiftModal();");
  const values={machine:'M001',date:a.run('today()'),hours:'8',meter:'1256',condition:'issue',note:'Тест: требуется проверить гидравлику'};
  let form=a.elements.get('#shift-form');form.values=values;form.onsubmit({target:form,preventDefault(){}});
  assert.equal(a.run("state.shifts.at(-1).status"),'pending');
  assert.equal(a.run("state.maintenance.filter(r=>r.sourceShift===state.shifts.at(-1).id).length"),1);
  assert.equal(a.run('state.operations.length'),0);
  a.run("state.shifts.at(-1).status='returned';shiftModal(state.shifts.at(-1).id);");
  form=a.elements.get('#shift-form');form.values={...values,note:'Тест: уточнение замечания'};form.onsubmit({target:form,preventDefault(){}});
  assert.equal(a.run("state.maintenance.filter(r=>r.sourceShift===state.shifts.at(-1).id).length"),1);
});

test('Photo rendering rejects arbitrary SVG and external URLs',()=>{
  const a=app();
  assert.equal(a.run("validPhotoUrl('https://example.com/photo.jpg')"),false);
  assert.equal(a.run("validPhotoUrl('data:image/svg+xml;base64,PHN2Zz4=')"),false);
  assert.equal(a.run("validPhotoUrl('./assets/demo-hydraulics.svg')"),true);
});


test('Fleet status follows blocking repairs, reservations and approved shifts',()=>{
 const a=app();
 a.run("state.maintenance=[];state.equipmentRequests=[];state.shifts=[];syncMachineStatuses();");
 assert.equal(a.run("machine('M001').status"),'free');
 a.run("state.equipmentRequests.push({status:'Согласована',releaseConfirmed:false,items:[{machine:'M001',start:today(),end:today()}]});syncMachineStatuses();");
 assert.equal(a.run("machine('M001').status"),'reserved');
 a.run("state.shifts.push({machine:'M001',date:today(),hours:8,status:'pending'});syncMachineStatuses();");
 assert.equal(a.run("machine('M001').status"),'reserved');
 a.run("state.shifts.at(-1).status='approved';syncMachineStatuses();");
 assert.equal(a.run("machine('M001').status"),'work');
 a.run("state.maintenance.push({machine:'M001',blocking:true,readyConfirmed:false});syncMachineStatuses();");
 assert.equal(a.run("machine('M001').status"),'repair');
});

test('Accounting import blocks potentially repeated mechanic repair expenses',()=>{
 const a=app();
 const fs=require('node:fs'),path=require('node:path');
 a.run(fs.readFileSync(path.join(__dirname,'..','dist','accountant.js'),'utf8'));
 a.run("state.operations.push({id:'repair-expense',machine:'M001',kind:'expense',category:'Ремонт и ТО',amount:35000,date:'2026-11-03',note:'ЗР-0099',sourceRepair:'repair-99'});state.maintenance.push({id:'repair-99',number:'ЗР-0099',machine:'M001'});");
 const rows=[['Дата','Техника','Статья','Сумма','Комментарий'],['2026-11-03','M001','Ремонт и ТО','35000','ЗР-0099']];
 const parsed=a.run('accountantParseRows('+JSON.stringify(rows)+')');
 assert.equal(parsed.rows.length,0);
 assert.match(parsed.errors.join(' '),/повтор расходов ремонта/);
});
