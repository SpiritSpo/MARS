const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser,demonstrationState,keys}=require('./fixtures/browser-app.cjs');

const header=['Дата','Техника','Статья','Сумма','Комментарий','Номер документа','ID документа','ID строки','Источник','Ремонт'];
const input=(machine='M001',amount='1250',extra={})=>['2027-01-04',machine,'Ремонт и ТО',amount,'Синтетическая операция',extra.document||'',extra.documentId||'',extra.documentLine||'',extra.source||'',extra.repair||''];
const meta=(hash='synthetic-file-a',file='expenses.csv',sheet='CSV')=>({fileHash:hash,file,sheet});
const json=JSON.stringify;

function setup(mode){
 const data=demonstrationState();
 const first=data.machines.find(m=>m.id==='M001');
 Object.assign(first,{registration:'А123ВС 77',inventoryNumber:'INV-001'});
 data.persistenceSentinel={nested:{value:'Сохранить прежние пользовательские данные'}};
 data.accountantImports=[{id:'earlier-import',at:'2026-11-01T00:00:00.000Z',file:'earlier.csv',count:0,total:0,status:'Ранее сохранено'}];
 const active=mode==='demo'?keys.demo:keys.working,inactive=mode==='demo'?keys.working:keys.demo;
 const storage=new Map([[active,JSON.stringify(data)],[inactive,JSON.stringify(demonstrationState())],[keys.legacy,'Не изменять прежний архив'],[keys.archive,'Не изменять архив справочников']]);
 const a=browser({mode,storage});a.run("role='accountant';period='2027-01';");
 return a;
}
function parse(a,data,source=meta()){
 return a.json('accountantParseRows('+json(data)+','+json(source)+')');
}
function commit(a,parsed,decisions={},source={}){
 return a.json('accountantCommitImport('+json(parsed.rows)+','+json(decisions)+','+json({...parsed,...source})+')');
}
function assign(a,id,destination,decision){
 return a.json('accountantAssignExpense('+json(id)+','+json(destination)+','+json(decision)+')');
}
const imported=a=>a.state().operations.filter(o=>o.source==='excel-demo'&&o.importFileHash);
const originalOthers=a=>[...a.storage].filter(([key])=>key!==a.activeKey());
function protect(a,before,others){
 const state=a.state();
 assert.deepEqual(state.operations.filter(o=>before.operations.some(old=>old.id===o.id)),before.operations);
 for(const field of ['machines','objects','shifts','maintenance','stock','stockMoves','persistenceSentinel'])assert.deepEqual(state[field],before[field],field);
 assert.deepEqual(state.accountantImports[0],before.accountantImports[0]);
 assert.deepEqual(originalOthers(a),others);
 assert.ok(a.writes.every(write=>write.key===a.activeKey()));
}
function reload(a){const b=a.reload();b.run("role='accountant';period='2027-01';");return b;}

for(const mode of ['demo','working']){
 test(mode+': exact file rows survive reload and a renamed identical file is already processed',()=>{
  const a=setup(mode),before=a.state(),others=originalOthers(a),table=[header,input()];
  const first=parse(a,table);assert.equal(first.errors.length,0);assert.equal(first.review.length,0);
  assert.deepEqual(commit(a,first).added,1);
  const saved=imported(a)[0];
  assert.equal(saved.importFileHash,'synthetic-file-a');assert.equal(saved.importSheet,'CSV');assert.equal(saved.importLine,2);
  assert.ok(saved.provenanceHistory.some(e=>e.action==='Импортировано'));
  const b=reload(a),again=parse(b,table,meta('synthetic-file-a','renamed.csv'));
  assert.equal(again.rows.length,0);assert.equal(again.processed.length,1);
  assert.equal(commit(b,again).processed,1);
  assert.equal(imported(b).length,1);assert.equal(b.run('overallFinance().expense'),1250);
  assert.ok(imported(b)[0].provenanceHistory.some(e=>e.action==='Повторная проверка источника'));
  protect(b,before,others);
 });

 test(mode+': a mixed repeat and new row imports only new work and reports both statuses',()=>{
  const a=setup(mode),doc={documentId:'known-document',documentLine:'known-line',source:'synthetic-1c'};
  const first=parse(a,[header,input('M001','1250',doc)]);assert.equal(commit(a,first).ok,true);
  const mixed=parse(a,[header,input('M001','1250',doc),input('M002','2300')],meta('mixed-new-file'));
  assert.equal(mixed.processed.length,1);assert.equal(mixed.rows.length,1);assert.equal(mixed.review.length,0);
  const result=commit(a,mixed);assert.equal(result.added,1);assert.equal(result.processed,1);
  assert.equal(imported(a).length,2);assert.equal(a.run('overallFinance().expense'),3550);
  assert.deepEqual(reload(a).state(),a.state());
 });

 test(mode+': identical real rows at different source lines require review instead of automatic deletion',()=>{
  const a=setup(mode),before=a.state(),table=[header,input(),input()],parsed=parse(a,table);
  assert.equal(parsed.rows.length,2);assert.equal(parsed.processed.length,0);assert.equal(parsed.review.length,1);
  assert.deepEqual(parsed.rows.map(row=>row.importLine),[2,3]);
  const denied=commit(a,parsed);assert.equal(denied.ok,false);assert.match(denied.error,/сверка/);
  assert.deepEqual(a.state(),before);
  const second=parsed.rows[1];
  const approved=commit(a,parsed,{[second.id]:{kind:'distinct',reason:'Разные подтверждённые расходы по отдельным актам'}});
  assert.equal(approved.ok,true);assert.equal(imported(a).length,2);assert.equal(a.run('overallFinance().expense'),2500);
  assert.equal(a.json('financeReviewCandidates(state.operations.find(o=>o.id==='+json(second.id)+')).length'),0);
  assert.deepEqual(reload(a).state(),a.state());
 });

 test(mode+': a changed payload with the same exact source identity is blocked without changing saved data',()=>{
  const a=setup(mode);assert.equal(commit(a,parse(a,[header,input()])).ok,true);
  const before=a.state(),bytes=[...a.storage],changed=parse(a,[header,input('M001','9999')]);
  assert.equal(changed.rows.length,0);assert.equal(changed.processed.length,0);
  assert.match(changed.errors.join(' '),/содержимое изменилось/);
  assert.equal(commit(a,changed).ok,false);
  assert.deepEqual(a.state(),before);assert.deepEqual([...a.storage],bytes);
 });

 test(mode+': stable source-scoped document and line IDs recognize repeats across files and machine aliases',()=>{
  const a=setup(mode),doc={document:'Акт № 7',documentId:'doc-uid-7',documentLine:'line-1',source:'Синтетическая база А'};
  assert.equal(commit(a,parse(a,[header,input('M001','1250',doc)])).ok,true);
  const repeated=parse(a,[header,input('А123ВС 77','1250',doc)],meta('different-file-hash','second.xlsx','Лист 2'));
  assert.equal(repeated.processed.length,1);assert.equal(repeated.rows.length,0);
  assert.equal(commit(a,repeated).processed,1);assert.equal(imported(a).length,1);
  const otherSource=parse(a,[header,input('M001','1250',{...doc,source:'Синтетическая база Б'})],meta('third-file'));
  assert.equal(otherSource.rows.length,1);assert.equal(otherSource.processed.length,0);assert.equal(otherSource.review.length,1);
 });

 test(mode+': document numbers alone do not suppress separate expenses from another file',()=>{
  const a=setup(mode),doc={document:'Акт № 7'};
  assert.equal(commit(a,parse(a,[header,input('M001','1250',doc)])).ok,true);
  const separate=parse(a,[header,input('INV-001','1250',doc)],meta('another-file'));
  assert.equal(separate.rows.length,1);assert.equal(separate.processed.length,0);assert.equal(separate.review.length,1);
  const result=commit(a,separate,{[separate.rows[0].id]:{kind:'distinct',reason:'Другой самостоятельный акт с тем же номером'}});
  assert.equal(result.ok,true);assert.equal(a.run('overallFinance().expense'),2500);
 });

 test(mode+': document IDs without an explicit source namespace remain advisory across files',()=>{
  const a=setup(mode),doc={documentId:'same-document-id',documentLine:'same-line-id'};
  assert.equal(commit(a,parse(a,[header,input('M001','1250',doc)])).ok,true);
  const ambiguous=parse(a,[header,input('M001','1250',doc)],meta('different-namespace-unknown-file'));
  assert.equal(ambiguous.processed.length,0);assert.equal(ambiguous.rows.length,1);assert.equal(ambiguous.review.length,1);
  assert.equal(commit(a,ambiguous).ok,false);
  assert.equal(imported(a).length,1);
 });

 test(mode+': legacy imported rows without identity remain available and require reconciliation',()=>{
  const a=setup(mode);
  a.run("state.operations.push({id:'legacy-import',source:'excel-demo',machine:'M001',allocation:'machine',kind:'expense',date:'2027-01-04',category:'Ремонт и ТО',amount:1250,note:'Ранее сохранённая операция без ID источника'});persist();");
  const old=a.state().operations.find(o=>o.id==='legacy-import'),parsed=parse(a,[header,input('INV-001')]);
  assert.equal(parsed.rows.length,1);assert.equal(parsed.processed.length,0);assert.equal(parsed.review.length,1);
  assert.deepEqual(a.state().operations.find(o=>o.id==='legacy-import'),old);
  assert.equal(commit(a,parsed).ok,false);
  assert.deepEqual(a.state().operations.find(o=>o.id==='legacy-import'),old);
 });

 test(mode+': mechanic-first expense links to a later accounting row with both origins retained',()=>{
  const a=setup(mode);
  a.run("state.operations.push({id:'mechanic-expense',source:'repair',sourceRepair:'synthetic-repair',machine:'M001',kind:'expense',date:'2027-01-04',category:'Ремонт и ТО',amount:1250,note:'ЗР-ТЕСТ'});state.maintenance.push({id:'synthetic-repair',number:'ЗР-ТЕСТ',machine:'M001',status:'done'});initializeWorkshop();syncMachineStatuses();persist();");
  const parsed=parse(a,[header,input('А123ВС 77','1250',{repair:'ЗР-ТЕСТ'})]);
  assert.equal(parsed.review.length,1);
  const result=commit(a,parsed,{[parsed.rows[0].id]:{kind:'link',targetId:'mechanic-expense',reason:'Один подтверждённый акт ремонта'}});
  assert.equal(result.ok,true);assert.equal(a.run('overallFinance().expense'),1250);
  assert.equal(a.run("sums([machine('M001')]).expense"),1250);
  assert.equal(imported(a)[0].expenseMatch.operationId,'mechanic-expense');
  assert.equal(imported(a)[0].repairReference,'ЗР-ТЕСТ');
  const log=a.state().accountantImports.at(-1);assert.equal(log.total,1250);assert.equal(log.countedTotal,0);
  assert.deepEqual(reload(a).state(),a.state());
 });

 test(mode+': ambiguous accounting match needs a chosen target and cannot auto-link partial amounts',()=>{
  const a=setup(mode);
  a.run("state.operations.push(...['one','two'].map(id=>({id,machine:'M001',kind:'expense',date:'2027-01-04',category:'Ремонт и ТО',amount:1250,note:id})));persist();");
  const parsed=parse(a,[header,input()]);assert.equal(parsed.review[0].candidates.length,2);
  assert.equal(commit(a,parsed).ok,false);
  const result=commit(a,parsed,{[parsed.rows[0].id]:{kind:'link',targetId:'one',reason:'Подтверждён акт первой операции'}});
  assert.equal(result.ok,true);assert.equal(a.run('overallFinance().expense'),2500);
  const smaller=parse(a,[header,input('M001','500',{repair:'ЗР-0001'})],meta('smaller'));
  a.run("state.operations.find(o=>o.id==='one').sourceRepair='service-101';state.maintenance.find(r=>r.id==='service-101').machine='M001';");
  const attempted=commit(a,smaller,{[smaller.rows[0].id]:{kind:'link',targetId:'one',reason:'Сумма только части ремонта'}});
  assert.equal(attempted.ok,false);assert.equal(imported(a).length,1);
 });

 test(mode+': import and journal roll back together after storage failure and retry the same parsed rows',()=>{
  const a=setup(mode),before=a.state(),bytes=[...a.storage],others=originalOthers(a),writes=a.writes.length;
  const parsed=parse(a,[header,input()]);a.control.failWrites=true;
  const failed=commit(a,parsed);assert.equal(failed.ok,false);assert.match(failed.error,/сохранить/);
  assert.deepEqual(a.state(),before);assert.deepEqual([...a.storage],bytes);assert.equal(a.writes.length,writes);
  assert.deepEqual(reload(a).state(),before);
  a.control.failWrites=false;assert.equal(commit(a,parsed).ok,true);
  assert.equal(a.writes.length,writes+1);assert.equal(imported(a).length,1);
  assert.equal(a.state().accountantImports.length,before.accountantImports.length+1);
  assert.deepEqual(reload(a).state(),a.state());protect(a,before,others);
 });

 test(mode+': confirmation rechecks imported source rows so a second confirmation cannot conduct them twice',()=>{
  const a=setup(mode),parsed=parse(a,[header,input()]);
  assert.equal(commit(a,parsed).added,1);
  const repeated=commit(a,parsed);assert.equal(repeated.ok,true);assert.equal(repeated.added,0);assert.equal(repeated.processed,1);
  assert.equal(imported(a).length,1);assert.equal(a.run('overallFinance().expense'),1250);
 });

 test(mode+': reassignment rechecks collisions and saves allocation plus history in one write',()=>{
  const a=setup(mode);
  assert.equal(commit(a,parse(a,[header,input('M002')])).ok,true);
  a.run("state.operations.push({id:'existing-m001',machine:'M001',kind:'expense',date:'2027-01-04',category:'Ремонт и ТО',amount:1250,note:'Другой расход машины'});persist();");
  const id=imported(a)[0].id,before=a.state(),writes=a.writes.length;
  const review=assign(a,id,'INV-001');assert.equal(review.ok,false);assert.equal(review.candidates.length,1);
  assert.deepEqual(a.state(),before);assert.equal(a.writes.length,writes);
  const result=assign(a,id,'А123ВС 77',{kind:'distinct',reason:'Два самостоятельных акта на одной машине'});
  assert.equal(result.ok,true);assert.equal(a.writes.length,writes+1);
  assert.equal(imported(a)[0].machine,'M001');assert.equal(a.state().accountantAllocationAudit.at(-1).rowId,id);
  assert.ok(imported(a)[0].provenanceHistory.some(e=>e.action==='Изменение назначения'));
  assert.equal(a.run("sums([machine('M001')]).expense"),2500);
  assert.deepEqual(reload(a).state(),a.state());
 });

 test(mode+': changing allocation preserves the immutable import source for a subsequent exact repeat',()=>{
  const a=setup(mode),table=[header,input('M002')],parsed=parse(a,table);
  assert.equal(commit(a,parsed).ok,true);
  const id=imported(a)[0].id,source=structuredClone(imported(a)[0].importOriginal);
  assert.equal(assign(a,id,'M001').ok,true);
  assert.deepEqual(imported(a)[0].importOriginal,source);
  const again=parse(a,table);assert.equal(again.processed.length,1);assert.equal(again.rows.length,0);
  assert.equal(commit(a,again).processed,1);assert.equal(imported(a).length,1);
  assert.equal(imported(a)[0].machine,'M001');
 });

 test(mode+': failed reassignment restores source, allocation and histories and can retry after reload',()=>{
  const a=setup(mode);assert.equal(commit(a,parse(a,[header,input('M002')])).ok,true);
  const id=imported(a)[0].id,before=a.state(),bytes=[...a.storage],writes=a.writes.length;
  a.control.failWrites=true;const failed=assign(a,id,'M001');assert.equal(failed.ok,false);
  assert.deepEqual(a.state(),before);assert.deepEqual([...a.storage],bytes);assert.equal(a.writes.length,writes);
  const b=reload(a);assert.deepEqual(b.state(),before);
  assert.equal(assign(b,id,'M001').ok,true);
  assert.equal(b.writes.length,1);assert.equal(imported(b)[0].machine,'M001');
  assert.deepEqual(reload(b).state(),b.state());
 });

 test(mode+': confirmed links prevent moving one side or the counted target independently',()=>{
  const a=setup(mode),first=parse(a,[header,input()]);assert.equal(commit(a,first).ok,true);
  const root=imported(a)[0].id,next=parse(a,[header,input()],meta('linked-file'));
  assert.equal(commit(a,next,{[next.rows[0].id]:{kind:'link',targetId:root,reason:'Та же подтверждённая операция'}}).ok,true);
  const linked=imported(a)[1].id,before=a.state(),bytes=[...a.storage];
  assert.equal(assign(a,linked,'M002').ok,false);assert.equal(assign(a,root,'M002').ok,false);
  assert.deepEqual(a.state(),before);assert.deepEqual([...a.storage],bytes);
  assert.equal(a.run('overallFinance().expense'),1250);
 });

 test(mode+': malformed optional accounting history is preserved when a new batch is saved',()=>{
  const a=setup(mode);
  a.run("state.accountantImports={opaque:'Сохранить исходный журнал'};state.accountantHistoryRecovery={earlier:'Не перезаписывать'};persist();");
  const original=a.state();assert.equal(commit(a,parse(a,[header,input()])).ok,true);
  const recovery=a.state().accountantHistoryRecovery;
  assert.deepEqual(recovery[0],{field:'accountantHistoryRecovery',value:original.accountantHistoryRecovery});
  assert.deepEqual(recovery[1].value,original.accountantImports);assert.equal(recovery[1].field,'accountantImports');
  assert.deepEqual(reload(a).state(),a.state());
 });
}

test('CSV blank and quoted multiline records retain physical source row numbers',()=>{
 const a=setup('working');
 const csv='Дата;Техника;Статья;Сумма;Комментарий\n\n2027-01-04;M001;Ремонт;1250;"Первая\nвторая строка"\n\n2027-01-05;M002;Топливо;300;Другое';
 const parsed=a.json('accountantParseRows(accountantParseCSV('+json(csv)+'),'+json(meta())+')');
 assert.equal(parsed.errors.length,0);assert.deepEqual(parsed.rows.map(o=>o.importLine),[3,6]);
 assert.equal(parsed.rows[0].note,'Первая\nвторая строка');
});

test('an ambiguous machine registration cannot silently choose one vehicle',()=>{
 const a=setup('working');a.run("machine('M002').registration=machine('M001').registration;");
 const parsed=parse(a,[header,input('А123ВС 77')]);
 assert.equal(parsed.rows.length,0);assert.match(parsed.errors.join(' '),/однозначный/);
});

function loaderContext(a){
 const context=a.run('globalThis');
 context.crypto.subtle=require('node:crypto').webcrypto.subtle;
 context.TextDecoder=TextDecoder;
 return context;
}

test('XLSX loading checks every sheet and preserves physical rows and a real SHA-256 file identity',async()=>{
 const a=setup('working'),context=loaderContext(a);
 const sheets={'Первый лист':[[],header,input()], 'Второй лист':[header,input('M002','2300')]};
 context.XLSX={read(){return {SheetNames:Object.keys(sheets),Sheets:sheets};},utils:{sheet_to_json(sheet){return sheet;}}};
 const bytes=new Uint8Array([11,22,33,44]);
 context.testFile={name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer};
 await a.run('accountantLoadFile(testFile)');
 const parsed=a.json('accountantPreview');assert.equal(parsed.errors.length,0);assert.equal(parsed.rows.length,2);
 assert.deepEqual(parsed.rows.map(row=>[row.importSheet,row.importLine]),[['Первый лист',3],['Второй лист',2]]);
 const hash=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 assert.ok(parsed.rows.every(row=>row.importFileHash===hash));
 assert.equal(commit(a,parsed).added,2);
 context.testFile={...context.testFile,name:'renamed.xlsx'};
 await a.run('accountantLoadFile(testFile)');
 const again=a.json('accountantPreview');assert.equal(again.rows.length,0);assert.equal(again.processed.length,2);
 assert.equal(commit(a,again).processed,2);assert.equal(imported(a).length,2);
});

test('a stable document row repeated on two XLSX sheets is conducted once',async()=>{
 const a=setup('working'),context=loaderContext(a);
 const doc={documentId:'doc-across-sheets',documentLine:'source-line',source:'synthetic-1c'};
 const sheets={One:[header,input('M001','1250',doc)],Two:[header,input('INV-001','1250',doc)]};
 context.XLSX={read(){return {SheetNames:Object.keys(sheets),Sheets:sheets};},utils:{sheet_to_json(sheet){return sheet;}}};
 context.testFile={name:'synthetic.xlsx',size:2,arrayBuffer:async()=>new Uint8Array([77,88]).buffer};
 await a.run('accountantLoadFile(testFile)');
 const parsed=a.json('accountantPreview');assert.equal(parsed.errors.length,0);assert.equal(parsed.rows.length,1);assert.equal(parsed.processed.length,1);
 const result=commit(a,parsed);assert.equal(result.ok,true);assert.equal(result.added,1);assert.equal(result.processed,1);
 assert.equal(imported(a).length,1);assert.equal(a.run('overallFinance().expense'),1250);
});

test('conflicting document identities across sheets block the entire workbook atomically',async()=>{
 const a=setup('working'),context=loaderContext(a),before=a.state(),saved=[...a.storage];
 const doc={documentId:'conflicting-doc',documentLine:'line',source:'synthetic-1c'};
 const sheets={One:[header,input('M001','1250',doc)],Two:[header,input('M001','2200',doc)]};
 context.XLSX={read(){return {SheetNames:Object.keys(sheets),Sheets:sheets};},utils:{sheet_to_json(sheet){return sheet;}}};
 context.testFile={name:'synthetic.xlsx',size:2,arrayBuffer:async()=>new Uint8Array([99,111]).buffer};
 await a.run('accountantLoadFile(testFile)');
 const parsed=a.json('accountantPreview');assert.ok(parsed.errors.length>0);assert.equal(commit(a,parsed).ok,false);
 assert.deepEqual(a.state(),before);assert.deepEqual([...a.storage],saved);
});
