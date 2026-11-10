'use strict';

// Browser-local workflow. Shared storage and employee authentication are not connected.
const repairStatusNames = {new:'Новая',planned:'Запланирована',progress:'В работе',waiting:'Ожидает запчасти',done:'Завершена'};
const repairStatusColors = {new:'red',planned:'blue',progress:'orange',waiting:'orange',done:'green'};
const repairUnassigned = 'Не назначен';
const repairAssignees = () => [repairUnassigned,...new Set(['Демо · Механик № 1','Демо · Механик № 2',...state.maintenance.map(r => r.assignee)].filter(name => name && name !== repairUnassigned))];
const workshopFilters = {status:'open',machine:'all',search:''};

function initializeWorkshop() {
  state.machinePhotos ??= {};
  for (const [i, r] of state.maintenance.entries()) {
    r.number ??= 'ЗР-' + String(i + 1).padStart(4,'0');
    r.kind ??= /ТО/.test(r.type) ? 'service' : 'repair';
    r.priority ??= 'normal';
    r.assignee ??= repairUnassigned;
    r.dueDate ??= '';
    r.createdAt ??= r.date || '';
    r.reportedBy ??= 'Не указан';
    r.blocking ??= r.kind === 'repair' && r.status !== 'done';
    r.readyConfirmed ??= false;
    r.photos ??= [];
    r.history ??= [];
    r.parts ??= [];
  }
  state.workshopVersion ??= 2;
}

const canManageRepairs = () => ['director','mechanic'].includes(role);
const visibleRepairs = () => state.maintenance.filter(r => role !== 'operator' || (currentOperatorMachine() && r.machine === currentOperatorMachine()));
const repairTag = r => tag(repairStatusNames[r.status] || r.status,repairStatusColors[r.status] || 'gray');
const repairTotal = r => (r.laborCost || 0) + (r.externalCost || 0) + (r.parts || []).reduce((n,p) => n + p.qty * p.price,0);
const repairLate = r => r.status !== 'done' && r.dueDate && r.dueDate < today();
const workshopTime = at => !at ? 'Дата не указана' : /^\d{4}-\d{2}-\d{2}$/.test(at) ? dateText(at) : new Date(at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const repairNumber = () => 'ЗР-' + String(Math.max(0,...state.maintenance.map(r => Number((r.number || '').replace('ЗР-','')) || 0)) + 1).padStart(4,'0');
const workshopActor = () => roleNames[role] || 'Роль не указана';

// Calendar projections only read recorded repair data. A planned deadline is
// neither a release confirmation nor evidence of a repair's actual duration.
function calendarRepairDay(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return '';
  const parsed=new Date(value+'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value?value:'';
}

function calendarRepairRecordedDay(value) {
  const day=calendarRepairDay(value);
  if(day)return day;
  if(typeof value!=='string')return '';
  const parts=value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?$/);
  if(!parts||!calendarRepairDay(parts[1])||Number(parts[2])>23||Number(parts[3])>59||Number(parts[4]||0)>59||!Number.isFinite(Date.parse(value)))return '';
  return parts[1];
}

function calendarRepairBounds(r,now) {
  const first=fields=>fields.map(key=>calendarRepairRecordedDay(r[key])).find(Boolean)||'';
  const actualStart=first(['startedAt','startDate','repairStartedAt']);
  const plannedStart=first(['planDate','plannedStartDate','plannedStart','plannedFrom']);
  const requestDate=calendarRepairRecordedDay(r.date)||calendarRepairRecordedDay(r.createdAt);
  const start=actualStart||plannedStart||calendarRepairRecordedDay(r.date);
  const due=calendarRepairDay(r.dueDate);
  const end=first(['releasedAt','completedAt']);
  const current=r.status!=='done'||Boolean(r.blocking&&!r.readyConfirmed);
  const closed=r.status==='done'&&r.readyConfirmed===true;
  const contradictory=Boolean((start&&due&&start>due)||(actualStart&&actualStart>now));
  const factual=Boolean(closed&&actualStart&&end&&actualStart<=end&&end<=now);
  return {actualStart,plannedStart,requestDate,start,due,end,current,closed,contradictory,factual};
}

function calendarRepairProjection(r,bounds,day,now) {
  if(bounds.closed)return bounds.factual&&bounds.actualStart<=day&&day<=bounds.end?'scheduled':'';
  if(!bounds.current)return '';
  if(!bounds.contradictory&&bounds.start&&bounds.due&&bounds.start<=day&&day<=bounds.due)return 'scheduled';
  // Current records cannot establish an open-ended historical repair. On
  // today/future dates an unknown boundary or overdue release stays uncertain.
  if(day>=now&&!r.readyConfirmed&&(bounds.contradictory||!bounds.start||!bounds.due||day>bounds.due||(r.blocking&&day<bounds.start)))return 'uncertain';
  return '';
}

function calendarRepairIndex(days) {
  const validDays=[...new Set(Array.from(days||[]).map(calendarRepairDay).filter(Boolean))];
  const index=new Map(),now=today();
  for(const r of state.maintenance) {
    if(!r||typeof r.machine!=='string'||!r.machine)continue;
    const bounds=calendarRepairBounds(r,now);
    if(!bounds.current&&!bounds.factual)continue;
    let machineDays=index.get(r.machine);
    if(!machineDays){machineDays=new Map();index.set(r.machine,machineDays);}
    for(const day of validDays) {
      const kind=calendarRepairProjection(r,bounds,day,now);
      if(!kind)continue;
      let cell=machineDays.get(day);
      if(!cell){cell={scheduled:[],uncertain:[]};machineDays.set(day,cell);}
      cell[kind].push(r);
    }
  }
  return index;
}

function calendarRepairState(machineId,day) {
  if(!calendarRepairDay(day))return {scheduled:[],uncertain:[]};
  return calendarRepairIndex([day]).get(machineId)?.get(day)||{scheduled:[],uncertain:[]};
}

function calendarRepairLimitations(r,bounds,now) {
  const notes=[];
  if(!bounds.actualStart)notes.push('Фактическое начало неизвестно. Дата заявки и план не подтверждают начало ремонта.');
  if(!bounds.due)notes.push('Плановое окончание не указано или дата некорректна.');
  if(bounds.contradictory)notes.push('Даты противоречат друг другу или фактическое начало указано в будущем. Период ремонта требует уточнения.');
  if(bounds.current&&!r.readyConfirmed)notes.push('Готовность не подтверждена: после планового срока или при неизвестных границах доступность требует уточнения.');
  if(r.blocking&&!r.readyConfirmed)notes.push('Текущая блокировка действует до подтверждения готовности механиком независимо от планового срока.');
  if(bounds.closed&&!bounds.factual)notes.push('Фактические границы завершённого ремонта неизвестны или некорректны; исторический период не восстановлен.');
  return notes.join(' ');
}

// Repair days include the due day; assignments keep their existing strict,
// half-open intervals. This projection never changes requests or availability.
function repairBookingWarnings(repair,requests,now) {
  if(!repair?.machine||!Array.isArray(requests))return [];
  const bounds=calendarRepairBounds(repair,now);
  if(!bounds.current)return [];
  const start=bounds.start?bounds.start+'T00:00':'';
  let end='';
  if(bounds.due){const next=new Date(bounds.due+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);end=next.toISOString().slice(0,10)+'T00:00';}
  const recorded=Boolean(start&&end&&!bounds.contradictory),rows=[];
  for(const request of requests) {
    if(!request||request.status==='Отменена'||request.releaseConfirmed||!Array.isArray(request.items))continue;
    for(const item of request.items) {
      if(!item||item.machine!==repair.machine||!calendarRepairRecordedDay(item.start)||!calendarRepairRecordedDay(item.end)||item.start>=item.end)continue;
      const overlaps=recorded&&item.start<end&&start<item.end;
      const uncertain=!repair.readyConfirmed&&item.end>now+'T00:00'&&(!recorded||item.end>end);
      if(overlaps||uncertain)rows.push({request,item,kind:overlaps?'overlap':recorded?'after-due':'unknown'});
    }
  }
  return rows;
}

function repairBookingWarningHtml(rows) {
  if(!rows.length)return '';
  const labels={overlap:'Пересечение с записанным периодом ремонта','after-due':'После планового срока: техническая готовность ещё не подтверждена',unknown:'Период ремонта требует уточнения; техническая готовность ещё не подтверждена'};
  return '<strong>У техники есть активные назначения</strong><p>Согласуйте занятость с ответственным менеджером. Сохранение ремонта не изменяет заявки. Плановый срок не подтверждает допуск техники к эксплуатации.</p><ul>'+rows.map(({request,item,kind})=>'<li><b>'+esc(request.number||'Номер не указан')+'</b> · '+esc(request.owner||'Менеджер не указан')+' · '+esc(request.customer||'Заказчик не указан')+' · '+esc(requestDateTimeText(item.start))+' — '+esc(requestDateTimeText(item.end))+'<br>'+esc(labels[kind])+'</li>').join('')+'</ul>';
}

function repairBookingWarningBox(id,rows) {
  return '<div id="'+id+'" class="info-note" aria-live="polite"'+(rows.length?'':' hidden')+'>'+repairBookingWarningHtml(rows)+'</div>';
}

function bindRepairBookingWarning(form,selector,proposed) {
  const refresh=values=>{
    const fields=values&&typeof values.get==='function'?values:new FormData(form);
    const box=$(selector),rows=repairBookingWarnings(proposed(fields),state.equipmentRequests,today());
    box.innerHTML=repairBookingWarningHtml(rows);box.hidden=!rows.length;
  };
  form.addEventListener('input',refresh);
  form.addEventListener('change',refresh);
  return refresh;
}

function openCalendarRepairs(machineId,day='') {
  if(!['director','dispatcher','mechanic'].includes(role)||typeof machineId!=='string'||!machineId)return;
  if(day&&!calendarRepairDay(day))return;
  const now=today();
  const rows=state.maintenance.filter(r=>r&&r.machine===machineId).map(r=>({r,bounds:calendarRepairBounds(r,now)})).filter(({bounds})=>bounds.current||Boolean(day&&bounds.factual&&bounds.actualStart<=day&&day<=bounds.end));
  const detail=(label,value,cls='')=>`<div><dt>${label}</dt><dd${cls?` class="${cls}"`:''}>${esc(value)}</dd></div>`;
  const cards=rows.map(({r,bounds})=>{
    const late=Boolean(bounds.current&&!r.readyConfirmed&&bounds.due&&bounds.due<now);
    const ready=r.readyConfirmed===true;
    const limitations=calendarRepairLimitations(r,bounds,now);
    return `<article class="calendar-repair-card"><header><h3>${esc(r.number||'Номер не указан')} · ${esc(r.type||'Работы не указаны')}</h3>${repairTag(r)}</header><p class="repair-detail-note">${esc(r.note||'Описание не добавлено')}</p><dl class="repair-detail-grid">${detail('Техника',machineLabel(machineId)+' · '+machineId)}${detail('Номер заявки',r.number||'Номер не указан')}${detail('Вид работ',r.kind==='service'?'Плановое ТО':'Ремонт')}${detail('Неисправность / работы',r.type||'Не указаны')}${detail('Фактическое начало',bounds.actualStart?dateText(bounds.actualStart):'Дата начала неизвестна')}${detail('Дата заявки / регистрации',bounds.requestDate?dateText(bounds.requestDate):'Дата заявки неизвестна')}${detail('Начало по плану',bounds.plannedStart?dateText(bounds.plannedStart):'Плановое начало не указано')}${detail('Плановое окончание',bounds.due?dateText(bounds.due):'Срок не указан',late?'negative':'')}${detail('Ответственный',r.assignee||repairUnassigned)}${detail('Статус',repairStatusNames[r.status]||r.status||'Не указан')}${detail('Просрочка',late?'Срок прошёл':!bounds.due?'Невозможно определить без срока':'Нет',late?'negative':'')}${detail('Техническая готовность',ready?'Подтверждена механиком':'Не подтверждена')}${detail('Допуск к эксплуатации',r.blocking&&!ready?'Эксплуатация запрещена до допуска механика':ready?'Готовность подтверждена':'Остановка не отмечена; готовность не подтверждена')}${bounds.closed?detail('Фактическое завершение / допуск',bounds.end?dateText(bounds.end):'Дата завершения неизвестна'):''}</dl>${limitations?`<p class="info-note">${esc(limitations)}</p>`:''}</article>`;
  }).join('');
  const intro=day?`На ${dateText(day)}. Показаны все текущие открытые и не допущенные ремонты техники, а также завершённые ремонты с подтверждённым фактическим периодом на эту дату.`:'Показаны все текущие открытые и не допущенные ремонты этой техники. Плановые сроки не подтверждают техническую готовность.';
  showModal('Ремонты · '+machineLabel(machineId),`<div class="calendar-repair-details"><p class="page-note">${esc(intro)}</p>${cards||'<p>Записей о ремонте для этого выбора нет. Сведения о сроках и готовности требуют уточнения.</p>'}</div><div class="modal-actions"><button class="btn" data-close>Закрыть</button></div>`,true);
}

function recordRepairEvent(r,text) {
  r.history.push({at:new Date().toISOString(),text,by:workshopActor()});
}

function saveWorkshop(previous) {
  try { if(storageLoadError)throw Error('Stored data must be recovered first');localStorage.setItem(activeStorageKey,JSON.stringify(state));storageAvailable=true;syncMachineStatuses();return true; } catch { storageAvailable=false; }
  replaceState(previous);
  syncMachineStatuses();
  formError('Не удалось сохранить в браузере. Уменьшите число фотографий или освободите место. Данные не изменены.');
  return false;
}

function repairAttention() {
  if (!allowed[role].includes('maintenance')) return '';
  const rows = visibleRepairs().filter(r => (r.status !== 'done' && (r.status === 'new' || r.status === 'waiting' || repairLate(r) || r.blocking || r.assignee === repairUnassigned)) || (r.status === 'done' && r.blocking && !r.readyConfirmed)).sort((a,b) => Number(repairLate(b)) - Number(repairLate(a))).slice(0,3);
  if (!rows.length) return '';
  return `<section class="panel workshop-attention"><div class="panel-head"><div><h2>Требует решения</h2><p class="subtitle">Заявки, сроки и ответственные</p></div><button class="btn ghost" data-nav="maintenance">Все заявки ${icon('arrow')}</button></div><div class="decision-list">${rows.map(r => `<button class="decision-row" data-repair="${r.id}"><span class="decision-symbol">${icon('maintenance')}</span><span class="decision-copy"><b>${esc(machineLabel(r.machine))} · ${esc(r.type)}</b><small>${esc(r.assignee)} · срок ${dateText(r.dueDate)}</small></span>${tag(repairLate(r)?'Срок прошёл':repairStatusNames[r.status],repairLate(r)?'red':repairStatusColors[r.status])}${icon('chevron')}</button>`).join('')}</div></section>`;
}

function workshopPage() {
  const all = visibleRepairs();
  const rows = all.filter(r => (period === 'all' || String(r.date || '').startsWith(period)) && (workshopFilters.status === 'all' || (workshopFilters.status === 'open' ? r.status !== 'done' : r.status === workshopFilters.status)) && (workshopFilters.machine === 'all' || r.machine === workshopFilters.machine) && `${r.number} ${r.type} ${machineLabel(r.machine)} ${r.assignee}`.toLocaleLowerCase('ru').includes(workshopFilters.search.toLocaleLowerCase('ru'))).sort((a,b) => Number(a.status === 'done') - Number(b.status === 'done') || Number(repairLate(b)) - Number(repairLate(a)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return `<div class="workshop-intro"><p>От замечания машиниста до завершения ремонта. Фотографии и изменения сохраняются в этом браузере.</p></div><div class="workshop-counts">${[['new','Новые'],['progress','В работе'],['waiting','Ожидают запчасти'],['done','Завершены']].map(([key,name]) => `<button class="workshop-count ${workshopFilters.status === key?'active':''}" data-repair-filter="${key}"><small>${name}</small><strong>${all.filter(r => r.status === key && (period === 'all' || String(r.date || '').startsWith(period))).length}</strong></button>`).join('')}</div><div class="filter-row workshop-filters"><input id="repair-search" type="search" aria-label="Поиск заявок" placeholder="Номер, техника или неисправность" value="${esc(workshopFilters.search)}"><select id="repair-status" aria-label="Статус заявки">${[['open','Открытые заявки'],['all','Все статусы'],...Object.entries(repairStatusNames)].map(([v,t]) => `<option value="${v}" ${workshopFilters.status === v?'selected':''}>${t}</option>`).join('')}</select><select id="repair-machine" aria-label="Техника в заявках"><option value="all">Вся техника</option>${visibleMachines().map(m => `<option value="${m.id}" ${workshopFilters.machine === m.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select></div><div class="repair-grid">${rows.map(repairCard).join('')}</div>${!rows.length?`<section class="panel">${empty('Заявки не найдены','Загрузите справочник техники и создайте заявку или измените фильтры и период.')}</section>`:''}<div class="info-note">Заявка связывает неисправность, выполненные работы и использованные запчасти. Данные сохраняются только в этом браузере.</div>`;
}

function repairCard(r) {
  return `<article class="panel repair-card"><div class="repair-card-top"><span class="repair-number">${esc(r.number)} · ${r.kind === 'service'?'ТО':'Ремонт'}</span>${repairTag(r)}</div><button class="repair-title" data-repair="${r.id}">${esc(r.type)}</button><button class="table-link repair-machine-link" data-machine="${r.machine}">${esc(machineLabel(r.machine))} <span>· ${r.machine}</span></button><p class="repair-description">${esc(r.note || 'Описание не добавлено')}</p><div class="repair-card-meta"><span>Ответственный<b>${esc(r.assignee)}</b></span><span>Срок<b class="${repairLate(r)?'negative':''}">${dateText(r.dueDate)}${repairLate(r)?' · просрочен':''}</b></span></div><div class="repair-card-bottom"><div>${r.priority === 'high'?tag('Высокий приоритет','red'):tag('Плановая работа','gray')}${r.photos.length?`<span class="muted">${r.photos.length} фото</span>`:''}</div><button class="btn small" data-repair="${r.id}">Открыть ${icon('arrow')}</button></div></article>`;
}

function bindWorkshopEvents() {
  document.querySelectorAll('[data-repair]').forEach(b => b.onclick = () => openRepair(b.dataset.repair));
  document.querySelectorAll('[data-new-repair]').forEach(b => b.onclick = () => repairForm(b.dataset.newRepair));
  document.querySelectorAll('[data-repair-filter]').forEach(b => b.onclick = () => {workshopFilters.status=b.dataset.repairFilter;updatePage();});
  $('#repair-status')?.addEventListener('change',e => {workshopFilters.status=e.target.value;updatePage();});
  $('#repair-machine')?.addEventListener('change',e => {workshopFilters.machine=e.target.value;updatePage();});
  $('#repair-search')?.addEventListener('input',e => {const pos=e.target.selectionStart;workshopFilters.search=e.target.value;updatePage();$('#repair-search').focus();$('#repair-search').setSelectionRange(pos,pos);});
}

function photoPicker(id) {
  return `<div class="photo-picker"><label class="photo-label" for="${id}">Фотографии · до 3 файлов</label><input id="${id}" type="file" accept="image/jpeg,image/png,image/webp" multiple><small>JPG, PNG или WebP, до 15 МБ на файл. Фото сохраняются только на этом устройстве.</small><div id="${id}-preview" class="photo-previews" aria-live="polite"></div><div id="${id}-error" class="error-text" role="alert"></div></div>`;
}

function validPhotoUrl(url) {
  return typeof url === 'string' && (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url) || url === './assets/demo-hydraulics.svg');
}

function photoGallery(photos) {
  return photos.filter(p => validPhotoUrl(p.url)).map(p => `<figure class="repair-photo"><img src="${esc(p.url)}" alt="${esc(p.name)}" loading="lazy"><figcaption>${esc(p.name)}</figcaption></figure>`).join('');
}

function compressDemoPhoto(file) {
  return new Promise((resolve,reject) => {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) return reject(new Error('Поддерживаются JPG, PNG и WebP. Выберите другой файл.'));
    if (file.size > 15 * 1024 * 1024) return reject(new Error('Один файл не должен превышать 15 МБ.'));
    const url=URL.createObjectURL(file), img=new Image();
    img.onload=() => {
      try {
        const scale=Math.min(1,1200/Math.max(img.width,img.height)), canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
        const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
        const data=canvas.toDataURL('image/jpeg',0.72);
        if (data.length > 650000) throw new Error('Фото слишком детальное. Выберите уменьшенную копию.');
        resolve({id:uid(),name:file.name.slice(0,100),url:data});
      } catch(error) {reject(error);} finally {URL.revokeObjectURL(url);}
    };
    img.onerror=() => {URL.revokeObjectURL(url);reject(new Error('Не удалось прочитать изображение. Выберите JPG, PNG или WebP.'));};
    img.src=url;
  });
}

function attachPhotoPicker(id,initial=[]) {
  const input=$('#'+id),preview=$('#'+id+'-preview'),error=$('#'+id+'-error');
  const draft={photos:initial.map(p=>({...p})),busy:false};
  const refresh=() => {
    preview.innerHTML=draft.photos.map((p,i) => `<div class="photo-preview">${photoGallery([p])}<button class="btn small" type="button" data-remove-photo="${i}" aria-label="Удалить фото ${i+1}">Удалить</button></div>`).join('');
    preview.querySelectorAll('[data-remove-photo]').forEach(b => b.onclick=() => {if(!draft.busy){draft.photos.splice(Number(b.dataset.removePhoto),1);refresh();}});
  };
  input.onchange=async () => {
    error.textContent='';
    const files=Array.from(input.files);
    if (files.length+draft.photos.length>3) {error.textContent='Можно прикрепить максимум 3 фотографии.';input.value='';return;}
    draft.busy=true;input.disabled=true;error.textContent='Подготавливаем фотографии…';
    try {const added=await Promise.all(files.map(compressDemoPhoto));draft.photos.push(...added);error.textContent='';refresh();}
    catch(e) {error.textContent=e.message;}
    finally {draft.busy=false;input.disabled=false;input.value='';}
  };
  refresh();
  return draft;
}

function newRepairRecord(values) {
  const r={readyConfirmed:false,id:uid(),number:repairNumber(),machine:values.machine,kind:values.kind||'repair',type:values.type,note:values.note||'',date:values.date||today(),dueDate:values.dueDate||'',createdAt:new Date().toISOString(),status:values.status||'new',priority:values.priority||'normal',assignee:values.assignee||repairUnassigned,blocking:values.kind==='repair'||!!values.blocking,reportedBy:workshopActor(),photos:values.photos||[],parts:[],history:[],sourceShift:values.sourceShift||null};
  recordRepairEvent(r,values.sourceShift?'Заявка создана из замечания к смене':'Заявка создана');
  return r;
}

function repairForm(machineId='') {if(!canManageRepairs())return;
  if(!visibleMachines().length)return toast('Сначала загрузите справочник техники.');
  if(!visibleMachines().some(m=>m.id===machineId))machineId=visibleMachines()[0].id;
  showModal('Новая заявка',`<form id="repair-form">${field('Техника',machineSelect('machine',machineId,visibleMachines()))}<div class="form-grid">${field('Вид заявки','<select name="kind"><option value="repair">Неисправность / ремонт</option><option value="service">Плановое ТО</option></select>')}${field('Приоритет','<select name="priority"><option value="normal">Обычный</option><option value="high">Высокий</option></select>')}</div>${field('Что нужно сделать?','<input name="type" required maxlength="100" placeholder="Например, устранить течь гидравлики">')}${field('Описание неисправности','<textarea name="note" required maxlength="500" placeholder="Что произошло и при каких условиях"></textarea>')}<div class="form-grid">${field('Ответственный',`<select name="assignee">${repairAssignees().map(n=>`<option>${esc(n)}</option>`).join('')}</select>`)}${field('Плановый срок',`<input name="dueDate" type="date" value="${today()}" min="${today()}" required>`)}</div><label class="workshop-checkbox"><input type="checkbox" name="blocking">Техника остановлена до завершения ремонта</label>${repairBookingWarningBox('repair-booking-warning',repairBookingWarnings({machine:machineId,date:today(),dueDate:today()},state.equipmentRequests,today()))}${photoPicker('repair-photos')}${formActions('Создать заявку')}<p class="form-hint">Запись хранится только в этом браузере. Уведомления сотрудникам не отправляются.</p></form>`,true);
  const draft=attachPhotoPicker('repair-photos');
  const refreshBookingWarning=bindRepairBookingWarning($('#repair-form'),'#repair-booking-warning',f=>({machine:f.get('machine'),date:today(),dueDate:f.get('dueDate')}));
  $('#repair-form').onsubmit=e => {
    e.preventDefault();if(!canManageRepairs())return;if(draft.busy)return formError('Дождитесь подготовки фотографий.');
    const f=new FormData(e.target),type=f.get('type').trim(),note=f.get('note').trim();
    refreshBookingWarning(f);
    if(!type||!note)return formError('Укажите название и описание работ.');
    if(!visibleMachines().some(m=>m.id===f.get('machine')))return formError('Выберите технику из справочника.');
    if(f.get('dueDate')<today())return formError('Срок новой заявки не может быть в прошлом.');
    const previous=structuredClone(state);
    const r=newRepairRecord({machine:f.get('machine'),kind:f.get('kind'),type,note,dueDate:f.get('dueDate'),assignee:f.get('assignee'),priority:f.get('priority'),blocking:f.has('blocking'),photos:draft.photos,status:f.get('kind')==='service'?'planned':'new'});
    state.maintenance.push(r);if(!saveWorkshop(previous))return;
    dateInPeriod(r.date);closeModal(false);render();openRepair(r.id);toast('Заявка создана.');
  };
}

function historyMarkup(events) {
  return `<ol class="workshop-history">${events.slice().sort((a,b)=>String(b.at || '').localeCompare(String(a.at || ''))).map(e=>`<li><span class="history-dot"></span><div><b>${esc(e.text)}</b><small>${esc(workshopTime(e.at))} · ${esc(e.by || 'Автор не указан')}</small></div></li>`).join('')}</ol>`;
}

function openRepair(id) {
  const r=visibleRepairs().find(x=>x.id===id);if(!r)return;
  const next={new:['new','planned','progress'],planned:['planned','progress'],progress:['progress','waiting'],waiting:['waiting','progress']}[r.status]||[];
  const manage=canManageRepairs()&&r.status!=='done'&&!!machine(r.machine);
   const needsRelease=role==='mechanic'&&r.status==='done'&&r.blocking&&!r.readyConfirmed;
  showModal(`${r.number} · ${r.kind==='service'?'Обслуживание':'Заявка на ремонт'}`,`<div class="workshop-detail-top">${repairTag(r)}</div><h2 class="repair-detail-title">${esc(r.type)}</h2><button class="table-link" id="repair-passport">${esc(machineLabel(r.machine))} · ${r.machine} ${icon('arrow')}</button><p class="repair-detail-note">${esc(r.note)}</p><dl class="spec-grid"><div><dt>Объект</dt><dd>${esc(objectLabel(machine(r.machine)?.object))}</dd></div><div><dt>Сообщил</dt><dd>${esc(r.reportedBy)}</dd></div><div><dt>Ответственный</dt><dd>${esc(r.assignee)}</dd></div><div><dt>Плановый срок</dt><dd class="${repairLate(r)?'negative':''}">${dateText(r.dueDate)}${repairLate(r)?' · срок прошёл':''}</dd></div><div><dt>Приоритет</dt><dd>${r.priority==='high'?'Высокий':'Обычный'}</dd></div><div><dt>Состояние техники</dt><dd>${r.readyConfirmed?'Готовность подтверждена механиком':r.blocking?'Эксплуатация запрещена до допуска механика':'Остановка не отмечена'}</dd></div></dl>${r.sourceShift?'<div class="info-note">Создана из замечания машиниста к смене. Заявка не означает, что смена утверждена.</div>':''}${r.photos.length?`<h3 class="workshop-section-title">Фотографии</h3><div class="repair-gallery">${photoGallery(r.photos)}</div>`:''}${r.status==='done'?`<div class="repair-result"><h3>Результат работ</h3><p>${esc(r.resultNote||'Результат работ не указан.')}</p>${canManageRepairs()?`<strong>${rub(repairTotal(r))}</strong><small>${r.financeOperationId?'Учтено одной операцией в разделе «Финансы»':'Стоимость не вносилась'}</small>`:''}${r.parts.length?`<p>Выдано со склада: ${r.parts.map(p=>`${esc(p.name)} — ${p.qty} ${esc(p.unit)}`).join('; ')}.</p>`:''}</div>`:''}${needsRelease?'<button class="btn primary" id="repair-release">Подтвердить исправность и допустить к эксплуатации</button>':''}${manage?`<form id="repair-update-form" class="workshop-update"><h3>Ведение заявки</h3><div class="form-grid">${field('Статус',`<select name="status">${next.map(v=>`<option value="${v}" ${v===r.status?'selected':''}>${repairStatusNames[v]}</option>`).join('')}</select>`)}${field('Ответственный',`<select name="assignee">${repairAssignees().map(n=>`<option ${n===r.assignee?'selected':''}>${esc(n)}</option>`).join('')}</select>`)}</div>${field('Плановый срок',`<input name="dueDate" type="date" value="${r.dueDate}" required>`)}<label class="workshop-checkbox"><input type="checkbox" name="blocking" ${r.blocking?'checked':''}>Техника остановлена до завершения ремонта</label>${field('Комментарий к изменению','<textarea name="comment" maxlength="400" placeholder="Результат диагностики, причина ожидания или следующий шаг"></textarea>')}${repairBookingWarningBox('repair-update-booking-warning',repairBookingWarnings(r,state.equipmentRequests,today()))}${photoPicker('update-photos')}${formActions('Сохранить изменения')}</form>${['progress','waiting'].includes(r.status)?'<button class="btn primary workshop-complete" id="repair-complete">Завершить ремонт</button>':'<p class="form-hint">Для завершения сначала примите заявку в работу.</p>'}`:''}<h3 class="workshop-section-title">История заявки</h3>${historyMarkup(r.history)}<div class="modal-actions"><button class="btn" data-close>Закрыть</button></div>`,true);
  $('#repair-passport').onclick=()=>openMachinePassport(r.machine,'history');
  $('#repair-complete')?.addEventListener('click',()=>completeRepairForm(r.id));
   $('#repair-release')?.addEventListener('click',()=>{const r=visibleRepairs().find(x=>x.id===id);if(role!=='mechanic'||!r||r.status!=='done'||r.readyConfirmed)return;const previous=structuredClone(state);r.readyConfirmed=true;r.blocking=false;r.releasedAt=new Date().toISOString();r.releasedBy=workshopActor();recordRepairEvent(r,'Исправность проверена. Допуск к эксплуатации подтверждён');if(!saveWorkshop(previous))return;render();openRepair(r.id);toast('Техника допущена к эксплуатации.');});
  if(manage) {
    const draft=attachPhotoPicker('update-photos',r.photos);
    const refreshBookingWarning=bindRepairBookingWarning($('#repair-update-form'),'#repair-update-booking-warning',f=>({...state.maintenance.find(x=>x.id===id),dueDate:f.get('dueDate')}));
    $('#repair-update-form').onsubmit=e=>{
      e.preventDefault();if(!canManageRepairs())return;if(draft.busy)return formError('Дождитесь подготовки фотографий.');
      const r=visibleRepairs().find(x=>x.id===id);if(!r||r.status==='done')return;
      const f=new FormData(e.target),nextStatus=f.get('status'),assignee=f.get('assignee'),comment=f.get('comment').trim();
      refreshBookingWarning(f);
      if(nextStatus!=='new'&&assignee===repairUnassigned)return formError('Назначьте ответственного механика.');
      if(nextStatus==='waiting'&&r.status!=='waiting'&&!comment)return formError('Укажите, какие запчасти ожидаются.');
      const changes=[];
      if(nextStatus!==r.status)changes.push('Статус: '+repairStatusNames[nextStatus]);
      if(assignee!==r.assignee)changes.push('Ответственный: '+assignee);
      if(f.get('dueDate')!==r.dueDate)changes.push('Срок: '+dateText(f.get('dueDate')));
      if(f.has('blocking')!==r.blocking)changes.push(f.has('blocking')?'Техника остановлена':'Остановка снята');
       if(r.blocking&&!f.has('blocking'))return formError('Снять блокировку можно только после завершения ремонта и подтверждения исправности.');
      if(JSON.stringify(draft.photos)!==JSON.stringify(r.photos))changes.push('Фотографии обновлены');
      if(comment)changes.push(comment);
      if(!changes.length)return formError('Нет изменений для сохранения.');
      const previous=structuredClone(state);
      Object.assign(r,{status:nextStatus,assignee,dueDate:f.get('dueDate'),blocking:f.has('blocking'),photos:draft.photos});recordRepairEvent(r,changes.join(' · '));
      if(!saveWorkshop(previous))return;render();openRepair(r.id);toast('Заявка обновлена.');
    };
  }
}

function completeRepairForm(id) {
  const r=state.maintenance.find(x=>x.id===id);if(!canManageRepairs()||!r||!['progress','waiting'].includes(r.status))return;
  if(!machine(r.machine))return toast('Сначала добавьте технику этой заявки в справочник.');
  showModal('Завершение ремонта · '+r.number,`<form id="repair-close-form"><p class="form-hint">${esc(machineLabel(r.machine))} · ${esc(r.type)}</p>${field('Что выполнено?','<textarea name="result" required maxlength="600" placeholder="Какие работы выполнены и проверена ли техника"></textarea>')}<div class="form-grid">${field('Стоимость работ, ₽','<input name="labor" type="number" min="0" max="999999999" step="0.01" value="0" required inputmode="decimal">')}${field('Прочие затраты, ₽','<input name="external" type="number" min="0" max="999999999" step="0.01" value="0" required inputmode="decimal">')}</div><h3 class="workshop-section-title">Запчасти со склада</h3><p class="form-hint">Укажите количество и цену за единицу. Цена пока вводится вручную и не проверяется по поступлениям. Остатки уменьшатся при завершении.</p><div class="repair-parts-list">${state.stock.map(p=>`<div class="repair-part-row"><div><b>${esc(p.name)}</b><small>На складе: ${p.qty} ${esc(p.unit)}</small></div><label>Количество<input name="qty-${p.id}" type="number" min="0" max="${p.qty}" step="${p.unit==='шт.'?'1':'0.01'}" value="0" inputmode="decimal"></label><label>Цена, ₽/${esc(p.unit)}<input name="price-${p.id}" type="number" min="0" max="999999999" step="0.01" value="0" inputmode="decimal"></label></div>`).join('')}</div><div class="repair-total-preview">Итого по заявке<strong id="close-total">0 ₽</strong></div><div class="info-note">Завершение спишет выбранные запчасти. При положительной сумме затраты будут учтены отдельно либо связаны с ранее внесённым расходом после сверки. Другие открытые ремонты этой машины сохранят её статус «На ремонте».</div><div id="repair-finance-review"></div>${formActions('Завершить и сохранить')}</form>`,true);
  const form=$('#repair-close-form');
  // A review belongs to the current amount and candidates. Cost changes or a
  // newly recorded expense invalidate an earlier choice without closing the form.
  let financeReviewSignature='';
  const updateFinanceReview=(op,candidates)=>{
    const signature=JSON.stringify([op.machine,op.date,op.amount,candidates.map(x=>[x.id,x.machine,x.allocation,x.amount,x.date,x.expenseMatch])]);
    if(signature===financeReviewSignature)return false;
    financeReviewSignature=signature;
    const box=$('#repair-finance-review');
    box.innerHTML=!candidates.length?'':`<div class="info-note"><strong>Нужна сверка расходов</strong><p>Найдены ранее внесённые расходы. Совпадение суммы, даты или техники само по себе не подтверждает повтор. Выберите уже учтённый расход либо подтвердите отдельную операцию. Обе записи сохранятся.</p>${field('Решение','<select name="financeDecision"><option value="">Выберите решение</option><option value="link">Это тот же расход — учесть один раз</option><option value="distinct">Это отдельный расход</option></select>')}${field('Ранее внесённый расход',`<select name="financeTarget"><option value="">Выберите запись для связи</option>${candidates.map(x=>`<option value="${esc(x.id)}" ${financeCanLink(op,x)?'':'disabled'}>${esc(x.date)} · ${esc(x.category)} · ${rub(x.amount)} · ${esc(x.note||x.id)}${financeCanLink(op,x)?'':' · сумма или назначение отличаются'}</option>`).join('')}</select>`)}${field('Основание сверки','<textarea name="financeReason" maxlength="500" placeholder="Укажите документ или основание решения"></textarea>')}</div>`;
    return true;
  };
  const proposedExpense=(r,total,date=today())=>({id:uid(),machine:r.machine,kind:'expense',category:'Ремонт и ТО',amount:total,date,note:`${r.number} · ${r.type}`,source:'repair',sourceRepair:r.id,provenance:{kind:'repair',repairId:r.id,repairNumber:r.number,documentNumber:r.documentNumber||''}});
  form.oninput=()=>{
    const f=new FormData(form),n=Number(f.get('labor'))+Number(f.get('external'))+state.stock.reduce((s,p)=>s+Number(f.get('qty-'+p.id))*Number(f.get('price-'+p.id)),0);
    $('#close-total').textContent=Number.isFinite(n)?rub(n):'—';
    const current=state.maintenance.find(x=>x.id===id);
    if(current&&Number.isFinite(n)&&n>=0){const op=proposedExpense(current,Math.round(n*100)/100);updateFinanceReview(op,n>0?financeReviewCandidates(op):[]);}
  };
  form.onsubmit=e=>{
    e.preventDefault();
    // A failed save restores cloned records, so a retry must resolve the current repair.
    const r=state.maintenance.find(x=>x.id===id);if(!canManageRepairs()||!r||!['progress','waiting'].includes(r.status))return;
    const f=new FormData(form),result=f.get('result').trim(),labor=Number(f.get('labor')),external=Number(f.get('external'));
    if(!result)return formError('Опишите выполненные работы.');
    if(r.assignee===repairUnassigned)return formError('Сначала назначьте механика в заявке.');
    if(![labor,external].every(n=>Number.isFinite(n)&&n>=0&&n<=999999999))return formError('Проверьте суммы затрат.');
    const parts=[];
    for(const p of state.stock){const qty=Number(f.get('qty-'+p.id)),price=Number(f.get('price-'+p.id));if(!Number.isFinite(qty)||qty<0||qty>p.qty||(p.unit==='шт.'&&!Number.isInteger(qty)))return formError('Проверьте количество: '+p.name);if(!Number.isFinite(price)||price<0||price>999999999)return formError('Проверьте цену: '+p.name);if(qty>0)parts.push({id:p.id,name:p.name,unit:p.unit,qty,price:Math.round(price*100)/100});}
    const date=today(),total=Math.round((Math.round(labor*100)/100+Math.round(external*100)/100+parts.reduce((sum,p)=>sum+p.qty*p.price,0))*100)/100;
    const op=total>0?proposedExpense(r,total,date):null;
    if(op){
      const candidates=financeReviewCandidates(op),changed=updateFinanceReview(op,candidates);
      if(candidates.length){
        if(changed)return formError('Проверьте найденные расходы и выберите решение сверки.');
        const error=financeApplyDecision(op,{kind:f.get('financeDecision'),targetId:f.get('financeTarget'),reason:String(f.get('financeReason')||'').trim()});
        if(error)return formError(error);
      }
      financeRecordEvent(op,'repair-completed',{repairId:r.id,repairNumber:r.number});
    }
    const previous=structuredClone(state);
    Object.assign(r,{status:'done',blocking:r.blocking,readyConfirmed:!r.blocking,completedAt:new Date().toISOString(),resultNote:result,laborCost:Math.round(labor*100)/100,externalCost:Math.round(external*100)/100,parts});
    for(const p of parts){const stock=state.stock.find(x=>x.id===p.id);stock.qty=Math.round((stock.qty-p.qty)*100)/100;state.stockMoves.push({id:uid(),part:p.id,qty:p.qty,kind:'issue',machine:r.machine,date,note:`Ремонт ${r.number}`,sourceRepair:r.id});}
    if(op){state.operations.push(op);r.financeOperationId=op.id;}
    recordRepairEvent(r,'Ремонт завершён: '+result+(total>0?(op.expenseMatch?' · расход связан с ранее учтённой операцией ':' · учтено ')+rub(total):''));
    if(!saveWorkshop(previous))return;closeModal(false);render();openRepair(r.id);toast(r.blocking?'Ремонт завершён. Для допуска техники подтвердите исправность.':'Работы завершены. История, склад и затраты обновлены.');
  };
}

function passportMetadata(m) {
  return {registration:m.registration || '',serial:m.serial || ''};
}

function machineIllustration() {
  return '<div class="passport-art" role="img" aria-label="Фото не загружено">Фото не загружено</div>';
}

function openMachinePassport(id,tabName='passport') {
  const m=visibleMachines().find(x=>x.id===id);if(!m)return;
  if(tabName==='finance'&&!canFinance())tabName='passport';
  const meta=passportMetadata(m),requests=visibleRepairs().filter(r=>r.machine===id),s=sums([m]);
  const tabs=[['passport','Паспорт'],['history','История'],['documents','Документы'],...(canFinance()?[['finance','Экономика']]:[])];
  const image=state.machinePhotos?.[id]?.[0];
  const meters=[m.meter,...state.shifts.filter(x=>x.machine===id&&x.status==='approved').map(x=>x.meter)].filter(hasAmount);
  const meter=meters.length ? Math.max(...meters).toLocaleString('ru-RU') : 'Не указано';
  const details=tabName==='passport'?`<dl class="spec-grid passport-specs">
    <div><dt>Инвентарный номер</dt><dd>${esc(m.id)}</dd></div>
    <div><dt>Регистрационный номер</dt><dd>${esc(meta.registration || 'Не указано')}</dd></div>
    <div><dt>Серийный номер</dt><dd>${esc(meta.serial || 'Не указано')}</dd></div>
    <div><dt>Машинист</dt><dd>${esc(m.operator || 'Не назначен')}</dd></div>
    <div><dt>Последний счётчик</dt><dd>${meter}${meters.length?' м/ч':''}</dd></div>
    <div><dt>Ближайшее плановое ТО</dt><dd>${m.service?dateText(m.service):'Не указано'}</dd></div>
    <div><dt>Открытых заявок</dt><dd>${requests.filter(r=>r.status!=='done').length}</dd></div>
  </dl><div class="passport-photo-control"><label class="btn" for="passport-photo">${icon('plus')}Добавить фото</label><input class="sr-only-input" id="passport-photo" type="file" accept="image/jpeg,image/png,image/webp"><small>Фото хранится в этом браузере.</small><div id="form-error" class="error-text" role="alert"></div></div>`:tabName==='history'?passportHistory(m,requests):tabName==='documents'?passportDocuments(m):passportFinance(m,s);
  showModal('Паспорт техники',`<div class="passport-hero"><div class="passport-image">${image&&validPhotoUrl(image.url)?`<img src="${esc(image.url)}" alt="Фото ${esc(machineLabel(m.id))}">`:machineIllustration()}</div><div class="passport-identity">${m.demo?'<span class="demo-badge">Образец карточки · данные не подтверждены</span>':''}<h2>${esc(machineLabel(m.id))}</h2><p>${esc(m.type || 'Тип не указан')}${m.year?' · '+esc(m.year)+' г.':''}</p><div class="passport-tags">${machineTag(m)}${tag(m.id,'blue')}</div><span class="passport-location">${icon('objects')}${esc(objectLabel(m.object))}</span></div></div><div class="passport-tabs" role="tablist" aria-label="Разделы паспорта">${tabs.map(([key,title])=>`<button type="button" role="tab" id="passport-tab-${key}" aria-selected="${tabName===key}" aria-controls="passport-panel" tabindex="${tabName===key?'0':'-1'}" data-passport-tab="${key}" class="${tabName===key?'active':''}">${title}</button>`).join('')}</div><div role="tabpanel" id="passport-panel" aria-labelledby="passport-tab-${tabName}" tabindex="0">${details}${tabName==='passport'?`<div class="passport-open-requests"><h3>Обслуживание и ремонт</h3>${requests.filter(r=>r.status!=='done').map(r=>`<button class="passport-request" data-passport-repair="${r.id}"><span><b>${esc(r.type)}</b><small>${esc(r.number)} · ${dateText(r.dueDate)} · ${esc(r.assignee)}</small></span>${repairTag(r)}${icon('chevron')}</button>`).join('')||'<p class="form-hint">Открытых заявок пока нет.</p>'}</div>`:''}</div><div class="modal-actions passport-actions"><button class="btn" data-close>Закрыть</button>${canManageRepairs()?`<button class="btn primary" id="passport-new-repair">${icon('plus')}Заявка на ремонт</button>`:''}</div>`,true);
  document.querySelectorAll('[data-passport-tab]').forEach(b=>{
    b.onclick=()=>{openMachinePassport(id,b.dataset.passportTab);$('#passport-tab-'+b.dataset.passportTab).focus();};
    b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const pos=tabs.findIndex(t=>t[0]===tabName),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(pos+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;openMachinePassport(id,tabs[next][0]);$('#passport-tab-'+tabs[next][0]).focus();};
  });
  document.querySelectorAll('[data-passport-repair]').forEach(b=>b.onclick=()=>openRepair(b.dataset.passportRepair));
  $('#passport-new-repair')?.addEventListener('click',()=>repairForm(id));
  $('#passport-photo')?.addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file)return;const input=e.target;input.disabled=true;
    try {const p=await compressDemoPhoto(file);if(!input.isConnected)return;const previous=structuredClone(state);state.machinePhotos[id]=[p];if(!saveWorkshop(previous))return;openMachinePassport(id);toast('Фото добавлено в паспорт.');}
    catch(error){if($('#form-error'))formError(error.message);}finally{input.disabled=false;input.value='';}
  });
}

function passportHistory(m,requests) {
  const events=requests.flatMap(r=>r.history.map(h=>({...h,text:r.number+' · '+h.text}))).concat(state.shifts.filter(s=>s.machine===m.id).map(s=>({at:s.date,text:`Смена: ${s.hours} ч · ${s.status==='approved'?'утверждена':s.status==='returned'?'возвращена':'на проверке'}`,by:s.operator || m.operator || 'Машинист не указан'})));
  return `<p class="form-hint">Все события по технике, независимо от выбранного финансового периода. История сохраняется в этом браузере.</p>${events.length?historyMarkup(events):empty('Событий пока нет','Создайте заявку на ремонт или закройте смену.')}<h3 class="workshop-section-title">Заявки по этой машине</h3>${requests.map(r=>`<button class="passport-request" data-passport-repair="${r.id}"><span><b>${esc(r.type)}</b><small>${esc(r.number)} · ${dateText(r.date)}</small></span>${repairTag(r)}${icon('chevron')}</button>`).join('')}`;
}

function passportDocuments() {
  return empty('Документы не загружены','В этом разделе нет подтверждённых документов техники.');
}

function passportFinance(m,s) {
  const ops=machineOps(m.id).slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12);
  const data=financialData([m]);
  const shifts=state.shifts.filter(x=>x.machine===m.id&&x.status==='approved'&&(period==='all'||String(x.date || '').startsWith(period))&&hasAmount(x.hours));
  const hours=shifts.length?shifts.reduce((n,x)=>n+x.hours,0).toLocaleString('ru-RU')+' ч':'Нет данных';
  const value=v=>hasAmount(v)?rub(v):'Не указано';
  return `<div class="summary-strip">Период: <b>${esc(periodLabel())}</b></div><div class="detail-stats"><div><small>Выручка</small><b>${data.incomePresent?rub(s.income):'Нет данных'}</b></div><div><small>Учтённые расходы</small><b>${data.expensePresent?rub(s.expense):'Нет данных'}</b></div><div><small>Результат по внесённым данным</small><b>${data.hasData?rub(s.income-s.expense):'Нет данных'}</b></div></div><dl class="spec-grid"><div><dt>Стоимость приобретения</dt><dd>${value(m.cost)}</dd></div><div><dt>Тариф аренды</dt><dd>${value(m.rate)}${hasAmount(m.rate)?' / ч':''}</dd></div><div><dt>Подтверждённые часы за период</dt><dd>${hours}</dd></div><div><dt>Маржа по внесённым данным</dt><dd>${data.incomePresent&&s.income?((s.income-s.expense)/s.income*100).toFixed(1).replace('.',',')+' %':'Нет данных'}</dd></div></dl><p class="form-hint">Выручка минус учтённые расходы не является чистой прибылью. Для расчёта себестоимости нужны полные затраты и подтверждённые часы за один и тот же период.</p><h3 class="workshop-section-title">Последние операции</h3>${ops.length?`<div class="table-scroll"><table class="data-table"><thead><tr><th>Дата</th><th>Статья</th><th>Сумма</th></tr></thead><tbody>${ops.map(o=>`<tr><td>${dateText(o.date)}</td><td>${esc(o.category)}<span class="cell-note">${esc(o.note)}</span></td><td class="money">${o.kind==='income'?'+':'−'}${rub(o.amount)}</td></tr>`).join('')}</tbody></table></div>`:empty('Операций пока нет','Финансовые записи появятся после ввода или загрузки данных.')}`;
}
