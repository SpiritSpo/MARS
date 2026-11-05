const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const imports=require('../dist/import-engine.js');

// Synthetic records identify test data explicitly; no company records are used.
const object={id:'TEST-O1',name:'Тестовый объект 1'};
const employee={id:'TEST-E1',name:'Тестовый сотрудник 1',position:'Машинист'};
const machine={id:'TEST-M1',name:'Тестовая машина 1',type:'Тестовый тип',objectId:object.id,employeeId:employee.id,plate:'TEST-001',serial:'TEST-SERIAL-001',year:2020,meter:100};
const expense={documentId:'TEST-EXP-1',sourceLine:'1',date:'2027-01-05',machineId:machine.id,objectId:object.id,category:'Топливо',amount:'1200,50',note:'Тестовый расход'};
const payroll={documentId:'TEST-PAY-1',sourceLine:'1',period:'2027-01',employeeId:employee.id,machineId:machine.id,objectId:object.id,amount:'25000,00'};
const timesheet={documentId:'TEST-TIME-1',sourceLine:'1',date:'2027-01-05',employeeId:employee.id,machineId:machine.id,objectId:object.id,hours:'8'};
const waybill={documentId:'TEST-WAY-1',sourceLine:'1',date:'2027-01-05',employeeId:employee.id,machineId:machine.id,objectId:object.id,hours:'8',meterStart:'100',meterEnd:'108'};

function baseState(){
 return {version:1,machines:[],objects:[],employees:[],operations:[],shifts:[],maintenance:[],stock:[],stockMoves:[],machinePhotos:{}};
}
function upload(entity,records,extra={}){
 const headers=[...new Set(records.flatMap(row=>Object.keys(row)))];
 return {entity,fileName:'test-'+entity+'.xlsx',sheetName:'Тест '+entity,rows:[headers,...records.map(row=>headers.map(key=>row[key]??''))],mapping:Object.fromEntries(headers.map((key,index)=>[key,index])),...extra};
}
function catalogs(){return [upload('machines',[machine]),upload('employees',[employee]),upload('objects',[object])];}
function preparedState(){
 const result=imports.validatePackage(baseState(),catalogs());
 assert.equal(result.valid,true,JSON.stringify(result.errors));
 return result.nextState;
}
function validate(entity,records,extra={}){return imports.validatePackage(preparedState(),[upload(entity,records,extra)]);}
function reject(result,field){
 assert.equal(result.valid,false,'Invalid data must block the complete package');
 assert.equal(result.nextState,null,'No partial candidate may be committed');
 assert.ok(result.errors.length>0,'Rejection must explain the problem');
 if(field)assert.ok(result.errors.some(error=>error.field===field),JSON.stringify(result.errors));
}
function frozen(value){
 if(value&&typeof value==='object'){for(const item of Object.values(value))frozen(item);Object.freeze(value);}
 return value;
}

test('A complete package resolves objects, machines and employees regardless of sheet order',()=>{
 const result=imports.validatePackage(baseState(),[
  upload('expenses',[expense]),upload('payroll',[payroll]),upload('timesheets',[timesheet]),upload('waybills',[waybill]),...catalogs()
 ]);
 assert.equal(result.valid,true,JSON.stringify(result.errors));
 const saved=result.nextState;
 assert.equal(saved.machines.length,1);
 assert.equal(saved.objects.length,1);
 assert.equal(saved.employees.length,1);
 assert.equal(saved.machines[0].object,object.id);
 assert.equal(saved.machines[0].operatorId,employee.id);
 assert.equal(saved.operations.length,1);
 assert.equal(saved.operations[0].machine,machine.id);
 assert.equal(saved.operations[0].amount,1200.50);
 assert.equal(saved.operations[0].kind,'expense');
 assert.equal(saved.operations[0].allocation,'machine');
 assert.equal(saved.payroll.length,1);
 assert.equal(saved.importedTimesheets.length,1);
 assert.equal(saved.importedWaybills.length,1);
 for(const row of [saved.payroll[0],saved.importedTimesheets[0],saved.importedWaybills[0]]){
  assert.equal(row.machine,machine.id);
  assert.equal(row.employee,employee.id);
  assert.equal(row.object,object.id);
 }
 assert.equal(saved.shifts.length,0,'Source documents cannot approve shifts');
 assert.equal(saved.stock.length,0,'A monetary warehouse entry cannot fabricate inventory');
 assert.equal(saved.stockMoves.length,0);
});

test('Preview never mutates saved records or files, including when validation fails',()=>{
 const base=preparedState();
 base.operations.push({id:'existing',date:'2026-12-01',kind:'income',amount:5000,machine:machine.id,category:'Тест'});
 base.userNotes={text:'Сохранить',nested:['test']};
 const files=[upload('expenses',[expense])],before=structuredClone(base),filesBefore=structuredClone(files);
 frozen(base);frozen(files);
 const valid=imports.validatePackage(base,files);
 assert.equal(valid.valid,true,JSON.stringify(valid.errors));
 assert.deepEqual(base,before);
 assert.deepEqual(files,filesBefore);
 assert.deepEqual(valid.nextState.operations[0],before.operations[0]);
 assert.deepEqual(valid.nextState.userNotes,before.userNotes);
 valid.nextState.operations.push({id:'candidate-only'});
 assert.deepEqual(base,before,'The editable candidate cannot share the saved operation array');
 reject(imports.validatePackage(base,[upload('expenses',[expense,{...expense,sourceLine:'2',machineId:'UNKNOWN'}])]));
 assert.deepEqual(base,before);
});

test('Every imported source row retains document, original file, sheet and row provenance',()=>{
 const result=validate('expenses',[expense],{fileName:'test-source.xlsx',sheetName:'Тестовые расходы',headerRow:3});
 assert.equal(result.valid,true,JSON.stringify(result.errors));
 const source=result.nextState.operations[0].importSource;
 assert.equal(source.entity,'expenses');
 assert.equal(source.file,'test-source.xlsx');
 assert.equal(source.sheet,'Тестовые расходы');
 assert.equal(source.row,5);
 assert.equal(source.documentId,expense.documentId);
 assert.equal(String(source.line),expense.sourceLine);
 assert.ok(source.sourceKey);
});

test('Unknown machines, objects and employees block the whole package with a precise location',async t=>{
 for(const [entity,row,field] of [
  ['expenses',{...expense,machineId:'UNKNOWN'},'machineId'],
  ['expenses',{...expense,objectId:'UNKNOWN'},'objectId'],
  ['payroll',{...payroll,employeeId:'UNKNOWN'},'employeeId'],
  ['timesheets',{...timesheet,machineId:'UNKNOWN'},'machineId'],
  ['timesheets',{...timesheet,employeeId:'UNKNOWN'},'employeeId'],
  ['waybills',{...waybill,objectId:'UNKNOWN'},'objectId'],
  ['machines',{...machine,id:'TEST-M2',objectId:'UNKNOWN'},'objectId'],
  ['machines',{...machine,id:'TEST-M2',employeeId:'UNKNOWN'},'employeeId']
 ])await t.test(entity+' '+field,()=>{
  const result=imports.validatePackage(preparedState(),[upload('expenses',[{...expense,documentId:'TEST-VALID'}]),upload(entity,[row],{sheetName:'Тест ошибки'})]);
  reject(result,field);
  assert.ok(result.errors.some(error=>error.sheet==='Тест ошибки'&&error.row===2&&error.field===field),JSON.stringify(result.errors));
 });
});

test('Historical documents retain their explicit known object with a warning when the current assignment differs',async t=>{
 const base=preparedState();
 base.objects.push({id:'TEST-O2',name:'Другой тестовый объект'});
 for(const [entity,row,target] of [
  ['expenses',expense,'operations'],['payroll',payroll,'payroll'],
  ['timesheets',timesheet,'importedTimesheets'],['waybills',waybill,'importedWaybills']
 ])await t.test(entity,()=>{
  const result=imports.validatePackage(base,[upload(entity,[{...row,objectId:'TEST-O2'}])]);
  assert.equal(result.valid,true,JSON.stringify(result.errors));
  assert.ok(result.warnings.some(issue=>issue.field==='objectId'&&issue.row===2));
  assert.equal(result.nextState[target][0].object,'TEST-O2');
  assert.equal(result.nextState[target][0].objectId,'TEST-O2');
  assert.equal(result.nextState.machines[0].object,object.id,'Historical imports cannot change today\'s machine assignment');
 });
});

test('Ambiguous objects and overhead or warehouse entries linked to an object remain blocking errors',()=>{
 const base=preparedState();
 base.objects.push({...base.objects[0],name:'Неоднозначный тестовый объект'});
 reject(imports.validatePackage(base,[upload('expenses',[expense])]),'objectId');
 for(const machineId of ['ОБЩЕХОЗ','СКЛАД'])reject(validate('expenses',[{...expense,machineId}]),'objectId');
});

test('A known historical driver different from current assignment is preserved with an explicit warning',()=>{
 const base=preparedState();
 base.employees.push({id:'TEST-E2',name:'Другой тестовый сотрудник'});
 for(const [entity,row,target] of [['payroll',payroll,'payroll'],['timesheets',timesheet,'importedTimesheets'],['waybills',waybill,'importedWaybills']]){
  const result=imports.validatePackage(base,[upload(entity,[{...row,employeeId:'TEST-E2'}])]);
  assert.equal(result.valid,true,JSON.stringify(result.errors));
  assert.ok(result.warnings.some(issue=>issue.field==='employeeId'&&issue.row===2));
  assert.equal(result.nextState[target][0].employeeId,'TEST-E2','The source driver must not be replaced with today\'s assignment');
  assert.equal(result.nextState.machines[0].operatorId,employee.id,'Importing a historical document cannot reassign the machine');
 }
});

test('Exact registration aliases resolve a machine while ambiguous aliases are never guessed',()=>{
 const base=preparedState();
 const result=imports.validatePackage(base,[upload('expenses',[{...expense,machineId:machine.plate}])]);
 assert.equal(result.valid,true,JSON.stringify(result.errors));
 assert.equal(result.nextState.operations[0].machine,machine.id);
 base.machines.push({...base.machines[0],id:'TEST-M2',name:'Вторая тестовая машина'});
 reject(imports.validatePackage(base,[upload('expenses',[{...expense,machineId:machine.plate}])]),'machineId');
 const exact=imports.validatePackage(base,[upload('expenses',[expense])]);
 assert.equal(exact.valid,true,'An explicit internal ID remains unambiguous');
 assert.equal(exact.nextState.operations[0].machine,machine.id);
});

test('Similar names and partial registration numbers cannot guess a machine ID',()=>{
 for(const reference of [machine.name,'TEST-M','TEST-00'])reject(validate('expenses',[{...expense,machineId:reference}]),'machineId');
});

test('Machine IDs and registration aliases cannot use reserved warehouse or overhead allocation codes',async t=>{
 for(const field of ['id','plate','serial','vin']){
  for(const value of [' склад ','оБщЕхОз'])await t.test(field+' '+value,()=>{
   const row={...machine,id:'TEST-M2',plate:'TEST-002',serial:'TEST-SERIAL-002',vin:'TEST-VIN-002',[field]:value};
   reject(validate('machines',[row]),field);
  });
 }
});

test('A preexisting machine or alias named like an allocation code cannot silently turn its expense into a warehouse purchase',()=>{
 for(const field of ['id','plate','serial','vin']){
  for(const value of ['СКЛАД','ОБЩЕХОЗ']){
   const base=preparedState();base.machines.push({...base.machines[0],id:'TEST-M2',plate:'TEST-002',serial:'TEST-SERIAL-002',vin:'TEST-VIN-002',[field]:value});
   const before=structuredClone(base);
   reject(imports.validatePackage(base,[upload('expenses',[{...expense,machineId:value,objectId:''}])]),'machineId');
   assert.deepEqual(base,before);
  }
 }
});

test('Catalog imports cannot silently overwrite existing IDs',async t=>{
 for(const [entity,row] of [['machines',{...machine,name:'Изменённое имя'}],['objects',{...object,name:'Изменённый объект'}],['employees',{...employee,name:'Изменённое имя'}]]){
  await t.test(entity,()=>reject(validate(entity,[row]),'id'));
 }
});

test('A duplicate source row in separate sheets blocks both files, regardless of filename',()=>{
 const result=imports.validatePackage(preparedState(),[
  upload('expenses',[expense],{fileName:'test-first.xlsx',sheetName:'Первый лист'}),
  upload('expenses',[{...expense,amount:'9999'}],{fileName:'test-renamed.csv',sheetName:'Второй лист'})
 ]);
 reject(result);
});

test('Reimporting an already accepted document/line cannot create another financial expense',()=>{
 const first=validate('expenses',[expense]);
 assert.equal(first.valid,true,JSON.stringify(first.errors));
 const before=structuredClone(first.nextState);
 reject(imports.validatePackage(first.nextState,[upload('expenses',[{...expense,amount:'7777',date:'2027-02-05'}],{fileName:'test-another-name.xlsx'})]));
 assert.deepEqual(first.nextState,before);
 assert.equal(first.nextState.operations.length,1);
});

test('Saved source identities prevent duplicates even when the import history view is absent',()=>{
 const first=validate('expenses',[expense]);
 assert.equal(first.valid,true,JSON.stringify(first.errors));
 delete first.nextState.importHistory;
 reject(imports.validatePackage(first.nextState,[upload('expenses',[expense])]));
 assert.equal(first.nextState.operations.length,1);
});

test('Import history prevents an old expense source being replayed after a register row is removed',()=>{
 const first=validate('expenses',[expense]);
 assert.equal(first.valid,true,JSON.stringify(first.errors));
 first.nextState.operations=[];
 reject(imports.validatePackage(first.nextState,[upload('expenses',[expense])]));
 assert.deepEqual(first.nextState.operations,[]);
});

test('Repeated payroll, timesheet and waybill sources cannot duplicate source registers',()=>{
 for(const [entity,row,target] of [['payroll',payroll,'payroll'],['timesheets',timesheet,'importedTimesheets'],['waybills',waybill,'importedWaybills']]){
  const first=validate(entity,[row]);
  assert.equal(first.valid,true,JSON.stringify(first.errors));
  reject(imports.validatePackage(first.nextState,[upload(entity,[row],{fileName:'test-renamed.xlsx'})]));
  assert.equal(first.nextState[target].length,1);
 }
});

test('Different source lines in one document represent independent expense rows',()=>{
 const result=validate('expenses',[expense,{...expense,sourceLine:'2',amount:'300'}]);
 assert.equal(result.valid,true,JSON.stringify(result.errors));
 assert.equal(result.nextState.operations.length,2);
 assert.equal(result.nextState.operations.reduce((sum,row)=>sum+row.amount,0),1500.50);
});

test('Document and source row identifiers are required for every source register',async t=>{
 for(const [entity,row] of [['expenses',expense],['payroll',payroll],['timesheets',timesheet],['waybills',waybill]]){
  for(const field of ['documentId','sourceLine'])await t.test(entity+' '+field,()=>reject(validate(entity,[{...row,[field]:''}]),field));
 }
});

test('Impossible dates and unrecognized date text cannot roll over to a different day',async t=>{
 for(const date of ['2027-02-29','2027-04-31','2027-13-01','31.02.2027','2027-01-01junk','01/02/27']){
  await t.test(date,()=>reject(validate('expenses',[{...expense,date}]),'date'));
 }
 const valid=validate('expenses',[{...expense,date:'29.02.2028'}]);
 assert.equal(valid.valid,true,JSON.stringify(valid.errors));
 assert.equal(valid.nextState.operations[0].date,'2028-02-29');
});

test('Money is finite, positive and restricted to kopecks before any row is accepted',async t=>{
 for(const amount of [0,-1,'NaN','Infinity','12.345','12.000','0.00000001','1 2','1e3','500 руб.']){
  await t.test(String(amount),()=>reject(validate('expenses',[expense,{...expense,sourceLine:'2',amount}]),'amount'));
 }
 const result=validate('expenses',[{...expense,amount:'1\u00a0234,56'}]);
 assert.equal(result.valid,true,JSON.stringify(result.errors));
 assert.equal(result.nextState.operations[0].amount,1234.56);
});

test('Payroll requires a real reporting month and remains a separate source register',async t=>{
 for(const period of ['2027-00','2027-13','2027-1','2027-01-02','январь']){
  await t.test(period,()=>reject(validate('payroll',[{...payroll,period}]),'period'));
 }
 const result=validate('payroll',[payroll]);
 assert.equal(result.valid,true,JSON.stringify(result.errors));
 assert.equal(result.nextState.payroll.length,1);
 assert.equal(result.nextState.payroll[0].amount,25000);
 assert.equal(result.nextState.operations.length,0,'Payroll source import must not duplicate expense accruals');
});

test('Imported tabular hours do not approve shifts or produce a second financial operation',async t=>{
 for(const hours of [0,-1,25,'NaN','8 часов'])await t.test(String(hours),()=>reject(validate('timesheets',[{...timesheet,hours}]),'hours'));
 const result=imports.validatePackage(preparedState(),[upload('timesheets',[timesheet]),upload('waybills',[waybill])]);
 assert.equal(result.valid,true,JSON.stringify(result.errors));
 assert.equal(result.nextState.importedTimesheets.length,1);
 assert.equal(result.nextState.importedWaybills.length,1);
 assert.equal(result.nextState.shifts.length,0);
 assert.equal(result.nextState.operations.length,0);
});

test('Several source rows cannot exceed one employee or machine day, including earlier imports',()=>{
 for(const [entity,row,target] of [['timesheets',timesheet,'importedTimesheets'],['waybills',waybill,'importedWaybills']]){
  reject(validate(entity,[{...row,hours:16},{...row,sourceLine:'2',hours:9}]),'hours');
  const first=validate(entity,[{...row,hours:16}]);
  assert.equal(first.valid,true,JSON.stringify(first.errors));
  reject(imports.validatePackage(first.nextState,[upload(entity,[{...row,documentId:'TEST-SECOND-DOC',hours:9}])]),'hours');
  assert.equal(first.nextState[target].length,1);
 }
 const sameWork=imports.validatePackage(preparedState(),[upload('timesheets',[{...timesheet,hours:16}]),upload('waybills',[{...waybill,hours:16}])]);
 assert.equal(sameWork.valid,true,'Timesheet and waybill may describe the same hours; their registers cannot be added together');
});

test('Daily hours are checked across different machines for one employee and different employees for one machine',()=>{
 const base=preparedState();
 base.machines.push({...base.machines[0],id:'TEST-M2',plate:'TEST-002',serial:'TEST-SERIAL-002'});
 base.employees.push({id:'TEST-E2',name:'Другой тестовый сотрудник'});
 reject(imports.validatePackage(base,[upload('timesheets',[{...timesheet,hours:16},{...timesheet,sourceLine:'2',machineId:'TEST-M2',hours:9}])]),'hours');
 reject(imports.validatePackage(base,[upload('timesheets',[{...timesheet,hours:16},{...timesheet,sourceLine:'2',employeeId:'TEST-E2',hours:9}])]),'hours');
});

test('Waybill meter readings must be paired, finite and ordered',async t=>{
 for(const change of [{meterEnd:''},{meterStart:''},{meterStart:-1},{meterEnd:'NaN'},{meterStart:120,meterEnd:100}]){
  await t.test(JSON.stringify(change),()=>reject(validate('waybills',[{...waybill,...change}])));
 }
 const row={...waybill,meterStart:'',meterEnd:''};
 const result=validate('waybills',[row]);
 assert.equal(result.valid,true,JSON.stringify(result.errors));
});

test('Explicit overhead and warehouse targets stay separate from machine expenses and stock balances',()=>{
 const result=validate('expenses',[
  expense,
  {...expense,sourceLine:'2',machineId:'ОБЩЕХОЗ',objectId:'',amount:'400'},
  {...expense,sourceLine:'3',machineId:'СКЛАД',objectId:'',amount:'900'}
 ]);
 assert.equal(result.valid,true,JSON.stringify(result.errors));
 assert.equal(result.nextState.operations.length,3);
 assert.deepEqual(result.nextState.operations.map(row=>row.allocation),['machine','overhead','warehouse']);
 assert.equal(result.nextState.operations[1].machine,'');
 assert.equal(result.nextState.operations[2].machine,'');
 assert.deepEqual(result.nextState.stock,[]);
 assert.deepEqual(result.nextState.stockMoves,[]);
});

test('A possible repair expense duplicate prevents an automatic second charge',()=>{
 const base=preparedState();
 base.operations.push({id:'test-repair-expense',sourceRepair:'TEST-REPAIR-1',date:expense.date,machine:machine.id,kind:'expense',amount:1200.50,category:'Ремонт и ТО',note:'Тестовый закрытый ремонт'});
 const result=imports.validatePackage(base,[upload('expenses',[{...expense,category:'Ремонт и ТО'}])]);
 reject(result);
 assert.equal(base.operations.length,1);
});

test('CSV preserves BOM, separator, quoted semicolons, quotes and multiline cells',()=>{
 const rows=imports.parseCSV('\uFEFFКод;Название;Комментарий\r\nTEST-1;"Тест;объект";"Первая строка\nВторая ""строка"""\r\n');
 assert.deepEqual(rows,[['Код','Название','Комментарий'],['TEST-1','Тест;объект','Первая строка\nВторая "строка"']]);
 assert.deepEqual(imports.parseCSV('Код,Название\nTEST-2,"Тест,объект"'),[['Код','Название'],['TEST-2','Тест,объект']]);
});

test('Broken CSV quoting cannot silently shift source fields to another column',()=>{
 for(const text of ['Код;Название\nTEST-1;"Не закрыто','Код;Название\nTEST-1;"Закрыто"лишнее','Код;Название\nTEST-1;не"верно']){
  assert.throws(()=>imports.parseCSV(text));
 }
});

test('Generated templates contain all required fields and localized headers can be mapped',()=>{
 for(const [entity,schema] of Object.entries(imports.schemas)){
  const rows=imports.templateRows(entity),mapping=imports.autoMap(entity,rows[0]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].length,schema.fields.length);
  for(const field of schema.fields.filter(item=>item.required))assert.ok(Number.isInteger(mapping[field.key]),entity+' '+field.key);
  assert.deepEqual(imports.parseCSV(imports.templateCSV(entity)),rows);
 }
});

test('Ambiguous or reused column mappings cannot silently import the wrong field',()=>{
 const duplicateHeader={entity:'objects',rows:[['Код объекта','Название объекта','Название объекта'],['TEST-O2','Тест 1','Тест 2']]};
 reject(imports.validatePackage(preparedState(),[duplicateHeader]),'name');
 reject(imports.validatePackage(preparedState(),[upload('objects',[{id:'TEST-O2',name:'Тест'}],{mapping:{id:0,name:0}})]));
 const manual=imports.validatePackage(preparedState(),[{...duplicateHeader,mapping:{id:0,name:2}}]);
 assert.equal(manual.valid,true,JSON.stringify(manual.errors));
 assert.equal(manual.nextState.objects.find(row=>row.id==='TEST-O2').name,'Тест 2');
});

test('Ambiguous optional object columns require a deliberate choice instead of silently losing their links',()=>{
 const file=upload('expenses',[expense]);
 file.rows[0][file.mapping.objectId]='Код объекта';
 file.rows[0].push('Объект');file.rows[1].push(object.id);
 const automatic={...file};delete automatic.mapping;
 reject(imports.validatePackage(preparedState(),[automatic]),'objectId');
 reject(imports.validatePackage(preparedState(),[{...file,mapping:{...file.mapping,objectId:-1}}]),'objectId');
 const selected=imports.validatePackage(preparedState(),[file]);
 assert.equal(selected.valid,true,JSON.stringify(selected.errors));
 assert.equal(selected.nextState.operations[0].object,object.id);
 const skipped=imports.validatePackage(preparedState(),[{...file,mapping:{...file.mapping,objectId:null}}]);
 assert.equal(skipped.valid,true,JSON.stringify(skipped.errors));
 assert.equal(skipped.nextState.operations[0].object,'');
});

test('Empty packages, empty sheets and malformed saved registers fail without partial candidates or exceptions',()=>{
 for(const uploads of [[],[upload('objects',[])],[{entity:'objects',rows:[]}],[{entity:'objects',rows:[['Код объекта','Название объекта'],['','']]}]]){
  reject(imports.validatePackage(preparedState(),uploads));
 }
 for(const [field,value] of [['machines',{}],['operations',[null]],['payroll','broken'],['importHistory',[42]]]){
  const base=preparedState();base[field]=value;
  let result;assert.doesNotThrow(()=>{result=imports.validatePackage(base,[upload('expenses',[expense])]);});
  reject(result,field);
 }
});

test('Unknown entity names and extra populated cells are rejected instead of losing source data',()=>{
 for(const entity of ['constructor','toString','__proto__','unknown']){
  let result;assert.doesNotThrow(()=>{result=imports.validatePackage(preparedState(),[upload(entity,[{id:'TEST-X',name:'Тест'}])]);});
  reject(result,'entity');
 }
 const file=upload('expenses',[expense]);file.rows[1].push('Необъяснённая сумма');
 reject(imports.validatePackage(preparedState(),[file]));
});

function appWithState(saved){
 const node=()=>({innerHTML:'',textContent:'',style:{},value:'',classList:{add(){},remove(){}},querySelectorAll(){return [];},addEventListener(){}});
 const elements=new Map();
 const ctx=vm.createContext({console,structuredClone,Intl,Date,Math,setTimeout,clearTimeout,
  document:{querySelector(selector){if(!elements.has(selector))elements.set(selector,node());return elements.get(selector);},querySelectorAll(){return [];},addEventListener(){},body:{style:{}},activeElement:{tagName:'BODY'}},
  localStorage:{getItem(){return null;},setItem(){}}
 });
 const run=code=>vm.runInContext(code,ctx);
 const dist=path.join(__dirname,'..','dist');
 run(fs.readFileSync(path.join(dist,'workshop.js'),'utf8'));
 run(fs.readFileSync(path.join(dist,'app.js'),'utf8').replace(/\nrender\(\);\s*$/,''));
 ctx.importedState=structuredClone(saved);
 run('replaceState(importedState);period="2027-01";');
 return {run,ctx};
}

test('Imported expenses reconcile with existing company and machine finance without counting warehouse or payroll twice',()=>{
 const result=imports.validatePackage(preparedState(),[
  upload('expenses',[expense,{...expense,sourceLine:'2',machineId:'ОБЩЕХОЗ',objectId:'',amount:'400'},{...expense,sourceLine:'3',machineId:'СКЛАД',objectId:'',amount:'900'}]),
  upload('payroll',[payroll]),upload('timesheets',[timesheet]),upload('waybills',[waybill])
 ]);
 assert.equal(result.valid,true,JSON.stringify(result.errors));
 result.nextState.operations.push({id:'test-income',kind:'income',amount:10000,date:'2027-01-05',machine:machine.id,category:'Тестовая выручка'});
 const app=appWithState(result.nextState);
 assert.deepEqual(JSON.parse(app.run('JSON.stringify(overallFinance())')),{income:10000,expense:1600.50});
 assert.equal(app.run('overallFinance().income-overallFinance().expense'),8399.50);
 assert.equal(app.run('result(machine("TEST-M1"))'),8799.50);
 assert.equal(app.run('confirmedHours("TEST-M1")'),null,'Imported source hours cannot be used as approved distribution hours');
});

test('Missing source object stays explicitly unassigned instead of inheriting the current machine object',()=>{
 const {objectId,...withoutObject}=expense;
 const result=validate('expenses',[withoutObject]);
 assert.equal(result.valid,true,JSON.stringify(result.errors));
 const row=result.nextState.operations[0];
 assert.ok(Object.hasOwn(row,'object'));
 assert.equal(row.object,'');
 const app=appWithState(result.nextState);
 assert.deepEqual(JSON.parse(app.run('JSON.stringify(objectSums("TEST-O1"))')),{income:0,expense:0});
 assert.equal(app.run('overallFinance().expense'),1200.50);
 assert.equal(app.run('sums([machine("TEST-M1")]).expense'),1200.50);
});

test('An expense keeps the object recorded by its source when a machine is assigned elsewhere later',()=>{
 const result=validate('expenses',[expense]);
 assert.equal(result.valid,true,JSON.stringify(result.errors));
 const app=appWithState(result.nextState);
 app.run('state.objects.push({id:"TEST-O2",name:"Другой тестовый объект"});machine("TEST-M1").object="TEST-O2";');
 assert.deepEqual(JSON.parse(app.run('JSON.stringify(objectSums("TEST-O1"))')),{income:0,expense:1200.50});
 assert.deepEqual(JSON.parse(app.run('JSON.stringify(objectSums("TEST-O2"))')),{income:0,expense:0});
 assert.equal(app.run('overallFinance().expense'),1200.50);
});

test('New historical expenses reconcile by their source object while warehouse and missing-object rows cannot inherit the current assignment',()=>{
 const base=preparedState();base.objects.push({id:'TEST-O2',name:'Исторический тестовый объект'});
 const {objectId,...withoutObject}=expense;
 const result=imports.validatePackage(base,[upload('expenses',[
  {...expense,objectId:'TEST-O2'},
  {...expense,sourceLine:'2',machineId:'СКЛАД',objectId:'',amount:900},
  {...expense,sourceLine:'3',machineId:'ОБЩЕХОЗ',objectId:'',amount:400},
  {...withoutObject,sourceLine:'4',amount:300}
 ])]);
 assert.equal(result.valid,true,JSON.stringify(result.errors));
 assert.ok(result.warnings.some(issue=>issue.field==='objectId'&&issue.row===2));
 const app=appWithState(result.nextState);
 assert.deepEqual(JSON.parse(app.run('JSON.stringify(objectSums("TEST-O2"))')),{income:0,expense:1200.50});
 assert.deepEqual(JSON.parse(app.run('JSON.stringify(objectSums("TEST-O1"))')),{income:0,expense:0});
 assert.equal(app.run('overallFinance().expense'),1900.50);
 assert.equal(app.run('sums([machine("TEST-M1")]).expense'),1500.50);
 assert.equal(app.run('machine("TEST-M1").object'),'TEST-O1');
});
