const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser,demonstrationState,keys}=require('./fixtures/browser-app.cjs');

const stamp='2026-11-07';
const requestValues={
  customer:'Тестовый заказчик: сохранение',object:'Коммунарка',comment:'Синтетическая заявка',
  contact:'Тестовый контакт',phone:'',followup:'Не уточняли',arrival:'Запланирована',
  dispatchStage:'Назначена',status:'Назначена',changeReason:'Проверка сохранения'
};
const shiftValues={machine:'M010',date:stamp,hours:'8',meter:'2088',condition:'ok',note:'Тестовая смена'};

function setup(mode,prepare=()=>{}){
  const data=demonstrationState();
  data.recordAudit=[{shiftId:'unrelated-shift',reason:'Ранее сохранённая тестовая запись'}];
  data.persistenceSentinel={id:'previous-record',text:'Должна сохраниться без изменений'};
  prepare(data);
  const protectedData=demonstrationState();protectedData.persistenceSentinel={id:'inactive-dataset'};
  const active=mode==='demo'?keys.demo:keys.working;
  const inactive=mode==='demo'?keys.working:keys.demo;
  const storage=new Map([
    [active,JSON.stringify(data)],
    [inactive,JSON.stringify(protectedData)],
    [keys.legacy,'Предыдущий синтетический архив: оставить исходные байты'],
    [keys.archive,'Синтетическая копия до очистки: оставить исходные байты']
  ]);
  return browser({mode,storage});
}

const scenarios=[
  {
    name:'manager creates a request',
    open(a){
      a.run("role='dispatcher';requestModal();");
      a.requestItems([{machine:'M007',operator:'Иван Петров',start:'2026-11-20T08:00',end:'2026-11-21T18:00'}]);
      return {form:a.form('#request-form'),values:{...requestValues}};
    },
    verify(a,before){
      const state=a.state();assert.equal(state.equipmentRequests.length,before.equipmentRequests.length+1);
      const saved=state.equipmentRequests.at(-1);
      assert.equal(saved.customer,requestValues.customer);assert.equal(saved.items[0].machine,'M007');
      assert.equal(saved.history.length,1);
      assert.deepEqual(state.equipmentRequests.slice(0,-1),before.equipmentRequests);
    },
    success:/Заявка сохранена/
  },
  {
    name:'manager edits an existing request and history',
    open(a){
      a.run("role='dispatcher';requestModal('req-0001');");
      const old=a.state().equipmentRequests.find(r=>r.id==='req-0001');a.requestItems(old.items);
      return {form:a.form('#request-form'),values:{...requestValues,comment:'Изменённое тестовое назначение'}};
    },
    verify(a,before){
      const state=a.state(),saved=state.equipmentRequests.find(r=>r.id==='req-0001');
      const old=before.equipmentRequests.find(r=>r.id==='req-0001');
      assert.equal(state.equipmentRequests.length,before.equipmentRequests.length);
      assert.equal(saved.customer,requestValues.customer);assert.equal(saved.history.length,old.history.length+1);
      assert.deepEqual(state.equipmentRequests.filter(r=>r.id!==saved.id),before.equipmentRequests.filter(r=>r.id!==saved.id));
    },
    success:/Заявка сохранена/
  },
  ...['ok','issue'].map(condition=>({
    name:'creates a shift'+(condition==='issue'?' with a linked repair':''),
    open(a){a.run("role='mechanic';shiftModal();");return {form:a.form('#shift-form'),values:{...shiftValues,condition}};},
    verify(a,before){
      const state=a.state(),saved=state.shifts.at(-1);
      assert.equal(state.shifts.length,before.shifts.length+1);assert.equal(saved.status,'pending');
      assert.equal(saved.machine,'M010');assert.equal(saved.hours,8);assert.equal(saved.meter,2088);
      assert.deepEqual(state.shifts.slice(0,-1),before.shifts);
      const repairs=state.maintenance.filter(r=>r.sourceShift===saved.id);
      assert.equal(repairs.length,condition==='issue'?1:0);
      assert.equal(state.maintenance.length,before.maintenance.length+(condition==='issue'?1:0));
      if(condition==='issue')assert.equal(saved.repairId,repairs[0].id);
    },
    success:/Смена отправлена/
  })),
  {
    name:'edits a returned shift and its linked repair',
    prepare(data){
      data.shifts.find(s=>s.id==='shift-102').status='returned';
      data.maintenance.push({id:'linked-existing-repair',machine:'M002',sourceShift:'shift-102',
        type:'Тестовое замечание',date:stamp,status:'new',note:'Прежнее замечание',blocking:false});
    },
    open(a){
      a.run("role='mechanic';shiftModal('shift-102');");
      return {form:a.form('#shift-form'),values:{...shiftValues,machine:'M002',meter:'3832',condition:'issue',note:'Уточнённое тестовое замечание'}};
    },
    verify(a,before){
      const state=a.state(),saved=state.shifts.find(s=>s.id==='shift-102');
      assert.equal(state.shifts.length,before.shifts.length);assert.equal(saved.status,'pending');
      assert.equal(saved.note,'Уточнённое тестовое замечание');assert.equal(saved.repairId,'linked-existing-repair');
      assert.equal(state.maintenance.length,before.maintenance.length);
      const repair=state.maintenance.find(r=>r.id==='linked-existing-repair');
      const old=before.maintenance.find(r=>r.id==='linked-existing-repair');
      assert.equal(repair.note,saved.note);assert.equal(repair.history.length,old.history.length+1);
    },
    success:/Смена отправлена/
  },
  {
    name:'approves a shift and assigns one waybill number',
    open(a){a.run("role='mechanic';");return {act:()=>a.run("approveShift('shift-102')")};},
    verify(a,before){
      const state=a.state(),saved=state.shifts.find(s=>s.id==='shift-102');
      assert.equal(saved.status,'approved');assert.equal(saved.waybill,'ПЛ-0005');assert.ok(saved.approvedAt);
      assert.equal(state.shifts.length,before.shifts.length);
      assert.deepEqual(state.shifts.filter(s=>s.id!==saved.id),before.shifts.filter(s=>s.id!==saved.id));
    },
    success:/Смена утверждена/
  },
  {
    name:'returns a pending shift with a reason',
    open(a){a.run("role='mechanic';returnShiftModal('shift-102');");return {form:a.form('#return-form'),values:{reason:'Тест: исправьте описание'}};},
    verify(a,before){
      const state=a.state(),saved=state.shifts.find(s=>s.id==='shift-102');
      assert.equal(saved.status,'returned');assert.equal(saved.returnNote,'Тест: исправьте описание');
      assert.equal(state.shifts.length,before.shifts.length);
      assert.deepEqual(state.shifts.filter(s=>s.id!==saved.id),before.shifts.filter(s=>s.id!==saved.id));
    },
    success:/Смена возвращена/
  },
  {
    name:'edits an approved shift and saves its audit atomically',
    open(a){a.run("role='mechanic';recordEditModal('shift-104');");return {form:a.form('#record-edit-form'),values:{hours:'7',meter:'1257',note:'Уточнённая смена',reason:'Тестовая сверка'}};},
    verify(a,before){
      const state=a.state(),saved=state.shifts.find(s=>s.id==='shift-104');
      assert.equal(saved.hours,7);assert.equal(saved.meter,1257);assert.equal(saved.note,'Уточнённая смена');
      assert.equal(saved.waybill,'ПЛ-0002');assert.equal(saved.status,'approved');
      assert.equal(state.recordAudit.length,before.recordAudit.length+1);
      assert.deepEqual(state.recordAudit.slice(0,-1),before.recordAudit);
      assert.equal(state.recordAudit.at(-1).shiftId,saved.id);assert.equal(state.recordAudit.at(-1).reason,'Тестовая сверка');
      assert.equal(state.recordAudit.at(-1).before.hours,8);assert.equal(state.recordAudit.at(-1).after.hours,7);
    },
    success:/Исправления сохранены/
  },
  ...['receipt','issue'].map(kind=>({
    name:'records stock '+kind,
    open(a){a.run("role='mechanic';stockModal();");return {form:a.form('#stock-form'),values:{part:'part-1',kind,qty:'1',machine:kind==='issue'?'M002':'',date:stamp,note:'Тестовое движение'}};},
    verify(a,before){
      const state=a.state();assert.equal(state.stockMoves.length,before.stockMoves.length+1);
      const saved=state.stockMoves.at(-1);assert.equal(saved.kind,kind);assert.equal(saved.qty,1);
      assert.equal(saved.machine,kind==='issue'?'M002':'');
      assert.equal(state.stock.find(p=>p.id==='part-1').qty,before.stock.find(p=>p.id==='part-1').qty+(kind==='receipt'?1:-1));
      assert.deepEqual(state.stockMoves.slice(0,-1),before.stockMoves);
      assert.deepEqual(state.operations,before.operations);
    },
    success:kind==='receipt'?/Поступление добавлено/:/Запчасти выданы/
  }))
];

function act(a,action){if(action.act)action.act();else a.submit(action.form,action.values);}
function protectedEntries(a){return Object.fromEntries([...a.storage].filter(([key])=>key!==a.activeKey()));}
function assertProtected(a,before){
  assert.deepEqual(protectedEntries(a),before);
  assert.ok(a.writes.every(w=>w.key===a.activeKey()),'Only the selected dataset may be written');
}
function assertPreserved(a,before){
  const state=a.state();assert.deepEqual(state.persistenceSentinel,before.persistenceSentinel);
  assert.deepEqual(state.operations,before.operations,'Existing finance must remain unchanged');
  assert.deepEqual(state.objects,before.objects,'Object catalogs must remain unchanged');
  const withoutStatus=rows=>rows.map(({status,...record})=>record);
  assert.deepEqual(withoutStatus(state.machines),withoutStatus(before.machines),'Machine cards must remain unchanged');
  assert.deepEqual(state.stockMoves.slice(0,before.stockMoves.length),before.stockMoves,'Earlier stock movements must remain unchanged');
}

for(const mode of ['demo','working'])for(const scenario of scenarios){
  test(mode+': '+scenario.name+' survives a fresh page load',()=>{
    const a=setup(mode,scenario.prepare),action=scenario.open(a),before=a.state(),protectedBefore=protectedEntries(a);
    const writes=a.writes.length;
    act(a,action);scenario.verify(a,before);assertPreserved(a,before);
    assert.equal(a.writes.length,writes+1,'One successful write commits the action');
    assert.ok(a.messages.some(m=>scenario.success.test(m)),'Success must follow a successful save');
    if(action.form)assert.equal(a.modalOpen(),false);
    assertProtected(a,protectedBefore);
    const reloaded=a.reload();scenario.verify(reloaded,before);assertPreserved(reloaded,before);
    assert.deepEqual(reloaded.state(),a.state(),'Reload must read the committed state');
    assertProtected(reloaded,protectedBefore);
  });

  test(mode+': '+scenario.name+' rolls back a failed write and can retry',()=>{
    const a=setup(mode,scenario.prepare),action=scenario.open(a),before=a.state();
    const originalStorage=[...a.storage],protectedBefore=protectedEntries(a),writes=a.writes.length;
    a.control.failWrites=true;act(a,action);
    assert.deepEqual(a.state(),before,'All related records and counters must roll back');
    assert.deepEqual([...a.storage],originalStorage,'A failed write must preserve the exact saved bytes');
    assert.equal(a.writes.length,writes);
    assert.ok(!a.messages.some(m=>scenario.success.test(m)),'No success message is allowed after a failed write');
    const notices=[...a.messages,a.form('#form-error').textContent];
    assert.ok(notices.some(m=>/не удалось|заблокирован|сохраните исходный/i.test(m)),'The user must receive a visible save error');
    if(action.form)assert.ok(a.modalOpen(),'Keep the form open with entered values after failure');
    assertProtected(a,protectedBefore);
    const afterFailure=a.reload();
    assert.deepEqual(afterFailure.state(),before,'Reload after failure must retain the previously saved data');
    a.control.failWrites=false;act(a,action);
    scenario.verify(a,before);assertPreserved(a,before);
    assert.equal(a.writes.length,writes+1,'Retry must commit exactly once');
    assert.ok(a.messages.some(m=>scenario.success.test(m)));
    if(action.form)assert.equal(a.modalOpen(),false);
    assertProtected(a,protectedBefore);
    const reloaded=a.reload();scenario.verify(reloaded,before);
    assert.deepEqual(reloaded.state(),a.state(),'A successful retry must survive reload');
  });
}

test('Unreadable existing demo bytes cannot be overwritten by request, shift or stock actions',()=>{
  const raw='{broken original demo bytes';
  const a=browser({storage:new Map([[keys.demo,raw],[keys.working,'unchanged working bytes'],[keys.legacy,'unchanged archive bytes']])});
  assert.equal(a.run('storageLoadError'),true);
  const original=[...a.storage];
  for(const name of ['manager creates a request','approves a shift and assigns one waybill number','records stock issue']){
    const scenario=scenarios.find(s=>s.name===name),action=scenario.open(a),before=a.state();
    act(a,action);assert.deepEqual(a.state(),before);assert.deepEqual([...a.storage],original);
    assert.ok(!a.messages.some(m=>scenario.success.test(m)));
  }
});
