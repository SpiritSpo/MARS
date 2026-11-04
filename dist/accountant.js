'use strict';
// Демо: данные и журнал импортов хранятся только в localStorage этого браузера.
let accountantPending=[],accountantTab='upload',accountantFileName='',accountantFileKey='';
const accountantImported=()=>state.operations.filter(o=>o.source==='excel-demo');
const accountantHistory=()=>Array.isArray(state.accountantImports)?state.accountantImports:(state.accountantImports=[]);
const accountantFingerprint=o=>[o.date,o.category.trim().toLowerCase(),Number(o.amount).toFixed(2),String(o.note||'').trim().toLowerCase(),(Object.hasOwn(o,'importMachine')?o.importMachine:o.machine)||''].join('|');
const accountantMoney=items=>items.reduce((s,x)=>s+Number(x.amount||0),0);
const accountantCsvCell=s=>String(s??'').trim();
function accountantParseCSV(text){
 const rows=[];let row=[],cell='',quoted=false;
 text=String(text).replace(/^\uFEFF/,'');
 const first=text.split(/\r?\n/,1)[0]||'';
 const sep=(first.match(/;/g)||[]).length>=(first.match(/,/g)||[]).length?';':',';
 for(let i=0;i<text.length;i++){const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!quoted&&!cell.trim())quoted=true;else if(quoted)quoted=false;else cell+=c;}
  else if(c===sep&&!quoted){row.push(accountantCsvCell(cell));cell='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(accountantCsvCell(cell));if(row.some(Boolean))rows.push(row);row=[];cell='';}
  else cell+=c;
 }
 if(quoted)throw Error('Незакрытые кавычки в CSV.');
 row.push(accountantCsvCell(cell));if(row.some(Boolean))rows.push(row);
 return rows;
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
function accountantParseRows(data){
 if(!Array.isArray(data)||data.length<2)throw Error('Файл пуст или не содержит строк расходов.');
 const head=data[0].map(x=>String(x??'').trim().toLowerCase().replace(/\s+/g,' '));
 const col=(...names)=>head.findIndex(x=>names.includes(x));
 const ix=[col('дата','date'),col('техника','машина','machine'),col('статья','категория','category'),col('сумма','amount'),col('комментарий','примечание','note')];
 if(ix.slice(0,4).some(x=>x<0))throw Error('Нужны колонки: Дата, Техника, Статья, Сумма.');
 const rows=[],errors=[],seen=new Set(),existing=new Set(accountantImported().map(accountantFingerprint));
 data.slice(1).forEach((r,i)=>{
  if(!r.some(x=>String(x??'').trim()))return;
  const raw=String(r[ix[1]]??'').trim();
  const matches=machines.filter(x=>[x.id,x.plate,x.serial,x.vin].filter(Boolean).some(v=>String(v).toLowerCase()===raw.toLowerCase()));
  const m=matches.length===1?matches[0]:null;
  const special=raw.toUpperCase()==='ОБЩЕХОЗ'?'overhead':raw.toUpperCase()==='СКЛАД'?'warehouse':'';
  if(!raw||(!m&&!special)){errors.push('Строка '+(i+2)+': укажите точный идентификатор техники, ОБЩЕХОЗ или СКЛАД.');return;}
  const date=accountantDate(r[ix[0]]),category=String(r[ix[2]]??'').trim(),note=ix[4]>=0?String(r[ix[4]]??'').trim():'';
  const amountText=String(r[ix[3]]??'').replace(/[\s\u00a0\u202f₽]/g,'').replace(',','.');
  const amount=Number(amountText),line=i+2;
  if(!date||!category||!amountText||!Number.isFinite(amount)||amount<=0||amount>1e12){errors.push('Строка '+line+': неверная дата, статья или сумма');return;}
  const item={id:uid(),machine:m?.id||'',importMachine:raw,kind:'expense',category,amount:Math.round(amount*100)/100,date,note,source:'excel-demo',allocation:m?'machine':special,importLine:line};
  const key=accountantFingerprint(item);
  if(seen.has(key)||existing.has(key)){errors.push('Строка '+line+': возможный дубль');return;}
  seen.add(key);rows.push(item);
 });
 return {rows,errors};
}
function accountantPage(){
 const rows=accountantImported(),pending=rows.filter(o=>!o.machine&&o.allocation!=='overhead'),assigned=rows.filter(o=>!!o.machine),overhead=rows.filter(o=>o.allocation==='overhead'),history=accountantHistory();
 const tabs=[['upload','Загрузка файлов'],['allocation','Распределение расходов'],['history','История импортов']];
 return '<section class="panel padded"><h2>Бухгалтер · расходы из 1С</h2><p class="subtitle">Демонстрация: CSV / XLSX, без прямого подключения к 1С. Данные остаются только в этом браузере.</p><div class="filter-row">'+tabs.map(([id,label])=>'<button class="btn '+(accountantTab===id?'primary':'')+'" data-accountant-tab="'+id+'">'+label+'</button>').join('')+'</div>'+
 (accountantTab==='upload'?'<div class="info-note"><strong>Шаблон:</strong> Дата;Техника;Статья;Сумма;Комментарий. Техника: M001–M010 либо точное название. Пустая или неизвестная техника блокирует импорт. Для общих затрат укажите ОБЩЕХОЗ, для склада — СКЛАД. Не загружайте реальные персональные и бухгалтерские данные.</div><p style="margin:18px 0"><button class="btn" id="accountant-sample">Скачать пример CSV</button> <label class="btn primary" for="accountant-file">Выбрать файл Excel / CSV</label><input type="file" id="accountant-file" accept=".csv,.xlsx" style="position:absolute;width:1px;height:1px;opacity:0"></p><div id="accountant-preview"></div>':
 accountantTab==='allocation'?'<div class="stats"><article class="stat"><div class="stat-label">Ожидают распределения</div><div class="stat-value">'+pending.length+'</div></article><article class="stat"><div class="stat-label">Распределено на технику</div><div class="stat-value">'+assigned.length+'</div></article><article class="stat"><div class="stat-label">Общехозяйственные</div><div class="stat-value">'+overhead.length+'</div></article></div><p class="subtitle">Без распределения расход не относится на себестоимость машины.</p>'+(!rows.length?'<p>Импортов пока нет.</p>':rows.slice().reverse().map(o=>'<div class="info-note" style="margin:8px 0"><strong>'+esc(o.date)+' · '+esc(o.category)+' · '+rub(o.amount)+'</strong><div>'+esc(o.note||'Без комментария')+'</div><small>Исходная техника: '+esc(o.importMachine||'не указана')+' · '+esc(o.importFile||'файл')+'</small><div><select class="accountant-assign" data-id="'+esc(o.id)+'"><option value="">Без распределения</option>'+machines.map(m=>'<option value="'+esc(m.id)+'" '+(o.machine===m.id?'selected':'')+'>'+esc(m.id)+' · '+esc(m.name)+'</option>').join('')+'<option value="overhead" '+(o.allocation==='overhead'?'selected':'')+'>Общехозяйственный расход</option></select> <button class="btn accountant-assign-save" data-id="'+esc(o.id)+'">Сохранить распределение</button></div></div>').join('')):
 '<div class="stats"><article class="stat"><div class="stat-label">Загрузок</div><div class="stat-value">'+history.length+'</div></article><article class="stat"><div class="stat-label">Импортировано строк</div><div class="stat-value">'+rows.length+'</div></article><article class="stat"><div class="stat-label">Всего расходов</div><div class="stat-value">'+rub(accountantMoney(rows))+'</div></article></div>'+(!history.length?'<p class="subtitle">Журнал пока пуст. История новых загрузок будет появляться здесь.</p>':'<div class="table-scroll"><table class="data-table"><thead><tr><th>Дата загрузки</th><th>Файл</th><th>Строк</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>'+history.slice().reverse().map(h=>'<tr><td>'+esc(new Date(h.at).toLocaleString('ru-RU'))+'</td><td>'+esc(h.file)+'</td><td>'+h.count+'</td><td>'+rub(h.total)+'</td><td>'+esc(h.status)+'</td></tr>').join('')+'</tbody></table></div>'))+
 '<p class="subtitle">Подтверждённые расходы по технике учитываются в разделе «Финансы» руководителя только на этом устройстве. Серверной базы и реальных прав доступа пока нет.</p></section>';
}
function accountantBind(){
 document.querySelectorAll('[data-accountant-tab]').forEach(b=>b.onclick=()=>{accountantTab=b.dataset.accountantTab;accountantPending=[];render();});
 document.querySelectorAll('.accountant-assign-save').forEach(btn=>btn.onclick=()=>{
  const row=accountantImported().find(o=>o.id===btn.dataset.id);if(!row)return;
  const selected=document.querySelector('.accountant-assign[data-id="'+btn.dataset.id+'"]')?.value||'';
  if(selected&&selected!=='overhead'&&!machines.some(m=>m.id===selected))return toast('Выберите технику.');
  const prev={machine:row.machine,allocation:row.allocation};
  row.machine=selected==='overhead'?'':selected;row.allocation=selected==='overhead'?'overhead':selected?'machine':'pending';
  if(!persist()){Object.assign(row,prev);return toast('Распределение не сохранено.');}
  render();toast('Распределение сохранено.');
 });
 document.getElementById('accountant-sample')?.addEventListener('click',()=>{
  const csv='Дата;Техника;Статья;Сумма;Комментарий\n2026-11-03;M001;Запчасти;12500;Фильтры\n2026-11-03;M002;Ремонт и ТО;34000;"Гидравлика; диагностика"\n2026-11-03;ОБЩЕХОЗ;Аренда офиса;85000;Общие расходы';
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download='mars-demo-1c.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 });
 document.getElementById('accountant-file')?.addEventListener('change',async e=>{
  const f=e.target.files?.[0];if(!f)return;const box=document.getElementById('accountant-preview');
  accountantPending=[];accountantFileName=f.name.slice(0,150);
  try{
   if(f.size>8*1024*1024)throw Error('Файл слишком большой (максимум 8 МБ).');
   let data;
   if(f.name.toLowerCase().endsWith('.xlsx')){
    if(!globalThis.XLSX)throw Error('Библиотека Excel недоступна. Используйте CSV.');
    const book=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:false});
    if(!book.SheetNames.length)throw Error('В Excel нет листов.');
    data=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,raw:false,defval:''});
   }else if(f.name.toLowerCase().endsWith('.csv'))data=accountantParseCSV(await f.text());
   else throw Error('Поддерживаются только CSV и XLSX.');
   const parsed=accountantParseRows(data);accountantPending=parsed.rows;
   const invalid=parsed.errors,valid=parsed.rows;
   box.innerHTML='<div class="info-note"><strong>Предпросмотр: '+esc(accountantFileName)+'</strong><p>Корректных строк: '+valid.length+' · сумма: '+rub(accountantMoney(valid))+' · ошибок/дублей: '+invalid.length+'</p>'+(invalid.length?'<p class="negative">'+esc(invalid.slice(0,15).join('; '))+'</p><p>Исправьте файл и загрузите его повторно. Импорт целиком заблокирован.</p>':'')+'</div>'+
   (valid.length?'<div class="table-scroll"><table class="data-table"><thead><tr><th>Строка</th><th>Дата</th><th>Техника</th><th>Статья</th><th>Сумма</th></tr></thead><tbody>'+valid.slice(0,50).map(o=>'<tr><td>'+o.importLine+'</td><td>'+esc(o.date)+'</td><td>'+esc(o.machine||'Распределить')+'</td><td>'+esc(o.category)+'</td><td>'+rub(o.amount)+'</td></tr>').join('')+'</tbody></table></div>':'')+
   (!invalid.length&&valid.length?'<button class="btn primary" id="accountant-confirm">Подтвердить импорт</button>':'');
   document.getElementById('accountant-confirm')?.addEventListener('click',()=>{
    const existing=new Set(accountantImported().map(accountantFingerprint));
    if(accountantPending.some(o=>existing.has(accountantFingerprint(o))))return toast('Дубли обнаружены. Повторно загрузите файл.');
    const snapshot=structuredClone(state),batch=uid();
    state.accountantImports??=[];
    const added=accountantPending.map(o=>({...o,importBatch:batch,importFile:accountantFileName}));
    state.operations.push(...added);
    state.accountantImports.push({id:batch,at:new Date().toISOString(),file:accountantFileName,count:added.length,total:accountantMoney(added),status:'Импортировано'});
    if(!persist()){state=snapshot;return toast('Не удалось сохранить импорт. Данные не изменены.');}
    accountantPending=[];accountantTab='history';render();toast('Расходы импортированы. Журнал обновлён.');
   });
  }catch(err){accountantPending=[];box.textContent='Ошибка импорта: '+err.message;}
 });
}
