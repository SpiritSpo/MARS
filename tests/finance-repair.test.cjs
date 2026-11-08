const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser,demonstrationState,keys}=require('./fixtures/browser-app.cjs');

const day='2026-11-07';
const imported=(id='booked',extra={})=>({
  id,kind:'expense',machine:'M008',allocation:'machine',category:'Ремонт и ТО',
  amount:950,date:day,note:'Синтетический первичный документ ремонта',source:'excel-demo',
  repairReference:'service-101',importDocumentId:'test-document-'+id,importDocumentLine:'1',...extra
});

function setup(mode,expenses=[]){
  const data=demonstrationState();
  data.operations=[
    {id:'prior-income',kind:'income',machine:'M008',category:'Синтетическая выручка',amount:10000,date:day,note:'Не изменять'},
    {id:'prior-expense',kind:'expense',machine:'M001',category:'Ранее сохранённый расход',amount:37,date:day,note:'Не изменять'},
    ...expenses
  ];
  data.accountantImports=[];
  data.persistenceSentinel={id:'previous-user-data',text:'Сохранить прежние записи'};
  const active=mode==='demo'?keys.demo:keys.working;
  const inactive=mode==='demo'?keys.working:keys.demo;
  const other=demonstrationState();other.persistenceSentinel={id:'other-dataset'};
  const a=browser({mode,storage:new Map([
    [active,JSON.stringify(data)],[inactive,JSON.stringify(other)],
    [keys.legacy,'Прежний архив без изменений'],[keys.archive,'Архив справочников без изменений']
  ])});
  a.run("role='mechanic';period='all';syncMachineStatuses();persist();messages.length=0;");
  return a;
}

const protectedEntries=a=>[...a.storage].filter(([key])=>key!==a.activeKey());
const repair=a=>a.state().maintenance.find(r=>r.id==='service-101');
function open(a,extra={}){
  a.run("completeRepairForm('service-101');");
  const form=a.form('#repair-close-form');
  form.values={result:'Синтетический ремонт выполнен',labor:'100',external:'200',
    ...Object.fromEntries(a.state().stock.flatMap(p=>[['qty-'+p.id,'0'],['price-'+p.id,'0']])),
    'qty-part-1':'1','price-part-1':'650',...extra};
  form.oninput();
  return form;
}
function assertTotals(a,expectedMachineExpense,expectedCompanyExpense){
  assert.equal(a.run("sums([machine('M008')]).expense"),expectedMachineExpense);
  assert.equal(a.run('overallFinance().expense'),expectedCompanyExpense);
  assert.equal(a.run('overallFinance().income-overallFinance().expense'),10000-expectedCompanyExpense);
  assert.equal(a.run("result(machine('M008'))"),10000-expectedMachineExpense);
}
function assertCompleted(a,before){
  const state=a.state(),r=repair(a),old=before.maintenance.find(x=>x.id===r.id);
  assert.equal(r.status,'done');
  assert.equal(r.history.length,old.history.length+1);
  assert.equal(state.stock.find(p=>p.id==='part-1').qty,before.stock.find(p=>p.id==='part-1').qty-1);
  assert.equal(state.stockMoves.length,before.stockMoves.length+1);
  assert.deepEqual(state.operations.slice(0,before.operations.length),before.operations,'Earlier financial records remain intact');
  assert.deepEqual(state.persistenceSentinel,before.persistenceSentinel);
  assert.deepEqual(state.shifts,before.shifts);
  assert.deepEqual(state.objects,before.objects);
  assert.deepEqual(state.maintenance.filter(x=>x.id!==r.id),before.maintenance.filter(x=>x.id!==r.id));
  const op=state.operations.find(x=>x.id===r.financeOperationId);
  assert.equal(op.amount,950);assert.equal(op.sourceRepair,r.id);
  assert.deepEqual(op.provenance,{kind:'repair',repairId:r.id,repairNumber:r.number,documentNumber:''});
  assert.ok(op.provenanceHistory.some(x=>x.action==='repair-completed'));
  return op;
}

function previewRepairImport(a){
  a.run("role='accountant';globalThis.repairImportPreview=accountantParseRows([['Дата','Техника','Статья','Сумма','Комментарий','Номер документа','ID документа','ID строки','Источник','Ремонт'],['2026-11-07','M008','Ремонт и ТО','950','Синтетический расход ремонта','ТЕСТ-001','test-document-001','line-1','test-accounting','service-101']],{fileHash:'sha256-synthetic-repair-file',file:'synthetic-repair.csv',sheet:'CSV'});");
  return a.json('repairImportPreview');
}

function commitRepairImport(a,targetId,kind='link'){
  return a.run('accountantCommitImport(repairImportPreview.rows,{[repairImportPreview.rows[0].id]:{kind:'+JSON.stringify(kind)+',targetId:'+JSON.stringify(targetId)+',reason:"Сверено по синтетическому первичному документу"}},{...repairImportPreview,file:"synthetic-repair.csv"})');
}

for(const mode of ['demo','working']){
  test(mode+': mechanic-first import retains both sources and counts a confirmed repair expense once after reload and repeat import',()=>{
    const a=setup(mode),initial=a.state(),protectedBefore=protectedEntries(a),form=open(a);
    a.submit(form,form.values);
    const repairOp=assertCompleted(a,initial),beforeImport=a.state();
    const parsed=previewRepairImport(a);
    assert.equal(parsed.rows.length,1);assert.equal(parsed.review.length,1);assert.deepEqual(parsed.errors,[]);
    const blocked=a.run('accountantCommitImport(repairImportPreview.rows,{},repairImportPreview)');
    assert.equal(blocked.ok,false);assert.deepEqual(a.state(),beforeImport);
    const outcome=commitRepairImport(a,repairOp.id);
    assert.equal(outcome.ok,true);assert.equal(outcome.added,1);
    assertTotals(a,950,987);
    const state=a.state(),row=state.operations.at(-1);
    assert.equal(row.source,'excel-demo');assert.equal(row.expenseMatch.operationId,repairOp.id);
    assert.equal(row.importFileHash,'sha256-synthetic-repair-file');assert.equal(row.importSheet,'CSV');
    assert.equal(row.importLine,2);assert.equal(row.importDocument,'ТЕСТ-001');assert.equal(row.importDocumentId,'test-document-001');
    assert.equal(row.importDocumentLine,'line-1');assert.equal(row.repairReference,'service-101');
    assert.deepEqual(state.operations.slice(0,-1),beforeImport.operations);
    assert.deepEqual(state.stock,beforeImport.stock);assert.deepEqual(state.stockMoves,beforeImport.stockMoves);
    assert.deepEqual(state.maintenance,beforeImport.maintenance);
    assert.equal(state.accountantImports.at(-1).total,950);assert.equal(state.accountantImports.at(-1).countedTotal,0);
    assert.deepEqual(protectedEntries(a),protectedBefore);
    const reloaded=a.reload();reloaded.run("period='all';");assert.deepEqual(reloaded.state(),state);assertTotals(reloaded,950,987);
    const repeated=previewRepairImport(reloaded);
    assert.equal(repeated.rows.length,0);assert.equal(repeated.processed.length,1);
    const repeatOutcome=reloaded.run('accountantCommitImport(repairImportPreview.rows,{},repairImportPreview)');
    assert.equal(repeatOutcome.ok,true);assert.equal(repeatOutcome.added,0);assert.equal(repeatOutcome.processed,1);
    assert.equal(reloaded.state().operations.length,state.operations.length);assertTotals(reloaded,950,987);
  });

  test(mode+': mechanic-first linked import failure preserves source records and retry reloads without another stock issue',()=>{
    const a=setup(mode),form=open(a);a.submit(form,form.values);
    const repairOp=a.state().operations.at(-1),parsed=previewRepairImport(a),before=a.state(),stored=[...a.storage],writes=a.writes.length;
    assert.equal(parsed.review.length,1);
    a.control.failWrites=true;
    const failed=commitRepairImport(a,repairOp.id);
    assert.equal(failed.ok,false);assert.match(failed.error,/Не удалось сохранить/);
    assert.deepEqual(a.state(),before);assert.deepEqual([...a.storage],stored);assert.equal(a.writes.length,writes);
    assert.deepEqual(a.reload().state(),before);
    a.control.failWrites=false;
    const success=commitRepairImport(a,repairOp.id);
    assert.equal(success.ok,true);assert.equal(a.writes.length,writes+1);assertTotals(a,950,987);
    assert.deepEqual(a.state().stockMoves,before.stockMoves);assert.deepEqual(a.state().stock,before.stock);
    assert.deepEqual(a.state().maintenance,before.maintenance);
    const reloaded=a.reload();reloaded.run("period='all';");assert.deepEqual(reloaded.state(),a.state());assertTotals(reloaded,950,987);
  });

  test(mode+': mechanic-first similar accounting expense stays independent when a different real operation is confirmed',()=>{
    const a=setup(mode),form=open(a);a.submit(form,form.values);
    const original=a.state(),repairOp=original.operations.at(-1);
    previewRepairImport(a);
    const outcome=commitRepairImport(a,repairOp.id,'distinct');
    assert.equal(outcome.ok,true);assertTotals(a,1900,1937);
    const newRow=a.state().operations.at(-1);
    assert.equal(newRow.expenseMatch,undefined);assert.ok(newRow.expenseDistinct.ids.includes(repairOp.id));
    assert.deepEqual(a.state().operations.slice(0,-1),original.operations);
  });

  test(mode+': accountant-first repair requires confirmation and a linked full expense counts once after reload',()=>{
    const a=setup(mode,[imported()]),before=a.state(),protectedBefore=protectedEntries(a),writes=a.writes.length;
    const form=open(a);
    a.submit(form,form.values);
    assert.equal(repair(a).status,'progress','Similar figures alone must not close or merge the repair');
    assert.deepEqual(a.state(),before);
    assert.match(a.form('#form-error').textContent,/Выберите|сверк|основан/i);
    a.submit(form,{...form.values,financeDecision:'link',financeTarget:'booked',financeReason:'Сверено с первичным документом'});
    const op=assertCompleted(a,before);
    assert.equal(op.expenseMatch.operationId,'booked');
    assert.equal(a.writes.length,writes+1);
    assertTotals(a,950,987);
    assert.deepEqual(protectedEntries(a),protectedBefore);
    const reloaded=a.reload();reloaded.run("period='all';");
    assert.deepEqual(reloaded.state(),a.state());assertTotals(reloaded,950,987);
  });

  test(mode+': equal date amount and machine remain separate expenses after explicit distinct confirmation',()=>{
    const a=setup(mode,[imported()]),before=a.state(),form=open(a);
    a.submit(form,{...form.values,financeDecision:'distinct',financeReason:'Другой заказ-наряд, отдельная работа'});
    const op=assertCompleted(a,before);
    assert.equal(op.expenseMatch,undefined);
    assert.ok(op.expenseDistinct.ids.includes('booked'));
    assertTotals(a,1900,1937);
    const reloaded=a.reload();reloaded.run("period='all';");assertTotals(reloaded,1900,1937);
  });

  test(mode+': several matching expenses need an explicit target and preserve all original operations',()=>{
    const a=setup(mode,[imported('candidate-a'),imported('candidate-b')]),before=a.state(),form=open(a);
    a.submit(form,form.values);
    assert.deepEqual(a.state(),before);
    assert.match(a.form('#repair-finance-review').innerHTML,/candidate-a/);
    assert.match(a.form('#repair-finance-review').innerHTML,/candidate-b/);
    a.submit(form,{...form.values,financeDecision:'link',financeTarget:'candidate-b',financeReason:'Сверка подтверждает второй документ'});
    const op=assertCompleted(a,before);
    assert.equal(op.expenseMatch.operationId,'candidate-b');
    assertTotals(a,1900,1937);
  });

  test(mode+': a partial accounting amount cannot suppress the whole repair and leaves stock unchanged',()=>{
    const a=setup(mode,[imported('partial',{amount:850})]),before=a.state(),form=open(a);
    a.submit(form,{...form.values,financeDecision:'link',financeTarget:'partial',financeReason:'Проверка частичного расхода'});
    assert.deepEqual(a.state(),before);
    assert.equal(repair(a).status,'progress');
    assert.match(a.form('#form-error').textContent,/полный расход|сумм|назначен/i);
    a.submit(form,{...form.values,financeDecision:'distinct',financeReason:'Разные подтверждённые хозяйственные операции'});
    assertCompleted(a,before);assertTotals(a,1800,1837);
  });

  test(mode+': warehouse procurement remains outside repair matching and its recognition policy stays unchanged',()=>{
    const a=setup(mode,[imported('warehouse',{machine:'',allocation:'warehouse'})]),before=a.state(),form=open(a);
    assert.equal(a.form('#repair-finance-review').innerHTML,'');
    a.submit(form,form.values);
    const op=assertCompleted(a,before);
    assert.equal(op.expenseMatch,undefined);
    assert.equal(op.expenseDistinct,undefined);
    assertTotals(a,950,987);
    assert.equal(a.state().operations.find(x=>x.id==='warehouse').allocation,'warehouse');
  });

  test(mode+': failed linked repair save rolls back all records and same-form retry commits once and survives reload',()=>{
    const a=setup(mode,[imported()]),before=a.state(),originalStorage=[...a.storage],protectedBefore=protectedEntries(a),writes=a.writes.length;
    const form=open(a,{financeDecision:'link',financeTarget:'booked',financeReason:'Первичный документ подтверждён'});
    a.control.failWrites=true;a.submit(form,form.values);
    assert.deepEqual(a.state(),before);
    assert.deepEqual([...a.storage],originalStorage);
    assert.equal(a.writes.length,writes);
    assert.ok(a.modalOpen());
    assert.match(a.form('#form-error').textContent,/Не удалось сохранить/);
    assert.deepEqual(a.reload().state(),before);
    a.control.failWrites=false;a.submit(form,form.values);
    assertCompleted(a,before);assertTotals(a,950,987);
    assert.equal(a.writes.length,writes+1);
    assert.deepEqual(protectedEntries(a),protectedBefore);
    const committed=a.state();
    a.submit(form,form.values);
    assert.deepEqual(a.state(),committed);assert.equal(a.writes.length,writes+1);
    const reloaded=a.reload();reloaded.run("period='all';");
    assert.deepEqual(reloaded.state(),committed);assertTotals(reloaded,950,987);
  });
}
