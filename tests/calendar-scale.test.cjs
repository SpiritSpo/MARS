'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {browser,keys}=require('./fixtures/browser-app.cjs');
const {createFleetScaleState,scaleManagers,scaleSizes,dayAt}=require('./fixtures/fleet-scale.cjs');

function scaleBrowser(state) {
  const a=browser({mode:'working',storage:new Map([[keys.working,JSON.stringify(state)]])});
  a.run("role='dispatcher';localStorage.setItem('mars-demo-manager','Алексей Иванов');view='requests';");
  return a;
}

function calendarHtml(html) {
  const start=html.indexOf('<section class="panel requests-calendar"');
  assert.ok(start>=0,'Calendar is rendered');
  return html.slice(start,html.indexOf('</section>',start)+10);
}

test('Scale fixtures have stable internal IDs and direct links independent of the demo catalog',()=>{
  const small=createFleetScaleState({machineCount:100,requestCount:80,repairCount:50});
  const large=createFleetScaleState({machineCount:500,requestCount:80,repairCount:50});
  assert.deepEqual(small.machines.map(m=>m.id),large.machines.slice(0,100).map(m=>m.id));
  for(const state of [small,large]) {
    const ids=new Set(state.machines.map(m=>m.id)),sites=new Set(state.objects.map(o=>o.id));
    assert.equal(ids.size,state.machines.length);
    assert.ok(state.machines.every(m=>/^asset-\d{5}$/.test(m.id)&&sites.has(m.object)));
    assert.ok(state.equipmentRequests.every(r=>scaleManagers.includes(r.owner)&&r.items.length>=1&&r.items.length<=2&&r.items.every(x=>ids.has(x.machine)&&x.start<x.end)&&r.history.length));
    assert.ok(state.maintenance.every(r=>ids.has(r.machine)&&r.history.length));
    assert.doesNotMatch(JSON.stringify(state),/M001|Bobcat|JCB|Коммунарка/);
  }
  assert.throws(()=>createFleetScaleState({activeRequestCount:5001}),RangeError);
});

for(const machineCount of scaleSizes) {
  test(`Calendar renders ${machineCount} machines with 5000 requests and 2000 repairs without losing links`,t=>{
    const state=createFleetScaleState({machineCount}),a=scaleBrowser(state);
    const began=performance.now(),html=a.run('requestsPage()'),elapsed=performance.now()-began,calendar=calendarHtml(html);
    // Timings are diagnostic only: shared CI hardware has no reliable fixed limit.
    t.diagnostic(`requestsPage: ${elapsed.toFixed(1)} ms; HTML ${html.length} characters`);
    assert.equal((calendar.match(/scope="row"/g)||[]).length,machineCount);
    assert.equal((calendar.match(/class="request-calendar-cell/g)||[]).length,machineCount*14);
    const requestIds=new Set(state.equipmentRequests.map(r=>r.id)),machineIds=new Set(state.machines.map(m=>m.id));
    const calendarRequestIds=new Set([...calendar.matchAll(/data-request-open="([^"]+)"/g)].map(match=>match[1]));
    const renderedRequestIds=new Set([...html.matchAll(/data-request-open="([^"]+)"/g)].map(match=>match[1]));
    for(const id of calendarRequestIds)assert.ok(requestIds.has(id),id);
    for(const [,id] of calendar.matchAll(/data-calendar-repair-machine="([^"]+)"/g))assert.ok(machineIds.has(id),id);
    assert.ok(html.includes('data-request-ownership="mine"'));
    assert.ok(html.includes('data-request-ownership="others"'));
    assert.deepEqual(renderedRequestIds,requestIds,'The full request list retains every record');
    const active=state.equipmentRequests.filter(r=>!r.releaseConfirmed&&r.status!=='Отменена');
    assert.equal(active.length,Math.floor(machineCount*.45));
    for(const r of active)assert.ok(calendarRequestIds.has(r.id),r.id+' has its recorded calendar booking');
    const days=Array.from({length:14},(_,i)=>dayAt('2026-11-07',i));
    const index=a.run('calendarRepairIndex('+JSON.stringify(days)+')');
    const repairs=new Set(state.maintenance.map(r=>r.id));
    for(const [id,byDay] of index)for(const [day,cell] of byDay) {
      assert.ok(machineIds.has(id));assert.ok(days.includes(day));
      for(const r of [...cell.scheduled,...cell.uncertain]){assert.equal(r.machine,id);assert.ok(repairs.has(r.id));}
    }
  });
}

test('A dense 500-machine workload keeps every one of 5000 active requests in the calendar',t=>{
  const state=createFleetScaleState({machineCount:500,activeRequestCount:5000}),a=scaleBrowser(state);
  const began=performance.now(),html=calendarHtml(a.run('requestsPage()'));
  t.diagnostic(`Dense requestsPage: ${(performance.now()-began).toFixed(1)} ms; calendar HTML ${html.length} characters`);
  assert.equal((html.match(/scope="row"/g)||[]).length,500);
  const rendered=new Set([...html.matchAll(/data-request-open="([^"]+)"/g)].map(match=>match[1]));
  assert.deepEqual(rendered,new Set(state.equipmentRequests.map(r=>r.id)));
});

test('Renaming display text and aliases preserves request, repair and card links by internal ID',()=>{
  const state=createFleetScaleState({machineCount:100}),a=scaleBrowser(state);
  const repair=state.maintenance[1],id=repair.machine,request=state.equipmentRequests.find(r=>!r.releaseConfirmed&&r.items.some(x=>x.machine===id));
  assert.ok(request,'A current booking shares this machine');
  const before=a.run("JSON.stringify({requests:state.equipmentRequests,repairs:state.maintenance})");
  a.run("Object.assign(machine("+JSON.stringify(id)+"),{name:'Переименованная машина',inventory:'НОВЫЙ-ИНВЕНТАРНЫЙ',registration:'НОВЫЙ-НОМЕР'});");
  const calendar=calendarHtml(a.run('requestsPage()'));
  assert.ok(calendar.includes('Переименованная машина'));
  assert.ok(calendar.includes(id));
  assert.ok(calendar.includes('data-request-open="'+request.id+'"'));
  assert.ok(calendar.includes('data-calendar-repair-machine="'+id+'"'));
  a.run('requestDetails('+JSON.stringify(request.id)+')');
  const requestCard=a.form('#modal-root').innerHTML;
  assert.ok(requestCard.includes('Переименованная машина'));
  assert.ok(requestCard.includes(id));
  assert.ok(requestCard.includes(request.number));
  a.run('openCalendarRepairs('+JSON.stringify(id)+',"2026-11-07")');
  const repairCard=a.form('#modal-root').innerHTML;
  assert.ok(repairCard.includes('Переименованная машина'));
  assert.ok(repairCard.includes(repair.number));
  assert.ok(repairCard.includes(id));
  assert.equal(a.run("JSON.stringify({requests:state.equipmentRequests,repairs:state.maintenance})"),before);
});
