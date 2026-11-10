const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./fixtures/browser-app.cjs');

const primary={
 director:['dashboard','requests','fleet','maintenance','finance'],
 dispatcher:['requests','fleet','objects','maintenance'],
 mechanic:['maintenance','requests','fleet','inventory'],
 operator:['shifts','maintenance'],
 accountant:['accountant']
};
const permitted={
 director:['accountant','dashboard','fleet','objects','finance','efficiency','requests','shifts','waybills','timesheets','maintenance','inventory','procurement','reports','directories','settings'],
 dispatcher:['dashboard','fleet','objects','requests','shifts','waybills','maintenance','reports','settings'],
 mechanic:['dashboard','fleet','requests','shifts','waybills','timesheets','maintenance','inventory','procurement','settings'],
 operator:['shifts','maintenance','settings'],
 accountant:['accountant','settings']
};
const navIds=html=>[...html.matchAll(/data-nav="([^"]+)"/g)].map(x=>x[1]);
const metricValues=html=>[...html.matchAll(/class="stat-value"[^>]*>(.*?)<\/div>/gs)].map(m=>m[1].replace(/<[^>]*>/g,'').trim());

test('Role switching lands in each role workflow and displays its explicit primary navigation',()=>{
 const a=browser();
 const choices=['director',...a.json('demoManagers').map(name=>'dispatcher:'+name),'mechanic','operator','accountant'];
 for(const choice of choices){
  const role=choice.startsWith('dispatcher:')?'dispatcher':choice;
  a.run('render();');
  a.form('#role').onchange({target:{value:choice}});
  assert.equal(a.run('view'),primary[role][0],choice);
  assert.deepEqual(navIds(a.run('sidebarNavigation()')),[...primary[role],'more'],choice+' sidebar');
  assert.deepEqual(navIds(a.run('mobileNavigation()')),[...primary[role].slice(0,4),'more'],choice+' mobile');
  if(role==='dispatcher')assert.equal(a.run('currentManager()'),choice.slice('dispatcher:'.length));
 }
});

test('All sections retains every permitted destination without making the primary menu a permission list',()=>{
 const a=browser();
 for(const role of Object.keys(primary)){
  a.run('role='+JSON.stringify(role)+';view="more";');
  assert.deepEqual(a.json('allowed[role]').sort(),[...permitted[role]].sort(),role);
  assert.deepEqual(navIds(a.run('morePage()')).sort(),[...permitted[role]].sort(),role);
  for(const destination of permitted[role]){
   a.run('go('+JSON.stringify(destination)+');');
   assert.equal(a.run('view'),destination,role+'/'+destination);
  }
  for(const destination of permitted.director.filter(id=>!permitted[role].includes(id))){
   a.run('view="more";go('+JSON.stringify(destination)+');');
   assert.equal(a.run('view'),'more',role+' cannot navigate to '+destination);
  }
 }
});

test('Role headers omit irrelevant search and import period controls and guard sensitive primary actions',()=>{
 const a=browser();
 a.run('globalThis.actions=[];requestModal=()=>actions.push("request");shiftModal=()=>actions.push("shift");serviceModal=()=>actions.push("repair");stockModal=()=>actions.push("stock");operationModal=()=>actions.push("finance");');
 for(const role of Object.keys(primary)){
  a.run('role='+JSON.stringify(role)+';view='+JSON.stringify(primary[role][0])+';render();');
  const html=a.form('#app').innerHTML;
  assert.equal(html.includes('id="global-search-form"'),!['operator','accountant'].includes(role),role+' search');
  if(role==='accountant')assert.doesNotMatch(html,/id="period"|data-action="add-/);
  a.run('view="requests";');
  assert.equal(a.run('primaryAction().includes("add-request")'),['director','dispatcher'].includes(role),role+' create request');
  a.run('view="maintenance";');
  assert.equal(a.run('primaryAction().includes("add-service")'),['director','mechanic'].includes(role),role+' create repair');
  a.run('actions=[];["add-request","add-shift","add-service","stock-move","add-operation"].forEach(handleAction);');
  const expected={director:['request','shift','repair','stock','finance'],dispatcher:['request'],mechanic:['shift','repair','stock'],operator:['shift'],accountant:[]};
  assert.deepEqual(a.json('actions'),expected[role],role+' action guards');
 }
});

test('Finance and efficiency stay reachable after finance filters refresh the page content',()=>{
 const a=browser();
 a.run('view="finance";render();');
 assert.match(a.form('#app').innerHTML,/aria-label="Финансы и эффективность"/);
 a.run('kindFilter="expense";updatePage();');
 assert.deepEqual(navIds(a.form('#page-content').innerHTML).slice(0,2),['finance','efficiency']);
 a.run('go("efficiency");');
 assert.match(a.form('#app').innerHTML,/data-nav="finance"/);
 assert.match(a.run('sidebarNavigation()'),/class="nav-button active" data-nav="finance"/);
 assert.match(a.form('#app').innerHTML,/aria-label="Финансы и эффективность"/);
});

test('Director today count uses unique approved positive-hour assets including an asset later blocked for repair',()=>{
 const a=browser({mode:'working'});
 a.run(`replaceState({...initialState(),machines:Array.from({length:5},(_,i)=>({id:'asset-'+i,name:'Техника '+i})),
  shifts:[
   {id:'one',machine:'asset-0',date:today(),status:'approved',hours:4},
   {id:'duplicate',machine:'asset-0',date:today(),status:'approved',hours:3},
   {id:'blocked',machine:'asset-1',date:today(),status:'approved',hours:2},
   {id:'pending',machine:'asset-2',date:today(),status:'pending',hours:8},
   {id:'zero',machine:'asset-3',date:today(),status:'approved',hours:0},
   {id:'old',machine:'asset-4',date:'2026-11-06',status:'approved',hours:8},
   {id:'invalid',machine:'asset-4',date:today(),status:'approved',hours:Infinity},
   {id:'unknown',machine:'absent',date:today(),status:'approved',hours:8}
  ],maintenance:[{id:'repair',machine:'asset-1',blocking:true,readyConfirmed:false,status:'progress'}],
  equipmentRequests:[{status:'Назначена',items:[{machine:'asset-3',start:today()+'T08:00',end:today()+'T18:00'}]}]
 });syncMachineStatuses();`);
 const before=a.state(),html=a.run('dashboardPage()');
 const operational=html.slice(html.indexOf('director-operational'),html.indexOf('<h2>Динамика финансов'));
 assert.deepEqual(metricValues(operational),['5','2']);
 assert.match(operational,/Отработали сегодня/);
 assert.match(operational,/не складывается с текущими статусами/);
 assert.equal(a.run('machines.filter(m=>m.status==="work").length'),2,'The presentation rejects invalid hours even when the existing status classifier accepts them');
 assert.match(operational,/Свободны<\/span><strong>1/);
 assert.match(operational,/Зарезервированы, без смены сегодня<\/span><strong>1/);
 assert.match(operational,/Ремонт \/ нет допуска<\/span><strong>1/);
 assert.deepEqual(a.state(),before,'Presentation does not change records');
});

test('Financial values stay intact while fictional amounts and partial current-month comparisons are labelled accurately',()=>{
 const a=browser();
 const totals=a.json('overallFinance()');
 assert.deepEqual(totals,{income:6660000,expense:3472000});
 a.run('period="2026-11";');
 const current=a.run('dashboardPage()');
 assert.deepEqual(metricValues(current).slice(0,4),['6 660 000 ₽','3 472 000 ₽','3 188 000 ₽','47,9%']);
 assert.match(current,/Условные суммы для демонстрации интерфейса/);
 assert.match(current,/Текущий месяц не завершён/);
 for(const period of ['2026-10','all']){
  a.run('period='+JSON.stringify(period)+';');
  assert.doesNotMatch(a.run('dashboardPage()'),/Текущий месяц не завершён/);
 }
 assert.doesNotMatch(a.run('financePageHtml()'),/Встроенные финансовые суммы отключены/);
 a.run('period="2026-11";');
 assert.deepEqual(a.json('overallFinance()'),totals);
 const working=browser({mode:'working'});
 assert.doesNotMatch(working.run('financialStats()'),/Условные суммы/);
 assert.match(working.run('financialStats()'),/источник каждой новой записи необходимо подтвердить/);
});
