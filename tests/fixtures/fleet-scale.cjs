'use strict';

// Synthetic browser data for repeatable scale checks. Never load this fixture
// into dist: names and aliases are deliberately unrelated to the demo catalog.
const scaleManagers=Object.freeze(['Алексей Иванов','Дмитрий Петров']);
const scaleSizes=Object.freeze([100,250,500]);
const pad=(n,width=5)=>String(n).padStart(width,'0');
const dayAt=(baseDate,offset)=>new Date(Date.parse(baseDate+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);

function createFleetScaleState({machineCount=100,requestCount=5000,repairCount=2000,baseDate='2026-11-07',activeRequestCount=Math.min(requestCount,Math.max(1,Math.floor(machineCount*.45)))}={}) {
  for(const [name,value] of Object.entries({machineCount,requestCount,repairCount})) {
    if(!Number.isInteger(value)||value<(name==='machineCount'?1:0))throw new RangeError(name+' must be a positive integer (record counts may be zero)');
  }
  if(!Number.isInteger(activeRequestCount)||activeRequestCount<0||activeRequestCount>requestCount)throw new RangeError('activeRequestCount must be between zero and requestCount');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)||!Number.isFinite(Date.parse(baseDate+'T12:00:00Z')))throw new RangeError('baseDate must be an ISO day');
  const objects=Array.from({length:Math.max(3,Math.ceil(machineCount/20))},(_,i)=>({id:'site-scale-'+pad(i+1,4),name:'Испытательный участок '+pad(i+1,3),address:'Синтетический адрес '+(i+1)}));
  const machines=Array.from({length:machineCount},(_,i)=>({
    id:'asset-'+pad(i+1),name:'Машина для проверки '+pad(i+1),type:['Экскаватор','Погрузчик','Самосвал','Кран'][i%4],
    object:objects[i%objects.length].id,operator:'Испытатель '+pad(i+1),status:'free',
    inventory:'ИНВ-'+pad(i+1),registration:'ТЕСТ-'+pad(i+1),serial:'SERIAL-SCALE-'+pad(i+1),
    year:2018+i%8,meter:1000+i*13,hours:0,plan:176,rate:2500+i%12*100,cost:5000000+i*10000
  }));
  // Enough live work to fill parts of the fortnight without introducing a
  // synthetic conflict on every machine/day. The remaining rows are history.
  const activeRequests=activeRequestCount;
  const equipmentRequests=Array.from({length:requestCount},(_,i)=>{
    const active=i<activeRequests,archivedIndex=i-activeRequests;
    const startOffset=active?(i*3)%14:-30-(Math.max(0,archivedIndex)*7)%700;
    const duration=active?i%2:1+i%4;
    const firstMachine=active?i:Math.abs(archivedIndex*17)%machineCount;
    const itemCount=machineCount>1&&i%4===0?2:1;
    const items=Array.from({length:itemCount},(_,j)=>{
      const m=machines[(firstMachine+j*Math.max(1,Math.floor(machineCount/2)))%machineCount];
      return {machine:m.id,operator:m.operator,start:dayAt(baseDate,startOffset)+'T08:00',end:dayAt(baseDate,Math.min(active?13:0,startOffset+duration))+'T18:00'};
    });
    const owner=scaleManagers[i%scaleManagers.length],cancelled=!active&&i%11===0;
    return {
      id:'request-scale-'+pad(i+1),number:'ЗТ-НАГРУЗКА-'+pad(i+1),owner,
      customer:'Заказчик для проверки '+pad(i%89+1,3),object:objects[i%objects.length].name,
      comment:'Синтетическая заявка для проверки объёма данных',contact:'Контакт '+pad(i%89+1,3),phone:'+7 000 000-00-00',
      status:active?['Назначена','В работе'][i%2]:cancelled?'Отменена':'Завершена',
      dispatchStage:active?['Назначена','На объекте'][i%2]:'Освобождена',
      followup:active?'Не уточняли':'Завершение согласовано',arrival:active?'Запланирована':'Приступила к работе',
      releaseConfirmed:!active,items,
      history:[{at:dayAt(baseDate,startOffset-2)+'T10:00:00Z',by:owner,action:'Создание заявки',reason:'Синтетические данные',changes:[{field:'Назначение №1',from:'—',to:items[0].machine}]}]
    };
  });
  const currentRepairs=Math.min(repairCount,Math.max(6,Math.floor(machineCount*.5)));
  const maintenance=Array.from({length:repairCount},(_,i)=>{
    const current=i<currentRepairs,scenario=current?i%6:5;
    const m=machines[(i*7+Math.floor(machineCount*.55))%machineCount];
    const planned=scenario===0,unknown=scenario===2,overdue=scenario===3,pendingRelease=scenario===4,released=scenario===5;
    const createdOffset=current?(planned?2:overdue?-7:released?-6:-2):-40-(i*11)%700;
    const date=unknown?'':dayAt(baseDate,createdOffset),dueDate=unknown?'':dayAt(baseDate,current?(planned?7:overdue?-3:2):createdOffset+2);
    return {
      id:'repair-scale-'+pad(i+1),number:'ЗР-НАГРУЗКА-'+pad(i+1),machine:m.id,
      kind:planned?'service':'repair',type:['Плановое обслуживание','Проверка гидросистемы','Диагностика без срока','Ожидание запасной части','Работы завершены, ожидается допуск','Архивный ремонт'][scenario],
      note:'Синтетическая запись для проверки календаря и связей по внутреннему ID',
      date,dueDate,createdAt:dayAt(baseDate,createdOffset)+'T09:00:00Z',
      ...(planned?{planDate:date}:!unknown?{startedAt:dayAt(baseDate,createdOffset)+'T10:00:00Z'}:{}),
      status:planned?'planned':overdue?'waiting':pendingRelease||released?'done':'progress',
      priority:overdue?'high':'normal',assignee:'Испытатель механик '+(i%2+1),reportedBy:'Испытатель диспетчер',
      blocking:!planned&&!released,readyConfirmed:released,photos:[],parts:[],laborCost:released?1500:0,externalCost:0,
      ...(pendingRelease||released?{completedAt:dayAt(baseDate,pendingRelease?-1:createdOffset+2)+'T15:00:00Z',resultNote:'Проверка завершена'}:{}),
      ...(released?{releasedAt:dayAt(baseDate,createdOffset+3)+'T16:00:00Z'}:{}),
      history:[{at:dayAt(baseDate,createdOffset)+'T09:00:00Z',by:'Испытатель механик '+(i%2+1),text:'Синтетическая запись создана'}]
    };
  });
  return {version:1,machines,objects,equipmentRequests,maintenance,operations:[],shifts:[],stock:[],stockMoves:[],purchaseRequests:[],machinePhotos:{},workshopVersion:2};
}

module.exports={createFleetScaleState,scaleManagers,scaleSizes,dayAt};
