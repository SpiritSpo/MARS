const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser,keys}=require('./fixtures/browser-app.cjs');

const managers=['Алексей Иванов','Дмитрий Петров'];
const machineIds=['machine-orbit-1','machine-orbit-2','machine-orbit-3'];
const requestIds=['request-orbit-1','request-orbit-2'];
const managerKey='mars-demo-manager';
const day='2026-11-07';

function request(index,overrides={}){
  return {
    id:requestIds[index],number:'ЗТ-ОРБИТА-'+(index+1),owner:managers[index],
    customer:'Синтетический заказчик '+(index+1),object:'Объект Орбита',
    comment:'Комментарий клиента '+(index+1)+' <важно>',contact:'Контакт клиента '+(index+1),
    phone:'+7 900 000 00 0'+(index+1),status:'Назначена',dispatchStage:'На объекте',
    followup:'Продление согласовано',arrival:'Приступила к работе',releaseConfirmed:false,
    items:[{machine:machineIds[index],operator:'Тестовый машинист '+(index+1),start:day+'T08:00',end:'2026-11-08T17:00'}],
    history:[{by:managers[index],at:'2026-11-05T10:30:00.000Z',action:'Оформление Орбиты '+(index+1),
      reason:'Причина для Орбиты '+(index+1),changes:[{field:'Объект',from:'Прежний объект '+(index+1),to:'Новый объект '+(index+1)}]}],
    ...overrides
  };
}

function data(){
  return {
    version:1,objects:[{id:'object-orbit',name:'Объект Орбита'}],
    machines:machineIds.map((id,index)=>({id,name:'Тестовая техника '+(index+1),type:'Погрузчик',
      object:'object-orbit',operator:'Тестовый машинист '+(index+1),
      registration:'ТЕСТ-РЕГ-'+(index+1),inventory:'ТЕСТ-ИНВ-'+(index+1),status:'free'})),
    equipmentRequests:[request(0),request(1)],maintenance:[],shifts:[],stock:[],stockMoves:[],
    operations:[{id:'expense-orbit-preserved',machine:machineIds[0],kind:'expense',
      amount:1234,date:'2026-11-04',category:'Прочие расходы',note:'Существующий расход: сохранить'}],
    machinePhotos:{},workshopVersion:2,
    persistenceSentinel:{id:'unrelated-orbit-record',note:'Посторонние данные не меняются'}
  };
}

function setup(mode,prepare=()=>{}){
  const state=data();prepare(state);
  const active=mode==='demo'?keys.demo:keys.working;
  const inactive=mode==='demo'?keys.working:keys.demo;
  const protectedData=data();protectedData.persistenceSentinel={id:'inactive-orbit-dataset'};
  const storage=new Map([[active,JSON.stringify(state)],[inactive,JSON.stringify(protectedData)],
    [keys.legacy,'Существующий архив Орбиты'],[keys.archive,'Исходная копия Орбиты'],[managerKey,managers[0]]]);
  const a=browser({mode,storage});
  assert.deepEqual(a.json('demoManagers'),managers,'Use the existing manager identities');
  a.run("role='dispatcher';view='requests';");
  return a;
}

function manager(a,index){a.storage.set(managerKey,managers[index]);a.run("role='dispatcher';");}
const modal=a=>a.form('#modal-root').innerHTML;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const getRequest=(a,id)=>a.state().equipmentRequests.find(r=>r.id===id);
function values(r,overrides={}){
  const {customer,object,comment,contact,phone,followup,arrival,dispatchStage,status}=r;
  return {customer,object,comment,contact,phone,followup,arrival,dispatchStage,status,
    ...(r.releaseConfirmed?{releaseConfirmed:'on'}:{}),changeReason:'Проверенное изменение Орбиты',...overrides};
}

function snapshot(a){return {state:a.state(),storage:[...a.storage],writes:a.writes.length,attempts:a.attempts.length};}
function assertUnchanged(a,before){
  assert.deepEqual(a.state(),before.state,'Viewing or rejecting an action must preserve all records');
  assert.deepEqual([...a.storage],before.storage,'Saved bytes must remain unchanged');
  assert.equal(a.writes.length,before.writes,'No successful storage write');
  assert.equal(a.attempts.length,before.attempts,'No attempted storage write');
}

function assertCloseOnly(html){
  assert.doesNotMatch(html,/<(?:form|input|select|textarea)\b/i,'Read-only details have no edit fields');
  const buttons=html.match(/<button\b[^>]*>/gi)||[];
  assert.ok(buttons.length,'Details must offer Close');
  assert.ok(buttons.every(button=>/\bdata-close(?:-modal)?(?:[\s=>])/.test(button)),
    'Every button must close the read-only details');
  assert.doesNotMatch(html,/data-(?:delete|reassign|status)|type=["']submit["']|Сохранить|Переназначить|Удалить/i);
}

function assertDetails(html,r,state){
  for(const value of [r.number,r.owner,r.customer,r.object,r.comment,r.contact,r.phone,
    r.status,r.dispatchStage,r.followup,r.arrival]){
    assert.ok(html.includes(esc(value)),'Details include '+value);
  }
  assert.match(html,/освобождени|возврат/i,'Show factual release confirmation');
  for(const item of r.items){
    const m=state.machines.find(m=>m.id===item.machine);
    for(const value of [m.name,item.operator,item.start,item.end])assert.ok(html.includes(esc(value)),'Assignment includes '+value);
  }
  assert.match(html,/Журнал изменений/);
  for(const entry of r.history){
    for(const value of [entry.by,entry.action,entry.reason])assert.ok(html.includes(esc(value)),'History includes '+value);
    for(const change of entry.changes)for(const value of [change.field,change.from,change.to])assert.ok(html.includes(esc(value)));
  }
  assert.match(html,/2026/,'History includes its timestamp');
  assert.doesNotMatch(html,/<важно>/,'Escape customer supplied markup');
}

for(const mode of ['demo','working']){
  for(const index of [0,1]){
    test(mode+': manager '+(index+1)+' edits their own request and only reads the other manager’s complete details',()=>{
      const a=setup(mode);manager(a,index);
      const own=getRequest(a,requestIds[index]),foreign=getRequest(a,requestIds[1-index]);
      assert.equal(a.run('canEditRequest('+JSON.stringify(own)+')'),true);
      assert.equal(a.run('canEditRequest('+JSON.stringify(foreign)+')'),false);
      a.run('requestModal('+JSON.stringify(own.id)+')');
      assert.match(modal(a),/<form\b[^>]*id="request-form"/);
      assert.match(modal(a),/type="submit"[^>]*>Сохранить/);
      const form=a.form('#request-form');a.requestItems(own.items);
      const before=a.state();a.submit(form,values(own,{comment:'Изменено владельцем '+(index+1)}));
      const saved=getRequest(a,own.id);
      assert.equal(saved.comment,'Изменено владельцем '+(index+1));
      assert.equal(saved.owner,managers[index]);assert.equal(saved.history.length,own.history.length+1);
      assert.deepEqual(getRequest(a,foreign.id),foreign);
      assert.deepEqual(a.state().operations,before.operations);
      assert.deepEqual(a.reload().state(),a.state(),'Own edit survives reload');

      const readBefore=snapshot(a);a.run('requestModal('+JSON.stringify(foreign.id)+')');
      assert.match(modal(a),/request-details/,'Foreign requests use the dedicated details view');
      assertDetails(modal(a),foreign,a.state());assertCloseOnly(modal(a));assertUnchanged(a,readBefore);
      a.run('closeModal(false)');assertUnchanged(a,readBefore);
    });

    test(mode+': manager '+(index+1)+' can open full read-only details directly without state or storage changes',()=>{
      const a=setup(mode);manager(a,index);const r=getRequest(a,requestIds[1-index]),before=snapshot(a);
      a.run('requestDetails('+JSON.stringify(r.id)+')');
      assertDetails(modal(a),r,a.state());assertCloseOnly(modal(a));assertUnchanged(a,before);
    });
  }

  test(mode+': director can edit requests belonging to either manager',()=>{
    const a=setup(mode);a.run("role='director';");
    for(const id of requestIds){
      const r=getRequest(a,id);assert.equal(a.run('canEditRequest('+JSON.stringify(r)+')'),true);
      a.run('requestModal('+JSON.stringify(id)+')');assert.match(modal(a),/<form\b[^>]*id="request-form"/);
      a.requestItems(r.items);a.submit(a.form('#request-form'),values(r,{comment:'Проверено руководителем: '+id}));
      assert.equal(getRequest(a,id).comment,'Проверено руководителем: '+id);
      assert.equal(getRequest(a,id).owner,r.owner,'Editing does not transfer ownership');
    }
    assert.deepEqual(a.reload().state(),a.state());
  });

  for(const change of ['manager','owner','role','removed'])test(mode+': stale edit rejects a changed '+change+' before mutating or saving',()=>{
    const a=setup(mode),r=getRequest(a,requestIds[0]);
    a.run('requestModal('+JSON.stringify(r.id)+')');const form=a.form('#request-form');a.requestItems(r.items);
    if(change==='manager')manager(a,1);
    if(change==='owner')a.run('state.equipmentRequests[0].owner=demoManagers[1]');
    if(change==='role')a.run("role='mechanic'");
    if(change==='removed')a.run('state.equipmentRequests=state.equipmentRequests.filter(r=>r.id!=='+JSON.stringify(r.id)+')');
    const before=snapshot(a);a.submit(form,values(r,{customer:'Изменение из устаревшей формы'}));
    assertUnchanged(a,before);assert.ok(!a.messages.some(message=>/Заявка сохранена/.test(message)));
  });

  test(mode+': unknown IDs never open a create form or create requests',()=>{
    const a=setup(mode),before=snapshot(a);
    assert.equal(a.run('canEditRequest(null)'),false);assert.equal(a.run('canEditRequest(undefined)'),false);
    for(const role of ['director','dispatcher','mechanic','operator','accountant']){
      a.run('role='+JSON.stringify(role)+';requestModal("request-that-does-not-exist");requestDetails("request-that-does-not-exist");');
      assert.equal(a.modalOpen(),false);assertUnchanged(a,before);
      if(!['director','dispatcher','mechanic'].includes(role)){
        a.run('requestModal('+JSON.stringify(requestIds[0])+');requestDetails('+JSON.stringify(requestIds[0])+')');
        assert.equal(a.modalOpen(),false);assertUnchanged(a,before);
      }
    }
  });

  test(mode+': both managers see both owners in the shared list and calendar with owner badges',()=>{
    const a=setup(mode);
    for(const index of [0,1]){
      manager(a,index);const before=snapshot(a),html=a.run('requestsPage()');
      const tables=[...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)].map(match=>match[0]);
      assert.equal(tables.length,2);
      for(const table of tables)for(const id of requestIds)assert.ok(table.includes('data-request-open="'+id+'"'),'Both requests are visible in each table');
      for(const owner of managers)assert.ok(html.includes(owner));
      assert.match(html,/request-owner-badge/);assert.match(html,/Моя заявка/);assert.match(html,/Другой менеджер/);
      assertUnchanged(a,before);
    }
  });

  test(mode+': a calendar cell preserves both overlapping bookings and its dated repair marker',()=>{
    const a=setup(mode,state=>{
      state.equipmentRequests[1].items[0].machine=machineIds[0];
      state.maintenance=[{id:'repair-orbit',number:'ЗР-ОРБИТА',machine:machineIds[0],kind:'service',
        type:'Плановая проверка Орбиты',note:'Проверка гидравлики',status:'planned',
        planDate:day,dueDate:'2026-11-09',date:'2026-11-06',blocking:false,readyConfirmed:false}];
    });
    const before=snapshot(a),html=a.run('requestsPage()');
    const cells=[...html.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/g)].map(match=>match[0]);
    const cell=cells.find(cell=>cell.includes('data-request-open="'+requestIds[0]+'"')&&cell.includes('data-calendar-repair-day="'+day+'"'));
    assert.ok(cell,'The request and repair share the same dated cell');
    for(const id of requestIds)assert.ok(cell.includes('data-request-open="'+id+'"'),'No double booking is hidden');
    assert.ok(cell.includes('data-calendar-repair-machine="'+machineIds[0]+'"'));
    assertUnchanged(a,before);
    a.run('openCalendarRepairs('+JSON.stringify(machineIds[0])+','+JSON.stringify(day)+')');
    assert.match(modal(a),/Плановая проверка Орбиты/);assertCloseOnly(modal(a));assertUnchanged(a,before);
  });

  test(mode+': renaming displayed machine identifiers preserves request and repair links by stable ID',()=>{
    const a=setup(mode,state=>{
      state.maintenance=[{id:'repair-stable-orbit',number:'ЗР-СТАБИЛЬНАЯ',machine:machineIds[0],
        type:'Проверка стабильной связи',note:'Связь по ID',kind:'service',status:'planned',
        planDate:day,dueDate:'2026-11-09',date:'2026-11-06',blocking:false,readyConfirmed:false}];
    });
    const linked=a.state();
    a.run('Object.assign(machine('+JSON.stringify(machineIds[0])+'),{name:"Новое имя Орбиты",registration:"НОВЫЙ-РЕГ",inventory:"НОВЫЙ-ИНВ",inventoryNumber:"НОВЫЙ-ИНВ-НОМЕР"})');
    const before=snapshot(a),html=a.run('requestsPage()');
    assert.match(html,/Новое имя Орбиты/);assert.ok(html.includes('data-request-open="'+requestIds[0]+'"'));
    assert.ok(html.includes('data-calendar-repair-machine="'+machineIds[0]+'"'));
    a.run('requestDetails('+JSON.stringify(requestIds[0])+')');assert.match(modal(a),/Новое имя Орбиты/);
    a.run('openCalendarRepairs('+JSON.stringify(machineIds[0])+','+JSON.stringify(day)+')');
    assert.match(modal(a),/Проверка стабильной связи/);assert.match(modal(a),/Новое имя Орбиты/);
    assert.deepEqual(a.state().equipmentRequests,linked.equipmentRequests);assert.deepEqual(a.state().maintenance,linked.maintenance);
    assert.deepEqual(a.state().operations,linked.operations,'Finance remains byte-for-byte unchanged');assertUnchanged(a,before);
  });

  for(const history of [undefined,null,{unexpected:'original-history'},[null,'invalid-entry',{at:'invalid date',changes:{original:'preserved'}},
    {by:'Сохраняемый автор',at:'2026-11-04T12:00:00Z',reason:'Сохраняемая причина',changes:[null,'bad',{field:'Сохраняемое поле',from:'Было',to:'Стало'}]}]]){
    test(mode+': read-only request details tolerate '+(Array.isArray(history)?'malformed history entries':history===undefined?'missing history':history===null?'null history':'non-array history')+' without changing imported data',()=>{
      const a=setup(mode,state=>{
        if(history===undefined)delete state.equipmentRequests[1].history;else state.equipmentRequests[1].history=structuredClone(history);
      });
      const before=snapshot(a);a.run('requestModal('+JSON.stringify(requestIds[1])+')');
      assert.match(modal(a),/Журнал изменений/);assertCloseOnly(modal(a));
      if(Array.isArray(history)){assert.match(modal(a),/Сохраняемый автор/);assert.match(modal(a),/Сохраняемая причина/);assert.match(modal(a),/Сохраняемое поле/);}
      assertUnchanged(a,before);
    });
  }

  test(mode+': read-only empty request data does not initialize a missing request collection',()=>{
    const a=setup(mode,state=>{delete state.equipmentRequests;});const before=snapshot(a);
    a.run('requestsPage();managerOverview();requestDetails("missing");requestModal("missing");');
    assertUnchanged(a,before);assert.equal(Object.hasOwn(a.state(),'equipmentRequests'),false);
  });

  test(mode+': an own-request save failure preserves history and the same form can retry changed values after reload',()=>{
    const a=setup(mode),r=getRequest(a,requestIds[0]);a.run('requestModal('+JSON.stringify(r.id)+')');
    const form=a.form('#request-form');a.requestItems(r.items);const before=snapshot(a);
    a.control.failWrites=true;a.submit(form,values(r,{customer:'Неудачная попытка Орбиты',comment:'Не должна остаться в истории'}));
    assert.deepEqual(a.state(),before.state);assert.deepEqual([...a.storage],before.storage);assert.equal(a.writes.length,before.writes);
    assert.equal(a.attempts.length,before.attempts+1);assert.equal(a.modalOpen(),true);
    assert.ok(a.messages.some(message=>/Не удалось сохранить/.test(message)));assert.ok(!a.messages.some(message=>/Заявка сохранена/.test(message)));
    assert.deepEqual(a.reload().state(),before.state,'Reload after failure keeps the previous saved request');
    a.control.failWrites=false;
    a.submit(form,values(r,{customer:'Успешная повторная попытка Орбиты',comment:'Правка из той же открытой формы',changeReason:'Исправленный ввод после ошибки'}));
    const saved=getRequest(a,r.id);
    assert.equal(saved.customer,'Успешная повторная попытка Орбиты');assert.equal(saved.comment,'Правка из той же открытой формы');
    assert.deepEqual(saved.history.slice(0,-1),r.history);assert.equal(saved.history.length,r.history.length+1);
    assert.equal(saved.history.at(-1).reason,'Исправленный ввод после ошибки');
    assert.ok(!JSON.stringify(saved.history).includes('Неудачная попытка'));
    assert.equal(a.writes.length,before.writes+1);assert.equal(a.modalOpen(),false);
    assert.deepEqual(getRequest(a,requestIds[1]),before.state.equipmentRequests[1]);
    assert.deepEqual(a.state().operations,before.state.operations);assert.deepEqual(a.state().persistenceSentinel,before.state.persistenceSentinel);
    for(const [key,value] of before.storage)if(key!==a.activeKey())assert.equal(a.storage.get(key),value);
    assert.deepEqual(a.reload().state(),a.state(),'The successful same-form retry persists across reload');
  });

  test(mode+': creating a request fails closed when an imported request collection is not an array',()=>{
    for(const collection of [null,{importedRows:'Сохранить исходные заявки'},'Исходный журнал заявок']){
      const a=setup(mode,state=>{state.equipmentRequests=structuredClone(collection);});
      a.run('requestModal()');a.requestItems(request(0).items);const before=snapshot(a);
      a.submit(a.form('#request-form'),values(request(0),{customer:'Не перезаписывать исходный журнал'}));
      assertUnchanged(a,before);assert.equal(a.modalOpen(),true,'Keep the form open after rejecting corrupt stored data');
      assert.ok(!a.messages.some(message=>/Заявка сохранена/.test(message)));
      assert.deepEqual(a.reload().state(),before.state,'Rejecting creation preserves the imported collection across reload');
    }
  });

  test(mode+': editing malformed history archives its exact value and preserves earlier recovery entries',()=>{
    for(const malformedHistory of [{imported:'Исходный журнал',nested:{value:17}},null]){
      const earlierRecovery=[{at:'2026-11-01T09:00:00.000Z',value:{original:'Предыдущий архив'}}];
      const a=setup(mode,state=>{
        state.equipmentRequests[0].history=structuredClone(malformedHistory);
        state.equipmentRequests[0].historyRecovery=structuredClone(earlierRecovery);
      });
      const r=getRequest(a,requestIds[0]),before=snapshot(a);
      a.run('requestModal('+JSON.stringify(r.id)+')');assertUnchanged(a,before);
      a.requestItems(r.items);a.submit(a.form('#request-form'),values(r,{customer:'Исправленная заявка с архивом'}));
      const saved=getRequest(a,r.id);
      assert.equal(saved.customer,'Исправленная заявка с архивом');assert.equal(saved.history.length,1);
      assert.equal(saved.history[0].action,'Изменение заявки');
      assert.deepEqual(saved.historyRecovery,[...earlierRecovery,{at:'2026-11-07T12:00:00.000Z',value:malformedHistory}]);
      assert.deepEqual(getRequest(a,requestIds[1]),before.state.equipmentRequests[1]);
      assert.deepEqual(a.state().operations,before.state.operations);assert.equal(a.writes.length,before.writes+1);
      assert.deepEqual(a.reload().state(),a.state(),'The archived original history and single new event survive reload');
    }
  });

  test(mode+': failed history recovery rolls back both malformed fields and a same-form retry archives each original once',()=>{
    const malformedHistory={importedEvents:{first:'Первоначальная история'}};
    const malformedRecovery={importedArchive:['Старые данные восстановления',{preserved:true}]};
    const a=setup(mode,state=>{
      state.equipmentRequests[0].history=structuredClone(malformedHistory);
      state.equipmentRequests[0].historyRecovery=structuredClone(malformedRecovery);
    });
    const r=getRequest(a,requestIds[0]);a.run('requestModal('+JSON.stringify(r.id)+')');
    const form=a.form('#request-form');a.requestItems(r.items);const before=snapshot(a);
    a.control.failWrites=true;
    a.submit(form,values(r,{customer:'Неудачное восстановление',changeReason:'Причина неудачной попытки'}));
    assert.deepEqual(a.state(),before.state,'A failed write restores both original malformed fields');
    assert.deepEqual([...a.storage],before.storage);assert.equal(a.writes.length,before.writes);
    assert.equal(a.attempts.length,before.attempts+1);assert.equal(a.modalOpen(),true);
    assert.deepEqual(a.reload().state(),before.state,'Failure creates no persisted recovery archive');
    assert.ok(!a.messages.some(message=>/Заявка сохранена/.test(message)));
    a.control.failWrites=false;
    a.submit(form,values(r,{customer:'Успешное восстановление',changeReason:'Причина успешного повтора'}));
    const saved=getRequest(a,r.id);
    assert.equal(saved.customer,'Успешное восстановление');assert.equal(saved.history.length,1);
    assert.equal(saved.history[0].reason,'Причина успешного повтора');
    assert.ok(!JSON.stringify(saved.history).includes('неудачной попытки'));
    assert.equal(saved.historyRecovery.length,2,'Each malformed source is archived exactly once');
    const priorArchive=saved.historyRecovery.find(entry=>entry.source==='historyRecovery');
    const historyArchive=saved.historyRecovery.find(entry=>!entry.source);
    assert.deepEqual(priorArchive,{at:'2026-11-07T12:00:00.000Z',source:'historyRecovery',value:malformedRecovery});
    assert.deepEqual(historyArchive,{at:'2026-11-07T12:00:00.000Z',value:malformedHistory});
    assert.equal(a.writes.length,before.writes+1);assert.equal(a.attempts.length,before.attempts+2);
    assert.equal(a.modalOpen(),false);assert.deepEqual(a.state().operations,before.state.operations);
    assert.deepEqual(getRequest(a,requestIds[1]),before.state.equipmentRequests[1]);
    for(const [key,value] of before.storage)if(key!==a.activeKey())assert.equal(a.storage.get(key),value);
    assert.deepEqual(a.reload().state(),a.state(),'Successful retry preserves both originals and exactly one event across reload');
  });

  test(mode+': editing a request with missing history creates one event without an unnecessary recovery archive',()=>{
    const a=setup(mode,state=>{delete state.equipmentRequests[0].history;});
    const r=getRequest(a,requestIds[0]);a.run('requestModal('+JSON.stringify(r.id)+')');a.requestItems(r.items);
    const before=snapshot(a);a.submit(a.form('#request-form'),values(r,{customer:'Заявка без предыдущей истории'}));
    const saved=getRequest(a,r.id);
    assert.equal(saved.customer,'Заявка без предыдущей истории');assert.equal(saved.history.length,1);
    assert.equal(saved.history[0].action,'Изменение заявки');assert.equal(Object.hasOwn(saved,'historyRecovery'),false);
    assert.deepEqual(a.state().operations,before.state.operations);assert.equal(a.writes.length,before.writes+1);
    assert.deepEqual(a.reload().state(),a.state());
  });

  const bookingCases=[
    {name:'overlapping machine',machine:machineIds[0],operator:'Другой тестовый машинист',start:'2026-11-07T09:00',end:'2026-11-07T10:00',blocked:true},
    {name:'overlapping operator on a different machine',machine:machineIds[2],operator:'Тестовый машинист 1',start:'2026-11-07T09:00',end:'2026-11-07T10:00',blocked:true},
    {name:'machine adjacency at the start',machine:machineIds[0],operator:'Другой тестовый машинист',start:'2026-11-07T06:00',end:'2026-11-07T08:00',blocked:false},
    {name:'machine adjacency at the end',machine:machineIds[0],operator:'Другой тестовый машинист',start:'2026-11-08T17:00',end:'2026-11-08T18:00',blocked:false},
    {name:'operator adjacency',machine:machineIds[2],operator:'Тестовый машинист 1',start:'2026-11-08T17:00',end:'2026-11-08T18:00',blocked:false},
    {name:'overlap with unrelated equipment and operator',machine:machineIds[2],operator:'Тестовый машинист 3',start:'2026-11-07T09:00',end:'2026-11-07T10:00',blocked:false}
  ];
  for(const {name,blocked,...item} of bookingCases)test(mode+': strict booking conflict behavior preserves '+name,()=>{
    const a=setup(mode);manager(a,1);a.run('requestModal()');a.requestItems([item]);const before=snapshot(a);
    a.submit(a.form('#request-form'),values(request(1),{customer:'Новая заявка для проверки пересечения'}));
    if(blocked){
      assertUnchanged(a,before);assert.ok(a.messages.some(message=>/Двойное назначение/.test(message)));assert.equal(a.modalOpen(),true);
    }else{
      assert.equal(a.state().equipmentRequests.length,before.state.equipmentRequests.length+1);
      assert.deepEqual(a.state().equipmentRequests.at(-1).items,[item]);assert.equal(a.writes.length,before.writes+1);
      assert.deepEqual(a.state().operations,before.state.operations);
    }
  });
}
