const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const fixture=require('./fixtures/demo-state.cjs');

function app(){
 const elements=new Map(),writes=[];
 const node=()=>({innerHTML:'',textContent:'',style:{},value:'',files:[],classList:{add(){},remove(){}},focus(){},querySelectorAll(){return [];},addEventListener(){},setSelectionRange(){}});
 const context=vm.createContext({console,structuredClone,Intl,Date,Math,setTimeout,clearTimeout,
  document:{querySelector(selector){if(!elements.has(selector))elements.set(selector,node());return elements.get(selector);},querySelectorAll(){return [];},addEventListener(){},body:{style:{}},activeElement:{tagName:'BODY'}},
  localStorage:{getItem(){return null;},setItem(key,value){writes.push({key,value});}},
  FormData:class{constructor(form){this.values=form.values;}get(key){return this.values[key]??'';}has(key){return key in this.values;}}
 });
 const run=source=>vm.runInContext(source,context);
 const root=path.join(__dirname,'..','dist');
 run(fs.readFileSync(path.join(root,'workshop.js'),'utf8'));
 run(fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\nrender\(\);\s*$/,''));
 context.fixture=structuredClone(fixture);
 run('replaceState({...fixture.state,machines:fixture.machines,objects:fixture.objects});initializeWorkshop();render=()=>{};toast=()=>{};openRepair=()=>{};state.operations=[];');
 delete context.fixture;
 function imported(values={}){
  context.imported={id:'imported-expense',machine:'M008',kind:'expense',category:'Ремонт и ТО',amount:1850,date:run('today()'),note:'',source:'excel-demo',importSource:{entity:'expenses',documentId:'EXP-TEST',line:'1'},...values};
  run('state.operations.push(imported)');delete context.imported;
 }
 function close(){
  run('completeRepairForm("service-101")');
  const form=elements.get('#repair-close-form');
  form.values={result:'Проверочный ремонт',labor:'1200',external:'0',...Object.fromEntries(run('state.stock.map(p=>p.id)').flatMap(id=>[['qty-'+id,'0'],['price-'+id,'0']])),'qty-part-1':'1','price-part-1':'650'};
  form.onsubmit({target:form,preventDefault(){}});
 }
 return {run,context,elements,writes,imported,close};
}

for(const [name,values] of [
 ['same repair category on the closing date',{amount:2000}],
 ['same amount on the closing date',{category:'Услуги по документу'}],
 ['repair number on a different date',{date:'2020-01-01',note:'Расход по ЗР-0001'}]
])test('Closing a repair blocks an imported expense with '+name+' before any mutation',()=>{
 const a=app();a.imported(values);
 const before=a.run('JSON.stringify(state)'),writeCount=a.writes.length;
 a.close();
 assert.equal(a.run('JSON.stringify(state)'),before);
 assert.equal(a.writes.length,writeCount);
 assert.match(a.elements.get('#form-error').textContent,/Возможный повтор.*расхода/);
 assert.match(a.elements.get('#form-error').textContent,/EXP-TEST/);
});

for(const [name,values] of [
 ['warehouse allocation',{allocation:'warehouse',note:'ЗР-0001'}],
 ['overhead allocation',{allocation:'overhead',note:'ЗР-0001'}],
 ['different date without a repair reference',{date:'2020-01-01'}],
 ['different machine',{machine:'M001'}],
 ['unrelated expense on the same date',{category:'Топливо',amount:101}]
])test('Closing a repair permits an imported expense with '+name,()=>{
 const a=app();a.imported(values);a.close();
 assert.equal(a.run('state.maintenance.find(r=>r.id==="service-101").status'),'done');
 assert.equal(a.run('state.stock[0].qty'),3);
 assert.equal(a.run('state.operations.length'),2);
 assert.equal(a.run('state.operations.at(-1).amount'),1850);
 assert.equal(a.run('state.operations.at(-1).sourceRepair'),'service-101');
});

test('Machine passports use imported registration plate and retain the legacy field fallback',()=>{
 const a=app();
 assert.equal(a.run('passportMetadata({plate:"TEST-PLATE",registration:"OLD-PLATE"}).registration'),'TEST-PLATE');
 assert.equal(a.run('passportMetadata({registration:"OLD-PLATE"}).registration'),'OLD-PLATE');
 assert.equal(a.run('passportMetadata({}).registration'),'');
});

test('Imported mechanics can be selected explicitly while unrelated employees are not added as repair assignees',()=>{
 const a=app();
 a.run('state.employees=[{id:"EMP-M",name:"Тестовый механик",position:"Главный механик"},{id:"EMP-S",name:"Тестовый слесарь",position:"Слесарь по ремонту"},{id:"EMP-D",name:"Тестовый водитель",position:"Водитель"}];');
 assert.equal(a.run('repairAssignees().includes("Тестовый механик")'),true);
 assert.equal(a.run('repairAssignees().includes("Тестовый слесарь")'),true);
 assert.equal(a.run('repairAssignees().includes("Тестовый водитель")'),false);
 assert.equal(a.run('newRepairRecord({machine:"M001",type:"Проверка"}).assignee'),'Не назначен');
});
