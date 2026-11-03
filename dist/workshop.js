'use strict';

// Browser-local demonstration workflow. No remote uploads or real company records.
const repairStatusNames = {new:'Новая',planned:'Запланирована',progress:'В работе',waiting:'Ожидает запчасти',done:'Завершена'};
const repairStatusColors = {new:'red',planned:'blue',progress:'orange',waiting:'orange',done:'green'};
const demoMechanics = ['Не назначен','Демо · Механик № 1','Демо · Механик № 2'];
const workshopFilters = {status:'open',machine:'all',search:''};

function initializeWorkshop() {
  state.machinePhotos ??= {};
  for (const [i, r] of state.maintenance.entries()) {
    r.number ??= 'ЗР-' + String(i + 1).padStart(4,'0');
    r.kind ??= /ТО/.test(r.type) ? 'service' : 'repair';
    r.priority ??= r.machine === 'M008' ? 'high' : 'normal';
    r.assignee ??= demoMechanics[r.machine === 'M008' ? 1 : 2];
    r.dueDate ??= r.date;
    r.createdAt ??= r.date + 'T09:00:00+03:00';
    r.reportedBy ??= 'Демо · Менеджер';
    r.blocking ??= r.status === 'progress';
    r.photos ??= r.machine === 'M008' ? [{id:'demo-hydraulics',url:'./assets/demo-hydraulics.svg',name:'Условная схема неисправности'}] : [];
    r.history ??= [{at:r.createdAt,text:'Заявка создана · условный пример',by:r.reportedBy}];
    r.parts ??= [];
    if (r.status === 'progress' && r.history.length === 1) r.history.push({at:r.createdAt,text:'Механик принял заявку в работу',by:r.assignee});
  }
  if (!state.workshopVersion) {
    state.maintenance.push({id:'service-demo-closed',number:'ЗР-0004',machine:'M002',kind:'repair',type:'Замена топливного фильтра',note:'Условный пример завершённого ремонта. Нестабильная работа двигателя.',date:'2026-10-28',dueDate:'2026-10-29',createdAt:'2026-10-28T09:00:00+03:00',completedAt:'2026-10-29T14:00:00+03:00',status:'done',priority:'normal',assignee:demoMechanics[1],reportedBy:'Демо · Машинист',blocking:false,photos:[],parts:[],laborCost:8500,externalCost:2000,resultNote:'Фильтр заменён, система проверена. Техника возвращена в работу.',costIncludedInDemo:true,history:[{at:'2026-10-28T09:00:00+03:00',text:'Сообщение о неисправности принято',by:'Демо · Машинист'},{at:'2026-10-28T11:00:00+03:00',text:'Начата диагностика',by:demoMechanics[1]},{at:'2026-10-29T14:00:00+03:00',text:'Ремонт завершён, техника возвращена в работу',by:demoMechanics[1]}]});
    state.workshopVersion = 1;
  }
}

const canManageRepairs = () => ['director','mechanic'].includes(role);
const visibleRepairs = () => state.maintenance.filter(r => role !== 'operator' || r.machine === 'M001');
const repairTag = r => tag(repairStatusNames[r.status] || r.status,repairStatusColors[r.status] || 'gray');
const repairTotal = r => (r.laborCost || 0) + (r.externalCost || 0) + (r.parts || []).reduce((n,p) => n + p.qty * p.price,0);
const repairLate = r => r.status !== 'done' && r.dueDate && r.dueDate < today();
const workshopTime = at => new Date(at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const repairNumber = () => 'ЗР-' + String(Math.max(0,...state.maintenance.map(r => Number((r.number || '').replace('ЗР-','')) || 0)) + 1).padStart(4,'0');
const demoActor = () => 'Демо · ' + roleNames[role];

function recordRepairEvent(r,text) {
  r.history.push({at:new Date().toISOString(),text,by:demoActor()});
}

function saveWorkshop(previous) {
  try { localStorage.setItem(storageKey,JSON.stringify(state));storageAvailable=true;syncMachineStatuses();return true; } catch { storageAvailable=false; }
  state = previous;
  syncMachineStatuses();
  formError('Не удалось сохранить в браузере. Уменьшите число фотографий или освободите место. Данные не изменены.');
  return false;
}

function repairAttention() {
  if (!allowed[role].includes('maintenance')) return '';
  const rows = visibleRepairs().filter(r => r.status !== 'done' && (r.status === 'new' || r.status === 'waiting' || repairLate(r) || r.blocking)).sort((a,b) => Number(repairLate(b)) - Number(repairLate(a))).slice(0,3);
  if (!rows.length) return '';
  return `<section class="panel workshop-attention"><div class="panel-head"><div><h2>Требует решения</h2><p class="subtitle">Заявки, сроки и ответственные · демоданные</p></div><button class="btn ghost" data-nav="maintenance">Все заявки ${icon('arrow')}</button></div><div class="decision-list">${rows.map(r => `<button class="decision-row" data-repair="${r.id}"><span class="decision-symbol">${icon('maintenance')}</span><span class="decision-copy"><b>${esc(machine(r.machine).name)} · ${esc(r.type)}</b><small>${esc(r.assignee)} · срок ${dateText(r.dueDate)}</small></span>${tag(repairLate(r)?'Срок прошёл':repairStatusNames[r.status],repairLate(r)?'red':repairStatusColors[r.status])}${icon('chevron')}</button>`).join('')}</div></section>`;
}

function workshopPage() {
  const all = visibleRepairs();
  const rows = all.filter(r => (period === 'all' || r.date.startsWith(period)) && (workshopFilters.status === 'all' || (workshopFilters.status === 'open' ? r.status !== 'done' : r.status === workshopFilters.status)) && (workshopFilters.machine === 'all' || r.machine === workshopFilters.machine) && `${r.number} ${r.type} ${machine(r.machine).name} ${r.assignee}`.toLocaleLowerCase('ru').includes(workshopFilters.search.toLocaleLowerCase('ru'))).sort((a,b) => Number(a.status === 'done') - Number(b.status === 'done') || Number(repairLate(b)) - Number(repairLate(a)) || b.createdAt.localeCompare(a.createdAt));
  return `<div class="workshop-intro"><span class="demo-badge">ДЕМО</span><p>От замечания машиниста до завершения ремонта. Фотографии и изменения сохраняются в этом браузере.</p></div><div class="workshop-counts">${[['new','Новые'],['progress','В работе'],['waiting','Ожидают запчасти'],['done','Завершены']].map(([key,name]) => `<button class="workshop-count ${workshopFilters.status === key?'active':''}" data-repair-filter="${key}"><small>${name}</small><strong>${all.filter(r => r.status === key && (period === 'all' || r.date.startsWith(period))).length}</strong></button>`).join('')}</div><div class="filter-row workshop-filters"><input id="repair-search" type="search" aria-label="Поиск заявок" placeholder="Номер, техника или неисправность" value="${esc(workshopFilters.search)}"><select id="repair-status" aria-label="Статус заявки">${[['open','Открытые заявки'],['all','Все статусы'],...Object.entries(repairStatusNames)].map(([v,t]) => `<option value="${v}" ${workshopFilters.status === v?'selected':''}>${t}</option>`).join('')}</select><select id="repair-machine" aria-label="Техника в заявках"><option value="all">Вся техника</option>${visibleMachines().map(m => `<option value="${m.id}" ${workshopFilters.machine === m.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select></div><div class="repair-grid">${rows.map(repairCard).join('')}</div>${!rows.length?`<section class="panel">${empty('Заявки не найдены','Измените фильтры или период. Завершённый пример есть в октябре и в режиме «Все периоды».')}</section>`:''}<div class="info-note"><strong>Как попробовать:</strong> откройте заявку JCB 531-70, измените статус или завершите ремонт. В режиме «Машинист» закройте смену с замечанием — заявка появится автоматически. Все имена, документы и суммы условные.</div>`;
}

function repairCard(r) {
  return `<article class="panel repair-card"><div class="repair-card-top"><span class="repair-number">${esc(r.number)} · ${r.kind === 'service'?'ТО':'Ремонт'}</span>${repairTag(r)}</div><button class="repair-title" data-repair="${r.id}">${esc(r.type)}</button><button class="table-link repair-machine-link" data-machine="${r.machine}">${esc(machine(r.machine).name)} <span>· ${r.machine}</span></button><p class="repair-description">${esc(r.note || 'Описание не добавлено')}</p><div class="repair-card-meta"><span>Ответственный<b>${esc(r.assignee)}</b></span><span>Срок<b class="${repairLate(r)?'negative':''}">${dateText(r.dueDate)}${repairLate(r)?' · просрочен':''}</b></span></div><div class="repair-card-bottom"><div>${r.priority === 'high'?tag('Высокий приоритет','red'):tag('Плановая работа','gray')}${r.photos.length?`<span class="muted">${r.photos.length} фото</span>`:''}</div><button class="btn small" data-repair="${r.id}">Открыть ${icon('arrow')}</button></div></article>`;
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
  return `<div class="photo-picker"><label class="photo-label" for="${id}">Фотографии · до 3 файлов</label><input id="${id}" type="file" accept="image/jpeg,image/png,image/webp" multiple><small>Для показа используйте тестовые изображения. JPG, PNG или WebP, до 15 МБ на файл. Фото сохраняются только на этом устройстве.</small><div id="${id}-preview" class="photo-previews" aria-live="polite"></div><div id="${id}-error" class="error-text" role="alert"></div></div>`;
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
  const r={id:uid(),number:repairNumber(),machine:values.machine,kind:values.kind||'repair',type:values.type,note:values.note||'',date:values.date||today(),dueDate:values.dueDate||today(),createdAt:new Date().toISOString(),status:values.status||'new',priority:values.priority||'normal',assignee:values.assignee||demoMechanics[0],blocking:!!values.blocking,reportedBy:demoActor(),photos:values.photos||[],parts:[],history:[],sourceShift:values.sourceShift||null};
  recordRepairEvent(r,values.sourceShift?'Заявка создана из замечания к смене':'Заявка создана');
  return r;
}

function repairForm(machineId='M001') {
  showModal('Новая заявка · демо',`<form id="repair-form">${field('Техника',machineSelect('machine',machineId,visibleMachines()))}<div class="form-grid">${field('Вид заявки','<select name="kind"><option value="repair">Неисправность / ремонт</option><option value="service">Плановое ТО</option></select>')}${field('Приоритет','<select name="priority"><option value="normal">Обычный</option><option value="high">Высокий</option></select>')}</div>${field('Что нужно сделать?','<input name="type" required maxlength="100" placeholder="Например, устранить течь гидравлики">')}${field('Описание неисправности','<textarea name="note" required maxlength="500" placeholder="Что произошло и при каких условиях"></textarea>')}<div class="form-grid">${field('Ответственный',`<select name="assignee">${demoMechanics.map(n=>`<option>${esc(n)}</option>`).join('')}</select>`)}${field('Плановый срок',`<input name="dueDate" type="date" value="${today()}" min="${today()}" required>`)}</div><label class="workshop-checkbox"><input type="checkbox" name="blocking">Техника остановлена до завершения ремонта</label>${photoPicker('repair-photos')}${formActions('Создать заявку')}<p class="form-hint">Все записи в этом прототипе демонстрационные. Уведомления сотрудникам не отправляются.</p></form>`,true);
  const draft=attachPhotoPicker('repair-photos');
  $('#repair-form').onsubmit=e => {
    e.preventDefault();if(draft.busy)return formError('Дождитесь подготовки фотографий.');
    const f=new FormData(e.target),type=f.get('type').trim(),note=f.get('note').trim();
    if(!type||!note)return formError('Укажите название и описание работ.');
    if(f.get('dueDate')<today())return formError('Срок новой заявки не может быть в прошлом.');
    const previous=structuredClone(state);
    const r=newRepairRecord({machine:f.get('machine'),kind:f.get('kind'),type,note,dueDate:f.get('dueDate'),assignee:f.get('assignee'),priority:f.get('priority'),blocking:f.has('blocking'),photos:draft.photos,status:f.get('kind')==='service'?'planned':'new'});
    state.maintenance.push(r);if(!saveWorkshop(previous))return;
    dateInPeriod(r.date);closeModal(false);render();openRepair(r.id);toast('Демонстрационная заявка создана.');
  };
}

function historyMarkup(events) {
  return `<ol class="workshop-history">${events.slice().sort((a,b)=>b.at.localeCompare(a.at)).map(e=>`<li><span class="history-dot"></span><div><b>${esc(e.text)}</b><small>${esc(workshopTime(e.at))} · ${esc(e.by)}</small></div></li>`).join('')}</ol>`;
}

function openRepair(id) {
  const r=visibleRepairs().find(x=>x.id===id);if(!r)return;
  const next={new:['new','planned','progress'],planned:['planned','progress'],progress:['progress','waiting'],waiting:['waiting','progress']}[r.status]||[];
  const manage=canManageRepairs()&&r.status!=='done';
  showModal(`${r.number} · ${r.kind==='service'?'Обслуживание':'Заявка на ремонт'}`,`<div class="workshop-detail-top"><span class="demo-badge">ДЕМО · УСЛОВНЫЕ ДАННЫЕ</span>${repairTag(r)}</div><h2 class="repair-detail-title">${esc(r.type)}</h2><button class="table-link" id="repair-passport">${esc(machine(r.machine).name)} · ${r.machine} ${icon('arrow')}</button><p class="repair-detail-note">${esc(r.note)}</p><dl class="spec-grid"><div><dt>Объект</dt><dd>${esc(obj(machine(r.machine).object).name)}</dd></div><div><dt>Сообщил</dt><dd>${esc(r.reportedBy)}</dd></div><div><dt>Ответственный</dt><dd>${esc(r.assignee)}</dd></div><div><dt>Плановый срок</dt><dd class="${repairLate(r)?'negative':''}">${dateText(r.dueDate)}${repairLate(r)?' · срок прошёл':''}</dd></div><div><dt>Приоритет</dt><dd>${r.priority==='high'?'Высокий':'Обычный'}</dd></div><div><dt>Состояние техники</dt><dd>${r.status==='done'?'Работы по заявке завершены':r.blocking?'Остановлена по этой заявке':'Остановка не отмечена'}</dd></div></dl>${r.sourceShift?'<div class="info-note">Создана из замечания машиниста к смене. Заявка не означает, что смена утверждена.</div>':''}${r.photos.length?`<h3 class="workshop-section-title">Фотографии</h3><div class="repair-gallery">${photoGallery(r.photos)}</div>`:''}${r.status==='done'?`<div class="repair-result"><h3>Результат работ</h3><p>${esc(r.resultNote||'Задача завершена в предыдущей версии демонстрации.')}</p>${canManageRepairs()?`<strong>${rub(repairTotal(r))}</strong><small>${r.costIncludedInDemo?'Условная стоимость · входит в стартовый пример':r.financeOperationId?'Учтено одной операцией в разделе «Финансы»':'Стоимость не вносилась'}</small>`:''}${r.parts.length?`<p>Выдано со склада: ${r.parts.map(p=>`${esc(p.name)} — ${p.qty} ${esc(p.unit)}`).join('; ')}.</p>`:''}</div>`:''}${manage?`<form id="repair-update-form" class="workshop-update"><h3>Ведение заявки</h3><div class="form-grid">${field('Статус',`<select name="status">${next.map(v=>`<option value="${v}" ${v===r.status?'selected':''}>${repairStatusNames[v]}</option>`).join('')}</select>`)}${field('Ответственный',`<select name="assignee">${demoMechanics.map(n=>`<option ${n===r.assignee?'selected':''}>${esc(n)}</option>`).join('')}</select>`)}</div>${field('Плановый срок',`<input name="dueDate" type="date" value="${r.dueDate}" required>`)}<label class="workshop-checkbox"><input type="checkbox" name="blocking" ${r.blocking?'checked':''}>Техника остановлена до завершения ремонта</label>${field('Комментарий к изменению','<textarea name="comment" maxlength="400" placeholder="Результат диагностики, причина ожидания или следующий шаг"></textarea>')}${photoPicker('update-photos')}${formActions('Сохранить изменения')}</form>${['progress','waiting'].includes(r.status)?'<button class="btn primary workshop-complete" id="repair-complete">Завершить ремонт</button>':'<p class="form-hint">Для завершения сначала примите заявку в работу.</p>'}`:''}<h3 class="workshop-section-title">История заявки</h3>${historyMarkup(r.history)}<div class="modal-actions"><button class="btn" data-close>Закрыть</button></div>`,true);
  $('#repair-passport').onclick=()=>openMachinePassport(r.machine,'history');
  $('#repair-complete')?.addEventListener('click',()=>completeRepairForm(r.id));
  if(manage) {
    const draft=attachPhotoPicker('update-photos',r.photos);
    $('#repair-update-form').onsubmit=e=>{
      e.preventDefault();if(draft.busy)return formError('Дождитесь подготовки фотографий.');
      const f=new FormData(e.target),nextStatus=f.get('status'),assignee=f.get('assignee'),comment=f.get('comment').trim();
      if(nextStatus!=='new'&&assignee===demoMechanics[0])return formError('Назначьте ответственного механика.');
      if(nextStatus==='waiting'&&r.status!=='waiting'&&!comment)return formError('Укажите, какие запчасти ожидаются.');
      const changes=[];
      if(nextStatus!==r.status)changes.push('Статус: '+repairStatusNames[nextStatus]);
      if(assignee!==r.assignee)changes.push('Ответственный: '+assignee);
      if(f.get('dueDate')!==r.dueDate)changes.push('Срок: '+dateText(f.get('dueDate')));
      if(f.has('blocking')!==r.blocking)changes.push(f.has('blocking')?'Техника остановлена':'Остановка снята');
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
  showModal('Завершение ремонта · '+r.number,`<form id="repair-close-form"><p class="form-hint">${esc(machine(r.machine).name)} · ${esc(r.type)}</p>${field('Что выполнено?','<textarea name="result" required maxlength="600" placeholder="Какие работы выполнены и проверена ли техника"></textarea>')}<div class="form-grid">${field('Стоимость работ, ₽','<input name="labor" type="number" min="0" max="999999999" step="0.01" value="0" required inputmode="decimal">')}${field('Прочие затраты, ₽','<input name="external" type="number" min="0" max="999999999" step="0.01" value="0" required inputmode="decimal">')}</div><h3 class="workshop-section-title">Запчасти со склада</h3><p class="form-hint">Укажите количество и условную цену за единицу. Остатки уменьшатся при завершении.</p><div class="repair-parts-list">${state.stock.map(p=>`<div class="repair-part-row"><div><b>${esc(p.name)}</b><small>На складе: ${p.qty} ${esc(p.unit)}</small></div><label>Количество<input name="qty-${p.id}" type="number" min="0" max="${p.qty}" step="${p.unit==='шт.'?'1':'0.01'}" value="0" inputmode="decimal"></label><label>Цена, ₽/${esc(p.unit)}<input name="price-${p.id}" type="number" min="0" max="999999999" step="0.01" value="0" inputmode="decimal"></label></div>`).join('')}</div><div class="repair-total-preview">Итого по заявке<strong id="close-total">0 ₽</strong></div><div class="info-note">Завершение спишет выбранные запчасти и добавит одну операцию «Ремонт и ТО», если сумма больше нуля. Другие открытые ремонты этой машины сохранят её статус «На ремонте».</div>${formActions('Завершить и сохранить')}</form>`,true);
  const form=$('#repair-close-form');
  form.oninput=()=>{const f=new FormData(form);const n=Number(f.get('labor'))+Number(f.get('external'))+state.stock.reduce((s,p)=>s+Number(f.get('qty-'+p.id))*Number(f.get('price-'+p.id)),0);$('#close-total').textContent=Number.isFinite(n)?rub(n):'—';};
  form.onsubmit=e=>{
    e.preventDefault();if(r.status==='done')return;
    const f=new FormData(form),result=f.get('result').trim(),labor=Number(f.get('labor')),external=Number(f.get('external'));
    if(!result)return formError('Опишите выполненные работы.');
    if(r.assignee===demoMechanics[0])return formError('Сначала назначьте механика в заявке.');
    if(![labor,external].every(n=>Number.isFinite(n)&&n>=0&&n<=999999999))return formError('Проверьте суммы затрат.');
    const parts=[];
    for(const p of state.stock){const qty=Number(f.get('qty-'+p.id)),price=Number(f.get('price-'+p.id));if(!Number.isFinite(qty)||qty<0||qty>p.qty||(p.unit==='шт.'&&!Number.isInteger(qty)))return formError('Проверьте количество: '+p.name);if(!Number.isFinite(price)||price<0||price>999999999)return formError('Проверьте цену: '+p.name);if(qty>0)parts.push({id:p.id,name:p.name,unit:p.unit,qty,price:Math.round(price*100)/100});}
    const previous=structuredClone(state),date=today();
    Object.assign(r,{status:'done',blocking:false,completedAt:new Date().toISOString(),resultNote:result,laborCost:Math.round(labor*100)/100,externalCost:Math.round(external*100)/100,parts});
    for(const p of parts){const stock=state.stock.find(x=>x.id===p.id);stock.qty=Math.round((stock.qty-p.qty)*100)/100;state.stockMoves.push({id:uid(),part:p.id,qty:p.qty,kind:'issue',machine:r.machine,date,note:`Ремонт ${r.number}`,sourceRepair:r.id});}
    const total=Math.round(repairTotal(r)*100)/100;
    if(total>0){const op={id:uid(),machine:r.machine,kind:'expense',category:'Ремонт и ТО',amount:total,date,note:`${r.number} · ${r.type}`,sourceRepair:r.id};state.operations.push(op);r.financeOperationId=op.id;}
    recordRepairEvent(r,'Ремонт завершён: '+result+(total>0?' · учтено '+rub(total):''));
    if(!saveWorkshop(previous))return;closeModal(false);render();openRepair(r.id);toast('Ремонт завершён. История, склад и затраты обновлены.');
  };
}

function passportMetadata(m) {
  const index=machines.indexOf(m)+1;
  const spec=m.type.includes('Башенный')?['Грузоподъёмность · демо','8 т']:m.type==='Автокран'?['Грузоподъёмность · демо',m.id==='M005'?'25 т':'40 т']:m.id==='M008'?['Грузоподъёмность · демо','3,1 т']:['Параметр учёта','Моточасы'];
  return {registration:'ДЕМО-'+String(index).padStart(4,'0'),serial:'DEMO-'+m.id+'-'+m.year,spec,art:m.type.toLowerCase().includes('кран')?'crane':m.id==='M009'||m.id==='M010'?'truck':'loader'};
}

function machineIllustration(type) {
  const shapes={loader:'<path d="M100 149h124l30 34h33v27H87v-45z" fill="#efaa3c"/><path d="M144 99h67l16 50h-88z" fill="#183452"/><path d="M155 111h45l10 31h-58z" fill="#a9c7dc"/><path d="M222 157l63-67 18 9-59 85z" fill="#f7bf59"/><path d="M279 177h63l-16 35h-53z" fill="#24415d"/><circle cx="125" cy="210" r="26" fill="#243951"/><circle cx="125" cy="210" r="13" fill="#8b9bb0"/><circle cx="226" cy="210" r="26" fill="#243951"/><circle cx="226" cy="210" r="13" fill="#8b9bb0"/>',crane:'<path d="M151 219V54h18v165M84 219h150M68 81l92-27 163 27H68M286 83v76h-13" fill="none" stroke="#e9a633" stroke-width="10"/><path d="M152 77l17 21-17 20 17 20-17 21 17 21-17 20" fill="none" stroke="#d79227" stroke-width="4"/><path d="M273 157v14a9 9 0 0 0 18 0" fill="none" stroke="#24415d" stroke-width="5"/><path d="M69 79h54v19H69z" fill="#24415d"/>',truck:'<path d="M69 128h170v77H69z" fill="#efaa3c"/><path d="M246 149h41l36 36v25h-77z" fill="#24415d"/><path d="M258 157h23l24 25h-47z" fill="#accddd"/><path d="M65 210h265" stroke="#24415d" stroke-width="10"/><circle cx="111" cy="211" r="24" fill="#243951"/><circle cx="111" cy="211" r="11" fill="#8b9bb0"/><circle cx="274" cy="211" r="24" fill="#243951"/><circle cx="274" cy="211" r="11" fill="#8b9bb0"/>'};
  return `<svg class="passport-art" viewBox="0 0 400 280" role="img" aria-label="Условная иллюстрация техники"><path d="M40 237h320" stroke="#d5dfe9" stroke-width="2"/><path d="M50 48h300M50 88h300M50 128h300M50 168h300M90 35v210M150 35v210M210 35v210M270 35v210M330 35v210" stroke="#e5edf4" fill="none"/>${shapes[type]||shapes.loader}<text x="24" y="266" font-family="sans-serif" font-size="10" fill="#73869b" letter-spacing="2">МАРС / ДЕМОИЗОБРАЖЕНИЕ</text></svg>`;
}

function openMachinePassport(id,tabName='passport') {
  const m=visibleMachines().find(x=>x.id===id);if(!m)return;
  if(tabName==='finance'&&!canFinance())tabName='passport';
  const meta=passportMetadata(m),requests=visibleRepairs().filter(r=>r.machine===id),s=sums([m]);
  const tabs=[['passport','Паспорт'],['history','История'],['documents','Документы'],...(canFinance()?[['finance','Экономика']]:[])];
  const image=state.machinePhotos[id]?.[0];
  showModal('Паспорт техники',`<div class="passport-hero"><div class="passport-image">${image&&validPhotoUrl(image.url)?`<img src="${esc(image.url)}" alt="Демонстрационное фото ${esc(m.name)}">`:machineIllustration(meta.art)}</div><div class="passport-identity"><span class="demo-badge">ДЕМО · ДАННЫЕ УСЛОВНЫЕ</span><h2>${esc(m.name)}</h2><p>${esc(m.type)} · ${m.year} г.</p><div class="passport-tags">${machineTag(m)}${tag(m.id,'blue')}</div><span class="passport-location">${icon('objects')}${esc(obj(m.object).name)}</span></div></div><div class="passport-tabs" role="tablist" aria-label="Разделы паспорта">${tabs.map(([key,title])=>`<button type="button" role="tab" id="passport-tab-${key}" aria-selected="${tabName===key}" aria-controls="passport-panel" tabindex="${tabName===key?'0':'-1'}" data-passport-tab="${key}" class="${tabName===key?'active':''}">${title}</button>`).join('')}</div><div role="tabpanel" id="passport-panel" aria-labelledby="passport-tab-${tabName}" tabindex="0">${tabName==='passport'?`<dl class="spec-grid passport-specs"><div><dt>Инвентарный номер</dt><dd>${m.id}</dd></div><div><dt>Условный регистрационный номер</dt><dd>${meta.registration}</dd></div><div><dt>Серийный номер · пример</dt><dd>${meta.serial}</dd></div><div><dt>Машинист · условное имя</dt><dd>${esc(m.operator)}</dd></div><div><dt>Последний счётчик</dt><dd>${Math.max(m.meter,...state.shifts.filter(x=>x.machine===id&&x.status==='approved').map(x=>x.meter)).toLocaleString('ru-RU')} м/ч</dd></div><div><dt>Ближайшее плановое ТО · демо</dt><dd>${dateText(m.service)}</dd></div><div><dt>${meta.spec[0]}</dt><dd>${meta.spec[1]}</dd></div><div><dt>Открытых заявок</dt><dd>${requests.filter(r=>r.status!=='done').length}</dd></div></dl><div class="passport-photo-control"><label class="btn" for="passport-photo">${icon('plus')}Добавить демофото</label><input class="sr-only-input" id="passport-photo" type="file" accept="image/jpeg,image/png,image/webp"><small>Только тестовое изображение. Хранится в этом браузере.</small><div id="form-error" class="error-text" role="alert"></div></div>`:tabName==='history'?passportHistory(m,requests):tabName==='documents'?passportDocuments(m):passportFinance(m,s)}${tabName==='passport'?`<div class="passport-open-requests"><h3>Обслуживание и ремонт</h3>${requests.filter(r=>r.status!=='done').map(r=>`<button class="passport-request" data-passport-repair="${r.id}"><span><b>${esc(r.type)}</b><small>${r.number} · ${dateText(r.dueDate)} · ${esc(r.assignee)}</small></span>${repairTag(r)}${icon('chevron')}</button>`).join('')||'<p class="form-hint">Открытых заявок пока нет.</p>'}</div>`:''}</div><div class="modal-actions passport-actions"><button class="btn" data-close>Закрыть</button><button class="btn primary" id="passport-new-repair">${icon('plus')}Заявка на ремонт</button></div>`,true);
  document.querySelectorAll('[data-passport-tab]').forEach(b=>{
    b.onclick=()=>{openMachinePassport(id,b.dataset.passportTab);$('#passport-tab-'+b.dataset.passportTab).focus();};
    b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const pos=tabs.findIndex(t=>t[0]===tabName),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(pos+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;openMachinePassport(id,tabs[next][0]);$('#passport-tab-'+tabs[next][0]).focus();};
  });
  document.querySelectorAll('[data-passport-repair]').forEach(b=>b.onclick=()=>openRepair(b.dataset.passportRepair));
  $('#passport-new-repair').onclick=()=>repairForm(id);
  document.querySelectorAll('[data-demo-document]').forEach(b=>b.onclick=()=>downloadPassportDocument(m,b.dataset.demoDocument));
  $('#passport-photo')?.addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file)return;const input=e.target;input.disabled=true;
    try {const p=await compressDemoPhoto(file);if(!input.isConnected)return;const previous=structuredClone(state);state.machinePhotos[id]=[p];if(!saveWorkshop(previous))return;openMachinePassport(id);toast('Демофото добавлено в паспорт.');}
    catch(error){if($('#form-error'))formError(error.message);}finally{input.disabled=false;input.value='';}
  });
}

function passportHistory(m,requests) {
  const events=requests.flatMap(r=>r.history.map(h=>({...h,text:r.number+' · '+h.text}))).concat(state.shifts.filter(s=>s.machine===m.id).map(s=>({at:s.date+'T18:00:00+03:00',text:`Смена: ${s.hours} ч · ${s.status==='approved'?'утверждена':s.status==='returned'?'возвращена':'на проверке'}`,by:'Демо · Машинист'})));
  return `<p class="form-hint">Все события по технике, независимо от выбранного финансового периода. История сохраняется в этом браузере.</p>${events.length?historyMarkup(events):empty('Событий пока нет','Создайте заявку на ремонт или закройте смену.')}<h3 class="workshop-section-title">Заявки по этой машине</h3>${requests.map(r=>`<button class="passport-request" data-passport-repair="${r.id}"><span><b>${esc(r.type)}</b><small>${r.number} · ${dateText(r.date)}</small></span>${repairTag(r)}${icon('chevron')}</button>`).join('')}`;
}

function passportDocuments(m) {
  return `<div class="info-note">Это образцы для демонстрации структуры. Настоящие документы компании не загружены.</div><div class="passport-documents">${[['equipment','Паспорт оборудования','Характеристики и условные идентификаторы'],['service','Карточка обслуживания','Заявки, выполненные работы и ответственные']].map(([id,title,description])=>`<article class="passport-document"><span class="icon-wrap">${icon('waybills')}</span><div><h3>${title}</h3><p>${description}</p>${tag('Образец · не официальный документ','gray')}</div><button class="btn small" data-demo-document="${id}">Скачать образец</button></article>`).join('')}</div>`;
}

function passportFinance(m,s) {
  const ops=machineOps(m.id).slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12);
  return `<div class="summary-strip">Период: <b>${esc(monthNames[period]||'Все периоды')}</b></div><div class="detail-stats"><div><small>Выручка</small><b>${rub(s.income)}</b></div><div><small>Учтённые расходы</small><b>${rub(s.expense)}</b></div><div><small>Результат</small><b class="${s.income-s.expense>=0?'positive':'negative'}">${rub(s.income-s.expense)}</b></div></div><dl class="spec-grid"><div><dt>Условная стоимость приобретения</dt><dd>${rub(m.cost)}</dd></div><div><dt>Условный тариф аренды</dt><dd>${rub(m.rate)} / ч</dd></div><div><dt>Загрузка за демомесяц</dt><dd>${m.hours} / ${m.plan} ч</dd></div><div><dt>Маржа по внесённым данным</dt><dd>${s.income?((s.income-s.expense)/s.income*100).toFixed(1).replace('.',',')+' %':'—'}</dd></div></dl><p class="form-hint">Выручка минус учтённые расходы не является чистой прибылью. Часы — отдельный условный пример за один месяц. Для расчёта себестоимости нужны полные затраты и часы за один и тот же период.</p><h3 class="workshop-section-title">Последние операции</h3><div class="table-scroll"><table class="data-table"><thead><tr><th>Дата</th><th>Статья</th><th>Сумма</th></tr></thead><tbody>${ops.map(o=>`<tr><td>${dateText(o.date)}</td><td>${esc(o.category)}<span class="cell-note">${esc(o.note)}</span></td><td class="money">${o.kind==='income'?'+':'−'}${rub(o.amount)}</td></tr>`).join('')}</tbody></table></div>`;
}

function downloadPassportDocument(m,kind) {
  const meta=passportMetadata(m),rows=state.maintenance.filter(r=>r.machine===m.id);
  const title=kind==='equipment'?'Паспорт оборудования':'Карточка обслуживания';
  const body=kind==='equipment'?`<p>Техника: ${esc(m.name)} · ${m.id}</p><p>Тип: ${esc(m.type)}. Год: ${m.year}.</p><p>Условный регистрационный номер: ${meta.registration}</p><p>Условный серийный номер: ${meta.serial}</p><p>Объект: ${esc(obj(m.object).name)}</p>`:`<p>Техника: ${esc(m.name)} · ${m.id}</p>${rows.map(r=>`<p><b>${r.number} · ${esc(r.type)}</b><br>Статус: ${repairStatusNames[r.status]}. Ответственный: ${esc(r.assignee)}. Срок: ${dateText(r.dueDate)}.<br>${esc(r.resultNote||r.note)}</p>`).join('')||'<p>Заявок пока нет.</p>'}`;
  download(`MARS-DEMO-${m.id}-${kind}.html`,`<!doctype html><html lang="ru"><meta charset="utf-8"><title>ДЕМО · ${title}</title><style>body{font:16px/1.7 system-ui;max-width:800px;margin:40px auto;padding:24px;color:#182337}.demo{border:2px solid #c87b13;padding:16px;color:#92570c}h1{font-size:28px}</style><body><div class="demo"><b>ДЕМОНСТРАЦИОННЫЙ ОБРАЗЕЦ</b><br>Все сведения вымышлены. Не является выданным паспортом или официальным документом компании.</div><h1>${title}</h1><p>МАРС · ООО «МонАрх и М» · демоверсия</p>${body}</body></html>`,'text/html');
  toast('Демонстрационный образец скачан.');
}
