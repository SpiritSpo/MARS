const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const demoFixture=require('./fixtures/demo-state.cjs');
const savedCatalogs=require('./fixtures/saved-catalogs.cjs');

const workingKey='mars-working-data-v1';
const archiveKey='monarch-im-control-v1';
const catalogArchiveKey='mars-catalog-archive-v1';

function workspace(saved={},options={}) {
 const storage=new Map(Object.entries(saved)),writes=[],writeAttempts=[],elements=new Map();
 const element=()=>({innerHTML:'',textContent:'',style:{},value:'',files:[],dataset:{},classList:{add(){},remove(){}},focus(){},querySelectorAll(){return [];},addEventListener(){},setSelectionRange(){}});
 const context=vm.createContext({console,structuredClone,Intl,Date,Math,setTimeout,clearTimeout,
  document:{querySelector(s){if(!elements.has(s))elements.set(s,element());return elements.get(s);},getElementById(id){if(!elements.has('#'+id))elements.set('#'+id,element());return elements.get('#'+id);},querySelectorAll(){return [];},addEventListener(){},body:{style:{}},activeElement:{tagName:'BODY'}},
  localStorage:{getItem(key){return storage.get(key)??null;},setItem(key,value){writeAttempts.push({key,value:String(value)});if(options.failWrite?.(key))throw Error('QuotaExceededError');writes.push(key);storage.set(key,String(value));}},
  window:{scrollTo(){},print(){}},
  FormData:class {constructor(form){this.values=form.values;}get(key){return this.values[key]??'';}has(key){return key in this.values;}}
 });
 const run=source=>vm.runInContext(source,context);
 for(const name of ['workshop.js','accountant.js','import-engine.js','import-ui.js','app.js']) {
  const source=fs.readFileSync(path.join(__dirname,'..','dist',name),'utf8');
  run(name==='app.js'?source.replace(/\nrender\(\);\s*$/,''):source);
 }
 run('toast=()=>{};');
 return {run,context,storage,writes,writeAttempts,elements};
}

function values(html){return [...html.matchAll(/class="stat-value"[^>]*>(.*?)<\/div>/gs)].map(m=>m[1].replace(/<[^>]*>/g,'').trim());}

function enteredState(operations=[]) {
 const fixture=structuredClone(demoFixture);
 return {...fixture.state,machines:fixture.machines,objects:fixture.objects,operations,shifts:[],maintenance:[],stock:[],stockMoves:[]};
}

function operation(id,kind,amount,date='2026-11-03') {
 return {id,machine:'M001',kind,amount,date,category:'Тестовая запись',note:'Данные введены пользователем теста'};
}

test('A fresh workspace has no fabricated records and every available role view renders',()=>{
 const a=workspace();
 for(const key of ['machines','objects','operations','shifts','maintenance','stock','stockMoves']) {
  assert.equal(a.run('state['+JSON.stringify(key)+'].length'),0,key);
 }
 a.run('period="all";initializeWorkshop();initializeWorkshop();');
 const roles=JSON.parse(a.run('JSON.stringify(Object.keys(allowed))'));
 for(const role of roles) {
  a.context.testRole=role;
  const views=JSON.parse(a.run('JSON.stringify(allowed[testRole])'));
  for(const view of [...views,'more']) {
   a.context.testView=view;
   assert.doesNotThrow(()=>a.run('role=testRole;view=testView;render();'),role+'/'+view);
   const html=a.elements.get('#app').innerHTML;
   assert.ok(html.length>0,role+'/'+view);
   assert.doesNotMatch(html,/NaN|Infinity|425[\s\u00a0]?000|6[\s\u00a0]?660[\s\u00a0]?000|Коммунарка|Хорошёвский|Сити Парк|Bobcat S650|JCB 3CX|Liebherr 132|Potain MDT|Мини-погрузчик|Башенный кран/,role+'/'+view);
  }
 }
 assert.equal(a.run('state.maintenance.length'),0);
 assert.equal(a.run('state.operations.length'),0);
});

test('Empty financial cards report missing data instead of measured zeroes',()=>{
 const a=workspace();a.run('role="director";period="all";');
 const dashboard=a.run('dashboardPage()'),finance=a.run('financialStats()');
 for(const html of [dashboard,finance]) {
  assert.match(html,/[Нн]ет данных|[Дд]анные[^<]*не загружены/);
  const financial=values(html).slice(0,4);
  assert.equal(financial.length,4);
  assert.ok(financial.every(v=>/—|[Нн]ет данных/.test(v)),JSON.stringify(financial));
  assert.doesNotMatch(html,/NaN|Infinity/);
 }
});

test('A real zero result remains visible and is different from an empty period',()=>{
 const state=enteredState([operation('income','income',100),operation('expense','expense',100)]);
 const a=workspace({[workingKey]:JSON.stringify(state)});a.run('role="director";period="2026-11";');
 const financial=values(a.run('dashboardPage()'));
 assert.match(financial[0],/100/);
 assert.match(financial[1],/100/);
 assert.match(financial[2],/^0\s*₽$/);
 assert.match(financial[3],/^0[,.]0%$/);
 assert.equal(a.run('overallFinance().income-overallFinance().expense'),0);
 a.run('period="2026-12";');
 assert.ok(values(a.run('dashboardPage()')).slice(0,4).every(v=>/—|[Нн]ет данных/.test(v)));
});

test('Stored working entries survive reload without monthly demo totals or writes to the archive',()=>{
 const operations=[operation('actual-income','income',1234),operation('actual-expense','expense',234)];
 const state=enteredState(operations),archive=JSON.stringify(demoFixture.state);
 const a=workspace({[workingKey]:JSON.stringify(state),[archiveKey]:archive});
 a.run('role="director";period="2026-11";');
 assert.deepEqual(JSON.parse(a.run('JSON.stringify(state.operations)')),operations);
 assert.deepEqual(JSON.parse(a.run('JSON.stringify(overallFinance())')),{income:1234,expense:234});
 assert.equal(a.run('result(machine("M001"))'),1000);
 assert.equal(a.run('operations().length'),2);
 const catalogs=JSON.parse(a.run('JSON.stringify({machines,objects})'));
 const withoutStatus=rows=>rows.map(({status,...record})=>record);
 assert.deepEqual(withoutStatus(catalogs.machines),withoutStatus(state.machines));
 assert.deepEqual(catalogs.objects,state.objects);
 assert.equal(a.run('persist()'),true);
 assert.ok(a.writes.includes(workingKey));
 assert.ok(!a.writes.includes(archiveKey));
 assert.equal(a.storage.get(archiveKey),archive);
 const reloaded=workspace(Object.fromEntries(a.storage));
 reloaded.run('period="all";');
 assert.deepEqual(JSON.parse(reloaded.run('JSON.stringify(state.operations)')),operations);
 assert.deepEqual(JSON.parse(reloaded.run('JSON.stringify(overallFinance())')),{income:1234,expense:234});
});

test('Legacy local storage remains untouched and is not mixed into the working workspace',()=>{
 const archive=JSON.stringify({...demoFixture.state,operations:[operation('legacy-entry','expense',777)]});
 const a=workspace({[archiveKey]:archive});
 assert.equal(a.run('state.operations.length'),0);
 assert.equal(a.run('machines.length'),0);
 assert.equal(a.run('objects.length'),0);
 assert.equal(a.run('state.maintenance.length'),0);
 a.run('persist();');
 assert.equal(a.storage.get(archiveKey),archive);
 assert.deepEqual(JSON.parse(a.storage.get(workingKey)).operations,[]);
 assert.ok(!a.writes.includes(archiveKey));
});

test('Periods are derived from entered data and newly selected months do not select all periods',()=>{
 const state=enteredState([operation('january','income',100,'2027-01-04'),operation('february','expense',30,'2027-02-06')]);
 const a=workspace({[workingKey]:JSON.stringify(state)});
 a.run('dateInPeriod("2027-01-04");');
 assert.equal(a.run('period'),'2027-01');
 let options=a.run('periodSelect()');
 assert.match(options,/value="2027-01"/);
 assert.match(options,/value="2027-02"/);
 const months=[...options.matchAll(/value="(\d{4}-\d{2})"/g)].map(m=>m[1]);
 const expected=[...new Set(['2027-01','2027-02',a.run('today().slice(0,7)')])].sort();
 assert.deepEqual(months.sort(),expected);
 assert.deepEqual(JSON.parse(a.run('JSON.stringify(overallFinance())')),{income:100,expense:0});
 a.run('dateInPeriod("2027-02-06");');
 assert.equal(a.run('period'),'2027-02');
 assert.deepEqual(JSON.parse(a.run('JSON.stringify(overallFinance())')),{income:0,expense:30});
});

test('Empty exports contain no fabricated rows and empty forms open safely',()=>{
 const a=workspace();
 a.run('role="director";period="all";globalThis.downloads=[];download=(name,content,type)=>downloads.push({name,content,type});');
 for(const type of ['finance','fleet','timesheets','waybills']) {
  a.context.testType=type;
  assert.doesNotThrow(()=>a.run('exportData(testType);'),type);
 }
 const downloads=JSON.parse(a.run('JSON.stringify(downloads)'));
 for(const file of downloads) {
  const lines=file.content.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  assert.ok(lines.length<=1,file.name);
 }
 for(const source of ['operationModal()','shiftModal()','stockModal()','repairForm()','directorPurchaseForm()','requestModal()','openMachine("missing")']) {
  assert.doesNotThrow(()=>a.run(source),source);
  assert.doesNotMatch(a.elements.get('#modal-root')?.innerHTML||'',/NaN|Infinity/,source);
 }
 assert.equal(a.run('state.operations.length'),0);
 assert.equal(a.run('state.maintenance.length'),0);
 assert.equal(a.run('state.stockMoves.length'),0);
});

test('Unreadable working data cannot be overwritten by direct or workshop saves',()=>{
 for(const original of ['{"version":1,',JSON.stringify({version:1,operations:[]})]) {
  const archive=JSON.stringify(demoFixture.state);
  const a=workspace({[workingKey]:original,[archiveKey]:archive});
  assert.equal(a.run('storageLoadError'),true);
  assert.equal(a.run('persist()'),false);
  a.run('globalThis.beforeSave=structuredClone(state);state.operations.push({id:"must-not-save",kind:"expense",amount:1});');
  assert.equal(a.run('saveWorkshop(beforeSave)'),false);
  assert.equal(a.run('state.operations.length'),0);
  assert.equal(a.storage.get(workingKey),original);
  assert.equal(a.storage.get(archiveKey),archive);
  assert.deepEqual(a.writes,[]);
 }
});

test('Fresh empty catalogs do not imply available equipment and have no calendar sample rows',()=>{
 const a=workspace();a.run('role="director";period="all";syncMachineStatuses();');
 assert.equal(a.run('machines.some(m=>["free","work","reserved","repair"].includes(m.status))'),false);
 const operational=values(a.run('dashboardPage()'))[4];
 assert.match(operational,/—|[Нн]ет данных/);
 a.run('role="dispatcher";');
 const manager=a.run('managerOverview()');
 assert.match(manager,/Свободно техники<\/span><strong>Нет данных<\/strong>/);
 assert.doesNotMatch(manager,/Свободно техники<\/span><strong>10<\/strong>/);
 const calendar=a.run('requestsPage()');
 assert.doesNotMatch(calendar,/title="Свободно"/);
 assert.doesNotMatch(calendar,/Bobcat|JCB|Коммунарка|Башенный кран|Мини-погрузчик/);
 assert.equal(a.run('machines.length'),0);
});

test('A referenced sample card remains readable without manufactured prices, meters or specifications',()=>{
 const saved=structuredClone(savedCatalogs);saved.operatorMachine='M001';
 const a=workspace({[workingKey]:JSON.stringify(saved)});
 a.run('role="director";period="all";');
 assert.deepEqual(JSON.parse(a.run('JSON.stringify(machines.map(m=>m.id))')),['M001']);
 for(const machine of JSON.parse(a.run('JSON.stringify(machines)'))) {
  a.context.testMachine=machine.id;
  assert.doesNotThrow(()=>a.run('openMachinePassport(testMachine);'));
  const passport=a.elements.get('#modal-root').innerHTML;
  assert.match(passport,/Образец/);
  assert.ok(machine.operator.startsWith('Демо · '));
  assert.ok(passport.includes('<dt>Машинист</dt><dd>'+machine.operator+'</dd>'));
  assert.match(passport,/Последний счётчик<\/dt><dd>Не указано/);
  assert.doesNotMatch(passport,/ДЕМО-\d|DEMO-M|Грузоподъёмность|На ремонте|Отработала сегодня|>Свободна</);
  assert.doesNotMatch(passport,/NaN|Infinity/);
  assert.doesNotThrow(()=>a.run('openMachinePassport(testMachine,"finance");'));
  const finance=a.elements.get('#modal-root').innerHTML;
  assert.match(finance,/Стоимость приобретения<\/dt><dd>Не указано/);
  assert.match(finance,/Тариф аренды<\/dt><dd>Не указано/);
  assert.match(finance,/Подтверждённые часы за период<\/dt><dd>Нет данных/);
  assert.doesNotMatch(finance,/5[\s\u00a0]?600[\s\u00a0]?000|8[\s\u00a0]?400[\s\u00a0]?000|NaN|Infinity/);
 }
});

test('Untouched saved sample catalogs are removed only after their exact original is archived',()=>{
 const original=JSON.stringify(savedCatalogs,null,2);
 const a=workspace({[workingKey]:original});
 assert.equal(a.run('machines.length'),0);
 assert.equal(a.run('objects.length'),0);
 assert.equal(a.storage.get(catalogArchiveKey),original);
 assert.equal(a.run('catalogArchiveData'),original);
 assert.equal(a.writes[0],catalogArchiveKey);
 assert.equal(a.run('persist()'),true);
 assert.ok(a.writes.indexOf(catalogArchiveKey)<a.writes.indexOf(workingKey));
 const cleaned=JSON.parse(a.storage.get(workingKey));
 assert.deepEqual(cleaned.machines,[]);
 assert.deepEqual(cleaned.objects,[]);
 const reloaded=workspace(Object.fromEntries(a.storage));
 assert.equal(reloaded.run('machines.length'),0);
 assert.equal(reloaded.run('objects.length'),0);
 assert.equal(reloaded.storage.get(catalogArchiveKey),original);
});

test('Catalog cleanup preserves referenced machines, their object and recorded expenses',()=>{
 const saved=structuredClone(savedCatalogs);
 saved.operations=[operation('recorded-cost','expense',12500)];
 const original=JSON.stringify(saved);
 const a=workspace({[workingKey]:original});
 assert.deepEqual(JSON.parse(a.run('JSON.stringify(machines.map(m=>m.id))')),['M001']);
 assert.deepEqual(JSON.parse(a.run('JSON.stringify(objects.map(o=>o.id))')),['o1']);
 assert.deepEqual(JSON.parse(a.run('JSON.stringify(state.operations)')),saved.operations);
 a.run('period="all";');
 assert.deepEqual(JSON.parse(a.run('JSON.stringify(overallFinance())')),{income:0,expense:12500});
 assert.equal(a.storage.get(catalogArchiveKey),original);
});

test('Catalog cleanup preserves unflagged and edited records including valid zero readings',()=>{
 const saved=structuredClone(savedCatalogs);
 saved.machines[0].name='Погрузчик из пользовательского справочника';
 saved.machines[1].meter=0;
 saved.machines[2].registration='USER-001';
 saved.machines[3].demo=false;
 delete saved.machines[4].demo;
 saved.objects[2].name='Объект из пользовательского справочника';
 const a=workspace({[workingKey]:JSON.stringify(saved)});
 const machines=JSON.parse(a.run('JSON.stringify(machines)'));
 assert.deepEqual(machines.map(m=>m.id),['M001','M002','M003','M004','M005']);
 assert.equal(machines[0].name,saved.machines[0].name);
 assert.equal(machines[1].meter,0);
 assert.equal(machines[2].registration,'USER-001');
 assert.equal(machines[3].demo,false);
 assert.equal(machines[4].demo,undefined);
 assert.equal(a.run('obj("o3").name'),saved.objects[2].name);
 assert.deepEqual(JSON.parse(a.run('JSON.stringify(objects.map(o=>o.id))')),['o1','o2','o3']);
});

test('An archive write failure prevents catalog cleanup and leaves the original bytes intact',()=>{
 const original=JSON.stringify(savedCatalogs);
 const a=workspace({[workingKey]:original},{failWrite:key=>key===catalogArchiveKey});
 assert.equal(a.run('machines.length'),10);
 assert.equal(a.run('objects.length'),3);
 assert.equal(a.storage.get(workingKey),original);
 assert.equal(a.storage.has(catalogArchiveKey),false);
 assert.deepEqual(a.writes,[]);
});

test('A working-data write failure preserves catalog records and their recovery archive',()=>{
 const original=JSON.stringify(savedCatalogs);
 const a=workspace({[workingKey]:original},{failWrite:key=>key===workingKey});
 assert.equal(a.run('machines.length'),10);
 assert.equal(a.run('objects.length'),3);
 assert.equal(a.storage.get(workingKey),original);
 assert.equal(a.storage.get(catalogArchiveKey),original);
 assert.equal(a.writes[0],catalogArchiveKey);
});

test('The first catalog archive is immutable while later recorded business entries remain active',()=>{
 const firstArchive=JSON.stringify(savedCatalogs,null,2),next=structuredClone(savedCatalogs);
 next.operations=[operation('later-cost','expense',350)];
 const a=workspace({[workingKey]:JSON.stringify(next),[catalogArchiveKey]:firstArchive});
 assert.equal(a.storage.get(catalogArchiveKey),firstArchive);
 assert.equal(a.run('catalogArchiveData'),firstArchive);
 assert.ok(!a.writeAttempts.some(attempt=>attempt.key===catalogArchiveKey));
 assert.deepEqual(JSON.parse(a.run('JSON.stringify(state.operations)')),next.operations);
 assert.deepEqual(JSON.parse(a.run('JSON.stringify(machines.map(m=>m.id))')),['M001']);
 assert.deepEqual(JSON.parse(a.storage.get(workingKey)).operations,next.operations);
});

test('Catalog cleanup is pure and preserves the original object when nothing can be removed',()=>{
 const a=workspace();
 a.context.cleanupInput=structuredClone(savedCatalogs);
 const before=JSON.stringify(a.context.cleanupInput);
 assert.equal(a.run('cleanupCatalogSamples(cleanupInput)===cleanupInput'),false);
 assert.equal(JSON.stringify(a.context.cleanupInput),before);
 a.context.cleanupInput=enteredState([operation('actual','expense',50)]);
 const entered=JSON.stringify(a.context.cleanupInput);
 assert.equal(a.run('cleanupCatalogSamples(cleanupInput)===cleanupInput'),true);
 assert.equal(JSON.stringify(a.context.cleanupInput),entered);
});

test('Catalog cleanup protects generic business references in values and object keys',()=>{
 const references=[
  ['operatorMachine','M001'],
  ['sourceDocument',{machine:'Bobcat S650'}],
  ['machinePhotos',{M001:[]}],
  ['recordAudit',[{before:{machine:'M001'}}]],
  ['stockMoves',[{id:'movement',machine:'M001',part:'user-part',qty:1,kind:'issue'}]],
  ['equipmentRequests',[{id:'request',status:'Согласована',items:[{machine:'M001',start:'2026-11-01',end:'2026-11-30'}]}]],
  ['purchaseRequests',[{id:'purchase',machine:'M001'}]]
 ];
 for(const [field,value] of references) {
  const saved=structuredClone(savedCatalogs);saved[field]=value;
  const a=workspace({[workingKey]:JSON.stringify(saved)});
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(machines.map(m=>m.id))')),['M001'],field);
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(objects.map(o=>o.id))')),['o1'],field);
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(state['+JSON.stringify(field)+'])')),value,field);
 }
 const saved=structuredClone(savedCatalogs);saved.sourceDocument={object:'ЖК Хорошёвский'};
 const a=workspace({[workingKey]:JSON.stringify(saved)});
 assert.equal(a.run('machines.length'),0);
 assert.deepEqual(JSON.parse(a.run('JSON.stringify(objects.map(o=>o.id))')),['o2']);
});
