'use strict';

// Files and previews stay in memory until the complete package is confirmed.
const dataImportDraft={entity:'objects',loaded:null,sheet:'',header:0,mapping:{},uploads:[],plan:null,baseMemory:null,baseRaw:null,busy:false,error:'',result:'',tab:'upload',generation:0};
const canImportData=()=>['director','accountant'].includes(role);
const dataEntityLabels={objects:'Объекты',machines:'Техника',employees:'Сотрудники',expenses:'Расходы',payroll:'Зарплата',timesheets:'Табели',waybills:'Путевые листы'};
const dataArrayNames={objects:'objects',machines:'machines',employees:'employees',expenses:'operations',payroll:'payroll',timesheets:'importedTimesheets',waybills:'importedWaybills'};
const dataRows=entity=>entity==='expenses'?state.operations.filter(o=>o.kind==='expense'):(state[dataArrayNames[entity]]||[]);
const dataEmployeeName=id=>(state.employees||[]).find(e=>e.id===id)?.name||id||'Не указан';
function clearDataImportPlan(){dataImportDraft.plan=null;dataImportDraft.baseMemory=null;dataImportDraft.baseRaw=null;dataImportDraft.error='';dataImportDraft.result='';}
function redrawDataImport(){if(view==='data'||view==='accountant')render();}
function currentImportRows(){return dataImportDraft.loaded?.sheets[dataImportDraft.sheet]||[];}
function mapCurrentImport(){dataImportDraft.mapping=MarsImport.autoMap(dataImportDraft.entity,currentImportRows()[dataImportDraft.header]||[]);clearDataImportPlan();}
function sourceDescription(row){const src=row.importSource||row.sourceInfo;if(!src)return 'Источник не указан';return [src.documentId?'Документ '+src.documentId:'',src.line?'строка документа '+src.line:'',src.file,src.sheet,src.row?'строка файла '+src.row:''].filter(Boolean).join(' · ');}
function dataSourceNote(entity){
 if(entity==='payroll')return 'Зарплата сохраняется отдельным реестром для сверки. В расходы техники повторно не добавляется; начисление и выплата не смешиваются автоматически.';
 if(entity==='timesheets')return 'Загруженные табели — исходные документы на сверке. Они не становятся утверждёнными сменами и не подменяют подтверждённые часы.';
 if(entity==='waybills')return 'Загруженные путевые листы — исходные записи на сверке. Загрузка не оформляет подписи, допуск, медосмотр и другие обязательные реквизиты.';
 return '';
}
function dataRegisterRows(entity,filter={}){return dataRows(entity).filter(r=>!filter.machineId||(r.machine||r.machineId)===filter.machineId);}
function dataRegisterColumns(entity){
 if(entity==='objects')return [['id','Код объекта'],['name','Название'],['address','Адрес']];
 if(entity==='machines')return [['id','Код техники'],['name','Название'],['type','Тип'],['object','Объект'],['operatorId','Сотрудник'],['plate','Рег. номер']];
 if(entity==='employees')return [['id','Табельный номер'],['name','Сотрудник'],['position','Должность']];
 if(entity==='expenses')return [['date','Дата'],['machine','Техника / назначение'],['object','Объект'],['category','Статья'],['amount','Сумма']];
 if(entity==='payroll')return [['period','Период'],['employeeId','Сотрудник'],['machine','Техника'],['object','Объект'],['amount','Сумма']];
 if(entity==='timesheets')return [['date','Дата'],['employeeId','Сотрудник'],['machine','Техника'],['object','Объект'],['hours','Часы']];
 return [['date','Дата'],['documentId','Документ'],['employeeId','Сотрудник'],['machine','Техника'],['object','Объект'],['hours','Часы'],['meterStart','Счётчик до'],['meterEnd','Счётчик после']];
}
function dataRegisterValue(row,key){
 const value=row[key];
 if(key==='machine')return machine(value)?.name||value||(row.allocation==='overhead'?'ОБЩЕХОЗ':row.allocation==='warehouse'?'СКЛАД':'Не указано');
 if(key==='object')return value?objectLabel(value):'Не указан в источнике';
 if(['employeeId','operatorId'].includes(key))return dataEmployeeName(value);
 if(key==='documentId')return row.documentId||row.importSource?.documentId||'Не указан';
 if(key==='amount')return hasAmount(value)?new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value)+' ₽':'Не указано';
 return value??'Не указано';
}
function dataRegisterHtml(entity,filter={}){
 const rows=dataRegisterRows(entity,filter),cols=dataRegisterColumns(entity),note=dataSourceNote(entity);
 return `<section class="panel padded"><div class="panel-head"><h2>${esc(dataEntityLabels[entity])} · ${rows.length} записей</h2>${rows.length?`<button class="btn" data-register-export="${entity}" data-register-machine="${esc(filter.machineId||'')}">Скачать CSV</button>`:''}</div>${note?`<p class="info-note">${esc(note)}</p>`:''}${rows.length?`<p class="import-source">На телефоне прокрутите таблицу в сторону, чтобы увидеть все колонки.</p><div class="table-scroll"><table class="data-table"><thead><tr>${cols.map(c=>`<th>${esc(c[1])}</th>`).join('')}<th>Источник</th></tr></thead><tbody>${rows.slice(0,100).map(r=>`<tr>${cols.map(([key])=>`<td>${esc(dataRegisterValue(r,key))}</td>`).join('')}<td class="import-source">${esc(sourceDescription(r))}</td></tr>`).join('')}</tbody></table></div>${rows.length>100?'<p>Показаны первые 100 записей. Полный реестр доступен в CSV.</p>':''}`:empty('Записей пока нет','Загрузите проверенный файл или добавьте данные в соответствующем разделе.')}</section>`;
}
function importedSourceSection(entity,filter={}){return dataRows(entity).length?dataRegisterHtml(entity,filter):'';}
function machineImportedDataHtml(id){
 const m=machine(id);if(!m)return '';
 const o=obj(m.object),e=(state.employees||[]).find(x=>x.id===m.operatorId);
 const groups=canFinance()?['expenses','payroll','timesheets','waybills']:['timesheets','waybills'];
 const rows=groups.map(entity=>({entity,count:dataRegisterRows(entity,{machineId:id}).length})).filter(x=>x.count);
 const refs=[['Карточка техники',m],['Объект',o],['Закреплённый сотрудник',e]];
 return `<section class="section-gap"><h3>Справочные связи</h3>${refs.map(([label,row])=>`<p><strong>${esc(label)}:</strong> ${row?esc(row.name+' ('+row.id+')'):'Не указано'}<br><span class="import-source">${row?esc(sourceDescription(row)):''}</span></p>`).join('')}<p>Оригиналы файлов здесь не хранятся. Для сверки сохранены реквизиты источника, лист и номер строки.</p><h3>Связанные исходные данные</h3><p>Связь по коду этой машины. Табели и путевые листы остаются на сверке.</p>${rows.length?rows.map(x=>dataRegisterHtml(x.entity,{machineId:id})).join(''):empty('Связанных документов пока нет','Они появятся после проверки и загрузки пакета.')}</section>`;
}
function importMappingHtml(){
 const d=dataImportDraft,rows=currentImportRows(),headers=rows[d.header]||[],schema=MarsImport.schemas[d.entity];
 return `<section class="panel padded"><h2>2. Сопоставьте колонки</h2><div class="import-grid"><label class="field">Лист<select id="data-sheet">${Object.keys(d.loaded.sheets).map(name=>`<option ${name===d.sheet?'selected':''}>${esc(name)}</option>`).join('')}</select></label><label class="field">Номер строки с заголовками<input id="data-header" type="number" min="1" max="${Math.max(1,rows.length)}" value="${d.header+1}"></label><label class="field">Что находится на листе<select id="data-entity">${Object.entries(dataEntityLabels).map(([key,label])=>`<option value="${key}" ${d.entity===key?'selected':''}>${label}</option>`).join('')}</select></label><div><p>${esc(schema.description||'')}</p><p>Файл: ${esc(d.loaded.fileName)}. Строк после заголовка: ${Math.max(0,rows.length-d.header-1)}.</p></div></div><p>Обязательные поля отмечены *. Код техники, объекта и сотрудника должен точно совпадать со справочником. Названия колонок можно выбрать вручную. Если в файле нет постоянных кодов техники, объектов или сотрудников, сначала согласуем их по вашим исходным таблицам — случайные коды не создаются.</p><div class="form-grid import-mapping">${schema.fields.map(f=>`<label class="field">${esc(f.label)}${f.required?' *':''}<select data-import-field="${f.key}"><option value="">Не загружать</option>${headers.map((h,i)=>`<option value="${i}" ${Number(d.mapping[f.key])===i&&d.mapping[f.key]!==''&&d.mapping[f.key]!=null?'selected':''}>${i+1}. ${esc(h||'Без названия')}</option>`).join('')}</select>${f.hint?`<small>${esc(f.hint)}</small>`:''}</label>`).join('')}</div><p class="import-source">На телефоне прокрутите таблицу в сторону, чтобы увидеть все колонки.</p><div class="table-scroll"><table class="data-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.slice(d.header+1,d.header+6).map(row=>`<tr>${headers.map((_,i)=>`<td>${esc(row[i]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="import-source">Показаны первые 5 строк файла. При проверке будут обработаны все строки, а не только этот фрагмент.</p><button class="btn primary" data-upload-action="add">Добавить лист в пакет</button></section>`;
}
function importPreviewDetails(entity,row,candidate){
 const find=(kind,id)=>candidate[kind]?.find(x=>x.id===id);
 const parts=[];
 for(const f of MarsImport.schemas[entity].fields){
  let value=row[f.key];
  if(f.key==='machineId')value=row.machineId||row.machine||(row.allocation==='overhead'?'ОБЩЕХОЗ':row.allocation==='warehouse'?'СКЛАД':'');
  if(f.key==='objectId')value=row.objectId||row.object||'';
  if(f.key==='employeeId')value=row.employeeId||row.operatorId||'';
  if(value===undefined||value===null||value==='')continue;
  if(f.key==='objectId'){const o=find('objects',value);value=o?o.name+' ('+o.id+')':value;}
  if(f.key==='machineId'){const m=find('machines',value);value=m?m.name+' ('+m.id+')':value;}
  if(f.key==='employeeId'){const e=find('employees',value);value=e?e.name+' ('+e.id+')':value;}
  parts.push('<div><strong>'+esc(f.label)+':</strong> '+esc(value)+'</div>');
 }
 return parts.join('');
}
function importPlanHtml(){
 const p=dataImportDraft.plan;if(!p)return '';
 const issues=(items,cls)=>items.length?`<ul class="${cls}">${items.slice(0,100).map(e=>`<li>${esc([dataEntityLabels[e.entity]||e.entity,e.sheet,e.row?'строка '+e.row:'',MarsImport.schemas[e.entity]?.fields.find(f=>f.key===e.field)?.label||e.field,e.message].filter(Boolean).join(' · '))}</li>`).join('')}</ul>`:'';
 return `<section class="panel padded"><h2>4. Проверьте результат</h2>${p.valid?'<p>Пакет прошёл проверку. Данные пока не сохранены.</p>':'<p role="alert">Пакет не будет сохранён: исправьте ошибки и проверьте его снова.</p>'}<div class="import-summary">${Object.entries(p.counts||{}).map(([key,count])=>`<div>${esc(dataEntityLabels[key]||key)}: <strong>${esc(count)}</strong></div>`).join('')}</div>${issues(p.errors||[],'import-errors')}${issues(p.warnings||[],'import-warnings')}${(p.errors||[]).length>100?'<p>Показаны первые 100 ошибок. Полный список можно скачать.</p>':''}${(p.errors||[]).length?'<button class="btn" data-upload-action="errors">Скачать ошибки CSV</button>':''}<div class="table-scroll"><table class="data-table import-preview-table"><thead><tr><th>Раздел</th><th>Файл / лист / строка</th><th>Проверенные данные и связи</th></tr></thead><tbody>${(p.preview||[]).slice(0,50).map(r=>`<tr><td data-label="Раздел">${esc(dataEntityLabels[r.entity]||r.entity)}</td><td data-label="Источник">${esc([r.sheet,r.row].filter(Boolean).join(' · '))}</td><td class="import-source" data-label="Проверенные данные">${importPreviewDetails(r.entity,r.data,p.nextState||state)}</td></tr>`).join('')}</tbody></table></div><p>В предпросмотре показано до 50 строк. Сохранение выполняется для всего проверенного пакета.</p><div class="import-toolbar"><button class="btn" data-upload-action="backup">Скачать текущие данные перед загрузкой</button>${p.valid?'<button class="btn primary" data-upload-action="commit">Подтвердить и сохранить весь пакет</button>':''}</div></section>`;
}
function dataPage(preferredEntity){
 if(!canImportData())return empty('Раздел недоступен','Выберите роль руководителя или бухгалтера.');
 const d=dataImportDraft;if(preferredEntity&&!d.loaded&&!d.uploads.length&&d.tab==='upload')d.entity=preferredEntity;
 const tabs=[['upload','Загрузка файлов'],...Object.entries(dataEntityLabels),['history','История загрузок']];
 const tabbar=`<div class="import-toolbar" role="group" aria-label="Разделы загрузки">${tabs.map(([key,label])=>`<button class="btn ${d.tab===key?'primary':''}" data-import-tab="${key}">${label}</button>`).join('')}</div>`;
 if(d.tab==='history')return tabbar+dataImportHistoryHtml();
 if(d.tab!=='upload')return tabbar+dataRegisterHtml(d.tab);
 return `${tabbar}<div class="import-step"><strong>1. Выбрать файл</strong><span>→ 2. Сопоставить колонки</span><span>→ 3. Собрать пакет</span><span>→ 4. Проверить и сохранить</span></div><p class="info-note">Объекты, сотрудники и техника могут быть в одном пакете с документами: связи проверяются перед записью всего пакета. Неизвестные и неоднозначные коды блокируют загрузку. Файлы не отправляются на сервер; данные остаются в этом браузере. ${esc(dataSourceNote('payroll'))}</p>${d.error?`<p class="import-errors" role="alert">${esc(d.error)}</p>`:''}${d.result?`<p class="info-note" role="status">${esc(d.result)}</p>`:''}<section class="panel padded"><h2>1. Выберите Excel или CSV</h2><p>До 8 МБ на файл. Можно последовательно добавить листы из нескольких файлов. Исходные документы и строки нужны для защиты от повторной загрузки. Если номера документов повторяются, используйте полный код с видом и годом или идентификатор из 1С.</p><div class="import-grid"><label class="field">Тип данных<select id="data-entity-start">${Object.entries(dataEntityLabels).map(([key,label])=>`<option value="${key}" ${d.entity===key?'selected':''}>${label}</option>`).join('')}</select></label><label class="field">Кодировка CSV<select id="data-encoding"><option value="utf-8">UTF-8</option><option value="windows-1251">Windows-1251</option></select></label></div><div class="import-toolbar"><label class="btn primary" for="data-file">${d.busy?'Чтение файла…':'Выбрать файл'}</label><input class="sr-only-input" id="data-file" type="file" accept=".csv,.xlsx" ${d.busy?'disabled':''}><button class="btn" data-upload-action="template">Скачать пустой шаблон выбранного типа</button></div><p class="import-source">Обрабатывается только выбранный лист и строка заголовков. Для каждой вкладки книги явно укажите тип данных.</p></section>${d.loaded?importMappingHtml():''}<section class="panel padded"><h2>3. Пакет загрузки · ${d.uploads.length} листов</h2>${d.uploads.length?`<ul class="directory-list">${d.uploads.map((u,i)=>`<li><span>${esc(dataEntityLabels[u.entity])} · ${esc(u.fileName)} · ${esc(u.sheetName)}</span><div class="import-toolbar"><button class="btn small" data-import-edit="${i}">Исправить</button><button class="btn small" data-import-remove="${i}">Убрать из пакета</button></div></li>`).join('')}</ul><div class="import-toolbar"><button class="btn primary" data-upload-action="validate">Проверить весь пакет</button><button class="btn" data-upload-action="clear">Очистить пакет</button></div>`:'<p>Добавьте нужные листы. До подтверждения существующие данные не изменяются.</p>'}</section>${importPlanHtml()}`;
}
function dataImportHistoryHtml(){const rows=state.importHistory||[];return `<section class="panel padded"><h2>История пакетных загрузок</h2>${rows.length?`<p class="import-source">На телефоне прокрутите таблицу в сторону, чтобы увидеть все колонки.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Дата</th><th>Пакет</th><th>Состав</th></tr></thead><tbody>${rows.slice().reverse().map(r=>`<tr><td>${esc(r.at||r.createdAt||'')}</td><td>${esc(r.id||'')}</td><td>${esc(Object.entries(r.counts||{}).filter(([,n])=>n).map(([key,n])=>(dataEntityLabels[key]||key)+': '+n).join(' · '))}</td></tr>`).join('')}</tbody></table></div>`:empty('Загрузок пока нет','Запись появится после успешного сохранения всего пакета.')}</section>`;}
function dataImportSheetRows(sheet){
 return XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',blankrows:true,range:0,dateNF:'yyyy-mm-dd',raw:false});
}
function dataImportNumericRows(sheet){
 const options={header:1,defval:'',blankrows:true,range:0,dateNF:'yyyy-mm-dd',raw:true};
 const raw=XLSX.utils.sheet_to_json(sheet,options);
 const startColumn=sheet['!ref']?XLSX.utils.decode_range(sheet['!ref']).s.c:0;
 return raw.map((row,r)=>row.map((value,c)=>{
  const cell=sheet[XLSX.utils.encode_cell({r,c:c+startColumn})];
  return typeof value==='number'&&!XLSX.SSF.is_date(cell?.z||'General')?value:null;
 }));
}
function dataImportMappedRows(allRows,numericRows,header,mapping){
 const rows=allRows.slice(header).map(row=>row.slice());
 // Identifiers remain exactly as displayed in Excel (e.g. 0007, not 7).
 // Only explicitly selected quantitative fields use underlying numeric precision.
 for(const field of ['amount','hours','year','meter','meterStart','meterEnd']){
  const col=mapping[field];if(!Number.isInteger(col)||col<0)continue;
  for(let r=header+1;r<allRows.length;r++){
   const value=numericRows?.[r]?.[col];
   if(typeof value==='number')rows[r-header][col]=value;
  }
 }
 return rows;
}
async function readDataImportFile(file,encoding){
 const d=dataImportDraft,generation=++d.generation;d.busy=true;clearDataImportPlan();redrawDataImport();
 try{
  if(file.size>8*1024*1024)throw Error('Файл больше 8 МБ. Разделите его на несколько файлов.');
  const sheets={},numericSheets={};
  if(/\.xlsx$/i.test(file.name)){
   if(!globalThis.XLSX)throw Error('Библиотека Excel недоступна. Можно использовать CSV.');
   const book=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false,cellNF:true,dateNF:'yyyy-mm-dd'});
   for(const name of book.SheetNames){sheets[name]=dataImportSheetRows(book.Sheets[name]);numericSheets[name]=dataImportNumericRows(book.Sheets[name]);}
  }else if(/\.csv$/i.test(file.name)){
   let text;try{text=new TextDecoder(encoding,{fatal:true}).decode(await file.arrayBuffer());}catch{throw Error('Не удалось прочитать CSV в выбранной кодировке. Попробуйте Windows-1251 или сохраните файл в UTF-8.');}
   sheets['CSV']=MarsImport.parseCSV(text);
  }else throw Error('Поддерживаются Excel .xlsx и CSV.');
  if(generation!==d.generation)return;
  const first=Object.keys(sheets)[0];if(!first||!sheets[first].length)throw Error('В файле нет строк.');
  d.loaded={fileName:file.name.slice(0,200),sheets,numericSheets};d.sheet=first;d.header=0;mapCurrentImport();
 }catch(e){if(generation===d.generation){d.loaded=null;d.error=e.message;}}
 finally{if(generation===d.generation){d.busy=false;redrawDataImport();}}
}
function validateDataImport(){
 if(!canImportData())return;
 const d=dataImportDraft;clearDataImportPlan();
 try{
  if(storageLoadError){d.error='Сохранённые данные не удалось прочитать. Сначала восстановите исходный набор; загрузка заблокирована.';redrawDataImport();return;}
  const actualRaw=localStorage.getItem(storageKey);
  if(actualRaw!==storedWorkingData){d.error='Сохранённые данные изменились в другой вкладке. Откройте страницу заново и повторно выберите файлы. Чужие изменения не перезаписаны.';redrawDataImport();return;}
  d.baseMemory=JSON.stringify(state);d.baseRaw=actualRaw;d.plan=MarsImport.validatePackage(state,d.uploads);
 }
 catch(e){d.error='Не удалось проверить пакет: '+e.message;}
 redrawDataImport();
}
function commitDataImport(){
 const d=dataImportDraft;let previous=null,applied=false,saved=false;
 if(!canImportData()||storageLoadError||!d.plan?.valid)return false;
 try{
  if(JSON.stringify(state)!==d.baseMemory||localStorage.getItem(storageKey)!==d.baseRaw){d.plan=null;d.error='Данные изменились после предпросмотра, возможно в другой вкладке. Если изменения пришли из другой вкладки, откройте страницу заново перед повторной проверкой; запись не выполнена.';redrawDataImport();return false;}
  const checked=MarsImport.validatePackage(state,d.uploads);
  if(!checked.valid){d.plan=checked;d.error='Повторная проверка обнаружила ошибки. Ничего не сохранено.';redrawDataImport();return false;}
  previous=structuredClone(state);replaceState(checked.nextState);applied=true;syncMachineStatuses();
  if(!persist()){replaceState(previous);applied=false;d.error='Не удалось сохранить пакет. Все прежние данные сохранены; освободите место в браузере и проверьте пакет заново.';d.plan=null;redrawDataImport();return false;}
  saved=true;
  const count=Object.values(checked.counts||{}).reduce((sum,n)=>sum+Number(n||0),0);
  d.uploads=[];d.loaded=null;d.plan=null;d.result=`Пакет сохранён: ${count} записей. Связи проверены. Откройте нужный реестр или раздел.`;d.error='';redrawDataImport();return true;
 }catch(e){if(applied&&!saved&&previous)replaceState(previous);d.error=saved?'Пакет сохранён, но экран не обновился. Откройте раздел снова.':'Пакет не сохранён: '+e.message;if(!saved)d.plan=null;try{redrawDataImport();}catch{}return saved;}

}
function exportDataRegister(entity,machineId){const cols=dataRegisterColumns(entity),rows=dataRegisterRows(entity,{machineId});download('mars-'+entity+'.csv','\uFEFF'+[[...cols.map(c=>c[1]),'Источник'],...rows.map(r=>[...cols.map(([key])=>dataRegisterValue(r,key)),sourceDescription(r)])].map(r=>r.map(csvCell).join(';')).join('\r\n'),'text/csv');}
function dataImportAction(action){
 const d=dataImportDraft;
 if(!canImportData())return;
 if(action==='template'){download('mars-'+d.entity+'-template.csv',MarsImport.templateCSV(d.entity),'text/csv');return;}
 if(action==='backup'){handleAction('backup');return;}
 if(action==='add'){
  if(!d.loaded||d.busy)return;
  const rows=currentImportRows();if(!rows.length||d.header<0||d.header>=rows.length)return;
  const numericRows=d.loaded.numericSheets?.[d.sheet]||[];d.uploads.push({entity:d.entity,rows:dataImportMappedRows(rows,numericRows,d.header,d.mapping),mapping:{...d.mapping},fileName:d.loaded.fileName,sheetName:d.sheet,headerRow:d.header,allRows:rows,allNumericRows:numericRows});clearDataImportPlan();
 }
 if(action==='validate'){validateDataImport();return;}
 if(action==='commit'){commitDataImport();return;}
 if(action==='clear'){d.uploads=[];clearDataImportPlan();}
 if(action==='errors'&&d.plan){download('mars-import-errors.csv','\uFEFF'+[['Раздел','Лист','Строка','Поле','Ошибка'],...(d.plan.errors||[]).map(e=>[e.entity,e.sheet,e.row,MarsImport.schemas[e.entity]?.fields.find(f=>f.key===e.field)?.label||e.field,e.message])].map(r=>r.map(csvCell).join(';')).join('\r\n'),'text/csv');return;}
 redrawDataImport();
}
function bindDataRegisterExports(){document.querySelectorAll('[data-register-export]').forEach(b=>b.onclick=()=>exportDataRegister(b.dataset.registerExport,b.dataset.registerMachine));}
function dataBind(){
 document.querySelectorAll('[data-import-tab]').forEach(b=>b.onclick=()=>{dataImportDraft.tab=b.dataset.importTab;redrawDataImport();});
 document.querySelectorAll('[data-upload-action]').forEach(b=>b.onclick=()=>dataImportAction(b.dataset.uploadAction));
 bindDataRegisterExports();
 document.querySelectorAll('[data-import-field]').forEach(el=>el.onchange=()=>{dataImportDraft.mapping[el.dataset.importField]=el.value===''?null:Number(el.value);clearDataImportPlan();});
 document.querySelectorAll('[data-import-remove]').forEach(b=>b.onclick=()=>{dataImportDraft.uploads.splice(Number(b.dataset.importRemove),1);clearDataImportPlan();redrawDataImport();});
 document.querySelectorAll('[data-import-edit]').forEach(b=>b.onclick=()=>{const u=dataImportDraft.uploads.splice(Number(b.dataset.importEdit),1)[0];dataImportDraft.loaded={fileName:u.fileName,sheets:{[u.sheetName]:u.allRows},numericSheets:{[u.sheetName]:u.allNumericRows||[]}};dataImportDraft.sheet=u.sheetName;dataImportDraft.entity=u.entity;dataImportDraft.header=u.headerRow;dataImportDraft.mapping={...u.mapping};clearDataImportPlan();redrawDataImport();});
 $('#data-file')?.addEventListener('change',e=>{const file=e.target.files?.[0];if(file)readDataImportFile(file,$('#data-encoding')?.value||'utf-8');});
 for(const id of ['data-entity','data-entity-start'])$('#'+id)?.addEventListener('change',e=>{dataImportDraft.entity=e.target.value;if(dataImportDraft.loaded)mapCurrentImport();else clearDataImportPlan();redrawDataImport();});
 $('#data-sheet')?.addEventListener('change',e=>{dataImportDraft.sheet=e.target.value;dataImportDraft.header=0;mapCurrentImport();redrawDataImport();});
 $('#data-header')?.addEventListener('change',e=>{const n=Number(e.target.value)-1;if(!Number.isInteger(n)||n<0||n>=currentImportRows().length){e.target.value=dataImportDraft.header+1;dataImportDraft.error='Укажите существующую строку заголовков.';redrawDataImport();return;}if(n===dataImportDraft.header)return;dataImportDraft.header=n;mapCurrentImport();redrawDataImport();});
}

// Existing allocation/history remain accessible; new expense uploads use the same
// package checks as every other entity, rather than a second import route.
const legacyAccountantPage=accountantPage,legacyAccountantBind=accountantBind;
accountantPage=function(){return accountantTab==='upload'?dataPage('expenses')+'<section class="panel padded"><h2>Ранее загруженные расходы</h2><div class="import-toolbar"><button class="btn" data-accountant-tab="allocation">Распределение расходов</button><button class="btn" data-accountant-tab="history">История прежних загрузок</button></div></section>':legacyAccountantPage();};
accountantBind=function(){if(accountantTab==='upload'){dataBind();document.querySelectorAll('[data-accountant-tab]').forEach(b=>b.onclick=()=>{accountantTab=b.dataset.accountantTab;render();});}else legacyAccountantBind();};
