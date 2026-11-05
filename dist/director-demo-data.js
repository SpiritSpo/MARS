'use strict';
// A fictional, isolated presentation dataset. No company accounting files are used.
window.MARS_DIRECTOR_DEMO = (() => {
  const objects = [
    {id:'o1',name:'Коммунарка',address:'Москва · Новомосковский округ',manager:'Андрей Соколов',demo:true},
    {id:'o2',name:'ЖК Хорошёвский',address:'Москва · Хорошёво-Мнёвники',manager:'Дмитрий Орлов',demo:true},
    {id:'o3',name:'ЖК Сити Парк',address:'Москва · Пресненский район',manager:'Сергей Волков',demo:true}
  ];
  // Figures and equipment characteristics restored from the pre-clearance MARS demo.
  const fleet = [
    ['M001','Bobcat S650','Мини-погрузчик','o1','Алексей Морозов',425000,184000,148,176,1248,5600000,2900,2021,'2026-11-12'],
    ['M002','JCB 3CX','Экскаватор-погрузчик','o2','Михаил Иванов',510000,227000,156,176,3820,8400000,3300,2020,'2026-11-16'],
    ['M003','Liebherr 132 EC-H','Башенный кран','o1','Армен Петросян',1250000,682000,172,192,6310,22000000,7300,2018,'2026-11-20'],
    ['M004','Potain MDT 219','Башенный кран','o3','Владимир Смирнов',1130000,590000,164,192,4270,19500000,6900,2019,'2026-11-22'],
    ['M005','КС-55713','Автокран','o2','Роман Козлов',790000,418000,136,176,5180,12000000,5800,2020,'2026-11-09'],
    ['M006','КС-65719','Автокран','o2','Павел Павлов',940000,512000,144,176,3900,16500000,6500,2021,'2026-11-14'],
    ['M007','Lonking CDM312','Мини-погрузчик','o3','Иван Петров',360000,176000,140,176,950,3900000,2600,2023,'2026-11-19'],
    ['M008','JCB 531-70','Телескопический погрузчик','o2','Александр Егоров',460000,232000,104,176,2870,9600000,4400,2020,'2026-11-02'],
    ['M009','КАМАЗ 65115','Самосвал','o1','Сергей Фёдоров',550000,318000,152,176,7140,7100000,3600,2019,'2026-11-18'],
    ['M010','Hyundai Porter','Грузовой автомобиль','o2','Виктор Николаев',245000,133000,128,176,2080,2800000,1900,2021,'2026-11-25']
  ];
  const expenseCategories=['Топливо','Запчасти','Ремонт и ТО','Зарплата','Прочие расходы'];
  const stock = [
    {id:'part-1',name:'Фильтр масляный JCB',sku:'02/100284',unit:'шт.',qty:4,min:2},
    {id:'part-2',name:'Масло моторное 10W-40',sku:'OIL-10W40',unit:'л',qty:120,min:40},
    {id:'part-3',name:'Фильтр воздушный Bobcat',sku:'6673752',unit:'шт.',qty:1,min:2},
    {id:'part-4',name:'Смазка универсальная',sku:'GREASE-400',unit:'шт.',qty:18,min:5},
    {id:'part-5',name:'Фильтр топливный',sku:'FUEL-01',unit:'шт.',qty:6,min:3},
    {id:'part-6',name:'Рукав высокого давления',sku:'RVD-12',unit:'шт.',qty:2,min:2}
  ];
  const isoDay=(day,offset)=>new Date(Date.parse(day+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
  const slot=(day,offset,hour)=>isoDay(day,offset)+'T'+hour;
  const request=(id,owner,customer,object,items,followup='Не уточняли')=>({
    id,number:'ЗТ-'+id.slice(-4),owner,customer,object,items,comment:'Учебная заявка для демонстрации календаря',contact:'Демо-заказчик',phone:'',followup,
    arrival:'Запланирована',dispatchStage:'Назначена',releaseConfirmed:false,status:'Назначена',history:[
      {by:owner,at:'2026-11-04T09:00:00.000Z',action:'Создание заявки',reason:'Демонстрационный пример',changes:[]}
    ],demo:true
  });
  function createState(day){
    const machines=fleet.map(([id,name,type,object,operator,income,expense,hours,plan,meter,cost,rate,year,service])=>({
      id,name,type,object,operator,income,expense,hours,plan,meter,cost,rate,year,service,status:'free',demo:true
    }));
    const operations=machines.flatMap(m=>['2026-10','2026-11'].flatMap(month=>{
      const factor=month==='2026-10'?0.94:1;
      const totalExpense=Math.round(m.expense*factor),income=Math.round(m.income*factor);
      let assigned=0;
      return [
        {id:'demo-'+month+'-'+m.id+'-income',machine:m.id,kind:'income',category:'Аренда техники',amount:income,date:month+'-01',note:'Условная выручка за месяц',seed:true,demo:true},
        ...expenseCategories.map((category,i)=>{
          const amount=i===4?totalExpense-assigned:Math.round(totalExpense*[.23,.19,.14,.36,.08][i]);
          assigned+=amount;
          return {id:'demo-'+month+'-'+m.id+'-cost-'+i,machine:m.id,kind:'expense',category,amount,date:month+'-01',note:'Условные расходы за месяц',seed:true,demo:true};
        })
      ];
    }));
    const shifts=[
      {id:'shift-101',machine:'M001',date:'2026-11-01',hours:8,meter:1248,condition:'ok',note:'Замечаний нет',status:'pending'},
      {id:'shift-102',machine:'M002',date:day,hours:8,meter:3828,condition:'ok',note:'Работа на объекте',status:'pending'},
      {id:'shift-103',machine:'M007',date:'2026-11-01',hours:7,meter:950,condition:'ok',note:'Завершена работа на объекте',status:'approved',waybill:'ПЛ-0001'},
      {id:'shift-104',machine:'M001',date:day,hours:8,meter:1256,condition:'ok',note:'Демо-смена',status:'approved',waybill:'ПЛ-0002'},
      {id:'shift-105',machine:'M003',date:day,hours:8,meter:6318,condition:'ok',note:'Демо-смена',status:'approved',waybill:'ПЛ-0003'},
      {id:'shift-106',machine:'M009',date:day,hours:10,meter:7150,condition:'ok',note:'Демо-смена',status:'approved',waybill:'ПЛ-0004'}
    ];
    const maintenance=[
      {id:'service-101',machine:'M008',date:'2026-11-02',dueDate:isoDay(day,1),type:'Ремонт гидравлики',note:'Диагностика и замена уплотнений',kind:'repair',status:'progress',assignee:'Демо · Механик № 1',blocking:true,readyConfirmed:false,priority:'high',laborCost:12000,externalCost:8000,parts:[],demo:true},
      {id:'service-102',machine:'M005',date:'2026-11-09',dueDate:isoDay(day,3),type:'Плановое ТО',note:'Масло, фильтры, проверка тормозной системы',kind:'service',status:'planned',assignee:'Демо · Механик № 2',blocking:false,priority:'normal',parts:[],demo:true},
      {id:'service-103',machine:'M001',date:'2026-11-12',dueDate:isoDay(day,7),type:'Плановое ТО',note:'Замена масла и фильтров',kind:'service',status:'planned',assignee:'Демо · Механик № 1',blocking:false,priority:'normal',parts:[],demo:true},
      {id:'service-104',machine:'M009',date:isoDay(day,-2),dueDate:isoDay(day,2),type:'Диагностика ходовой',note:'Проверить замечание машиниста',kind:'repair',status:'new',assignee:'Не назначен',blocking:false,priority:'normal',parts:[],demo:true}
    ];
    const equipmentRequests=[
      request('req-0001','Алексей Иванов','МонАрх · участок А','Коммунарка',[{machine:'M001',operator:'Алексей Морозов',start:slot(day,0,'08:00'),end:slot(day,2,'18:00')},{machine:'M002',operator:'Михаил Иванов',start:slot(day,0,'08:00'),end:slot(day,2,'18:00')}]),
      request('req-0002','Дмитрий Петров','МонАрх · участок Б','ЖК Сити Парк',[{machine:'M004',operator:'Владимир Смирнов',start:slot(day,1,'08:00'),end:slot(day,5,'18:00')}]),
      request('req-0003','Алексей Иванов','МонАрх · участок В','ЖК Хорошёвский',[{machine:'M005',operator:'Роман Козлов',start:slot(day,3,'08:00'),end:slot(day,7,'17:00')}],'Ожидается ответ'),
      request('req-0004','Дмитрий Петров','МонАрх · участок Г','ЖК Хорошёвский',[{machine:'M006',operator:'Павел Павлов',start:slot(day,0,'09:00'),end:slot(day,0,'23:59')}],'Ожидается ответ'),
      request('req-0005','Дмитрий Петров','МонАрх · участок Д','ЖК Хорошёвский',[{machine:'M010',operator:'Виктор Николаев',start:slot(day,4,'09:00'),end:slot(day,9,'18:00')}])
    ];
    const purchaseRequests=[
      {id:'demo-purchase-1',number:'СН-000101',item:'Комплект фильтров JCB',qty:2,price:3200,machine:'M008',note:'Для ремонта и ТО',status:'На согласовании',at:day+'T09:00:00.000Z',history:[],demo:true},
      {id:'demo-purchase-2',number:'СН-000102',item:'Гидравлический рукав',qty:1,price:4800,machine:'M008',note:'Заявка механика',status:'Согласована',at:day+'T09:30:00.000Z',history:[],demo:true}
    ];
    return {
      version:1,demoVersion:'director-full-v1',machines,objects:objects.map(o=>({...o})),
      operations,shifts,maintenance,stock:stock.map(p=>({...p})),
      stockMoves:[
        {id:'demo-stock-1',date:isoDay(day,-3),part:'part-2',kind:'receipt',qty:40,machine:'',note:'Учебное поступление'},
        {id:'demo-stock-2',date:isoDay(day,-1),part:'part-3',kind:'issue',qty:1,machine:'M001',note:'Учебная выдача'}
      ],
      equipmentRequests,purchaseRequests,machinePhotos:{},operatorMachine:'M001'
    };
  }
  return {version:'director-full-v1',createState,objects,expectedMachineCount:fleet.length};
})();
