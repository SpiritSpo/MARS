(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.MarsImport=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';

 // This module prepares a detached candidate. Only the caller may save it.
 // Financial sources and source registers deliberately have separate targets.
 const field=(key,label,required,aliases,hint)=>({key,label,required:!!required,aliases:aliases||[],hint:hint||''});
 const sourceFields=()=>[
  field('documentId','Документ',true,['document','document id','номер документа','ид документа','идентификатор документа'],'Устойчивый номер исходного документа, одинаковый при повторной выгрузке.'),
  field('sourceLine','Строка документа',true,['source line','line','номер строки','строка'],'Номер или устойчивый код строки внутри исходного документа.')
 ];
 const machineRef=required=>field('machineId','Код техники',required,['machine','machine id','equipment id','техника','машина','ид техники','идентификатор техники'],'Точный внутренний код; в расходах также ОБЩЕХОЗ или СКЛАД.');
 const objectRef=()=>field('objectId','Код объекта',false,['object','object id','объект','ид объекта','идентификатор объекта']);
 const employeeRef=required=>field('employeeId','Код сотрудника',required,['employee','employee id','operator id','operatorId','сотрудник','водитель','машинист','ид сотрудника']);
 const dateField=()=>field('date','Дата',true,['date','дата документа','дата смены'],'ДД.ММ.ГГГГ или ГГГГ-ММ-ДД.');
 const amountField=()=>field('amount','Сумма',true,['amount','стоимость','сумма руб','сумма рублей'],'Положительная сумма в рублях, не более двух знаков после запятой.');
 const noteField=()=>field('note','Комментарий',false,['note','примечание','описание']);
 const schemas={
  objects:{label:'Объекты',target:'objects',description:'Справочник объектов с устойчивыми внутренними кодами.',fields:[field('id','Код объекта',true,['id','код','object id','objectId','ид объекта']),field('name','Название объекта',true,['name','название','наименование','объект']),field('address','Адрес',false,['address']),field('manager','Ответственный',false,['manager'])]},
  employees:{label:'Сотрудники',target:'employees',description:'Справочник сотрудников; загрузка не создаёт учётных записей и прав доступа.',fields:[field('id','Код сотрудника',true,['id','код','employee id','employeeId','ид сотрудника','табельный номер']),field('name','ФИО',true,['name','фио сотрудника','сотрудник','фамилия имя отчество']),field('position','Должность',false,['position'])]},
  machines:{label:'Техника',target:'machines',description:'Техника и точные ссылки на объекты и сотрудников.',fields:[field('id','Код техники',true,['id','код','machine id','machineId','equipment id','ид техники']),field('name','Название техники',true,['name','название','наименование','марка и модель','модель']),field('type','Вид техники',true,['type','тип','тип техники','вид']),objectRef(),employeeRef(false),field('plate','Госномер',false,['plate','гос номер','государственный номер','регистрационный номер']),field('serial','Заводской номер',false,['serial','серийный номер']),field('vin','VIN',false,['vin номер']),field('year','Год выпуска',false,['year','год']),field('meter','Показание счётчика',false,['meter','счетчик','моточасы','пробег'])]},
  expenses:{label:'Расходы',target:'operations',description:'Подтверждённые расходы. Закупки СКЛАД не создают складское поступление и не входят в результат машины.',fields:[...sourceFields(),dateField(),machineRef(true),objectRef(),field('category','Статья',true,['category','категория','статья расходов']),amountField(),noteField()]},
  payroll:{label:'Зарплата',target:'payroll',description:'Отдельный реестр зарплаты для сверки; загрузка не добавляет её в расходы повторно.',fields:[...sourceFields(),field('period','Период',true,['period','месяц','расчетный период','период начисления'],'ГГГГ-ММ или ММ.ГГГГ.'),employeeRef(true),machineRef(false),objectRef(),amountField(),noteField()]},
  timesheets:{label:'Табели',target:'importedTimesheets',description:'Исходный реестр часов. Загрузка не подтверждает смены и не распределяет общие расходы.',fields:[...sourceFields(),dateField(),employeeRef(true),machineRef(true),objectRef(),field('hours','Часы',true,['hours','отработано часов','отработанные часы','фактические часы']),noteField()]},
  waybills:{label:'Путевые листы',target:'importedWaybills',description:'Реестр исходных путевых листов для сверки, без оформления юридически значимого документа.',fields:[...sourceFields(),dateField(),employeeRef(true),machineRef(true),objectRef(),field('hours','Часы',false,['hours','отработано часов','отработанные часы']),field('meterStart','Счётчик начало',false,['meter start','meterStart','счетчик на начало','пробег начало','моточасы начало']),field('meterEnd','Счётчик конец',false,['meter end','meterEnd','счетчик на конец','пробег конец','моточасы конец']),noteField()]}
 };
 const entities=Object.keys(schemas);
 const text=value=>String(value==null?'':value).trim();
 const key=value=>text(value).normalize('NFC').toLocaleLowerCase('ru-RU');
 const specialAllocation=value=>key(value)==='общехоз'?'overhead':key(value)==='склад'?'warehouse':'';
 const normalizeHeader=value=>key(value).replace(/ё/g,'е').replace(/[\s_./()\[\]№:;\-]+/g,' ').trim();
 const entityName=value=>value==='equipment'?'machines':value;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const nonempty=value=>text(value)!=='';
 const rowHasData=row=>Array.isArray(row)&&row.some(nonempty);
 const schemaFor=entity=>Object.prototype.hasOwnProperty.call(schemas,entity)?schemas[entity]:null;

 function autoMap(entity,headers){
  const schema=schemaFor(entityName(entity));
  if(!schema)throw Error('Неизвестный вид данных.');
  const normalized=(headers||[]).map(normalizeHeader),mapping={};
  schema.fields.forEach(f=>{
   const accepted=[f.key,f.label,...f.aliases].map(normalizeHeader);
   const matches=[];
   normalized.forEach((h,i)=>{if(h&&accepted.includes(h))matches.push(i);});
   mapping[f.key]=matches.length===1?matches[0]:-1;
  });
  return mapping;
 }

 function csvSeparator(input){
  const separators=[';',',','\t'],samples=[];
  let quoted=false,counts=[0,0,0],content=false;
  const sample=()=>{if(content)samples.push(counts);counts=[0,0,0];content=false;};
  for(let i=0;i<input.length;i++){
   const c=input[i];
   if(c==='"'){content=true;if(quoted&&input[i+1]==='"')i++;else quoted=!quoted;}
   else if(!quoted&&(c==='\r'||c==='\n')){sample();if(c==='\r'&&input[i+1]==='\n')i++;if(samples.length>=20)break;}
   else {if(c.trim())content=true;const index=separators.indexOf(c);if(!quoted&&index>=0)counts[index]++;}
  }
  sample();
  const scores=separators.map((separator,index)=>{
   const frequency=new Map();samples.forEach(row=>{if(row[index]>0)frequency.set(row[index],(frequency.get(row[index])||0)+1);});
   let consistency=0,width=0;
   frequency.forEach((count,size)=>{if(count>consistency||count===consistency&&size>width){consistency=count;width=size;}});
   return {separator,consistency,width};
  });
  scores.sort((a,b)=>b.consistency-a.consistency||b.width-a.width);
  return scores[0].separator;
 }

 function parseCSV(value){
  const input=String(value==null?'':value).replace(/^\uFEFF/,'');
  if(!input.trim())return [];
  const separator=csvSeparator(input),rows=[];
  let row=[],cell='',quoted=false,closed=false;
  const pushRow=()=>{row.push(cell.trim());rows.push(row);row=[];cell='';closed=false;};
  for(let i=0;i<input.length;i++){
   const c=input[i];
   if(quoted){
    if(c==='"'){if(input[i+1]==='"'){cell+='"';i++;}else {quoted=false;closed=true;}}
    else cell+=c;
   }else if(c===separator){row.push(cell.trim());cell='';closed=false;}
   else if(c==='\r'||c==='\n'){if(c==='\r'&&input[i+1]==='\n')i++;pushRow();}
   else if(c==='"'){
    if(closed||cell.trim())throw Error('Кавычка внутри неэкранированного поля CSV.');
    cell='';quoted=true;
   }else if(closed){if(!/\s/.test(c))throw Error('После закрывающей кавычки CSV требуется разделитель.');}
   else cell+=c;
  }
  if(quoted)throw Error('Незакрытые кавычки в CSV.');
  if(row.length||cell!==''||closed)pushRow();
  while(rows.length&&!rowHasData(rows[rows.length-1]))rows.pop();
  return rows;
 }

 function templateRows(entity){
  const schema=schemaFor(entityName(entity));if(!schema)throw Error('Неизвестный вид данных.');
  return [schema.fields.map(f=>f.label)];
 }
 function templateCSV(entity){return templateRows(entity)[0].map(v=>'"'+v.replace(/"/g,'""')+'"').join(';')+'\r\n';}

 function parseDate(value){
  let iso='';const s=text(value);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))iso=s;
  else if(/^\d{2}[./]\d{2}[./]\d{4}$/.test(s))iso=s.slice(6)+'-'+s.slice(3,5)+'-'+s.slice(0,2);
  if(!iso||Number(iso.slice(0,4))<1900||Number(iso.slice(0,4))>2199)return '';
  const parsed=new Date(iso+'T12:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===iso?iso:'';
 }
 function parsePeriod(value){
  const s=text(value);let period='';
  if(/^\d{4}-\d{2}$/.test(s))period=s;
  else if(/^\d{2}\.\d{4}$/.test(s))period=s.slice(3)+'-'+s.slice(0,2);
  return period&&parseDate(period+'-01')?period:'';
 }
 function numeric(value){
  if(typeof value==='number')return Number.isFinite(value)?value:NaN;
  const grouped=text(value).replace(/[\s\u00a0\u202f]+/g,' ');
  if(grouped.includes(' ')&&!/^[+-]?\d{1,3}(?: \d{3})+(?:[.,]\d+)?$/.test(grouped))return NaN;
  const s=grouped.replace(/ /g,'');
  if(!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(s))return NaN;
  return Number(s.replace(',','.'));
 }
 function cents(value){
  const n=numeric(value);
  if(typeof value!=='number'&&/[.,]\d{3,}$/.test(text(value)))return null;
  if(!Number.isFinite(n)||n<0.01||n>1e12||Math.round(n*100)/100!==n)return null;
  return Math.round(n*100)/100;
 }
 function sourceKey(entity,documentId,line){return JSON.stringify([entity,key(documentId),key(line)]);}
 function operationFingerprint(row){
  const allocation=row.allocation||'machine';
  return JSON.stringify([row.date,key(row.machine),allocation,key(row.category),Math.round(Number(row.amount)*100),key(row.note)]);
 }
 function sourceOf(row){return row&&row.importSource&&typeof row.importSource==='object'?row.importSource:null;}

 function validatePackage(baseState,uploads,options){
  options=options||{};
  const errors=[],warnings=[],preview=[],normalizedRows={},counts={};
  entities.forEach(e=>{normalizedRows[e]=[];counts[e]=0;});
  const issue=(target,ctx,fieldName,message)=>target.push({entity:ctx.entity||'',sheet:ctx.sheet||'',row:ctx.row||1,field:fieldName||'',message});
  const error=(ctx,f,m)=>issue(errors,ctx,f,m);
  const warn=(ctx,f,m)=>issue(warnings,ctx,f,m);
  const result=nextState=>({valid:errors.length===0,errors,warnings,preview,counts,normalizedRows,nextState});
  if(!baseState||typeof baseState!=='object'||Array.isArray(baseState)){
   error({},'','Текущее хранилище повреждено или отсутствует.');return result(null);
  }
  if(!Array.isArray(uploads)||!uploads.length){error({},'','Добавьте хотя бы один файл или лист.');return result(null);}
  let candidate;
  try{candidate=clone(baseState);}catch(e){error({},'','Не удалось подготовить независимую копию текущих данных.');return result(null);}
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)){error({},'','Текущее хранилище должно содержать объект данных.');return result(null);}
  const targetNames=['objects','machines','employees','operations','payroll','importedTimesheets','importedWaybills','importHistory'];
  targetNames.forEach(target=>{
   if(candidate[target]===undefined)candidate[target]=[];
   else if(!Array.isArray(candidate[target]))error({},target,'Раздел «'+target+'» имеет неверный формат. Сохранение остановлено.');
   else if(candidate[target].some(row=>!row||typeof row!=='object'||Array.isArray(row)))error({},target,'В разделе «'+target+'» найдена повреждённая запись. Сохранение остановлено.');
  });
  if(candidate.maintenance!==undefined&&(!Array.isArray(candidate.maintenance)||candidate.maintenance.some(row=>!row||typeof row!=='object'||Array.isArray(row))))error({},'maintenance','Журнал ремонтов повреждён. Сверка расходов невозможна.');
  if(errors.length)return result(null);
  const pending=[];let totalRows=0;
  uploads.forEach((upload,uploadIndex)=>{
   const entity=entityName(upload&&upload.entity),schema=schemaFor(entity);
   const context={entity:entity||'',sheet:text(upload&&(upload.sheetName||upload.sheet))||'Лист '+(uploadIndex+1),row:1};
   if(!schema){error(context,'entity','Выберите допустимый вид данных.');return;}
   const rows=upload.rows;
   if(!Array.isArray(rows)||!rows.length||!Array.isArray(rows[0])){error(context,'','Лист не содержит строки заголовков.');return;}
   const offset=upload.headerRow==null?0:Number(upload.headerRow);
   if(!Number.isInteger(offset)||offset<0){error(context,'headerRow','Неверный номер строки заголовков.');return;}
   context.row=offset+1;
   const header=rows[0],automatic=autoMap(entity,header),mapping={},used=new Map();
   let mappingError=false;
   schema.fields.forEach(f=>{
    const hasExplicitMapping=upload.mapping&&Object.prototype.hasOwnProperty.call(upload.mapping,f.key);
    const explicitlySkipped=hasExplicitMapping&&upload.mapping[f.key]===null;
    let col=hasExplicitMapping?upload.mapping[f.key]:automatic[f.key];
    if(typeof col==='string'){
     const matching=header.map(normalizeHeader).flatMap((h,i)=>h===normalizeHeader(col)?[i]:[]);
     if(matching.length!==1){error(context,f.key,'Название выбранной колонки «'+col+'» отсутствует или повторяется. Выберите колонку по её положению.');mappingError=true;}
     col=matching.length===1?matching[0]:-1;
    }
    if(col==null||col==='')col=-1;
    if(!Number.isInteger(col)||col< -1||col>=header.length){error(context,f.key,'Неверно выбрана колонка «'+f.label+'».');mappingError=true;col=-1;}
    const accepted=[f.key,f.label,...f.aliases].map(normalizeHeader);
    const matching=header.filter(value=>accepted.includes(normalizeHeader(value)));
    const ambiguous=col<0&&matching.length>1&&!explicitlySkipped;
    if(ambiguous){error(context,f.key,'Несколько колонок подходят для «'+f.label+'». Выберите нужную колонку или явно пропустите поле.');mappingError=true;}
    if(col>=0&&used.has(col)){error(context,f.key,'Колонка «'+text(header[col])+'» сопоставлена нескольким полям.');mappingError=true;}
    if(col>=0)used.set(col,f.key);
    if(f.required&&col<0&&!ambiguous){error(context,f.key,'Выберите колонку «'+f.label+'».');mappingError=true;}
    mapping[f.key]=col;
   });
   if(mappingError)return;
   let dataRows=0;
   rows.slice(1).forEach((row,index)=>{
    if(!Array.isArray(row)){error({...context,row:offset+index+2},'','Строка имеет неверный формат.');return;}
    if(!rowHasData(row))return;
    dataRows++;totalRows++;
    if(totalRows>10000)return;
    const ctx={entity,sheet:context.sheet,row:offset+index+2};
    if(row.slice(header.length).some(nonempty)){error(ctx,'','В строке есть заполненные колонки за пределами заголовков. Проверьте разделитель CSV и строку заголовков.');return;}
    const raw={};schema.fields.forEach(f=>{raw[f.key]=mapping[f.key]>=0?row[mapping[f.key]]:undefined;});
    const missing=schema.fields.filter(f=>f.required&&!nonempty(raw[f.key]));
    missing.forEach(f=>error(ctx,f.key,'Заполните «'+f.label+'».'));
    if(missing.length)return;
    const source={entity,file:text(upload.fileName||upload.file),sheet:ctx.sheet,row:ctx.row};
    pending.push({entity,raw,ctx,source,uploadIndex});
   });
   if(!dataRows)error(context,'','Лист содержит только заголовки: строк для загрузки нет.');
  });
  if(totalRows>10000){error({},'','В одном пакете допускается не более 10 000 строк.');return result(null);}

  // Catalogs are staged before references, regardless of file/queue ordering.
  const indexes={objects:new Map(),machines:new Map(),employees:new Map()};
  const addIndex=(entity,row,ctx)=>{
   const id=key(row.id),index=indexes[entity];
   if(!id){error(ctx,'id','У записи отсутствует устойчивый код.');return false;}
   if(index.has(id)){error(ctx,'id','Код «'+text(row.id)+'» уже существует или повторяется в пакете. Изменение существующих записей загрузкой запрещено.');return false;}
   index.set(id,row);return true;
  };
  ['objects','employees','machines'].forEach(entity=>candidate[entity].forEach(row=>{
   const id=key(row&&row.id);
   if(id){if(indexes[entity].has(id))indexes[entity].set(id,null);else indexes[entity].set(id,row);}
  }));
  function emit(entry,row){
   normalizedRows[entry.entity].push(row);counts[entry.entity]++;
   preview.push({entity:entry.entity,sheet:entry.ctx.sheet,row:entry.ctx.row,data:row});
   candidate[schemas[entry.entity].target].push(row);
  }
  function reference(entity,value,entry,fieldName,required){
   if(!nonempty(value)){if(required)error(entry.ctx,fieldName,'Не указан точный код.');return null;}
   const id=key(value),index=indexes[entity];
   let found=index.get(id);
   if(!index.has(id)&&entity==='machines'&&aliases.has(id)){
    const matches=aliases.get(id);
    if(matches.size!==1){error(entry.ctx,fieldName,'Госномер, VIN или заводской номер «'+text(value)+'» относится к нескольким машинам. Укажите внутренний код.');return null;}
    found=index.get(Array.from(matches)[0]);
   }else if(!index.has(id)){error(entry.ctx,fieldName,'Код «'+text(value)+'» отсутствует в справочнике «'+schemas[entity].label+'» и в этом пакете.');return null;}
   if(!found){error(entry.ctx,fieldName,'Код «'+text(value)+'» неоднозначен в текущем справочнике.');return null;}
   return found;
  }
  function stringFields(entry,keys){const out={};keys.forEach(k=>{if(nonempty(entry.raw[k]))out[k]=text(entry.raw[k]);});return out;}
  ['objects','employees'].forEach(entity=>pending.filter(x=>x.entity===entity).forEach(entry=>{
   const row={...stringFields(entry,entity==='objects'?['id','name','address','manager']:['id','name','position']),importSource:entry.source};
   if(addIndex(entity,row,entry.ctx))emit(entry,row);
  }));
  const stagedMachines=[];
  pending.filter(x=>x.entity==='machines').forEach(entry=>{
   const initialErrors=errors.length;
   const row={...stringFields(entry,['id','name','type','plate','serial','vin']),importSource:entry.source};
   ['id','plate','serial','vin'].forEach(fieldName=>{
    if(specialAllocation(row[fieldName]))error(entry.ctx,fieldName,'Значение «'+text(row[fieldName])+'» зарезервировано для назначения расходов. Используйте другой устойчивый код или исправьте номер техники.');
   });
   const object=reference('objects',entry.raw.objectId,entry,'objectId',false);
   const employee=reference('employees',entry.raw.employeeId,entry,'employeeId',false);
   row.object=object?object.id:'';
   if(employee){row.operatorId=employee.id;row.operator=employee.name;}
   if(nonempty(entry.raw.year)){
    const n=numeric(entry.raw.year);
    if(!Number.isInteger(n)||n<1900||n>2199)error(entry.ctx,'year','Укажите действительный год выпуска от 1900 до 2199.');else row.year=n;
   }
   if(nonempty(entry.raw.meter)){
    const n=numeric(entry.raw.meter);
    if(!Number.isFinite(n)||n<0||n>1e12)error(entry.ctx,'meter','Показание счётчика должно быть неотрицательным числом.');else row.meter=n;
   }
   if(errors.length===initialErrors&&addIndex('machines',row,entry.ctx)){emit(entry,row);stagedMachines.push({entry,row});}
  });
  // Registration/serial/VIN must not become ambiguous alternate identities.
  const aliases=new Map();
  candidate.machines.forEach(row=>[row.id,row.plate,row.serial,row.vin].filter(nonempty).forEach(value=>{
   const alias=key(value);if(!aliases.has(alias))aliases.set(alias,new Set());aliases.get(alias).add(key(row.id));
  }));
  stagedMachines.forEach(({entry,row})=>['plate','serial','vin'].forEach(f=>{
   if(nonempty(row[f])&&aliases.get(key(row[f])).size>1)error(entry.ctx,f,'Значение «'+row[f]+'» уже относится к другой машине. Проверьте справочник.');
  }));

  const seenSources=new Set(),expenseFingerprints=new Set();
  function rememberSource(entity,row){
   const source=sourceOf(row);
   if(source&&source.documentId!=null&&source.line!=null)seenSources.add(sourceKey(entity,source.documentId,source.line));
   else if(source&&source.sourceKey)seenSources.add(source.sourceKey);
  }
  ['expenses','payroll','timesheets','waybills'].forEach(entity=>{
   (baseState[schemas[entity].target]||[]).forEach(row=>rememberSource(entity,row));
  });
  candidate.importHistory.forEach(batch=>{
   if(Array.isArray(batch.sources))batch.sources.forEach(source=>{
    if(source&&entities.includes(source.entity))rememberSource(source.entity,{importSource:source});
   });
  });
  candidate.operations.filter(row=>row.kind==='expense').forEach(row=>expenseFingerprints.add(operationFingerprint(row)));
  const sourceId=entry=>{
   const documentId=text(entry.raw.documentId),line=text(entry.raw.sourceLine);
   if(documentId.length>200||line.length>100){error(entry.ctx,'documentId','Номер документа или строки слишком длинный.');return null;}
   const id=sourceKey(entry.entity,documentId,line);
   if(seenSources.has(id)){error(entry.ctx,'documentId','Документ «'+documentId+'», строка «'+line+'» уже загружен или повторяется в пакете.');return null;}
   seenSources.add(id);
   return {...entry.source,documentId,line,sourceKey:id};
  };
  function linked(entry,allowSpecial){
   const raw=entry.raw,ref=key(raw.machineId);
   const special=specialAllocation(raw.machineId);
   let machine=null;
   if(special&&aliases.has(ref)){error(entry.ctx,'machineId','Значение «'+text(raw.machineId)+'» одновременно обозначает назначение расхода и технику в текущем справочнике. Уточните коды техники перед загрузкой.');}
   else if(special&&!allowSpecial){error(entry.ctx,'machineId','Здесь требуется код конкретной техники.');}
   else if(nonempty(raw.machineId)&&!special)machine=reference('machines',raw.machineId,entry,'machineId',false);
   const object=reference('objects',raw.objectId,entry,'objectId',false);
   if(machine&&object&&machine.object&&key(machine.object)!==key(object.id))warn(entry.ctx,'objectId','Объект исходного документа отличается от текущего объекта техники. Проверьте историческое назначение машины на дату документа. Сохраняется объект источника; текущее назначение техники не меняется.');
   if(special&&object)error(entry.ctx,'objectId','Расход ОБЩЕХОЗ или СКЛАД не должен иметь объект конкретной машины. Уточните назначение.');
   return {machine:machine?machine.id:'',machineId:machine?machine.id:'',object:object?object.id:'',objectId:object?object.id:'',allocation:machine?'machine':special||'unallocated'};
  }
  function repairConflict(row){
   if(row.allocation!=='machine')return null;
   const repairCategory=/ремонт|техобслуж|запчаст|материал|сервис/i.test(row.category);
   return candidate.operations.find(op=>{
    if(!op.sourceRepair||op.kind!=='expense'||key(op.machine)!==key(row.machine))return false;
    const repair=(candidate.maintenance||[]).find(x=>x.id===op.sourceRepair);
    const referenceId=repair&&repair.number;
    const byNumber=referenceId&&key(row.note).includes(key(referenceId));
    return byNumber||(op.date===row.date&&(repairCategory||Math.abs(Number(op.amount)-row.amount)<0.005));
   })||null;
  }
  pending.filter(x=>!['objects','employees','machines'].includes(x.entity)).forEach(entry=>{
   const initialErrors=errors.length,raw=entry.raw;
   const source=sourceId(entry);
   const links=linked(entry,entry.entity==='expenses');
   let row={...links,note:text(raw.note),importSource:source};
   if(entry.entity==='payroll'){
    const period=parsePeriod(raw.period);
    if(!period)error(entry.ctx,'period','Укажите действительный период ГГГГ-ММ или ММ.ГГГГ.');
    row.period=period;
    if(source)source.period=period;
   }else{
    const date=parseDate(raw.date);
    if(!date)error(entry.ctx,'date','Неверная календарная дата. Используйте ДД.ММ.ГГГГ или ГГГГ-ММ-ДД.');
    row.date=date;
    if(source)source.date=date;
   }
   if(['payroll','timesheets','waybills'].includes(entry.entity)){
    const employee=reference('employees',raw.employeeId,entry,'employeeId',true);
    row.employee=row.employeeId=employee?employee.id:'';
    if(employee&&links.machine){
     const machine=indexes.machines.get(key(links.machine));
     if(machine&&machine.operatorId&&key(machine.operatorId)!==key(employee.id))warn(entry.ctx,'employeeId','В документе указан сотрудник, отличный от текущего закреплённого водителя. Проверьте назначение на дату документа.');
    }
   }
   if(['expenses','payroll'].includes(entry.entity)){
    const amount=cents(raw.amount);
    if(amount===null)error(entry.ctx,'amount','Укажите положительную сумму до 1 трлн рублей, не более двух знаков после запятой.');
    row.amount=amount;
   }
   if(entry.entity==='expenses'){
    row={...row,kind:'expense',category:text(raw.category),source:'excel-demo',importMachine:text(raw.machineId),importLine:entry.ctx.row,importFile:entry.source.file};
    const fingerprint=operationFingerprint(row);
    if(expenseFingerprints.has(fingerprint))error(entry.ctx,'amount','Возможный повтор уже учтённого расхода с той же датой, техникой, статьёй, суммой и комментарием. Требуется сверка.');
    else expenseFingerprints.add(fingerprint);
    const conflict=repairConflict(row);
    if(conflict)error(entry.ctx,'amount','Возможный повтор расхода по ремонту, уже учтённому механиком ('+conflict.sourceRepair+'). Требуется сверка.');
    if(row.allocation==='warehouse')warn(entry.ctx,'machineId','Закупка СКЛАД сохранится в реестре закупок, но не увеличит остаток запчастей: для поступления нужны номенклатура, количество и цена.');
   }
   if(['timesheets','waybills'].includes(entry.entity)&&nonempty(raw.hours)){
    const hours=numeric(raw.hours);
    if(!Number.isFinite(hours)||hours<=0||hours>24)error(entry.ctx,'hours','Отработанные часы за одну дату должны быть положительным числом до 24 включительно.');else row.hours=hours;
   }
   if(entry.entity==='waybills'){
    const hasStart=nonempty(raw.meterStart),hasEnd=nonempty(raw.meterEnd);
    if(hasStart!==hasEnd)error(entry.ctx,'meterEnd','Укажите оба показания счётчика: на начало и конец.');
    if(hasStart&&hasEnd){
     const start=numeric(raw.meterStart),end=numeric(raw.meterEnd);
     if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||end>1e12)error(entry.ctx,'meterEnd','Показания должны быть неотрицательными; конец не меньше начала.');
     else {row.meterStart=start;row.meterEnd=end;}
    }
   }
   if(source){
    row.id='import:'+encodeURIComponent(source.sourceKey);
    row.documentId=source.documentId;row.sourceLine=source.line;
    row.importBatch='package';
   }
   if(entry.entity!=='expenses')row.status='source';
   if(errors.length===initialErrors&&source)emit(entry,row);
  });

  // Different source documents must not give the same employee or machine
  // more than 24 hours in one day. Cross-register comparison is intentional:
  // a timesheet and a waybill may describe the same work and are not added.
  ['timesheets','waybills'].forEach(entity=>{
   const affected=new Map();
   preview.filter(item=>item.entity===entity&&item.data.hours!=null).forEach(item=>{
    ['employee','machine'].forEach(scope=>affected.set(JSON.stringify([scope,key(item.data[scope]),item.data.date]),item));
   });
   const totals=new Map();
   candidate[schemas[entity].target].forEach(row=>{
    const hours=Number(row.hours);if(!Number.isFinite(hours)||hours<=0)return;
    ['employee','machine'].forEach(scope=>{
     const id=row[scope]||row[scope+'Id'];if(!id)return;
     const idKey=JSON.stringify([scope,key(id),row.date]);
     totals.set(idKey,(totals.get(idKey)||0)+hours);
    });
   });
   const reported=new Set();
   affected.forEach((item,idKey)=>{
    if(totals.get(idKey)>24.000001&&!reported.has(item)){
     error(item,'hours','Суммарные часы сотрудника или машины за эту дату превышают 24 в реестре «'+schemas[entity].label+'». Проверьте повторные строки.');reported.add(item);
    }
   });
  });

  ['payroll','timesheets','waybills'].forEach(entity=>{
   if(!counts[entity])return;
   const messages={payroll:'Зарплата сохранится отдельным реестром для сверки и не увеличит расходы автоматически.',timesheets:'Табели сохранятся как исходные документы. Они не подтверждают смены и не участвуют в распределении общих расходов.',waybills:'Путевые листы сохранятся как исходный реестр. Это не выпуск юридически значимых путевых листов и не подтверждение смен.'};
   warn({entity,sheet:'',row:1},'',messages[entity]);
  });
  if(errors.length)return result(null);
  const timestamp=options.now==null?new Date():new Date(options.now);
  if(!Number.isFinite(timestamp.getTime())){error({},'now','Неверная дата записи в журнал загрузки.');return result(null);}
  const at=timestamp.toISOString();
  const importId=text(options.batchId)||'package:'+at+':'+(candidate.importHistory.length+1);
  if(importId.length>300){error({},'batchId','Номер пакета слишком длинный.');return result(null);}
  if(candidate.importHistory.some(item=>item.id===importId)){error({},'batchId','Номер пакета уже используется в журнале загрузок.');return result(null);}
  preview.forEach(p=>{if(p.data.importBatch)p.data.importBatch=importId;});
  candidate.importHistory.push({id:importId,at,files:uploads.map(u=>({file:text(u.fileName||u.file),sheet:text(u.sheetName||u.sheet),entity:entityName(u.entity)})),sources:preview.map(p=>({...p.data.importSource})),counts:{...counts},count:preview.length,status:'Импортировано',sourceRegisterOnly:['payroll','timesheets','waybills'].filter(e=>counts[e]>0)});
  const financial=normalizedRows.expenses;
  if(financial.length){
   if(candidate.accountantImports===undefined)candidate.accountantImports=[];
   if(!Array.isArray(candidate.accountantImports)){error({},'accountantImports','Журнал бухгалтерских загрузок повреждён.');return result(null);}
   candidate.accountantImports.push({id:importId,at,file:uploads.filter(u=>entityName(u.entity)==='expenses').map(u=>text(u.fileName||u.file)).join(', '),count:financial.length,total:financial.reduce((sum,row)=>sum+Math.round(row.amount*100),0)/100,status:'Импортировано'});
  }
  return result(candidate);
 }

 return {version:1,schemas,normalizeHeader,autoMap,parseCSV,templateRows,templateCSV,validatePackage};
});
