'use strict';
// Browser-local import: exact source identities prevent repeats; similarities require a human decision.
let accountantPending=[],accountantTab='upload',accountantFileName='',accountantFileKey='',accountantPreview=null,accountantLoadVersion=0;
const accountantImported=()=>state.operations.filter(o=>o.source==='excel-demo');
const accountantHistory=()=>Array.isArray(state.accountantImports)?state.accountantImports:[];
const accountantMoney=items=>items.reduce((s,x)=>s+(Number(x.amount)||0),0);
const accountantFingerprint=o=>JSON.stringify(accountantOriginal(o));
function accountantOriginal(o){
 if(o.importOriginal&&typeof o.importOriginal==='object'&&!Array.isArray(o.importOriginal))return o.importOriginal;
 return {date:o.date,category:String(o.category||'').trim(),amount:Number(o.amount),machine:financeMachineId(o.importMachine||o.machine)||o.machine||'',allocation:o.importAllocation||o.allocation||'machine',note:String(o.note||'').trim(),repairReference:String(o.repairReference||'').trim(),document:String(o.importDocument||'').trim(),documentId:String(o.importDocumentId||'').trim(),documentLine:String(o.importDocumentLine||'').trim(),source:String(o.importSource||'').trim().toLowerCase()};
}
function accountantSourceKeys(o){
 const keys=[];
 if(o.importFileHash&&o.importSheet&&Number.isInteger(o.importLine))keys.push(JSON.stringify(['file',o.importFileHash,o.importSheet,o.importLine]));
 for(const event of Array.isArray(o.provenanceHistory)?o.provenanceHistory:[]){
  const origin=event?.action==='Повторная проверка источника'?event.details:null;
  if(origin?.fileHash&&origin.sheet&&Number.isInteger(origin.line))keys.push(JSON.stringify(['file',origin.fileHash,origin.sheet,origin.line]));
 }
 // A document number alone is not a global identity. Stable document and line IDs are required.
 if(o.importSource&&o.importDocumentId&&o.importDocumentLine)keys.push(JSON.stringify(['document',String(o.importSource).trim().toLowerCase(),o.importDocumentId,o.importDocumentLine]));
 return keys;
}
function accountantSourceMatch(row,pool=state.operations){
 const keys=accountantSourceKeys(row);
 if(!keys.length)return null;
 const matches=pool.filter(o=>o.source==='excel-demo'&&accountantSourceKeys(o).some(key=>keys.includes(key)));
 if(!matches.length)return null;
 const same=matches.filter(o=>accountantFingerprint(o)===accountantFingerprint(row));
 return same.length===matches.length?{operation:same[0]}:{conflict:matches[0]};
}
function accountantAppendHistory(key,event){
 if(!Array.isArray(state[key])){
  if(Object.hasOwn(state,key)&&state[key]!==undefined){
   if(!Array.isArray(state.accountantHistoryRecovery)){
    const old=state.accountantHistoryRecovery;
    state.accountantHistoryRecovery=Object.hasOwn(state,'accountantHistoryRecovery')&&old!==undefined?[{field:'accountantHistoryRecovery',value:structuredClone(old)}]:[];
   }
   state.accountantHistoryRecovery.push({field:key,at:new Date().toISOString(),value:structuredClone(state[key])});
  }
  state[key]=[];
 }
 state[key].push(event);
}
// Kept as a read-only compatibility helper for callers that need a repair warning.
function accountantRepairConflict(o){return financeExpenseCandidates(o).find(x=>x.sourceRepair)||null;}
const accountantCsvCell=s=>String(s??'').trim();
function accountantParseCSV(text){
 const rows=[];let row=[],cell='',quoted=false,line=1,start=1;
 text=String(text).replace(/^\uFEFF/,'');
 const first=text.split(/\r?\n/).find(value=>value.trim())||'';
 const sep=(first.match(/;/g)||[]).length>=(first.match(/,/g)||[]).length?';':',';
 const finish=()=>{row.push(accountantCsvCell(cell));if(row.some(Boolean)){Object.defineProperty(row,'sourceLine',{value:start});rows.push(row);}row=[];cell='';};
 for(let i=0;i<text.length;i++){const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!quoted&&!cell.trim())quoted=true;else if(quoted)quoted=false;else cell+=c;}
  else if(c===sep&&!quoted){row.push(accountantCsvCell(cell));cell='';}
  else if(c==='\n'||c==='\r'){
   if(c==='\r'&&text[i+1]==='\n')i++;
   if(quoted)cell+='\n';else finish();
   line++;if(!quoted)start=line;
  }else cell+=c;
 }
 if(quoted)throw Error('Незакрытые кавычки в CSV.');
 finish();return rows;
}
function accountantDate(value){
 const s=String(value??'').trim();let iso='';
 if(/^\d{4}-\d{2}-\d{2}$/.test(s))iso=s;
 else if(/^\d{2}\.\d{2}\.\d{4}$/.test(s))iso=s.slice(6)+'-'+s.slice(3,5)+'-'+s.slice(0,2);
 else if(/^\d{2}\/\d{2}\/\d{4}$/.test(s))iso=s.slice(6)+'-'+s.slice(3,5)+'-'+s.slice(0,2);
 if(!iso)return '';
 const d=new Date(iso+'T12:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===iso?iso:'';
}
function accountantParseRows(data,meta={}){
 if(!Array.isArray(data))throw Error('Файл не содержит таблицу расходов.');
 const header=data.findIndex(r=>Array.isArray(r)&&r.some(x=>String(x??'').trim()));
 if(header<0||data.length<=header+1)throw Error('Файл пуст или не содержит строк расходов.');
 const head=data[header].map(x=>String(x??'').trim().toLowerCase().replace(/\s+/g,' '));
 const col=(...names)=>head.findIndex(x=>names.includes(x));
 const ix=[col('дата','date'),col('техника','машина','machine'),col('статья','категория','category'),col('сумма','amount'),col('комментарий','примечание','note')];
 if(ix.slice(0,4).some(x=>x<0))throw Error('Нужны колонки: Дата, Техника, Статья, Сумма.');
 const document=col('номер документа','документ','document'),documentId=col('id документа','ид документа','document id'),documentLine=col('id строки','ид строки','строка документа','document line'),source=col('источник','source system'),repair=col('ремонт','номер ремонта','repair');
 const rows=[],errors=[],processed=[],review=[],sourceRows=[];
 data.slice(header+1).forEach((r,index)=>{
  if(!Array.isArray(r)||!r.some(x=>String(x??'').trim()))return;
  const line=meta.rowNumbers?.[header+1+index]||r.sourceLine||header+index+2;
  const raw=String(r[ix[1]]??'').trim(),machineId=financeMachineId(raw);
  const special=raw.toUpperCase()==='ОБЩЕХОЗ'?'overhead':raw.toUpperCase()==='СКЛАД'?'warehouse':'';
  if(!raw||(!machineId&&!special)){errors.push('Строка '+line+': укажите однозначный ID, инвентарный или государственный номер техники, ОБЩЕХОЗ или СКЛАД.');return;}
  const date=accountantDate(r[ix[0]]),category=String(r[ix[2]]??'').trim(),note=ix[4]>=0?String(r[ix[4]]??'').trim():'';
  const amountText=String(r[ix[3]]??'').replace(/[\s\u00a0\u202f₽]/g,'').replace(',','.');
  const amount=Number(amountText);
  if(!date||!category||!amountText||!Number.isFinite(amount)||amount<=0||amount>1e12){errors.push('Строка '+line+': неверная дата, статья или сумма');return;}
  const cell=i=>i>=0?String(r[i]??'').trim():'';
  const item={id:uid(),machine:machineId,importMachine:raw,kind:'expense',category,amount:Math.round(amount*100)/100,date,note,source:'excel-demo',allocation:machineId?'machine':special,importAllocation:machineId?'machine':special,importLine:line,importSheet:String(meta.sheet||'CSV'),importFile:String(meta.file||''),importFileHash:String(meta.fileHash||''),importDocument:cell(document),importDocumentId:cell(documentId),importDocumentLine:cell(documentLine),importSource:cell(source).toLowerCase(),repairReference:cell(repair)};
  item.importOriginal=accountantOriginal(item);
  const match=accountantSourceMatch(item,[...state.operations,...rows]);
  if(match?.conflict){errors.push('Строка '+line+': идентификатор источника уже существует, но содержимое изменилось. Требуется сверка исходного документа; повторное проведение заблокировано.');return;}
  sourceRows.push(item);
  if(match?.operation){processed.push({row:item,operationId:match.operation.id});return;}
  const candidates=financeReviewCandidates(item,[...state.operations,...rows]);
  if(candidates.length)review.push({row:item,candidates,reason:'Возможное повторное отражение расхода. Подтвердите связь либо самостоятельный расход.'});
  rows.push(item);
 });
 return {rows,errors,processed,review,sourceRows};
}
function accountantCommitImport(rows=accountantPending,decisions={},meta={}){
 if(!['accountant','director'].includes(role))return {ok:false,error:'Импорт доступен бухгалтеру или руководителю.'};
 if(meta.errors?.length)return {ok:false,error:'Исправьте ошибки источника перед импортом.'};
 const checked=[...rows,...(meta.processed||[]).map(x=>x.row)].filter(Boolean);
 if(!checked.length)return {ok:false,error:'Нет строк для проведения или проверки.'};
 const snapshot=structuredClone(state),batch=uid(),added=[],processed=[];
 const fail=error=>{replaceState(snapshot);return {ok:false,error};};
 for(const original of checked){
  const row=structuredClone(original),match=accountantSourceMatch(row);
  if(match?.conflict)return fail('Строка '+row.importLine+': исходная операция изменилась. Требуется сверка.');
  if(match?.operation){
   processed.push({row,operationId:match.operation.id});
   financeRecordEvent(match.operation,'Повторная проверка источника',{file:row.importFile,fileHash:row.importFileHash,sheet:row.importSheet,line:row.importLine,batch,document:row.importDocument,documentId:row.importDocumentId,documentLine:row.importDocumentLine,source:row.importSource,repair:row.repairReference});
   continue;
  }
  const candidates=financeReviewCandidates(row),decision=decisions[row.id];
  if(candidates.length&&!decision)return fail('Строка '+row.importLine+': требуется сверка возможного повтора расходов.');
  if(decision){
   if(decision.kind==='link'){
    const selected=state.operations.find(o=>o.id===decision.targetId),root=selected&&financeExpenseRoot(selected);
    if(!selected||!financeCanLink(row,selected)||!candidates.some(x=>x.id===root.id))return fail('Совпадения изменились. Повторно проверьте строку '+row.importLine+'.');
   }
   const error=financeApplyDecision(row,decision);if(error)return fail(error);
  }
  row.importBatch=batch;
  financeRecordEvent(row,'Импортировано',{file:row.importFile,fileHash:row.importFileHash,sheet:row.importSheet,line:row.importLine,document:row.importDocument,documentId:row.importDocumentId,documentLine:row.importDocumentLine,repair:row.repairReference});
  state.operations.push(row);added.push(row);
 }
 accountantAppendHistory('accountantImports',{id:batch,at:new Date().toISOString(),file:meta.file||accountantFileName||checked[0]?.importFile||'Источник',fileHash:meta.fileHash||checked[0]?.importFileHash||'',count:added.length,processed:processed.length,total:accountantMoney(added),countedTotal:accountantMoney(added.filter(o=>financeIsCounted(o)&&o.allocation!=='warehouse')),operations:added.map(o=>o.id),processedOperations:processed.map(o=>o.operationId),status:added.length?'Импортировано':'Повтор: уже обработано'});
 if(!persistOrRollback(snapshot))return {ok:false,error:'Не удалось сохранить импорт. Данные не изменены.'};
 return {ok:true,added:added.length,processed:processed.length,batch};
}
function accountantAssignExpense(id,selected,decision){
 const row=accountantImported().find(o=>o.id===id);if(!row)return {ok:false,error:'Расход не найден.'};
 const machineId=financeMachineId(selected),special=['overhead','warehouse'].includes(selected);
 if(!machineId&&!special)return {ok:false,error:'Укажите однозначную машину, склад или общехозяйственные расходы.'};
 const next={machine:special?'':machineId,allocation:special?selected:'machine'};
 if(row.machine===next.machine&&row.allocation===next.allocation)return {ok:true,unchanged:true};
 // Moving one member of a confirmed link independently would change recognition for the entire expense.
 if(row.expenseMatch||financeHasDependents(row))return {ok:false,error:'Расход связан с другой записью. Для переназначения сначала требуется отдельная сверка всей связи.'};
 const candidate={...structuredClone(row),...next};delete candidate.expenseDistinct;
 const candidates=financeReviewCandidates(candidate);
 if(candidates.length&&!decision)return {ok:false,error:'После переназначения обнаружены возможные повторы. Требуется сверка.',candidates,candidate};
 if(decision){const error=financeApplyDecision(candidate,decision);if(error)return {ok:false,error,candidates,candidate};}
 const snapshot=structuredClone(state),previous={machine:row.machine,allocation:row.allocation},previousDecision={expenseMatch:row.expenseMatch,expenseDistinct:row.expenseDistinct};
 delete row.expenseDistinct;Object.assign(row,candidate);
 financeRecordEvent(row,'Изменение назначения',{from:previous,to:next,previousDecision});
 accountantAppendHistory('accountantAllocationAudit',{at:new Date().toISOString(),rowId:id,from:previous,to:next,actor:'Бухгалтер · локальная запись'});
 if(!persistOrRollback(snapshot))return {ok:false,error:'Распределение не сохранено. Данные не изменены.'};
 return {ok:true};
}
function accountantDecisionFields(row,candidates,prefix='accountant-review'){
 return '<div class="info-note accountant-review"><p><strong>Требуется сверка:</strong> '+esc(row.importSheet||'')+' · строка '+esc(row.importLine||'')+' · '+esc(row.date)+' · '+rub(row.amount)+'</p><label class="accountant-field">Решение сверки<select class="accountant-control" id="'+prefix+'-'+esc(row.id)+'"><option value="">Выберите решение</option>'+candidates.map(o=>'<option value="'+esc(o.id)+'" '+(!financeCanLink(row,o)?'disabled':'')+'>Тот же расход: '+esc(o.id)+' · '+esc(o.date)+' · '+esc(o.importDocument||o.note||o.category)+' · '+rub(o.amount)+(!financeCanLink(row,o)?' — сумма или назначение отличаются':'')+'</option>').join('')+'<option value="distinct">Это отдельный расход</option></select></label><label class="accountant-field">Основание сверки<input class="accountant-control" id="'+prefix+'-reason-'+esc(row.id)+'" maxlength="400" placeholder="Документ или причина решения"></label></div>';
}
function accountantReadDecision(row,prefix='accountant-review'){
 const selected=document.getElementById(prefix+'-'+row.id)?.value||'',reason=document.getElementById(prefix+'-reason-'+row.id)?.value.trim()||'';
 return selected?{kind:selected==='distinct'?'distinct':'link',targetId:selected==='distinct'?'':selected,reason}:undefined;
}
function accountantReviewAssignment(id,selected,result){
 showModal('Сверка назначения расхода','<form class="accountant-review-form" id="accountant-assignment-review">'+accountantDecisionFields(result.candidate,result.candidates,'assignment-review')+formActions('Подтвердить назначение')+'</form>');
 $('#accountant-assignment-review').onsubmit=e=>{e.preventDefault();const row=accountantImported().find(o=>o.id===id);if(!row)return formError('Расход не найден.');const response=accountantAssignExpense(id,selected,accountantReadDecision(row,'assignment-review'));if(!response.ok)return formError(response.error);closeModal(false);render();toast('Распределение и история сохранены.');};
}
function accountantPreviewMarkup(parsed){
 return '<div class="info-note accountant-preview-summary"><strong>Предпросмотр: '+esc(accountantFileName)+'</strong><p>Новых строк: '+parsed.rows.length+' · уже обработано: '+parsed.processed.length+' · требуют сверки: '+parsed.review.length+' · ошибок: '+parsed.errors.length+'</p>'+(parsed.errors.length?'<p class="negative">'+esc(parsed.errors.join('; '))+'</p><p>Исправьте файл. Проведение заблокировано.</p>':'')+'</div>'+
 ((parsed.rows.length||parsed.processed.length)?'<div class="table-scroll"><table class="data-table"><thead><tr><th>Лист / строка</th><th>Дата</th><th>Техника</th><th>Документ / статья</th><th>Сумма</th><th>Проверка</th></tr></thead><tbody>'+[...parsed.rows.map(row=>({row,status:parsed.review.some(r=>r.row.id===row.id)?'Требует сверки':'Новая'})),...parsed.processed.map(p=>({row:p.row,status:'Уже обработано: '+p.operationId}))].map(({row,status})=>'<tr><td>'+esc(row.importSheet)+' / '+row.importLine+'</td><td>'+esc(row.date)+'</td><td>'+esc(row.machine||row.allocation)+'</td><td>'+esc(row.importDocument||row.category)+'</td><td>'+rub(row.amount)+'</td><td>'+esc(status)+'</td></tr>').join('')+'</tbody></table></div>':'')+
 parsed.review.map(r=>accountantDecisionFields(r.row,r.candidates)).join('')+
 (!parsed.errors.length&&(parsed.rows.length||parsed.processed.length)?'<button class="btn primary accountant-action" id="accountant-confirm">'+(parsed.rows.length?'Подтвердить импорт':'Записать результат проверки')+'</button>':'');
}
function accountantProvenanceMarkup(row){
 const events=Array.isArray(row.provenanceHistory)?row.provenanceHistory:[];
 const labels={'expense-reconciliation':'Сверка расхода'};
 const text=value=>typeof value==='string'||typeof value==='number'?String(value):'';
 return '<details><summary>Происхождение и сверки</summary><p class="page-note">Источник: '+esc(row.importSource||'не указан')+' · ID документа: '+esc(row.importDocumentId||'не записан')+' · ID строки: '+esc(row.importDocumentLine||'не записан')+'</p>'+events.filter(event=>event&&typeof event==='object').map(event=>{
  const details=event.details&&typeof event.details==='object'?event.details:{},reason=text(details.decision?.reason||details.reason);
  const from=details.from&&typeof details.from==='object'?text(details.from.machine||details.from.allocation):'',to=details.to&&typeof details.to==='object'?text(details.to.machine||details.to.allocation):'';
  const allocation=value=>({overhead:'Общехозяйственные расходы',warehouse:'Склад',machine:'Техника'})[value]||value;
  const origin=details.file?'<br>Файл: '+esc(text(details.file))+' · '+esc(text(details.sheet))+' / '+esc(text(details.line)):'';
  const date=typeof event.at==='string'&&Number.isFinite(Date.parse(event.at))?new Date(event.at).toLocaleString('ru-RU'):'Дата не записана';
  return '<p class="page-note"><strong>'+esc(date)+' · '+esc(labels[event.action]||text(event.action)||'Сохранённая запись')+'</strong>'+origin+(reason?'<br>Основание: '+esc(reason):'')+(from||to?'<br>Назначение: '+esc(allocation(from)||'Не задано')+' → '+esc(allocation(to)||'Не задано'):'')+'</p>';
 }).join('')+(!events.length?'<p class="page-note">Для прежней записи история источника не сохранена.</p>':'')+'</details>';
}
function accountantPage(){
 const rows=accountantImported(),pending=rows.filter(o=>!o.machine&&!['overhead','warehouse'].includes(o.allocation)),assigned=rows.filter(o=>!!o.machine),overhead=rows.filter(o=>o.allocation==='overhead'),history=accountantHistory();
 const tabs=[['upload','Загрузка файлов'],['allocation','Распределение расходов'],['history','История импортов']];
 let content='';
 if(accountantTab==='upload')content='<div class="info-note"><strong>Шаблон:</strong> Дата;Техника;Статья;Сумма;Комментарий. Для техники укажите ID, инвентарный или государственный номер из справочника; для общих затрат — ОБЩЕХОЗ, для склада — СКЛАД. Необязательные колонки: Номер документа, ID документа, ID строки, Источник, Ремонт. Для точного повтора документа нужны ID документа, ID строки и явно указанный Источник. Повтор источника проверяется отдельно от похожих расходов. Одинаковые суммы сами по себе не означают дубль.</div><p class="accountant-upload-actions"><button class="btn accountant-action" id="accountant-sample">Скачать пустой шаблон CSV</button> <label class="btn primary accountant-action" for="accountant-file">Выбрать файл Excel / CSV</label><input type="file" class="accountant-file-input" id="accountant-file" accept=".csv,.xlsx" style="position:absolute;width:1px;height:1px;opacity:0"></p><div class="accountant-preview" id="accountant-preview">'+(accountantPreview?accountantPreviewMarkup(accountantPreview):'')+'</div>';
 else if(accountantTab==='allocation')content='<div class="stats"><article class="stat"><div class="stat-label">Ожидают распределения</div><div class="stat-value">'+pending.length+'</div></article><article class="stat"><div class="stat-label">Распределено на технику</div><div class="stat-value">'+assigned.length+'</div></article><article class="stat"><div class="stat-label">Общехозяйственные</div><div class="stat-value">'+overhead.length+'</div></article></div><p class="subtitle">Без распределения расход не относится на себестоимость машины. Связанные записи сохраняются для истории источников.</p>'+(!rows.length?'<p>Импортов пока нет.</p>':rows.slice().reverse().map(o=>{const candidates=financeReviewCandidates(o);return '<div class="info-note accountant-expense" style="margin:8px 0"><strong>'+esc(o.date)+' · '+esc(o.category)+' · '+rub(o.amount)+'</strong><div>'+esc(o.note||'Без комментария')+'</div><small>Исходная техника: '+esc(o.importMachine||'не указана')+' · '+esc(o.importFile||'файл')+' · '+esc(o.importSheet||'лист не записан')+' / '+esc(o.importLine||'строка не записана')+' · '+esc(o.importDocument||'документ не указан')+'</small>'+accountantProvenanceMarkup(o)+'<p>'+esc(financeAccountingStatus(o))+'</p><div class="accountant-actions"><label class="accountant-field accountant-assignment-field">Назначение расхода<select class="accountant-assign accountant-control" data-id="'+esc(o.id)+'"><option value="">Выберите назначение</option>'+machines.map(m=>'<option value="'+esc(m.id)+'" '+(o.machine===m.id?'selected':'')+'>'+esc(m.id)+' · '+esc(m.name)+'</option>').join('')+'<option value="overhead" '+(o.allocation==='overhead'?'selected':'')+'>Общехозяйственный расход</option><option value="warehouse" '+(o.allocation==='warehouse'?'selected':'')+'>Закупка на склад</option></select></label> <button class="btn accountant-assign-save accountant-action" data-id="'+esc(o.id)+'">Сохранить распределение</button>'+(candidates.length?'<button class="btn accountant-reconcile accountant-action" data-id="'+esc(o.id)+'">Сверить расход</button>':'')+'</div></div>';}).join(''));
 else content='<div class="stats"><article class="stat"><div class="stat-label">Загрузок</div><div class="stat-value">'+history.length+'</div></article><article class="stat"><div class="stat-label">Сохранено строк источников</div><div class="stat-value">'+rows.length+'</div></article><article class="stat"><div class="stat-label">Учтённые расходы</div><div class="stat-value">'+rub(accountantMoney(rows.filter(o=>financeIsCounted(o)&&o.allocation!=='warehouse')))+'</div></article></div><p>Сумма строк источников: '+rub(accountantMoney(rows))+'. Связанные подтверждённые расходы отражаются в финансовом результате один раз; складские закупки учитываются отдельно.</p>'+(!history.length?'<p class="subtitle">Журнал пока пуст.</p>':'<div class="table-scroll"><table class="data-table"><thead><tr><th>Дата загрузки</th><th>Файл</th><th>Новых / обработано</th><th>Сумма строк</th><th>Учтено при загрузке</th><th>Статус</th></tr></thead><tbody>'+history.filter(h=>h&&typeof h==='object').slice().reverse().map(h=>'<tr><td>'+esc(h.at?new Date(h.at).toLocaleString('ru-RU'):'Не записана')+'</td><td>'+esc(h.file||'Источник не записан')+'</td><td>'+esc(h.count||0)+' / '+esc(h.processed||0)+'</td><td>'+rub(Number(h.total)||0)+'</td><td>'+(Number.isFinite(h.countedTotal)?rub(h.countedTotal):'Требует сверки')+'</td><td>'+esc(h.status||'Прежняя запись')+'</td></tr>').join('')+'</tbody></table></div>');
 return '<section class="panel padded accountant-page"><h2>Бухгалтер · загрузка расходов</h2><p class="subtitle">CSV / XLSX по согласованному шаблону, без прямого подключения к 1С. Данные остаются только в этом браузере.</p><div class="filter-row accountant-tabs">'+tabs.map(([id,label])=>'<button class="btn '+(accountantTab===id?'primary':'')+'" data-accountant-tab="'+id+'">'+label+'</button>').join('')+'</div>'+content+'<p class="subtitle">Сверка не удаляет записи источников. Серверной базы и реальных прав доступа пока нет.</p></section>';
}
function accountantReconcileExisting(id){
 const row=accountantImported().find(o=>o.id===id);if(!row)return;
 const candidates=financeReviewCandidates(row);if(!candidates.length)return toast('Новых совпадений для сверки нет.');
 showModal('Сверка расхода','<form class="accountant-review-form" id="accountant-existing-review">'+accountantDecisionFields(row,candidates,'existing-review')+formActions('Сохранить сверку')+'</form>');
 $('#accountant-existing-review').onsubmit=e=>{e.preventDefault();const current=accountantImported().find(o=>o.id===id);if(!current)return formError('Расход не найден.');const previous=structuredClone(state),error=financeApplyDecision(current,accountantReadDecision(current,'existing-review'));if(error){replaceState(previous);return formError(error);}if(!persistOrRollback(previous))return;closeModal(false);render();toast('Сверка сохранена.');};
}
function accountantConfirmPreview(){
 if(!accountantPreview)return;
 const decisions={};for(const row of accountantPending){const value=accountantReadDecision(row);if(value)decisions[row.id]=value;}
 const result=accountantCommitImport(accountantPending,decisions,{...accountantPreview,file:accountantFileName,fileHash:accountantFileKey});
 if(!result.ok)return toast(result.error);
 accountantPending=[];accountantPreview=null;accountantTab='history';render();toast('Импорт: новых '+result.added+', уже обработано '+result.processed+'.');
}
async function accountantLoadFile(f){
 const version=++accountantLoadVersion;accountantPending=[];accountantPreview=null;accountantFileName=String(f.name).slice(0,150);accountantFileKey='';
 if(f.size>8*1024*1024)throw Error('Файл слишком большой (максимум 8 МБ).');
 const bytes=await f.arrayBuffer();
 if(!globalThis.crypto?.subtle)throw Error('Безопасная проверка файла недоступна. Откройте приложение по HTTPS.');
 const digest=await crypto.subtle.digest('SHA-256',bytes),fileHash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
 const sheets=[];
 if(f.name.toLowerCase().endsWith('.xlsx')){
  if(!globalThis.XLSX)throw Error('Библиотека Excel недоступна. Используйте CSV.');
  const book=XLSX.read(bytes,{type:'array',cellDates:false});
  for(const sheet of book.SheetNames){const data=XLSX.utils.sheet_to_json(book.Sheets[sheet],{header:1,raw:false,defval:'',blankrows:true,range:0});if(data.some(r=>r.some(x=>String(x??'').trim())))sheets.push({sheet,data});}
 }else if(f.name.toLowerCase().endsWith('.csv'))sheets.push({sheet:'CSV',data:accountantParseCSV(new TextDecoder('utf-8',{fatal:true}).decode(bytes))});
 else throw Error('Поддерживаются только CSV и XLSX.');
 if(!sheets.length)throw Error('В файле нет строк расходов.');
 const parsed={rows:[],errors:[],processed:[],review:[],sourceRows:[]};
 for(const {sheet,data} of sheets){
  try{const result=accountantParseRows(data,{fileHash,file:f.name,sheet});for(const key of ['rows','processed','review','sourceRows'])parsed[key].push(...result[key]);parsed.errors.push(...result.errors.map(error=>sheet+': '+error));}
  catch(error){parsed.errors.push(sheet+': '+error.message);}
 }
 // Recheck identities and similarities across sheets as well as within each sheet.
 const accepted=[];
 parsed.processed=[];parsed.review=[];
 for(const row of parsed.sourceRows){
  const match=accountantSourceMatch(row,[...state.operations,...accepted]);
  if(match?.conflict){parsed.errors.push(row.importSheet+' / '+row.importLine+': идентификатор источника изменил содержимое. Требуется сверка.');continue;}
  if(match?.operation){parsed.processed.push({row,operationId:match.operation.id});continue;}
  const candidates=financeReviewCandidates(row,[...state.operations,...accepted]);if(candidates.length)parsed.review.push({row,candidates});accepted.push(row);
 }
 parsed.rows=accepted;
 if(version!==accountantLoadVersion)return null;
 accountantFileKey=fileHash;accountantPending=parsed.rows;accountantPreview=parsed;
 return parsed;
}
function accountantBind(){
 document.querySelectorAll('[data-accountant-tab]').forEach(b=>b.onclick=()=>{accountantTab=b.dataset.accountantTab;accountantLoadVersion++;accountantPending=[];accountantPreview=null;render();});
 document.querySelectorAll('.accountant-assign-save').forEach(btn=>btn.onclick=()=>{const selected=document.querySelector('.accountant-assign[data-id="'+btn.dataset.id+'"]')?.value||'',result=accountantAssignExpense(btn.dataset.id,selected);if(!result.ok){if(result.candidates?.length)return accountantReviewAssignment(btn.dataset.id,selected,result);return toast(result.error);}render();toast(result.unchanged?'Назначение не изменилось.':'Распределение и история сохранены.');});
 document.querySelectorAll('.accountant-reconcile').forEach(btn=>btn.onclick=()=>accountantReconcileExisting(btn.dataset.id));
 document.getElementById('accountant-sample')?.addEventListener('click',()=>{const csv='Дата;Техника;Статья;Сумма;Комментарий;Номер документа;ID документа;ID строки;Источник;Ремонт\n';download('mars-expenses-template.csv','\ufeff'+csv,'text/csv;charset=utf-8');});
 document.getElementById('accountant-confirm')?.addEventListener('click',accountantConfirmPreview);
 document.getElementById('accountant-file')?.addEventListener('change',async e=>{
  const f=e.target.files?.[0];if(!f)return;const box=document.getElementById('accountant-preview'),attempt=accountantLoadVersion+1;
  try{const parsed=await accountantLoadFile(f);if(!parsed)return;box.innerHTML=accountantPreviewMarkup(parsed);document.getElementById('accountant-confirm')?.addEventListener('click',accountantConfirmPreview);}
  catch(err){if(attempt!==accountantLoadVersion)return;accountantPending=[];accountantPreview=null;box.textContent='Ошибка импорта: '+err.message;}
 });
}
