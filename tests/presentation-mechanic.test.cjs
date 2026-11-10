const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser,keys}=require('./fixtures/browser-app.cjs');

const day='2026-11-07',asset='asset:repair-warning',other='asset:other-warning';
const booking=(id,extra={})=>({id,number:'ЗТ-'+id,owner:'Менеджер '+id,customer:'Заказчик '+id,
  object:'Тестовый объект',status:'Назначена',dispatchStage:'На объекте',releaseConfirmed:false,
  comment:'Комментарий <клиента>',contact:'Контакт '+id,phone:'+7 900 111 22 33',
  arrival:'Приступила к работе',followup:'Продление согласовано',
  items:[{machine:asset,operator:'Машинист '+id,start:day+'T08:00',end:day+'T17:00'}],
  history:[{by:'Сохраняемый автор',at:'2026-11-06T09:00:00Z',action:'Назначение техники',
    reason:'Согласовано с заказчиком',changes:[{field:'Объект',from:'Первый',to:'Тестовый объект'}]}],...extra});
const repair=extra=>({id:'repair-warning',number:'ЗР-ПРЕДУПРЕЖДЕНИЕ',machine:asset,kind:'repair',
  type:'Проверка машины',note:'Проверка узла',date:day,dueDate:day,status:'progress',
  priority:'normal',assignee:'Механик проверки',blocking:true,readyConfirmed:false,photos:[],parts:[],
  reportedBy:'Механик',history:[{at:day,text:'Исходная запись',by:'Механик'}],...extra});
function data(){return {version:1,objects:[{id:'object-warning',name:'Тестовый объект'}],
  machines:[asset,other].map(id=>({id,name:'Одинаковая модель',type:'Тестовая техника',
    status:'free',operator:'Тестовый машинист',object:'object-warning'})),
  equipmentRequests:[booking('overlap'),booking('future',{status:'Завершена',
    items:[{machine:asset,operator:'Второй машинист',start:'2026-11-09T09:00',end:'2026-11-09T18:00'}]})],
  maintenance:[],shifts:[],stock:[{id:'part-warning',name:'Сохраняемая запчасть',unit:'шт.',qty:3}],
  stockMoves:[],operations:[{id:'finance-warning',machine:asset,kind:'expense',amount:31,
    date:day,category:'Прочие расходы',note:'Сохраняемый расход'}],machinePhotos:{},workshopVersion:2,
  persistenceSentinel:{original:'Сохранить все посторонние данные'}};}
function setup(mode,prepare=()=>{}){
  const state=data();prepare(state);
  const active=mode==='demo'?keys.demo:keys.working,inactive=mode==='demo'?keys.working:keys.demo;
  const a=browser({mode,storage:new Map([[active,JSON.stringify(state)],[inactive,JSON.stringify(data())],
    [keys.legacy,'Исходный архив'],[keys.archive,'Исходный справочник']])});
  a.run("role='mechanic';period='all';view='requests';");return a;
}
const modal=a=>a.form('#modal-root').innerHTML;
const snapshot=a=>({state:a.state(),storage:[...a.storage],writes:a.writes.length,attempts:a.attempts.length});
function unchanged(a,b){assert.deepEqual(a.state(),b.state);assert.deepEqual([...a.storage],b.storage);
  assert.equal(a.writes.length,b.writes);assert.equal(a.attempts.length,b.attempts);}
function watch(a,selector){const form=a.form(selector),events={};
  form.addEventListener=(name,callback)=>{events[name]=callback;};return {form,events};}
const createValues=extra=>({machine:asset,kind:'repair',priority:'normal',type:'Проверка предупреждения',
  note:'Работы по тестовой машине',assignee:'Механик проверки',dueDate:day,blocking:'on',...extra});
const updateValues=extra=>({status:'progress',assignee:'Механик проверки',dueDate:day,blocking:'on',
  comment:'Уточнён план работ',...extra});
const closeValues=()=>({result:'Проверка выполнена без затрат',labor:'0',external:'0',
  'qty-part-warning':'0','price-part-warning':'0'});

for(const mode of ['demo','working']){
  test(mode+': mechanic reads all request cards, assignments and history without write controls or persistence',()=>{
    const a=setup(mode),before=snapshot(a);
    assert.equal(a.run('canViewRequests()'),true);assert.equal(a.run('canCreateRequest()'),false);
    const html=a.run('requestsPage()');
    for(const r of before.state.equipmentRequests){
      assert.ok(html.includes(r.number));assert.ok(html.includes(r.owner));
      assert.equal(a.run('canEditRequest('+JSON.stringify(r)+')'),false);
      for(const entry of ['requestModal','requestDetails']){
        a.run(entry+'('+JSON.stringify(r.id)+')');const card=modal(a);
        const displayedTimes=r.id==='future'?['09.11.2026, 09:00','09.11.2026, 18:00']:['07.11.2026, 08:00','07.11.2026, 17:00'];
        for(const value of [r.number,r.owner,r.customer,r.object,r.contact,r.phone,
          r.status,r.dispatchStage,r.arrival,r.followup,r.items[0].operator,...displayedTimes,
          'Сохраняемый автор','Согласовано с заказчиком','Первый'])assert.ok(card.includes(value),value);
        assert.match(card,/Комментарий &lt;клиента&gt;/);
        assert.match(card,/Фактическое освобождение/);assert.match(card,/Журнал изменений/);
        assert.doesNotMatch(card,/<(?:form|input|select|textarea)\b|type="submit"|Сохранить|Удалить/);
        assert.ok((card.match(/<button\b[^>]*>/g)||[]).every(b=>/data-close/.test(b)));
        unchanged(a,before);
      }
    }
    a.run('closeModal(false);requestModal();handleAction("add-request");requestModal("missing");');
    assert.equal(a.modalOpen(),false);unchanged(a,before);
    a.run('openCalendarRepairs('+JSON.stringify(asset)+');');
    assert.match(modal(a),/Ремонты/);assert.doesNotMatch(modal(a),/<form|repair-release|repair-complete/);
    unchanged(a,before);
  });

  test(mode+': mechanic cannot submit a manager request form opened before the role changed',()=>{
    for(const editing of [false,true]){
      const a=setup(mode);a.run("role='director';requestModal("+(editing?'"overlap"':'')+");");
      const form=a.form('#request-form');a.run("role='mechanic';");const before=snapshot(a);
      a.submit(form,{});unchanged(a,before);
    }
  });

  test(mode+': warning projection uses active assignments on the same stable machine ID and strict boundaries',()=>{
    const rows=[
      booking('direct',{items:[{machine:asset,start:'2026-11-08T00:00',end:'2026-11-09T00:00'}]}),
      booking('completed',{status:'Завершена',items:[{machine:asset,start:'2026-11-09T23:00',end:'2026-11-10T00:00'}]}),
      booking('adjacent-before',{items:[{machine:asset,start:'2026-11-07T23:00',end:'2026-11-08T00:00'}]}),
      booking('adjacent-after',{items:[{machine:asset,start:'2026-11-10T00:00',end:'2026-11-10T01:00'}]}),
      booking('cross-start',{items:[{machine:asset,start:'2026-11-07T23:59',end:'2026-11-08T00:01'}]}),
      booking('cancelled',{status:'Отменена'}),booking('released',{releaseConfirmed:true}),
      booking('other-machine',{items:[{machine:other,start:'2026-11-08T08:00',end:'2026-11-08T17:00'}]}),
      booking('invalid',{items:[{machine:asset,start:'2026-11-31T08:00',end:'2026-12-01T08:00'}]}),
      booking('reversed',{items:[{machine:asset,start:'2026-11-09T10:00',end:'2026-11-09T09:00'}]}),
      booking('zero',{items:[{machine:asset,start:'2026-11-09T10:00',end:'2026-11-09T10:00'}]})];
    const a=setup(mode,state=>{state.equipmentRequests=rows;}),before=snapshot(a);
    const proposed=repair({planDate:'2026-11-08',dueDate:'2026-11-09'});
    assert.deepEqual(a.json('repairBookingWarnings('+JSON.stringify(proposed)+',state.equipmentRequests,today()).map(x=>[x.request.id,x.kind])'),
      [['direct','overlap'],['completed','overlap'],['adjacent-after','after-due'],['cross-start','overlap']]);
    const past=repair({date:'2026-11-01',dueDate:'2026-11-03'});
    assert.deepEqual(a.json('repairBookingWarnings('+JSON.stringify(past)+','+JSON.stringify([booking('past',{
      items:[{machine:asset,start:'2026-11-04T08:00',end:'2026-11-04T09:00'}]})])+',today())'),[]);
    assert.deepEqual(a.json('repairBookingWarnings('+JSON.stringify({...proposed,status:'done',readyConfirmed:true})+',state.equipmentRequests,today())'),[]);
    unchanged(a,before);
  });

  test(mode+': creation warns before saving, responds to machine/date changes and survives failed-save retry',()=>{
    const a=setup(mode),{form,events}=watch(a,'#repair-form'),before=snapshot(a);
    a.run('repairForm('+JSON.stringify(asset)+');');
    assert.match(modal(a),/id="repair-booking-warning" class="info-note"/);
    assert.match(modal(a),/ЗТ-overlap/);assert.match(modal(a),/ЗТ-future/);
    assert.match(modal(a),/Пересечение с записанным периодом ремонта/);
    assert.match(modal(a),/После планового срока: техническая готовность ещё не подтверждена/);
    assert.match(modal(a),/Менеджер overlap/);assert.match(modal(a),/Заказчик overlap/);
    assert.ok(modal(a).indexOf('id="repair-booking-warning"')<modal(a).indexOf('type="submit"'));
    form.values=createValues({machine:other});events.change({target:form});
    assert.equal(a.form('#repair-booking-warning').hidden,true);unchanged(a,before);
    form.values=createValues({dueDate:'2026-11-10'});events.input({target:form});
    assert.match(a.form('#repair-booking-warning').innerHTML,/ЗТ-future/);
    assert.doesNotMatch(a.form('#repair-booking-warning').innerHTML,/После планового срока:/);unchanged(a,before);
    a.control.failWrites=true;a.submit(form,createValues());
    assert.deepEqual(a.state(),before.state);assert.deepEqual([...a.storage],before.storage);
    assert.equal(a.writes.length,before.writes);assert.equal(a.attempts.length,before.attempts+1);
    assert.equal(a.modalOpen(),true);assert.equal(a.form('#repair-booking-warning').hidden,false);
    assert.match(a.form('#repair-booking-warning').innerHTML,/ЗТ-overlap/);
    assert.deepEqual(a.reload().state(),before.state);
    a.control.failWrites=false;a.submit(form,createValues({type:'Повторная попытка',dueDate:'2026-11-10'}));
    const saved=a.state();assert.equal(saved.maintenance.length,1);assert.equal(saved.maintenance[0].type,'Повторная попытка');
    assert.equal(saved.maintenance[0].history.length,1);assert.equal(a.writes.length,before.writes+1);
    for(const key of ['equipmentRequests','operations','stock','stockMoves','persistenceSentinel'])assert.deepEqual(saved[key],before.state[key]);
    for(const [key,value] of before.storage)if(key!==a.activeKey())assert.equal(a.storage.get(key),value);
    assert.deepEqual(a.reload().state(),saved);
  });

  test(mode+': update recomputes booking warnings without writes and retries against the restored repair',()=>{
    const a=setup(mode,state=>{state.maintenance=[repair()];}),{form,events}=watch(a,'#repair-update-form');
    const before=snapshot(a);a.run('openRepair("repair-warning");');
    assert.match(modal(a),/id="repair-update-booking-warning" class="info-note"/);
    assert.match(modal(a),/После планового срока: техническая готовность ещё не подтверждена/);
    form.values=updateValues({dueDate:'2026-11-10'});events.change({target:form});
    assert.match(a.form('#repair-update-booking-warning').innerHTML,/ЗТ-future/);
    assert.doesNotMatch(a.form('#repair-update-booking-warning').innerHTML,/После планового срока:/);unchanged(a,before);
    a.control.failWrites=true;a.submit(form,form.values);
    assert.deepEqual(a.state(),before.state);assert.deepEqual([...a.storage],before.storage);
    assert.equal(a.form('#repair-update-booking-warning').hidden,false);
    a.control.failWrites=false;a.submit(form,updateValues({dueDate:'2026-11-09',comment:'Исправленный план после ошибки'}));
    const saved=a.state();assert.equal(saved.maintenance[0].dueDate,'2026-11-09');
    assert.equal(saved.maintenance[0].history.length,before.state.maintenance[0].history.length+1);
    assert.match(saved.maintenance[0].history.at(-1).text,/Исправленный план после ошибки/);
    assert.equal(a.writes.length,before.writes+1);
    for(const key of ['equipmentRequests','operations','stock','stockMoves','persistenceSentinel'])assert.deepEqual(saved[key],before.state[key]);
    assert.deepEqual(a.reload().state(),saved);
  });

  test(mode+': unknown repair dates warn about unconfirmed availability without fabricating an overlap',()=>{
    const a=setup(mode,state=>{state.maintenance=[repair({date:'',dueDate:''})];}),before=snapshot(a);
    a.run('openRepair("repair-warning");');assert.match(modal(a),/Период ремонта требует уточнения/);
    assert.doesNotMatch(modal(a),/Пересечение с записанным периодом ремонта/);unchanged(a,before);
  });

  test(mode+': stale repair create, update and close handlers reject a switch to every non-managing role',()=>{
    for(const action of ['create','update','close'])for(const role of ['dispatcher','operator','accountant']){
      const a=setup(mode,state=>{state.maintenance=[repair()];});
      const selector={create:'#repair-form',update:'#repair-update-form',close:'#repair-close-form'}[action];
      a.run({create:'repairForm('+JSON.stringify(asset)+');',update:'openRepair("repair-warning");',close:'completeRepairForm("repair-warning");'}[action]);
      const form=a.form(selector);a.run('role='+JSON.stringify(role));const before=snapshot(a);
      a.submit(form,{create:createValues(),update:updateValues(),close:closeValues()}[action]);unchanged(a,before);
    }
  });

  test(mode+': zero-cost completion retries atomically, preserves bookings and keeps technical release mandatory',()=>{
    const a=setup(mode,state=>{state.maintenance=[repair()];}),before=snapshot(a);
    a.run('completeRepairForm("repair-warning");');const form=a.form('#repair-close-form');
    a.control.failWrites=true;a.submit(form,closeValues());
    assert.deepEqual(a.state(),before.state);assert.deepEqual([...a.storage],before.storage);
    assert.equal(a.writes.length,before.writes);assert.equal(a.modalOpen(),true);
    a.control.failWrites=false;a.submit(form,closeValues());
    const saved=a.state(),r=saved.maintenance[0];assert.equal(r.status,'done');assert.equal(r.blocking,true);
    assert.equal(r.readyConfirmed,false);assert.equal(r.laborCost,0);assert.equal(r.externalCost,0);
    assert.equal(a.run('machine('+JSON.stringify(asset)+').status'),'repair');
    assert.equal(r.history.length,before.state.maintenance[0].history.length+1);
    for(const key of ['equipmentRequests','operations','stock','stockMoves','persistenceSentinel'])assert.deepEqual(saved[key],before.state[key]);
    assert.equal(a.writes.length,before.writes+1);assert.match(modal(a),/id="repair-release"/);
    assert.deepEqual(a.reload().state(),saved);
  });
}
