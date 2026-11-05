// Fictional demonstration records only. Never populate this module from accounting uploads.
export const demoSeed = Object.freeze({
  mode: 'DEMO',
  machines: [
    {id:'JCB-DEMO-01',name:'Экскаватор-погрузчик JCB',status:'working',objectId:'OBJ-01'},
    {id:'MINI-DEMO-01',name:'Мини-погрузчик',status:'service',objectId:'OBJ-02'},
    {id:'CRANE-DEMO-01',name:'Автокран',status:'working',objectId:'OBJ-03'}
  ],
  objects: [
    {id:'OBJ-01',name:'Демо — Коммунарка'},
    {id:'OBJ-02',name:'Демо — ЖК Хорошёвский'},
    {id:'OBJ-03',name:'Демо — ЖК Сити Парк'}
  ],
  shifts: [
    {id:'SHIFT-01',machineId:'JCB-DEMO-01',objectId:'OBJ-01',hours:8,status:'closed'},
    {id:'SHIFT-02',machineId:'CRANE-DEMO-01',objectId:'OBJ-03',hours:7,status:'closed'},
    {id:'SHIFT-03',machineId:'JCB-DEMO-01',objectId:'OBJ-01',hours:0,status:'open'}
  ],
  parts: [{id:'PART-01',name:'Фильтр гидравлический',quantity:6,unitCost:2100}],
  repairs: [{id:'REPAIR-01',machineId:'MINI-DEMO-01',status:'open',description:'Плановое обслуживание'}],
  transactions: [
    {id:'TX-01',machineId:'JCB-DEMO-01',kind:'income',amount:185000,description:'Демонстрационная выручка'},
    {id:'TX-02',machineId:'JCB-DEMO-01',kind:'expense',amount:42000,description:'Демонстрационные расходы'},
    {id:'TX-03',machineId:'CRANE-DEMO-01',kind:'income',amount:260000,description:'Демонстрационная выручка'}
  ]
});
export function demoTotals(state) {
  const sum=kind=>state.transactions.filter(x=>x.kind===kind).reduce((n,x)=>n+x.amount,0);
  const revenue=sum('income'),expenses=sum('expense');
  return {revenue,expenses,profit:revenue-expenses};
}
export function applyDemoAction(state,role,action) {
  if (!state || state.mode!=='DEMO') throw Error('Demo mode required');
  const permissions={
    director:['addTransaction','closeShift','usePart','createRepair'],
    owner:['addTransaction','closeShift','usePart','createRepair'],
    accountant:['addTransaction'],
    dispatcher:['closeShift'],
    mechanic:['usePart','createRepair'],
    operator:[]
  };
  if (!permissions[role]?.includes(action.type)) throw Error('Forbidden');
  const next=structuredClone(state);
  if (action.type==='addTransaction') {
    if (!['income','expense'].includes(action.kind)||!Number.isSafeInteger(action.amount)||action.amount<=0||!next.machines.some(x=>x.id===action.machineId))throw Error('Invalid transaction');
    next.transactions.push({id:'TX-'+crypto.randomUUID(),machineId:action.machineId,kind:action.kind,amount:action.amount,description:String(action.description||'').slice(0,200)});
  } else if(action.type==='closeShift') {
    const shift=next.shifts.find(x=>x.id===action.shiftId);
    if(!shift||shift.status==='closed'||!Number.isFinite(action.hours)||action.hours<0||action.hours>24)throw Error('Invalid shift');
    shift.hours=action.hours;shift.status='closed';
  } else if(action.type==='createRepair') {
    if(!next.machines.some(x=>x.id===action.machineId))throw Error('Unknown machine');
    next.repairs.push({id:'REPAIR-'+crypto.randomUUID(),machineId:action.machineId,status:'open',description:String(action.description||'').slice(0,200)});
  } else if(action.type==='usePart') {
    const part=next.parts.find(x=>x.id===action.partId);
    if(!part||!Number.isSafeInteger(action.quantity)||action.quantity<=0||part.quantity<action.quantity||!next.machines.some(x=>x.id===action.machineId))throw Error('Invalid part issue');
    part.quantity-=action.quantity;
    next.transactions.push({id:'TX-'+crypto.randomUUID(),machineId:action.machineId,kind:'expense',amount:part.unitCost*action.quantity,description:'Списание: '+part.name});
  }
  return next;
}
