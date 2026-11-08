const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const demoFixture=require('./fixtures/demo-state.cjs');

function app({saved={},restore=false}={}) {
  const elements=new Map(),storage=new Map(Object.entries(saved)),writes=[],messages=[];
  const node=()=>({innerHTML:'',textContent:'',style:{},value:'',files:[],listeners:{},classList:{add(){},remove(){}},focus(){},querySelectorAll(){return [];},addEventListener(name,handler){this.listeners[name]=handler;},setSelectionRange(){}});
  const context=vm.createContext({console,structuredClone,Intl,Date,Math,setTimeout,clearTimeout,failWrites:false,testMessages:messages,document:{querySelector(s){if(!elements.has(s))elements.set(s,node());return elements.get(s);},querySelectorAll(){return [];},addEventListener(){},body:{style:{}},activeElement:{tagName:'BODY'}},localStorage:{getItem(key){return storage.get(key)??null;},setItem(key,value){if(context.failWrites)throw new Error('QuotaExceededError');storage.set(key,String(value));writes.push(key);}},FormData:class {constructor(form){this.values=form.values;}get(key){return this.values[key]??'';}has(key){return key in this.values;}}});
  const run=source=>vm.runInContext(source,context);
  const root=path.join(__dirname,'..','dist');
  run(fs.readFileSync(path.join(root,'workshop.js'),'utf8'));
  run(fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\nrender\(\);\s*$/,''));
  if(!restore){
    context.testFixture=structuredClone(demoFixture);
    run('replaceState({...testFixture.state,machines:testFixture.machines,objects:testFixture.objects});initializeWorkshop();');
    delete context.testFixture;
  }
  run('const showRepairForTest=openRepair;render=()=>{};toast=message=>testMessages.push(message);openRepair=()=>{};');
  return {run,elements,context,storage,writes,messages};
}

function close(a,values={}) {
  a.run("completeRepairForm('service-101')");
  const form=a.elements.get('#repair-close-form');
  form.values={result:'Тестовый ремонт: соединение заменено и проверено',labor:'1200',external:'0',...Object.fromEntries(a.run('state.stock.map(p=>p.id)').flatMap(id=>[['qty-'+id,'0'],['price-'+id,'0']])),...values};
  form.onsubmit({target:form,preventDefault(){}});
  return form;
}

test('Migration preserves existing browser records without injecting example repairs',()=>{
  const a=app();
  a.run("state.maintenance=state.maintenance.filter(r=>r.id!=='service-demo-closed');delete state.workshopVersion;state.operations.push({id:'preserved'});state.stock[0].qty=19;state.maintenance[0].status='done';initializeWorkshop();initializeWorkshop();");
  assert.equal(a.run('state.operations[0].id'),'preserved');
  assert.equal(a.run('state.stock[0].qty'),19);
  assert.equal(a.run('state.maintenance[0].status'),'done');
  assert.equal(a.run("state.maintenance.filter(r=>r.id==='service-demo-closed').length"),0);
  assert.equal(a.run('state.maintenance.length'),3);
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
  const a=app();a.run("state.operatorMachine='M001';role='operator';shiftModal();");
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

test('A failed repair completion can be retried in the same form without losing or duplicating records',()=>{
  const protectedKeys={
    'monarch-im-control-v1':'preserved legacy bytes',
    'mars-catalog-archive-v1':'preserved catalog archive bytes',
    'mars-director-presentation-v1':'preserved separate demo bytes'
  };
  const a=app({saved:protectedKeys});
  a.run("state.operations.push({id:'prior-expense',machine:'M001',kind:'expense',category:'Тест',amount:75,date:today(),note:'Ранее сохранённая тестовая операция'});state.stockMoves.push({id:'prior-move',part:'part-2',qty:1,kind:'receipt',machine:'',date:today(),note:'Ранее сохранённое тестовое движение'});syncMachineStatuses();persist();");
  const before=a.run('JSON.stringify(state)'),storedBefore=a.storage.get('mars-working-data-v1'),writesBefore=a.writes.length;
  const historyBefore=a.run("state.maintenance.find(r=>r.id==='service-101').history.length");
  a.context.failWrites=true;
  const form=close(a,{'qty-part-1':'1','price-part-1':'650'});
  assert.equal(a.run('JSON.stringify(state)'),before);
  assert.equal(a.storage.get('mars-working-data-v1'),storedBefore);
  assert.equal(a.writes.length,writesBefore);
  assert.deepEqual(a.messages,[]);
  assert.match(a.elements.get('#form-error').textContent,/Данные не изменены/);
  form.onsubmit({target:form,preventDefault(){}});
  assert.equal(a.run('JSON.stringify(state)'),before);
  assert.equal(a.storage.get('mars-working-data-v1'),storedBefore);
  assert.deepEqual(a.messages,[]);

  a.context.failWrites=false;
  form.onsubmit({target:form,preventDefault(){}});
  assert.equal(a.run("state.stock.find(p=>p.id==='part-1').qty"),3);
  assert.equal(a.run("state.operations.filter(o=>o.sourceRepair==='service-101').length"),1);
  assert.equal(a.run("state.stockMoves.filter(m=>m.sourceRepair==='service-101').length"),1);
  assert.equal(a.run("state.operations.find(o=>o.id==='prior-expense').amount"),75);
  assert.equal(a.run("state.stockMoves.find(m=>m.id==='prior-move').qty"),1);
  assert.equal(a.run("state.maintenance.find(r=>r.id==='service-101').history.length"),historyBefore+1);
  assert.equal(a.writes.length,writesBefore+1);
  assert.equal(a.messages.length,1);
  assert.match(a.messages[0],/Ремонт завершён/);
  const saved=a.storage.get('mars-working-data-v1');
  form.onsubmit({target:form,preventDefault(){}});
  assert.equal(a.storage.get('mars-working-data-v1'),saved);
  assert.equal(a.writes.length,writesBefore+1);
  assert.equal(a.messages.length,1);
  for(const [key,value] of Object.entries(protectedKeys))assert.equal(a.storage.get(key),value);

  const reloaded=app({saved:Object.fromEntries(a.storage),restore:true});
  assert.equal(reloaded.run("state.maintenance.find(r=>r.id==='service-101').status"),'done');
  assert.equal(reloaded.run("state.stock.find(p=>p.id==='part-1').qty"),3);
  assert.equal(reloaded.run("state.operations.filter(o=>o.sourceRepair==='service-101').length"),1);
  assert.equal(reloaded.run("state.stockMoves.filter(m=>m.sourceRepair==='service-101').length"),1);
  assert.equal(reloaded.run("state.operations.find(o=>o.id==='prior-expense').amount"),75);
  assert.equal(reloaded.run("state.stockMoves.find(m=>m.id==='prior-move').qty"),1);
});

test('Repair changes retry against the restored record and survive reload',()=>{
  const a=app();
  a.run("syncMachineStatuses();persist();showRepairForTest('service-101');");
  const form=a.elements.get('#repair-update-form');
  const dueDate='2027-12-31';
  form.values={status:'progress',assignee:a.run("state.maintenance.find(r=>r.id==='service-101').assignee"),dueDate,blocking:'on',comment:''};
  const before=a.run('JSON.stringify(state)'),storedBefore=a.storage.get('mars-working-data-v1'),writesBefore=a.writes.length;
  const historyBefore=a.run("state.maintenance.find(r=>r.id==='service-101').history.length");
  a.context.failWrites=true;
  form.onsubmit({target:form,preventDefault(){}});
  assert.equal(a.run('JSON.stringify(state)'),before);
  assert.equal(a.storage.get('mars-working-data-v1'),storedBefore);
  assert.equal(a.writes.length,writesBefore);
  assert.deepEqual(a.messages,[]);
  assert.match(a.elements.get('#form-error').textContent,/Данные не изменены/);
  a.context.failWrites=false;
  form.onsubmit({target:form,preventDefault(){}});
  assert.equal(a.run("state.maintenance.find(r=>r.id==='service-101').dueDate"),dueDate);
  assert.equal(a.run("state.maintenance.find(r=>r.id==='service-101').history.length"),historyBefore+1);
  assert.equal(a.writes.length,writesBefore+1);
  assert.deepEqual(a.messages,['Заявка обновлена.']);
  form.onsubmit({target:form,preventDefault(){}});
  assert.equal(a.writes.length,writesBefore+1);
  assert.equal(a.messages.length,1);
  const reloaded=app({saved:Object.fromEntries(a.storage),restore:true});
  assert.equal(reloaded.run("state.maintenance.find(r=>r.id==='service-101').dueDate"),dueDate);
  assert.equal(reloaded.run("state.maintenance.find(r=>r.id==='service-101').history.length"),historyBefore+1);
});

test('A mechanic can retry technical release after a storage failure without false success',()=>{
  const a=app();
  a.run("role='mechanic';Object.assign(state.maintenance.find(r=>r.id==='service-101'),{status:'done',blocking:true,readyConfirmed:false});syncMachineStatuses();persist();showRepairForTest('service-101');");
  const click=a.elements.get('#repair-release').listeners.click;
  const before=a.run('JSON.stringify(state)'),storedBefore=a.storage.get('mars-working-data-v1'),writesBefore=a.writes.length;
  const historyBefore=a.run("state.maintenance.find(r=>r.id==='service-101').history.length");
  a.context.failWrites=true;
  click();
  assert.equal(a.run('JSON.stringify(state)'),before);
  assert.equal(a.storage.get('mars-working-data-v1'),storedBefore);
  assert.equal(a.writes.length,writesBefore);
  assert.deepEqual(a.messages,[]);
  assert.match(a.elements.get('#form-error').textContent,/Данные не изменены/);
  a.context.failWrites=false;
  click();
  assert.equal(a.run("state.maintenance.find(r=>r.id==='service-101').readyConfirmed"),true);
  assert.equal(a.run("state.maintenance.find(r=>r.id==='service-101').blocking"),false);
  assert.equal(a.run("state.maintenance.find(r=>r.id==='service-101').history.length"),historyBefore+1);
  assert.equal(a.writes.length,writesBefore+1);
  assert.deepEqual(a.messages,['Техника допущена к эксплуатации.']);
  click();
  assert.equal(a.writes.length,writesBefore+1);
  assert.equal(a.messages.length,1);
  const reloaded=app({saved:Object.fromEntries(a.storage),restore:true});
  assert.equal(reloaded.run("state.maintenance.find(r=>r.id==='service-101').readyConfirmed"),true);
  assert.equal(reloaded.run("state.maintenance.find(r=>r.id==='service-101').blocking"),false);
  assert.equal(reloaded.run("state.maintenance.find(r=>r.id==='service-101').history.length"),historyBefore+1);
});

test('Technical release reports a storage failure without an inline error element and retries safely',()=>{
  const a=app();
  a.run("role='mechanic';Object.assign(state.maintenance.find(r=>r.id==='service-101'),{status:'done',blocking:true,readyConfirmed:false});syncMachineStatuses();persist();showRepairForTest('service-101');");
  const querySelector=a.context.document.querySelector;
  a.context.document.querySelector=function(selector){
    return selector==='#form-error'?null:querySelector.call(this,selector);
  };
  const click=a.elements.get('#repair-release').listeners.click;
  const before=a.run('JSON.stringify(state)'),storedBefore=a.storage.get('mars-working-data-v1'),writesBefore=a.writes.length;
  const historyBefore=a.run("state.maintenance.find(r=>r.id==='service-101').history.length");

  a.context.failWrites=true;
  assert.doesNotThrow(()=>click());
  assert.equal(a.run('JSON.stringify(state)'),before);
  assert.equal(a.storage.get('mars-working-data-v1'),storedBefore);
  assert.equal(a.writes.length,writesBefore);
  assert.equal(a.messages.length,1);
  assert.match(a.messages[0],/Не удалось сохранить.*Данные не изменены/);
  assert.ok(a.messages.every(message=>!message.includes('Техника допущена')));

  a.context.failWrites=false;
  assert.doesNotThrow(()=>click());
  assert.equal(a.run("state.maintenance.find(r=>r.id==='service-101').readyConfirmed"),true);
  assert.equal(a.run("state.maintenance.find(r=>r.id==='service-101').blocking"),false);
  assert.equal(a.run("state.maintenance.find(r=>r.id==='service-101').history.length"),historyBefore+1);
  assert.equal(a.writes.length,writesBefore+1);
  assert.equal(a.messages.at(-1),'Техника допущена к эксплуатации.');
  const reloaded=app({saved:Object.fromEntries(a.storage),restore:true});
  assert.equal(reloaded.run("state.maintenance.find(r=>r.id==='service-101').readyConfirmed"),true);
  assert.equal(reloaded.run("state.maintenance.find(r=>r.id==='service-101').history.length"),historyBefore+1);
});
