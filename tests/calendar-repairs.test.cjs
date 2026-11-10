const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./fixtures/browser-app.cjs');

const asset='asset:stable-42';
const record=(id,extra={})=>({id,machine:asset,number:'ЗР-'+id,type:'Проверка узла',kind:'repair',status:'progress',blocking:true,readyConfirmed:false,...extra});
function setup(repairs){
  const a=browser({mode:'working'});
  a.run(`replaceState({...initialState(),machines:[{id:${JSON.stringify(asset)},name:'Тестовая машина',type:'Тестовый тип',status:'free'},{id:'asset:other',name:'Тестовая машина',type:'Тестовый тип',status:'free'}]});role='director';state.maintenance=${JSON.stringify(repairs)};`);
  return a;
}
const projection=(a,day)=>a.json(`(()=>{const s=calendarRepairState(${JSON.stringify(asset)},${JSON.stringify(day)});return {scheduled:s.scheduled.map(r=>r.id),uncertain:s.uncertain.map(r=>r.id)}})()`);

test('repair calendar validates real ISO days and supports leap dates without normalizing invalid input',()=>{
  const a=setup([record('leap',{planDate:'2028-02-29',dueDate:'2028-02-29',blocking:false})]);
  for(const day of ['2026-02-29','2026-04-31','2026-13-01','2026-11-7','07.11.2026','2026-11-07T00:00:00Z',''])assert.deepEqual(projection(a,day),{scheduled:[],uncertain:[]});
  assert.deepEqual(projection(a,'2028-02-29'),{scheduled:['leap'],uncertain:[]});
  assert.equal(a.run("calendarRepairIndex(['2026-02-29','2028-02-29','2028-02-29']).get('asset:stable-42').size"),1);
});

test('repair plan is bounded while overdue and unknown current availability remain uncertain',()=>{
  const a=setup([
    record('bounded',{date:'2026-11-06',planDate:'2026-11-07',dueDate:'2026-11-09',blocking:false}),
    record('unknown-start',{dueDate:'2026-11-09'}),
    record('unknown-end',{startedAt:'2026-11-05T10:00:00Z'}),
    record('invalid-end',{date:'2026-11-05',dueDate:'2026-11-31'}),
    record('contradictory',{startDate:'2026-11-10',dueDate:'2026-11-08'}),
    record('future-actual',{startedAt:'2026-11-10T10:00:00Z',dueDate:'2026-11-12'}),
    record('future-plan',{planDate:'2026-11-10',dueDate:'2026-11-12'}),
    record('future-service',{kind:'service',blocking:false,planDate:'2026-11-10',dueDate:'2026-11-12'})
  ]);
  const current=projection(a,'2026-11-07');
  assert.deepEqual(current.scheduled,['bounded']);
  assert.deepEqual(current.uncertain,['unknown-start','unknown-end','invalid-end','contradictory','future-actual','future-plan']);
  assert.deepEqual(projection(a,'2026-11-09').scheduled,['bounded']);
  assert.ok(projection(a,'2026-11-10').uncertain.includes('bounded'));
  assert.ok(projection(a,'2026-11-10').uncertain.includes('future-actual'));
  assert.deepEqual(projection(a,'2026-11-10').scheduled,['future-plan','future-service']);
  assert.deepEqual(projection(a,'2026-11-04'),{scheduled:[],uncertain:[]});
});

test('legacy missing deadlines and readiness never create a deadline or release a blocked repair',()=>{
  const a=setup([record('legacy',{status:'done',date:'2026-11-01',readyConfirmed:undefined})]);
  a.run('initializeWorkshop();syncMachineStatuses();');
  const legacy=a.state().maintenance[0];
  assert.equal(legacy.dueDate,'');
  assert.equal(legacy.readyConfirmed,false);
  assert.equal(a.run(`machine(${JSON.stringify(asset)}).status`),'repair');
  assert.deepEqual(projection(a,'2026-11-07'),{scheduled:[],uncertain:['legacy']});
  a.run(`globalThis.newUndatedRepair=newRepairRecord({machine:${JSON.stringify(asset)},type:'Без срока',blocking:true});`);
  assert.equal(a.run('newUndatedRepair.dueDate'),'');
  a.run('repairForm();');
  assert.match(a.form('#modal-root').innerHTML,/name="dueDate" type="date" value="2026-11-07"[^>]*required/);
});

test('released repairs project only valid factual start and completion bounds',()=>{
  const a=setup([
    record('factual',{status:'done',readyConfirmed:true,blocking:false,date:'2026-10-01',startedAt:'2026-11-03T10:00:00Z',releasedAt:'2026-11-05T12:00:00Z'}),
    record('fallback-fields',{status:'done',readyConfirmed:true,blocking:false,startedAt:'2026-02-29T10:00:00Z',startDate:'2026-11-04',releasedAt:'invalid',completedAt:'2026-11-06T12:00:00Z'}),
    record('no-actual-start',{status:'done',readyConfirmed:true,date:'2026-11-01',dueDate:'2026-11-05',completedAt:'2026-11-05T12:00:00Z'}),
    record('future-end',{status:'done',readyConfirmed:true,startedAt:'2026-11-03',completedAt:'2026-11-09T12:00:00Z'}),
    record('reverse-history',{status:'done',readyConfirmed:true,startedAt:'2026-11-06',completedAt:'2026-11-03T12:00:00Z'})
  ]);
  assert.deepEqual(projection(a,'2026-11-02'),{scheduled:[],uncertain:[]});
  assert.deepEqual(projection(a,'2026-11-04'),{scheduled:['factual','fallback-fields'],uncertain:[]});
  assert.deepEqual(projection(a,'2026-11-06'),{scheduled:['fallback-fields'],uncertain:[]});
  assert.deepEqual(projection(a,'2026-11-09'),{scheduled:[],uncertain:[]});
});

test('repair details include every current record and matching closed records, escape data and remain readonly',()=>{
  const a=setup([
    record('open-undated',{number:'<ЗР>',type:'<Узел>',note:'<script>bad()</script>',assignee:'<Механик>',date:'2026-11-01',dueDate:'bad',history:{malformed:true}}),
    record('open-future',{status:'planned',planDate:'2026-11-10',dueDate:'2026-11-12'}),
    record('awaiting-release',{status:'done',dueDate:'2026-11-05'}),
    record('matched-history',{status:'done',readyConfirmed:true,startedAt:'2026-11-03',releasedAt:'2026-11-05'}),
    record('other-history',{status:'done',readyConfirmed:true,startedAt:'2026-10-03',releasedAt:'2026-10-05'}),
    record('different-machine',{machine:'asset:other',note:'DO NOT SHOW'})
  ]);
  const before=a.state(),writes=a.writes.length,attempts=a.attempts.length;
  a.run(`calendarRepairIndex(['2026-11-04','2026-11-07']);openCalendarRepairs(${JSON.stringify(asset)},'2026-11-04');`);
  const html=a.form('#modal-root').innerHTML;
  assert.equal((html.match(/class="calendar-repair-card"/g)||[]).length,4);
  assert.match(html,/ЗР-open-future/);
  assert.match(html,/ЗР-awaiting-release/);
  assert.match(html,/ЗР-matched-history/);
  assert.doesNotMatch(html,/ЗР-other-history|DO NOT SHOW/);
  assert.match(html,/&lt;ЗР&gt;|&lt;Узел&gt;/);
  assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html,/<dt>Фактическое начало<\/dt><dd>Дата начала неизвестна<\/dd>/);
  assert.match(html,/<dt>Дата заявки \/ регистрации<\/dt><dd>01\.11\.2026<\/dd>/);
  assert.match(html,/<dt>Плановое окончание<\/dt><dd>Срок не указан<\/dd>/);
  assert.match(html,/<dt>Техническая готовность<\/dt><dd>Не подтверждена<\/dd>/);
  assert.match(html,/Срок прошёл/);
  assert.match(html,/asset:stable-42/);
  assert.doesNotMatch(html,/<form|<input|<select|<textarea|data-repair=|repair-release|repair-complete|data-machine=/);
  assert.equal((html.match(/<button\b/g)||[]).length,2,'Only the modal close icon and close button are interactive');
  assert.deepEqual(a.state(),before);
  assert.equal(a.writes.length,writes);
  assert.equal(a.attempts.length,attempts);
  a.run(`openCalendarRepairs(${JSON.stringify(asset)},'2026-02-29');`);
  assert.equal(a.form('#modal-root').innerHTML,html,'Invalid days cannot select a different history');
  a.run(`role='mechanic';openCalendarRepairs(${JSON.stringify(asset)});`);
  assert.equal((a.form('#modal-root').innerHTML.match(/class="calendar-repair-card"/g)||[]).length,3,'Mechanics can view current calendar repair cards');
  assert.doesNotMatch(a.form('#modal-root').innerHTML,/<form|<input|<select|<textarea|repair-release|repair-complete/);
  assert.deepEqual(a.state(),before);assert.equal(a.attempts.length,attempts);
  a.run(`role='dispatcher';openCalendarRepairs(${JSON.stringify(asset)});`);
  assert.equal((a.form('#modal-root').innerHTML.match(/class="calendar-repair-card"/g)||[]).length,3);
});

test('repair projection uses maintenance records and never fabricates intervals from machine status',()=>{
  const a=setup([]);
  a.run(`machine(${JSON.stringify(asset)}).status='repair';`);
  assert.deepEqual(projection(a,'2026-11-07'),{scheduled:[],uncertain:[]});
  assert.equal(a.run("calendarRepairIndex(['2026-11-07']).size"),0);
});
