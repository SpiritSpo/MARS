const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function upload(entity,records){
 const headers=[...new Set(records.flatMap(row=>Object.keys(row)))];
 return {entity,fileName:'test-'+entity+'.xlsx',sheetName:'Тест '+entity,rows:[headers,...records.map(row=>headers.map(key=>row[key]??''))],mapping:Object.fromEntries(headers.map((key,i)=>[key,i]))};
}
function packageFiles(){
 return [
  upload('expenses',[{documentId:'TEST-EXP',sourceLine:'1',date:'2027-01-05',machineId:'TEST-M',objectId:'TEST-O',category:'Топливо',amount:'1500,50'}]),
  upload('payroll',[{documentId:'TEST-PAY',sourceLine:'1',period:'2027-01',employeeId:'TEST-E',machineId:'TEST-M',objectId:'TEST-O',amount:25000}]),
  upload('timesheets',[{documentId:'TEST-TIME',sourceLine:'1',date:'2027-01-05',employeeId:'TEST-E',machineId:'TEST-M',objectId:'TEST-O',hours:8}]),
  upload('waybills',[{documentId:'TEST-WAY',sourceLine:'1',date:'2027-01-05',employeeId:'TEST-E',machineId:'TEST-M',objectId:'TEST-O',hours:8,meterStart:100,meterEnd:108}]),
  upload('machines',[{id:'TEST-M',name:'Тестовая машина',type:'Тестовый тип',objectId:'TEST-O',employeeId:'TEST-E'}]),
  upload('employees',[{id:'TEST-E',name:'Тестовый сотрудник'}]),
  upload('objects',[{id:'TEST-O',name:'Тестовый объект'}])
 ];
}
function fixture(options={}){
 const storageKey='mars-working-data-v1';
 const empty={version:1,machines:[],objects:[],operations:[],shifts:[],maintenance:[],stock:[],stockMoves:[],machinePhotos:{},testMarker:'Существующие данные'};
 const values=new Map([[storageKey,options.raw??JSON.stringify(empty)]]),writes=[];
 let failWrites=false;
 const node=()=>({innerHTML:'',textContent:'',style:{},value:'',dataset:{},classList:{add(){},remove(){}},querySelectorAll(){return [];},addEventListener(){}});
 const elements=new Map();
 const ctx=vm.createContext({console,structuredClone,Intl,Date,Math,TextDecoder,Uint8Array,
  setTimeout(){return 0;},clearTimeout(){},
  document:{querySelector(selector){if(!elements.has(selector))elements.set(selector,node());return elements.get(selector);},querySelectorAll(){return [];},addEventListener(){},body:{style:{}},activeElement:{tagName:'BODY'}},
  localStorage:{getItem(key){return values.get(key)??null;},setItem(key,value){writes.push({key,value});if(failWrites)throw Error('TEST quota exceeded');values.set(key,value);}}
 });
 const run=code=>vm.runInContext(code,ctx),dist=path.join(__dirname,'..','dist');
 for(const name of ['workshop.js','import-engine.js','accountant.js','import-ui.js'])run(fs.readFileSync(path.join(dist,name),'utf8'));
 run(fs.readFileSync(path.join(dist,'app.js'),'utf8').replace(/\nrender\(\);\s*$/,''));
 run('render=()=>{};toast=()=>{};view="data";role="director";');
 const snapshot=()=>JSON.parse(run('JSON.stringify(state)'));
 const queue=(files=packageFiles())=>{ctx.testFiles=files;run('dataImportDraft.uploads=structuredClone(testFiles);');delete ctx.testFiles;};
 return {ctx,run,values,writes,storageKey,snapshot,queue,failStorage(){failWrites=true;}};
}

test('Import preview is read only and one confirmation saves the complete linked package in one write',()=>{
 const app=fixture(),before=app.snapshot(),raw=app.values.get(app.storageKey);app.queue();
 app.run('validateDataImport()');
 assert.equal(app.run('dataImportDraft.plan.valid'),true,app.run('JSON.stringify(dataImportDraft.plan.errors)'));
 assert.deepEqual(app.snapshot(),before);
 assert.equal(app.values.get(app.storageKey),raw);
 assert.equal(app.writes.length,0);
 assert.equal(app.run('commitDataImport()'),true);
 const saved=app.snapshot();
 assert.equal(saved.testMarker,before.testMarker);
 assert.equal(saved.machines.length,1);
 assert.equal(saved.machines[0].object,'TEST-O');
 assert.equal(saved.machines[0].operatorId,'TEST-E');
 assert.equal(saved.operations.length,1);
 assert.equal(saved.operations[0].machine,'TEST-M');
 assert.equal(saved.operations[0].amount,1500.50);
 assert.equal(saved.payroll.length,1);
 assert.equal(saved.importedTimesheets.length,1);
 assert.equal(saved.importedWaybills.length,1);
 assert.deepEqual(saved.shifts,[]);
 assert.deepEqual(saved.stock,[]);
 assert.deepEqual(saved.stockMoves,[]);
 assert.equal(saved.importHistory.length,1);
 assert.deepEqual(JSON.parse(app.values.get(app.storageKey)),saved);
 assert.equal(app.writes.length,1);
 assert.equal(app.run('dataImportDraft.uploads.length'),0);
 assert.equal(app.run('dataImportDraft.plan'),null);
});

test('A package with one unknown link cannot save its valid catalogs or financial rows',()=>{
 const app=fixture(),files=packageFiles(),before=app.snapshot();
 files[0].rows[1][files[0].mapping.machineId]='UNKNOWN';app.queue(files);
 app.run('validateDataImport()');
 assert.equal(app.run('dataImportDraft.plan.valid'),false);
 assert.equal(app.run('commitDataImport()'),false);
 assert.deepEqual(app.snapshot(),before);
 assert.equal(app.writes.length,0);
});

test('Confirming a known historical source object preserves both its link and the current machine assignment',()=>{
 const app=fixture(),files=packageFiles();
 files[0].rows[1][files[0].mapping.objectId]='TEST-HISTORICAL-O';
 files.push(upload('objects',[{id:'TEST-HISTORICAL-O',name:'Исторический тестовый объект'}]));
 app.queue(files);app.run('validateDataImport()');
 assert.equal(app.run('dataImportDraft.plan.valid'),true);
 assert.equal(app.run('dataImportDraft.plan.warnings.some(issue=>issue.field==="objectId")'),true);
 assert.equal(app.run('commitDataImport()'),true);
 assert.equal(app.snapshot().operations[0].object,'TEST-HISTORICAL-O');
 assert.equal(app.snapshot().machines[0].object,'TEST-O');
 assert.equal(app.run('dataRegisterValue(state.operations[0],"object")'),'Исторический тестовый объект');
 assert.deepEqual(JSON.parse(app.values.get(app.storageKey)),app.snapshot());
});

test('Browser storage failure restores the complete previous memory state and leaves saved data intact',()=>{
 const app=fixture(),before=app.snapshot(),raw=app.values.get(app.storageKey);app.queue();app.run('validateDataImport()');app.failStorage();
 assert.equal(app.run('commitDataImport()'),false);
 assert.deepEqual(app.snapshot(),before);
 assert.equal(app.values.get(app.storageKey),raw);
 assert.equal(app.writes.length,1);
 assert.equal(app.run('dataImportDraft.plan'),null);
 assert.equal(app.run('dataImportDraft.uploads.length'),7,'Files remain available for another preview');
 assert.match(app.run('dataImportDraft.error'),/Не удалось сохранить/);
});

test('Unexpected failure before persistence also restores the previous state',()=>{
 const app=fixture(),before=app.snapshot(),raw=app.values.get(app.storageKey);app.queue();app.run('validateDataImport()');
 app.run('syncMachineStatuses=()=>{throw Error("TEST processing failure");};');
 assert.equal(app.run('commitDataImport()'),false);
 assert.deepEqual(app.snapshot(),before);
 assert.equal(app.values.get(app.storageKey),raw);
 assert.equal(app.writes.length,0);
});

test('A rendering error after persistence cannot report a failed import or undo the saved package',()=>{
 const app=fixture();app.queue();app.run('validateDataImport()');
 app.run('redrawDataImport=()=>{throw Error("TEST rendering failure");};');
 let committed;assert.doesNotThrow(()=>{committed=app.run('commitDataImport()');});
 assert.equal(committed,true);
 assert.equal(app.snapshot().operations.length,1);
 assert.deepEqual(JSON.parse(app.values.get(app.storageKey)),app.snapshot());
 assert.equal(app.writes.length,1);
 assert.equal(app.run('dataImportDraft.uploads.length'),0);
});

test('Edits made after preview in the same tab block a stale package and preserve those edits',()=>{
 const app=fixture();app.queue();app.run('validateDataImport();state.testMarker="Изменено после проверки";');
 const updated=app.snapshot(),raw=app.values.get(app.storageKey);
 assert.equal(app.run('commitDataImport()'),false);
 assert.deepEqual(app.snapshot(),updated);
 assert.equal(app.values.get(app.storageKey),raw);
 assert.equal(app.writes.length,0);
 assert.equal(app.run('dataImportDraft.plan'),null);
 assert.match(app.run('dataImportDraft.error'),/Данные изменились/);
});

test('Another tab changing localStorage after preview cannot be overwritten by a stale package',()=>{
 const app=fixture(),before=app.snapshot();app.queue();app.run('validateDataImport()');
 const fromAnotherTab={...JSON.parse(app.values.get(app.storageKey)),testMarker:'Изменено другой вкладкой'};
 const raw=JSON.stringify(fromAnotherTab);app.values.set(app.storageKey,raw);
 assert.equal(app.run('commitDataImport()'),false);
 assert.deepEqual(app.snapshot(),before);
 assert.equal(app.values.get(app.storageKey),raw);
 assert.equal(app.writes.length,0);
 assert.equal(app.run('dataImportDraft.plan'),null);
});

test('Changes from another tab before the first preview cannot be accepted as the baseline of stale memory',()=>{
 const app=fixture(),before=app.snapshot();app.queue();
 const external={...JSON.parse(app.values.get(app.storageKey)),testMarker:'Данные другой вкладки до проверки',operations:[{id:'TEST-EXTERNAL',date:'2027-01-01',kind:'expense',allocation:'overhead',machine:'',amount:4321,category:'Тест'}]};
 const raw=JSON.stringify(external);app.values.set(app.storageKey,raw);
 app.run('validateDataImport()');
 assert.equal(app.run('dataImportDraft.plan'),null,'A new preview requires reloading external saved data first');
 assert.equal(app.run('commitDataImport()'),false);
 assert.deepEqual(app.snapshot(),before);
 assert.equal(app.values.get(app.storageKey),raw,'The exact external data must survive, including its financial row');
 assert.equal(app.writes.length,0);
 assert.match(app.run('dataImportDraft.error'),/другой вкладке/);
});

test('Repeating validation after a stale-preview refusal cannot overwrite data from another tab',()=>{
 const app=fixture(),before=app.snapshot();app.queue();app.run('validateDataImport()');
 const external={...JSON.parse(app.values.get(app.storageKey)),testMarker:'Данные другой вкладки после проверки',objects:[{id:'TEST-EXTERNAL-O',name:'Тестовый объект другой вкладки'}]};
 const raw=JSON.stringify(external);app.values.set(app.storageKey,raw);
 assert.equal(app.run('commitDataImport()'),false);
 app.run('validateDataImport()');
 assert.equal(app.run('dataImportDraft.plan'),null,'Retrying must not treat stale memory as the newly saved dataset');
 assert.equal(app.run('commitDataImport()'),false);
 assert.deepEqual(app.snapshot(),before);
 assert.equal(app.values.get(app.storageKey),raw);
 assert.equal(app.writes.length,0);
});

test('Successful local saves advance the saved-data baseline and permit a subsequent import',async t=>{
 for(const writer of ['persist','saveWorkshop'])await t.test(writer,()=>{
  const app=fixture();
  app.run('globalThis.testPreviousState=structuredClone(state);state.testMarker="Сохранено этой вкладкой";');
  assert.equal(app.run(writer==='persist'?'persist()':'saveWorkshop(testPreviousState)'),true);
  const ownRaw=app.values.get(app.storageKey);
  assert.equal(app.run('storedWorkingData'),ownRaw);
  app.queue();app.run('validateDataImport()');
  assert.equal(app.run('dataImportDraft.plan.valid'),true,app.run('dataImportDraft.error'));
  assert.equal(app.run('commitDataImport()'),true);
  assert.equal(app.snapshot().testMarker,'Сохранено этой вкладкой');
  assert.equal(app.run('storedWorkingData'),app.values.get(app.storageKey),'The import itself advances the baseline too');
  app.queue([upload('objects',[{id:'TEST-SECOND-O',name:'Второй тестовый объект'}])]);app.run('validateDataImport()');
  assert.equal(app.run('dataImportDraft.plan.valid'),true,app.run('dataImportDraft.error'));
  assert.equal(app.run('commitDataImport()'),true);
  assert.equal(app.snapshot().objects.length,2);
  assert.deepEqual(JSON.parse(app.values.get(app.storageKey)),app.snapshot());
  assert.equal(app.writes.length,3);
 });
});

test('Commit rechecks the queued package rather than trusting an old valid preview',()=>{
 const app=fixture(),before=app.snapshot();app.queue();app.run('validateDataImport()');
 app.run('dataImportDraft.uploads[0].rows[1][dataImportDraft.uploads[0].mapping.machineId]="UNKNOWN";');
 assert.equal(app.run('commitDataImport()'),false);
 assert.equal(app.run('dataImportDraft.plan.valid'),false);
 assert.deepEqual(app.snapshot(),before);
 assert.equal(app.writes.length,0);
});

test('Read-only role modes cannot validate or commit a package even if preview existed earlier',()=>{
 for(const role of ['operator','mechanic','dispatcher']){
  const app=fixture(),before=app.snapshot();app.queue();app.run('validateDataImport()');
  app.ctx.testRole=role;app.run('role=testRole;');
  assert.equal(app.run('commitDataImport()'),false,role);
  app.run('clearDataImportPlan();validateDataImport();');
  assert.equal(app.run('dataImportDraft.plan'),null,role);
  assert.deepEqual(app.snapshot(),before);
  assert.equal(app.writes.length,0);
 }
});

test('Accountant mode can import source data without producing approved shifts',()=>{
 const app=fixture();app.queue();app.run('role="accountant";validateDataImport();');
 assert.equal(app.run('dataImportDraft.plan.valid'),true);
 assert.equal(app.run('commitDataImport()'),true);
 assert.deepEqual(app.snapshot().shifts,[]);
 assert.equal(app.snapshot().operations.length,1);
});

test('A newly imported machine remains unknown until an actual shift, reservation or repair proves a status',()=>{
 const app=fixture(),files=packageFiles(),day=app.run('today()');
 for(const file of files.filter(item=>['timesheets','waybills'].includes(item.entity)))file.rows[1][file.mapping.date]=day;
 app.queue(files);app.run('validateDataImport();commitDataImport();');
 assert.equal(app.run('machine("TEST-M").status'),'unknown','Source hours, including today, do not establish that a machine is free or worked');
 app.ctx.testDay=day;
 app.run('state.shifts.push({id:"TEST-SHIFT",machine:"TEST-M",date:testDay,hours:8,status:"approved"});syncMachineStatuses();');
 assert.equal(app.run('machine("TEST-M").status'),'work');
 app.run('state.maintenance.push({id:"TEST-REPAIR",machine:"TEST-M",blocking:true,readyConfirmed:false});syncMachineStatuses();');
 assert.equal(app.run('machine("TEST-M").status'),'repair');
 app.run('state.shifts=[];state.maintenance=[];state.equipmentRequests=[{id:"TEST-REQUEST",status:"Запланирована",items:[{machine:"TEST-M",start:testDay,end:testDay}]}];syncMachineStatuses();');
 assert.equal(app.run('machine("TEST-M").status'),'reserved');
 app.run('state.equipmentRequests=[];syncMachineStatuses();');
 assert.equal(app.run('machine("TEST-M").status'),'unknown');
});

test('Unreadable saved storage is preserved and cannot be overwritten by an import',()=>{
 const raw='TEST broken JSON',app=fixture({raw}),before=app.snapshot();app.queue();app.run('validateDataImport()');
 assert.equal(app.run('storageLoadError'),true);
 assert.equal(app.run('dataImportDraft.plan'),null,'An unreadable baseline cannot produce an import preview');
 assert.equal(app.run('commitDataImport()'),false);
 assert.deepEqual(app.snapshot(),before);
 assert.equal(app.values.get(app.storageKey),raw);
 assert.equal(app.writes.length,0);
});

test('Selected header rows preserve original file row numbers through package building',()=>{
 const app=fixture();
 app.ctx.testLoaded={fileName:'test-report.csv',sheets:{'Тестовый лист':[['Служебный заголовок'],[],['Код объекта','Название объекта'],['TEST-O','Тестовый объект']]}};
 app.run('dataImportDraft.entity="objects";dataImportDraft.loaded=testLoaded;dataImportDraft.sheet="Тестовый лист";dataImportDraft.header=2;mapCurrentImport();dataImportAction("add");validateDataImport();');
 assert.equal(app.run('dataImportDraft.plan.valid'),true,app.run('JSON.stringify(dataImportDraft.plan.errors)'));
 assert.equal(app.run('dataImportDraft.plan.nextState.objects[0].importSource.row'),4);
 assert.equal(app.run('dataImportDraft.plan.nextState.objects[0].importSource.file'),'test-report.csv');
 assert.equal(app.writes.length,0);
});

function queueFormattedExcel(app,rawAmount,formattedAmount){
 // Excel may store ID 7 with display format 0000; the ID in the agreed
 // directory is 0007, while a separate machine genuinely has internal ID 7.
 app.queue([upload('machines',[{id:'7',name:'Тестовая машина 7',type:'Тестовый тип'}])]);
 app.ctx.testMachineExcel={fileName:'test-codes.xlsx',sheets:{'Техника':[['Код техники','Название техники','Вид техники'],['0007','Тестовая машина 0007','Тестовый тип']]},numericSheets:{'Техника':[[null,null,null],[7,null,null]]}};
 app.run('dataImportDraft.entity="machines";dataImportDraft.loaded=testMachineExcel;dataImportDraft.sheet="Техника";dataImportDraft.header=0;mapCurrentImport();dataImportAction("add");');
 app.ctx.testExpenseExcel={fileName:'test-expenses-formatted.xlsx',sheets:{'Расходы':[
  ['Тестовая выгрузка'],['Документ','Строка документа','Дата','Код техники','Статья','Сумма'],
  ['0007','0003','05.01.2027','0007','Топливо',formattedAmount]
 ]},numericSheets:{'Расходы':[[null],[null,null,null,null,null,null],[7,3,null,7,null,rawAmount]]}};
 app.run('dataImportDraft.entity="expenses";dataImportDraft.loaded=testExpenseExcel;dataImportDraft.sheet="Расходы";dataImportDraft.header=1;mapCurrentImport();dataImportAction("add");validateDataImport();');
}

test('Excel keeps formatted identifiers while hidden fractions of a kopeck block the entire package',()=>{
 const app=fixture(),before=app.snapshot();queueFormattedExcel(app,1234.567,'1 234,57 ₽');
 assert.equal(app.run('dataImportDraft.uploads[1].rows[1][0]'),'0007');
 assert.equal(app.run('dataImportDraft.uploads[2].rows[1][0]'),'0007');
 assert.equal(app.run('dataImportDraft.uploads[2].rows[1][1]'),'0003');
 assert.equal(app.run('dataImportDraft.uploads[2].rows[1][3]'),'0007');
 assert.equal(app.run('dataImportDraft.uploads[2].rows[1][5]'),1234.567);
 assert.equal(app.run('dataImportDraft.plan.valid'),false);
 assert.equal(app.run('dataImportDraft.plan.errors.some(issue=>issue.field==="amount"&&issue.row===3)'),true);
 assert.equal(app.run('commitDataImport()'),false);
 assert.deepEqual(app.snapshot(),before);
 assert.equal(app.writes.length,0);
 assert.equal(app.ctx.testExpenseExcel.sheets['Расходы'][2][5],'1 234,57 ₽','Source display cells remain unmodified');
});

test('Excel numeric precision is accepted only for quantities and cannot redirect a zero-padded machine ID',()=>{
 const app=fixture();queueFormattedExcel(app,1234.56,'1 234,56 ₽');
 assert.equal(app.run('dataImportDraft.plan.valid'),true,app.run('JSON.stringify(dataImportDraft.plan.errors)'));
 assert.equal(app.run('commitDataImport()'),true);
 const saved=app.snapshot();
 assert.deepEqual(saved.machines.map(machine=>machine.id),['7','0007']);
 assert.equal(saved.operations[0].machine,'0007');
 assert.equal(saved.operations[0].documentId,'0007');
 assert.equal(saved.operations[0].sourceLine,'0003');
 assert.equal(saved.operations[0].amount,1234.56);
 assert.equal(saved.operations[0].date,'2027-01-05');
 assert.deepEqual(JSON.parse(app.values.get(app.storageKey)),saved);
});

test('An older asynchronous file read cannot replace a more recently selected file',async()=>{
 const app=fixture(),csv='Код объекта;Название объекта\nTEST-O;Тестовый объект';
 const bytes=new TextEncoder().encode(csv).buffer;
 let release;
 app.ctx.slowFile={name:'test-slow.csv',size:bytes.byteLength,arrayBuffer:()=>new Promise(resolve=>{release=resolve;})};
 const slow=app.run('readDataImportFile(slowFile,"utf-8")');
 app.ctx.fastFile={name:'test-fast.csv',size:bytes.byteLength,arrayBuffer:async()=>bytes};
 await app.run('readDataImportFile(fastFile,"utf-8")');
 release(bytes);await slow;
 assert.equal(app.run('dataImportDraft.loaded.fileName'),'test-fast.csv');
 assert.equal(app.run('dataImportDraft.busy'),false);
 assert.equal(app.writes.length,0);
});

test('A malformed newly selected CSV preserves previously queued sheets and saved records',async()=>{
 const app=fixture(),before=app.snapshot();app.queue();
 app.ctx.invalidFile={name:'test-invalid.csv',size:1,arrayBuffer:async()=>Uint8Array.from([255]).buffer};
 await app.run('readDataImportFile(invalidFile,"utf-8")');
 assert.equal(app.run('dataImportDraft.loaded'),null);
 assert.equal(app.run('dataImportDraft.uploads.length'),7);
 assert.match(app.run('dataImportDraft.error'),/кодировке/);
 assert.deepEqual(app.snapshot(),before);
 assert.equal(app.writes.length,0);
});

test('Source and register tables escape file contents while preserving original saved text',()=>{
 const app=fixture(),files=packageFiles(),unsafe='<img src=x onerror=alert(1)>';
 files.at(-1).rows[1][files.at(-1).mapping.name]=unsafe;
 app.queue(files);app.run('validateDataImport();commitDataImport();');
 const html=app.run('dataRegisterHtml("objects")');
 assert.doesNotMatch(html,/<img src=x/);
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.equal(app.snapshot().objects[0].name,unsafe);
});
