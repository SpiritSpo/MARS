const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser,demonstrationState,keys}=require('./fixtures/browser-app.cjs');

function expense(id,extra={}){
 return {id,machine:'M001',kind:'expense',allocation:'machine',date:'2026-11-07',
  category:'Ремонт и ТО',amount:100,note:'Синтетический расход '+id,...extra};
}
function setup(mode='demo',operations=[]){
 const data=demonstrationState();data.operations=structuredClone(operations);
 const active=mode==='demo'?keys.demo:keys.working;
 const inactive=mode==='demo'?keys.working:keys.demo;
 const a=browser({mode,storage:new Map([
  [active,JSON.stringify(data)],[inactive,'Неактивные записи оставить без изменений'],
  [keys.legacy,'Прежние записи пользователя'],[keys.archive,'Исходный архив']
 ])});
 a.run("role='director';period='all';");
 return a;
}
const totals=a=>a.json('overallFinance()');
const storedOthers=a=>[...a.storage].filter(([key])=>key!==a.activeKey());

test('Machine matching resolves internal, inventory and actual registration aliases with normalized letters',()=>{
 const a=setup();
 a.run("Object.assign(machine('M001'),{inventoryNumber:'ИНВ-001',registration:'А 123 ВС 77',serial:'SN-001',vin:'VIN-001'});");
 for(const value of ['M001','м 001','m-001','ИНВ 001','A123BC77','а-123-вс-77','sn 001','vin_001']){
  assert.equal(a.run('financeMachineId('+JSON.stringify(value)+')'),'M001',value);
 }
 assert.equal(a.run('financeMachineId("")'),'');
 assert.equal(a.run('financeMachineId("unknown-machine")'),'');
});

test('An alias shared by two machines is ambiguous and cannot create a confirmed expense link',()=>{
 const a=setup();
 a.run("machine('M001').registration='А123ВС77';machine('M002').registration='A 123 BC 77';");
 assert.equal(a.run('financeMachineId("A123BC77")'),'');
 a.run('state.operations='+JSON.stringify([expense('one',{machine:'A123BC77'}),expense('two')])+';');
 assert.equal(a.run('financeCanLink(state.operations[0],state.operations[1])'),false);
 assert.equal(a.run('financeMachineId("M001")'),'M001','Internal IDs remain authoritative');
});

for(const mode of ['demo','working']){
 test(mode+': similar legacy expenses remain separate and unchanged until a user confirms a match',()=>{
  const first=expense('first',{note:'Одинаковое описание'}),second=expense('second',{note:'Одинаковое описание'});
  const a=setup(mode,[first,second]),before=a.state(),bytes=[...a.storage];
  assert.deepEqual(a.json('financeReviewCandidates(state.operations[1]).map(o=>o.id)'),['first']);
  assert.equal(a.run('financeIsCounted(state.operations[0])'),true);
  assert.equal(a.run('financeIsCounted(state.operations[1])'),true);
  assert.deepEqual(totals(a),{income:0,expense:200});
  assert.match(a.run('financePageHtml()'),/Одинаковое описание/);
  assert.deepEqual(a.state(),before,'Candidate detection and rendering never migrate or remove old records');
  assert.deepEqual([...a.storage],bytes);
 });

 test(mode+': an explicit confirmed expense link reconciles company, machine and efficiency while retaining both sources',()=>{
  const income={id:'income',kind:'income',date:'2026-11-07',machine:'M001',category:'Работа',amount:1000,note:'Тестовая выручка'};
  const a=setup(mode,[expense('mechanic',{sourceRepair:'repair-test',note:'Источник механика'}),expense('accountant',{source:'excel-demo',note:'Источник бухгалтера'}),income]);
  const otherBytes=storedOthers(a),before=a.state();
  assert.equal(a.run("financeApplyDecision(state.operations[1],{kind:'link',targetId:'mechanic',reason:'Один подтверждённый документ'})"),'');
  assert.equal(a.run('state.operations.length'),3);
  assert.deepEqual(a.json('state.operations[0]'),before.operations[0]);
  assert.equal(a.run('financeIsCounted(state.operations[1])'),false);
  assert.deepEqual(totals(a),{income:1000,expense:100});
  assert.deepEqual(a.json("sums([machine('M001')])"),{income:1000,expense:100});
  assert.equal(a.run("result(machine('M001'))"),900);
  assert.equal(a.run("machineOps('M001').length"),2);
  assert.match(a.run('efficiencyPage()'),/900/);
  assert.match(a.run("passportFinance(machine('M001'),sums([machine('M001')]))"),/900/);
  const journal=a.run('financePageHtml()');
  assert.match(journal,/Источник механика/);
  assert.match(journal,/Источник бухгалтера/,'Raw source row stays available in the journal');
  assert.equal(a.run('persist()'),true);
  const reloaded=a.reload();reloaded.run("period='all';");
  assert.deepEqual(reloaded.state(),a.state());
  assert.deepEqual(totals(reloaded),{income:1000,expense:100});
  assert.deepEqual(storedOthers(a),otherBytes);
 });

 test(mode+': independent-operation approval is invalidated when either operation economics changes',()=>{
  const a=setup(mode,[expense('old',{sourceRepair:'repair-test'}),expense('new')]);
  assert.equal(a.run("financeApplyDecision(state.operations[1],{kind:'distinct',reason:'Разные документы и работы'})"),'');
  assert.deepEqual(a.json('financeReviewCandidates(state.operations[1]).map(o=>o.id)'),[]);
  assert.deepEqual(totals(a),{income:0,expense:200});
  a.run('state.operations[0].amount=120;');
  assert.deepEqual(a.json('financeReviewCandidates(state.operations[1]).map(o=>o.id)'),['old']);
  a.run('state.operations[0].amount=100;state.operations[1].amount=130;');
  assert.deepEqual(a.json('financeReviewCandidates(state.operations[1]).map(o=>o.id)'),['old']);
 });

 test(mode+': moving an approved independent operation to another machine requires reviewing its new matches',()=>{
  const a=setup(mode,[expense('old'),expense('new'),expense('other-machine',{machine:'M002'})]);
  assert.equal(a.run("financeApplyDecision(state.operations[1],{kind:'distinct',reason:'Самостоятельная работа'})"),'');
  a.run("state.operations[1].machine='M002';");
  assert.deepEqual(a.json('financeReviewCandidates(state.operations[1]).map(o=>o.id)'),['other-machine']);
 });

 test(mode+': partial amounts and warehouse procurement cannot be suppressed as one complete repair expense',()=>{
  const a=setup(mode,[expense('repair',{sourceRepair:'repair-test'}),expense('partial',{amount:40}),expense('warehouse',{machine:'',allocation:'warehouse',amount:60})]);
  assert.equal(a.run('financeCanLink(state.operations[1],state.operations[0])'),false);
  assert.equal(a.run('financeCanLink(state.operations[2],state.operations[0])'),false);
  assert.equal(a.run('financeCanLink(state.operations[0],state.operations[2])'),false);
  assert.deepEqual(totals(a),{income:0,expense:140},'Warehouse purchase stays outside company result until use');
  assert.deepEqual(a.json("sums([machine('M001')])"),{income:0,expense:140});
  const before=a.state();
  assert.match(a.run("financeApplyDecision(state.operations[1],{kind:'link',targetId:'repair',reason:'Только часть документа'})"),/полный расход|сумм/);
  assert.deepEqual(a.state(),before,'Rejected reconciliation must not change provenance or amounts');
 });

 test(mode+': missing targets, cycles, self-links and cross-machine links remain counted instead of hiding expenses',()=>{
  const cases=[
   [expense('missing',{expenseMatch:{confirmed:true,operationId:'absent'}})],
   [expense('self',{expenseMatch:{confirmed:true,operationId:'self'}})],
   [expense('a',{expenseMatch:{confirmed:true,operationId:'b'}}),expense('b',{expenseMatch:{confirmed:true,operationId:'a'}})],
   [expense('a',{expenseMatch:{confirmed:true,operationId:'b'}}),expense('b',{machine:'M002'})],
   [expense('a',{expenseMatch:{confirmed:true,operationId:'b'}}),expense('b',{amount:50})],
   [expense('a',{expenseMatch:{confirmed:false,operationId:'b'}}),expense('b')]
  ];
  for(const rows of cases){
   const a=setup(mode,rows),before=a.state();
   assert.ok(a.json('state.operations.map(financeIsCounted)').every(Boolean));
   assert.equal(totals(a).expense,rows.reduce((sum,row)=>sum+row.amount,0));
   assert.deepEqual(a.state(),before);
  }
 });

 test(mode+': confirmed link chains collapse to one canonical expense and reject a cycle-producing decision',()=>{
  const a=setup(mode,[expense('root'),expense('middle'),expense('leaf')]);
  assert.equal(a.run("financeApplyDecision(state.operations[1],{kind:'link',targetId:'root',reason:'Подтверждено'})"),'');
  assert.equal(a.run("financeApplyDecision(state.operations[2],{kind:'link',targetId:'middle',reason:'Тот же документ'})"),'');
  assert.equal(a.run('state.operations[2].expenseMatch.operationId'),'root');
  assert.equal(a.run('financeExpenseRoot(state.operations[2]).id'),'root');
  assert.deepEqual(totals(a),{income:0,expense:100});
  assert.equal(a.run('financeCanLink(state.operations[0],state.operations[2])'),false);
 });

 test(mode+': persisted compatible link chains preserve the root even when intermediate machine aliases differ',()=>{
  const a=setup(mode,[expense('root'),expense('middle',{machine:'м 001',expenseMatch:{confirmed:true,operationId:'root'}}),expense('leaf',{machine:'M-001',expenseMatch:{confirmed:true,operationId:'middle'}})]);
  const before=a.state();
  assert.equal(a.run('financeExpenseRoot(state.operations[2]).id'),'root');
  assert.deepEqual(totals(a),{income:0,expense:100});
  assert.equal(a.run("sums([machine('M001')]).expense"),100);
  assert.deepEqual(a.state(),before,'Reading an older chain must not rewrite its provenance');
 });

 test(mode+': a linked source retains candidate evidence even if its counted root belongs to an earlier month',()=>{
  const a=setup(mode,[expense('root',{date:'2026-10-01'}),expense('bridge',{date:'2026-11-07',expenseMatch:{confirmed:true,operationId:'root'}}),expense('new',{date:'2026-11-07'})]);
  assert.deepEqual(a.json('financeReviewCandidates(state.operations[2]).map(o=>o.id)'),['root'],'Compare new sources with original linked evidence while proposing the counted root');
 });

 test(mode+': one import batch can confirm a source against an earlier root and another source against that first row',()=>{
  const a=setup(mode,[expense('old-root',{date:'2026-10-01',sourceRepair:'repair-test'})]);
  const rows=[['Дата','Техника','Статья','Сумма','Комментарий','Ремонт'],
   ['2026-11-07','M001','Ремонт и ТО','100','Первая строка источника','repair-test'],
   ['2026-11-07','M001','Прочие расходы','100','Вторая строка источника','']];
  a.run("role='accountant';globalThis.chainImport=accountantParseRows("+JSON.stringify(rows)+",{fileHash:'chain-file',file:'chain.csv',sheet:'CSV'});");
  assert.deepEqual(a.json('chainImport.review.map(r=>r.candidates.map(o=>o.id))'),[['old-root'],[a.run('chainImport.rows[0].id')]]);
  const response=a.run("accountantCommitImport(chainImport.rows,{[chainImport.rows[0].id]:{kind:'link',targetId:'old-root',reason:'Расход ранее признан'},[chainImport.rows[1].id]:{kind:'link',targetId:chainImport.rows[0].id,reason:'Тот же расход в другом источнике'}},chainImport)");
  assert.equal(response.ok,true,response.error);
  assert.equal(response.added,2);
  assert.equal(a.run('state.operations.length'),3);
  assert.deepEqual(a.json('state.operations.slice(1).map(o=>o.expenseMatch.operationId)'),['old-root','old-root']);
  assert.deepEqual(totals(a),{income:0,expense:100});
  const reloaded=a.reload();reloaded.run("period='all';");
  assert.deepEqual(totals(reloaded),{income:0,expense:100});
 });

 test(mode+': expense reconciliation never suppresses revenue or changes warehouse recognition',()=>{
  const income={id:'income',machine:'M001',kind:'income',date:'2026-11-07',amount:1000,category:'Выручка',note:'Синтетическая выручка',expenseMatch:{confirmed:true,operationId:'cost'}};
  const a=setup(mode,[income,expense('cost'),expense('warehouse',{machine:'',allocation:'warehouse',amount:500})]);
  assert.equal(a.run('financeIsCounted(state.operations[0])'),true);
  assert.equal(a.run('financeCanLink(state.operations[0],state.operations[1])'),false);
  assert.equal(a.run('financeCanLink(state.operations[1],state.operations[0])'),false);
  assert.deepEqual(totals(a),{income:1000,expense:100});
  assert.equal(a.run("result(machine('M001'))"),900);
 });

 test(mode+': an explicitly linked expense is recognized in the selected canonical operation period',()=>{
  const a=setup(mode,[expense('november',{date:'2026-11-07'}),expense('december',{date:'2026-12-01'})]);
  assert.equal(a.run("financeApplyDecision(state.operations[1],{kind:'link',targetId:'november',reason:'Счёт получен позже, расход уже признан'})"),'');
  a.run("period='2026-11';");assert.equal(totals(a).expense,100);
  a.run("period='2026-12';");assert.equal(totals(a).expense,0);
  assert.equal(a.run('operations().length'),1,'Later source record remains available in its own period');
  assert.equal(a.run('financialData().expensePresent'),false,'Presence flags agree with counted totals');
  a.run("period='all';");assert.equal(totals(a).expense,100);
 });

 test(mode+': dashboard month comparison and financial trend use reconciled expenses in earlier months',()=>{
  const income=(id,date,amount)=>({id,machine:'M001',kind:'income',date,amount,category:'Выручка',note:'Синтетическая выручка'});
  const a=setup(mode,[income('old-income','2026-10-07',1000),expense('old-root',{date:'2026-10-07',amount:200}),expense('old-source',{date:'2026-10-08',amount:200}),income('income','2026-11-07',1100),expense('current',{amount:300})]);
  assert.equal(a.run("financeApplyDecision(state.operations[2],{kind:'link',targetId:'old-root',reason:'Расход прошлого месяца уже признан'})"),'');
  a.run("period='2026-11';");
  const html=a.run('dashboardPage()');
  assert.match(html,/↑ 50,0% к предыдущему месяцу/,'300 compares with the canonical 200, not the gross 400');
  assert.doesNotMatch(html,/↓ 25,0% к предыдущему месяцу/);
  const trend=html.slice(html.indexOf('Динамика финансов'));
  assert.ok(trend.includes('Расходы '+a.run('rub(200)')),'October trend shows one recognized expense');
  assert.ok(trend.includes('Расходы '+a.run('rub(300)')),'November trend shows the new independent expense');
  assert.ok(!trend.includes('Расходы '+a.run('rub(400)')),'Earlier source copies must not inflate historical trends');
 });

 test(mode+': finance CSV retains source rows and explicitly exports zero counted amount for a linked copy',()=>{
  const a=setup(mode,[expense('root',{note:'Первый источник'}),expense('copy',{note:'Второй источник'})]);
  assert.equal(a.run("financeApplyDecision(state.operations[1],{kind:'link',targetId:'root',reason:'Одна хозяйственная операция'})"),'');
  a.run("globalThis.testExports=[];download=(name,content,type)=>testExports.push({name,content,type});exportData('finance');");
  const file=a.json('testExports[0]');
  assert.equal(file.type,'text/csv');
  const rows=a.run('accountantParseCSV('+JSON.stringify(file.content)+')');
  const amountColumn=rows[0].indexOf('Сумма, ₽'),countedColumn=rows[0].indexOf('Учтённая сумма, ₽'),statusColumn=rows[0].indexOf('Статус учёта');
  assert.ok(amountColumn>=0&&countedColumn>=0&&statusColumn>=0);
  assert.equal(rows.length,3,'Both preserved source records are exported');
  assert.equal(Number(rows[1][amountColumn]),100);
  assert.equal(Number(rows[2][amountColumn]),100);
  assert.equal(Number(rows[1][countedColumn]),100);
  assert.equal(Number(rows[2][countedColumn]),0);
  assert.match(rows[2][statusColumn],/повторно не учтено/);
 });

 test(mode+': reconciliation provenance preserves malformed histories and prior recovery values',()=>{
  const broken={unexpected:['Исходное содержимое']},older={olderArchive:'Сохранить тоже'};
  const a=setup(mode,[expense('target'),expense('source',{provenanceHistory:broken,provenanceRecovery:older})]);
  assert.equal(a.run("financeApplyDecision(state.operations[1],{kind:'link',targetId:'target',reason:'Первичная сверка'})"),'');
  const operation=a.state().operations[1];
  assert.deepEqual(operation.provenanceRecovery,[{value:older},{value:broken}]);
  assert.equal(operation.provenanceHistory.length,1);
  assert.equal(operation.provenanceHistory[0].action,'expense-reconciliation');
  assert.equal(a.run('persist()'),true);
  assert.deepEqual(a.reload().state(),a.state());
 });
}

for(const mode of ['demo','working'])test(mode+': an explicit repair reference with a different allocation requires review without silently linking',()=>{
 const a=setup(mode,[expense('mechanic',{sourceRepair:'service-101',machine:'M008'}),expense('wrong-allocation',{machine:'M002',source:'excel-demo',repairReference:'service-101'})]);
 assert.deepEqual(a.json('financeReviewCandidates(state.operations[1]).map(o=>o.id)'),['mechanic']);
 assert.equal(a.run('financeCanLink(state.operations[1],state.operations[0])'),false);
 assert.notEqual(a.run("financeApplyDecision(state.operations[1],{kind:'link',targetId:'mechanic',reason:'Проверка назначения'})"),'');
 assert.deepEqual(totals(a),{income:0,expense:200});
});
