const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser,keys}=require('./fixtures/browser-app.cjs');

const managerNames=['Алексей Иванов','Дмитрий Петров'];
const rawStart='2026-11-06T08:00',rawEnd='2026-11-07T17:45';
const shownStart='06.11.2026, 08:00',shownEnd='07.11.2026, 17:45';
const sourceComment='Комментарий хранит 2026-11-06T08:00 / 2026-11-07T17:45 <без изменений>';
const rawAssignment='Тестовый экскаватор / секция А · ID date-asset-a · ТЕСТ-11 / Машинист А / 2026-11-06T08:00 / 2026-11-07T17:45';
const shownAssignment='Тестовый экскаватор / секция А · ID date-asset-a · ТЕСТ-11 / Машинист А / 06.11.2026, 08:00 / 07.11.2026, 17:45';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function data(){
 const machines=[
  {id:'date-asset-a',name:'Тестовый экскаватор / секция А',registration:'ТЕСТ-11',operator:'Машинист А'},
  {id:'date-asset-b',name:'Тестовый погрузчик',registration:'ТЕСТ-22',operator:'Машинист Б'},
  {id:'date-asset-r',name:'Тестовый резерв',registration:'ТЕСТ-33',operator:'Машинист Р'}
 ].map(m=>({...m,type:'Тестовая техника',object:'date-object',status:'free'}));
 const requests=managerNames.map((owner,i)=>({id:'date-request-'+i,number:'ЗТ-ДАТА-'+i,owner,
  customer:'Синтетический заказчик '+i,object:'Тестовый объект дат',contact:'Синтетический контакт',phone:'',
  comment:sourceComment,status:'Назначена',dispatchStage:'На объекте',releaseConfirmed:false,
  followup:'Продление согласовано',arrival:'Приступила к работе',
  items:[{machine:machines[i].id,operator:machines[i].operator,start:rawStart,end:rawEnd}],
  history:[{by:owner,at:'2026-11-05T10:00:00Z',action:'Тестовое изменение',reason:sourceComment,
   changes:[{field:'Назначение №1',from:rawAssignment,to:rawAssignment},
    {field:'Комментарий',from:sourceComment,to:sourceComment},
    {field:'Назначение №01',from:rawAssignment,to:rawAssignment},
    {field:'Назначение №1\n',from:rawAssignment,to:rawAssignment}]}]
 }));
 return {version:1,machines,objects:[{id:'date-object',name:'Тестовый объект дат'}],equipmentRequests:requests,
  maintenance:[],shifts:[],stock:[],stockMoves:[],machinePhotos:{},workshopVersion:2,
  operations:[{id:'date-preserved-expense',machine:'date-asset-a',kind:'expense',amount:13,
   date:'2026-11-01',category:'Прочие расходы',note:'Синтетический сохраняемый расход'}],
  dateDisplaySentinel:{value:'Посторонние данные сохраняются'}};
}
function setup(mode){
 const active=mode==='demo'?keys.demo:keys.working,inactive=mode==='demo'?keys.working:keys.demo;
 return browser({mode,storage:new Map([[active,JSON.stringify(data())],[inactive,JSON.stringify(data())],
  [keys.legacy,'Синтетический исходный архив'],[keys.archive,'Синтетический архив справочника'],
  ['mars-demo-manager',managerNames[0]]])});
}
const modal=a=>a.form('#modal-root').innerHTML;
const snapshot=a=>({state:a.state(),storage:[...a.storage],writes:a.writes.length,attempts:a.attempts.length});
function unchanged(a,b){
 assert.deepEqual(a.state(),b.state);assert.deepEqual([...a.storage],b.storage);
 assert.equal(a.writes.length,b.writes);assert.equal(a.attempts.length,b.attempts);
 assert.deepEqual(a.reload().state(),b.state,'Reload keeps source values after viewing');
}
function selectRole(a,choice){
 a.storage.set('mars-demo-manager',managerNames[choice==='manager-b'?1:0]);
 a.run('role='+JSON.stringify(choice.startsWith('manager-')?'dispatcher':choice)+';');
}

test('Assignment dates display literal calendar components in a 24-hour format',()=>{
 const a=browser({mode:'working'});
 const cases=[
  ['2026-11-06T08:00','06.11.2026, 08:00'],
  ['2026-01-01T00:00','01.01.2026, 00:00'],
  ['2026-12-31T23:59','31.12.2026, 23:59'],
  ['2028-02-29T12:30','29.02.2028, 12:30'],
  ['2000-02-29T09:05','29.02.2000, 09:05'],
  ['2026-04-30T20:15','30.04.2026, 20:15'],
  ['0001-01-01T00:00','01.01.0001, 00:00'],
  ['9999-12-31T23:59','31.12.9999, 23:59'],
  ['2026-11-06T08:00:15','06.11.2026, 08:00:15'],
  ['2026-11-06T08:00:15.123','06.11.2026, 08:00:15.123'],
  ['2026-11-06T08:00:00.123456789Z','06.11.2026, 08:00:00.123456789 UTC'],
  ['2026-01-01T00:15+14:00','01.01.2026, 00:15 UTC+14:00'],
  ['2026-12-31T23:45-12:00','31.12.2026, 23:45 UTC-12:00']
 ];
 for(const [value,expected] of cases)assert.equal(a.run('requestDateTimeText('+JSON.stringify(value)+')'),expected,value);
});

test('Missing or invalid assignment dates stay explicit instead of rolling into another day',()=>{
 const a=browser({mode:'working'});
 for(const value of [undefined,null,'']){
  const expression=value===undefined?'undefined':JSON.stringify(value);
  assert.equal(a.run('requestDateTimeText('+expression+')'),'—');
 }
 const invalid=[' ',false,true,0,20261106,[],{},'2026-02-29T08:00','2100-02-29T08:00',
  '2026-04-31T08:00','2026-00-01T08:00','2026-13-01T08:00','2026-11-00T08:00',
  '0000-01-01T08:00','2026-11-06','2026-11-6T08:00','2026-11-06 08:00',
  '2026-11-06T8:00','2026-11-06T24:00','2026-11-06T08:60','2026-11-06T08:00:60',
  '2026-11-06T08:00.1','2026-11-06T08:00:00.1234567890','2026-11-06T08:00+24:00',
  '2026-11-06T08:00+03:60','2026-11-06T08:00junk','2026-11-06T08:00\n','2026-11-06T08:00\r\n'];
 for(const value of invalid)assert.equal(a.run('requestDateTimeText('+JSON.stringify(value)+')'),'Некорректная дата',JSON.stringify(value));
 assert.equal(a.run('requestDateTimeText({toString(){throw Error("Do not coerce imported objects");}})'),'Некорректная дата');
});

test('Assignment date display is independent of process timezone and keeps offset clocks unchanged',()=>{
 const previous=process.env.TZ;
 // This test stays synchronous: no other test can observe the temporary TZ,
 // and finally restores the environment even when an assertion fails.
 try{
  for(const timezone of ['UTC','Pacific/Honolulu','Asia/Tokyo']){
   process.env.TZ=timezone;const a=browser({mode:'working'});
   const result=a.json('[requestDateTimeText("2026-01-01T00:15"),requestDateTimeText("2026-01-01T00:15+14:00"),requestDateTimeText("2026-12-31T23:45-12:00"),requestDateTimeText("2026-11-06T08:00:15.123Z")]');
   assert.deepEqual(result,['01.01.2026, 00:15','01.01.2026, 00:15 UTC+14:00',
    '31.12.2026, 23:45 UTC-12:00','06.11.2026, 08:00:15.123 UTC'],timezone);
   a.run('Date=class {constructor(){throw Error("Do not interpret wall time as an instant");}};Intl={DateTimeFormat(){throw Error("Do not convert recorded clock components");}};');
   assert.equal(a.run('requestDateTimeText("2026-01-01T00:15+14:00")'),'01.01.2026, 00:15 UTC+14:00');
  }
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});

for(const mode of ['demo','working']){
 test(mode+': all request readers see formatted dates while owners keep raw edit values without writes',()=>{
  const a=setup(mode);
  for(const choice of ['director','manager-a','manager-b','mechanic']){
   selectRole(a,choice);const before=snapshot(a);
   for(const id of ['date-request-0','date-request-1']){
    a.run('requestDetails('+JSON.stringify(id)+');');
    const html=modal(a),assignment=html.match(/<section class="request-assignment">[\s\S]*?<\/section>/)?.[0];
    assert.ok(assignment);assert.ok(assignment.includes(shownStart));assert.ok(assignment.includes(shownEnd));
    assert.ok(!assignment.includes(rawStart));assert.ok(!assignment.includes(rawEnd));
    assert.ok(html.includes(escape(sourceComment)),'Ordinary comment remains literal');
    assert.doesNotMatch(html,/<form|type="submit"/);
   }
   const list=a.run('requestsPage()');assert.ok(list.includes(shownStart));assert.ok(list.includes(shownEnd));
   if(choice==='director'||choice.startsWith('manager-')){
    const ownId=choice==='manager-b'?'date-request-1':'date-request-0';
    a.run('requestModal('+JSON.stringify(ownId)+');');
    assert.match(modal(a),/<input type="datetime-local" name="start" required value="2026-11-06T08:00">/);
    assert.match(modal(a),/<input type="datetime-local" name="end" required value="2026-11-07T17:45">/);
   }
   if(choice.startsWith('manager-')){
    const foreignId=choice==='manager-a'?'date-request-1':'date-request-0';
    a.run('requestModal('+JSON.stringify(foreignId)+');');
    assert.match(modal(a),/request-details/);assert.ok(modal(a).includes(shownStart));assert.ok(modal(a).includes(shownEnd));
   }
   unchanged(a,before);
  }
 });

 test(mode+': repair warnings format both endpoints and leave assignment sources and other data intact',()=>{
  const a=setup(mode);a.run("role='mechanic';");const before=snapshot(a);
  const html=a.run(`repairBookingWarningHtml(repairBookingWarnings({machine:'date-asset-a',date:'2026-11-06',dueDate:'2026-11-08'},state.equipmentRequests,today()))`);
  assert.ok(html.includes(shownStart+' — '+shownEnd));assert.ok(!html.includes(rawStart));assert.ok(!html.includes(rawEnd));
  assert.match(html,/ЗТ-ДАТА-0/);unchanged(a,before);
 });

 test(mode+': only assignment audit endpoints are formatted; stored history and ordinary text remain raw',()=>{
  const a=setup(mode);const before=snapshot(a),html=a.run('requestHistoryHtml(state.equipmentRequests[0])');
  assert.ok(html.includes('<b>Назначение №1:</b> '+escape(shownAssignment)+' → '+escape(shownAssignment)));
  assert.ok(html.includes('<b>Комментарий:</b> '+escape(sourceComment)+' → '+escape(sourceComment)));
  assert.ok(html.includes('<b>Назначение №01:</b> '+escape(rawAssignment)+' → '+escape(rawAssignment)),
   'An ordinary field with a similar name is not treated as an assignment');
  assert.ok(html.includes('<b>Назначение №1\n:</b> '+escape(rawAssignment)+' → '+escape(rawAssignment)),
   'A field with trailing whitespace is not treated as an exact assignment label');
  assert.ok(html.includes('Причина: '+escape(sourceComment)));
  assert.equal(a.state().equipmentRequests[0].history[0].changes[0].from,rawAssignment);
  unchanged(a,before);
 });

 test(mode+': rendered invalid timestamps and assignment history cannot inject markup',()=>{
  const a=setup(mode),attack='2026-11-06T08:00\"><img src=x onerror=alert(1)>';
  a.run('state.equipmentRequests[0].items[0].start='+JSON.stringify(attack)+';state.equipmentRequests[0].items[0].end=null;');
  a.run('state.equipmentRequests[0].history[0].changes[0].from='+JSON.stringify('<svg onload=alert(1)> / Машинист / '+attack+' / 2026-11-07T17:45')+';');
  const before=snapshot(a);a.run("role='mechanic';requestDetails('date-request-0');");
  const html=modal(a);assert.doesNotMatch(html,/<img\b|<script\b|<svg\b[^>]*\bonload/);
  assert.ok(html.includes('Некорректная дата'));assert.ok(html.includes('&lt;svg onload=alert(1)&gt;'));
  assert.ok(!html.includes(attack));assert.deepEqual(a.state(),before.state);
  assert.equal(a.writes.length,before.writes);assert.deepEqual([...a.storage],before.storage);
 });

 test(mode+': saving a real assignment edit preserves original timestamps and raw audit values on reload',()=>{
  const a=setup(mode);selectRole(a,'manager-a');const before=snapshot(a),r=before.state.equipmentRequests[0];
  a.run("requestModal('date-request-0');");const form=a.form('#request-form');
  a.requestItems([{...r.items[0],operator:'Машинист Р'}]);
  const {customer,object,comment,contact,phone,followup,arrival,dispatchStage,status}=r;
  a.submit(form,{customer,object,comment,contact,phone,followup,arrival,dispatchStage,status,changeReason:'Синтетическая замена машиниста'});
  const saved=a.state(),changed=saved.equipmentRequests[0],audit=changed.history.at(-1).changes.find(c=>c.field==='Назначение №1');
  assert.equal(changed.items[0].start,rawStart);assert.equal(changed.items[0].end,rawEnd);assert.equal(changed.items[0].operator,'Машинист Р');
  assert.equal(audit.from,rawAssignment);
  assert.equal(audit.to,'Тестовый экскаватор / секция А · ID date-asset-a · ТЕСТ-11 / Машинист Р / 2026-11-06T08:00 / 2026-11-07T17:45');
  assert.equal(changed.comment,sourceComment);assert.deepEqual(saved.operations,before.state.operations);
  assert.deepEqual(saved.equipmentRequests[1],before.state.equipmentRequests[1]);
  assert.equal(a.writes.length,before.writes+1);assert.deepEqual(a.reload().state(),saved);
  for(const [key,value] of before.storage)if(key!==a.activeKey())assert.equal(a.storage.get(key),value);
  const history=a.run('requestHistoryHtml(state.equipmentRequests[0])');
  assert.ok(history.includes('Машинист Р / 06.11.2026, 08:00 / 07.11.2026, 17:45'));
  assert.equal(a.state().equipmentRequests[0].history.at(-1).changes.find(c=>c.field==='Назначение №1').to,audit.to);
 });
}
