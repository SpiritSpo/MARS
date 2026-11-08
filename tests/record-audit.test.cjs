const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser,demonstrationState,keys}=require('./fixtures/browser-app.cjs');

const at='2026-11-07T12:00:00.000Z';
const existing={
  shiftId:'shift-104',at:'2026-11-06T12:00:00.000Z',actor:'Механик',reason:'Прежняя корректировка',
  before:{hours:7,meter:1250,note:'Прежде'},after:{hours:8,meter:1255,note:'Уточнение'},
  userMetadata:{source:'Сохранить без изменений'}
};
const cases=[
  {name:'undefined',value:undefined},
  {name:'null',value:null},
  {name:'object',value:{legacy:'Сохранить исходный журнал',nested:{entries:[1,2]}}},
  {name:'empty object',value:{}},
  {name:'string',value:'Повреждённый журнал, сохранить целиком'},
  {name:'number',value:42},
  {name:'valid array',value:[existing]},
  {name:'mixed array',value:[null,42,'opaque',{},existing,{shiftId:'other-shift',reason:'Прежняя неполная запись'}]},
  {name:'missing snapshots',value:[{shiftId:'shift-104',at,actor:'Механик',reason:'Неполная запись без снимков'}]},
  {name:'invalid snapshots',value:[{...existing,before:null},{...existing,after:'opaque'}]}
];

function setup(mode,audit,recovery){
  const data=demonstrationState();
  data.recordAudit=structuredClone(audit);
  if(recovery!==undefined)data.recordAuditRecovery=structuredClone(recovery);
  data.persistenceSentinel={id:'unrelated',value:'Сохранённые данные пользователя'};
  const active=mode==='demo'?keys.demo:keys.working;
  const inactive=mode==='demo'?keys.working:keys.demo;
  const storage=new Map([
    [active,JSON.stringify(data)],
    [inactive,JSON.stringify({unchanged:'Неактивный набор данных'})],
    [keys.legacy,'Исходный архив: оставить байты'],
    [keys.archive,'Архив справочников: оставить байты']
  ]);
  const a=browser({mode,storage});
  a.run("role='mechanic';");
  return a;
}

const values={hours:'7',meter:'1257',note:'Исправление из теста',reason:'Проверка надёжности журнала'};
const success=/Исправления сохранены/;
const selected=state=>state.shifts.find(s=>s.id==='shift-104');
const protectedEntries=a=>[...a.storage].filter(([key])=>key!==a.activeKey());

function open(a){
  const before=a.state(),stored=[...a.storage],writes=a.writes.length,attempts=a.attempts.length;
  assert.doesNotThrow(()=>a.run("recordEditModal('shift-104');"));
  assert.ok(a.modalOpen());
  assert.deepEqual(a.state(),before,'Opening the form must not normalize or alter any data');
  assert.deepEqual([...a.storage],stored,'Opening must preserve original saved bytes');
  assert.equal(a.writes.length,writes);
  assert.equal(a.attempts.length,attempts,'Opening must not attempt a write');
  return a.form('#record-edit-form');
}

function assertOnlyCorrectionChanged(a,before){
  const current=a.state();
  delete current.recordAudit;delete current.recordAuditRecovery;
  const original=structuredClone(before);
  delete original.recordAudit;delete original.recordAuditRecovery;
  Object.assign(selected(current),{
    hours:selected(original).hours,meter:selected(original).meter,note:selected(original).note
  });
  assert.deepEqual(current,original,'Other user records, finance, catalogs and shifts must remain unchanged');
}

function verifySaved(a,before,audit,expectedValues=values,eventCount=1){
  const state=a.state(),shift=selected(state),old=selected(before);
  assert.equal(shift.hours,Number(expectedValues.hours));
  assert.equal(shift.meter,Number(expectedValues.meter));
  assert.equal(shift.note,expectedValues.note);
  const prefix=Array.isArray(audit)?audit:[];
  assert.deepEqual(state.recordAudit.slice(0,prefix.length),prefix,'Every previous array entry stays intact');
  assert.equal(state.recordAudit.length,prefix.length+eventCount,'Exactly one new history event per successful correction');
  if(eventCount===1)assert.deepEqual(state.recordAudit.at(-1),{
    shiftId:'shift-104',at,actor:'Механик',reason:expectedValues.reason,
    before:{hours:old.hours,meter:old.meter,note:old.note||''},
    after:{hours:Number(expectedValues.hours),meter:Number(expectedValues.meter),note:expectedValues.note}
  });
  if(audit!==undefined&&!Array.isArray(audit)){
    assert.deepEqual(state.recordAuditRecovery,[{at,value:audit}],'Keep the complete original invalid container in the same atomic save');
  }else assert.equal(Object.hasOwn(state,'recordAuditRecovery'),Object.hasOwn(before,'recordAuditRecovery'));
  assertOnlyCorrectionChanged(a,before);
}

for(const mode of ['demo','working'])for(const entry of cases){
  test(mode+': '+entry.name+' audit opens safely and preserves corrections and original content after reload',()=>{
    const a=setup(mode,entry.value),before=a.state(),protectedBefore=protectedEntries(a),writes=a.writes.length;
    const form=open(a);
    if(Array.isArray(entry.value)&&entry.value.some(x=>x===existing))assert.match(a.form('#modal-root').innerHTML,/Прежняя корректировка/);
    a.submit(form,values);
    verifySaved(a,before,entry.value);
    assert.equal(a.writes.length,writes+1);
    assert.ok(a.messages.some(message=>success.test(message)));
    assert.equal(a.modalOpen(),false);
    assert.deepEqual(protectedEntries(a),protectedBefore);
    assert.ok(a.writes.every(write=>write.key===a.activeKey()));
    const reloaded=a.reload();
    verifySaved(reloaded,before,entry.value);
    assert.deepEqual(reloaded.state(),a.state());
    open(reloaded);
    assert.match(reloaded.form('#modal-root').innerHTML,/Проверка надёжности журнала/);
  });

  test(mode+': '+entry.name+' audit rolls back failed normalization and retries the same form without loss',()=>{
    const a=setup(mode,entry.value),before=a.state(),original=[...a.storage],protectedBefore=protectedEntries(a),writes=a.writes.length;
    const form=open(a);
    a.control.failWrites=true;
    a.submit(form,{...values,note:'Неудачная попытка',reason:'Не сохранять в журнале'});
    assert.deepEqual(a.state(),before,'Failure restores the original journal shape and all user records');
    assert.deepEqual([...a.storage],original,'Failure preserves exact saved bytes');
    assert.equal(a.writes.length,writes);
    assert.ok(a.modalOpen());
    assert.ok(!a.messages.some(message=>success.test(message)));
    assert.deepEqual(a.reload().state(),before,'Reload after failure reads the original data');
    a.control.failWrites=false;
    a.submit(form,values);
    verifySaved(a,before,entry.value);
    assert.equal(a.writes.length,writes+1);
    assert.ok(a.messages.some(message=>success.test(message)));
    assert.equal(a.modalOpen(),false);
    assert.deepEqual(protectedEntries(a),protectedBefore);
    const reloaded=a.reload();
    verifySaved(reloaded,before,entry.value);
    assert.deepEqual(reloaded.state(),a.state());
  });
}

for(const mode of ['demo','working']){
  test(mode+': an explicitly undefined in-memory audit remains untouched until a successful correction',()=>{
    const a=setup(mode,undefined),before=a.state(),stored=[...a.storage];
    a.run('state.recordAudit=undefined;');
    const form=open(a);
    assert.equal(a.run('Object.hasOwn(state,"recordAudit")'),true);
    assert.equal(a.run('state.recordAudit'),undefined);
    a.control.failWrites=true;
    a.submit(form,values);
    assert.equal(a.run('Object.hasOwn(state,"recordAudit")'),true);
    assert.equal(a.run('state.recordAudit'),undefined);
    assert.deepEqual([...a.storage],stored);
    a.control.failWrites=false;
    a.submit(form,values);
    verifySaved(a,before,undefined);
    assert.equal(Object.hasOwn(a.state(),'recordAuditRecovery'),false);
    assert.deepEqual(a.reload().state(),a.state());
  });

  test(mode+': unchanged and invalid corrections leave the original malformed audit untouched',()=>{
    const a=setup(mode,{opaque:'Original audit'},[{at,value:'Earlier recovery'}]);
    const before=a.state(),stored=[...a.storage],writes=a.writes.length,attempts=a.attempts.length;
    const form=open(a),shift=selected(before);
    a.submit(form,{hours:String(shift.hours),meter:String(shift.meter),note:shift.note||'',reason:'Нет изменений'});
    assert.deepEqual(a.state(),before);
    assert.deepEqual([...a.storage],stored);
    a.submit(form,{...values,reason:''});
    assert.deepEqual(a.state(),before);
    assert.deepEqual([...a.storage],stored);
    assert.equal(a.writes.length,writes);
    assert.equal(a.attempts.length,attempts,'No-op and invalid input must not trigger normalization writes');
    assert.ok(a.modalOpen());
    assert.ok(!a.messages.some(message=>success.test(message)));
  });

  test(mode+': later corrections retain prior audit events and the original recovery archive',()=>{
    const a=setup(mode,{previous:'Original opaque journal'}),before=a.state();
    a.submit(open(a),values);
    const first=a.state(),recovery=structuredClone(first.recordAuditRecovery);
    const secondValues={hours:'6',meter:'1258',note:'Второе исправление',reason:'Последующая сверка'};
    a.submit(open(a),secondValues);
    verifySaved(a,before,{previous:'Original opaque journal'},secondValues,2);
    assert.deepEqual(a.state().recordAudit[0],first.recordAudit[0]);
    assert.deepEqual(a.state().recordAuditRecovery,recovery,'Later corrections cannot overwrite the archive');
    const reloaded=a.reload();
    assert.deepEqual(reloaded.state(),a.state());
    assert.doesNotThrow(()=>open(reloaded));
  });

  test(mode+': normalization appends to an existing recovery archive without changing previous entries',()=>{
    const archived=[{at:'2026-11-01T00:00:00.000Z',value:{previousArchive:'Keep untouched'}}];
    const original={opaque:'Original invalid journal'},a=setup(mode,original,archived);
    a.submit(open(a),values);
    assert.deepEqual(a.state().recordAuditRecovery,[...archived,{at,value:original}]);
    assert.deepEqual(a.reload().state(),a.state());
  });

  test(mode+': a malformed recovery field is itself preserved when an invalid audit is normalized',()=>{
    const archived={unexpected:'Preserve this too'},original={opaque:'Original invalid journal'};
    const a=setup(mode,original,archived);
    a.submit(open(a),values);
    assert.deepEqual(a.state().recordAuditRecovery,[{at,source:'recordAuditRecovery',value:archived},{at,value:original}]);
    assert.deepEqual(a.reload().state(),a.state());
  });
}
