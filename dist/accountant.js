'use strict';
// Демонстрационный импорт: данные остаются только в браузере.
function accountantPage(){
 const rows=state.operations.filter(o=>o.source==='excel-demo');
 const total=rows.reduce((a,o)=>a+o.amount,0); const pending=rows.filter(o=>!o.machine && o.allocation!=='overhead'); const pendingTotal=pending.reduce((a,o)=>a+o.amount,0); const assigned=rows.filter(o=>!!o.machine); const overhead=rows.filter(o=>o.allocation==='overhead');
 return `<section class="panel padded"><h2>Бухгалтер · загрузка расходов из 1С</h2><p class="subtitle">Демонстрация без интеграции с 1С. Поддерживаются CSV (UTF-8, разделитель ; или ,) и XLSX при доступной библиотеке чтения Excel.</p><div class="info-note"><strong>Шаблон:</strong> Дата;Техника;Статья;Сумма;Комментарий. В графе «Техника» укажите код M001–M010 или точное название машины. Пример: 2026-11-03;M002;Запчасти;12500;Фильтр. Не загружайте реальные бухгалтерские или персональные данные в публичную демоверсию.</div><p style="margin:18px 0"><button class="btn" id="accountant-sample">Скачать пример CSV</button> <label class="btn primary" for="accountant-file">Выбрать файл Excel / CSV</label><input type="file" id="accountant-file" accept=".csv,.xlsx" style="position:absolute;width:1px;height:1px;opacity:0"></p><div id="accountant-preview"></div><h3>Нераспределённые расходы</h3><p class="subtitle">Расходы без техники не включаются в себестоимость конкретной машины, пока бухгалтер не назначит её.</p><div class="info-note">Ожидают распределения: <b>${pending.length}</b> · ${rub(pendingTotal)}</div>${pending.map(o=>`<div class="info-note" style="margin:8px 0"><strong>${esc(o.date)} · ${esc(o.category)} · ${rub(o.amount)}</strong><div>${esc(o.note||"Без комментария")}</div><select class="accountant-assign" data-id="${esc(o.id)}"><option value="">Выбрать технику</option>${machines.map(m=>`<option value="${esc(m.id)}">${esc(m.id)} · ${esc(m.name)}</option>`).join("")}</select> <button class="btn accountant-assign-save" data-id="${esc(o.id)}">Назначить</button> <button class="btn accountant-overhead" data-id="${esc(o.id)}">Общехозяйственный расход</button></div>`).join("")}<p class="subtitle">Общехозяйственные расходы: ${overhead.length} строк · ${rub(overhead.reduce((a,o)=>a+o.amount,0))}</p><h3>Расходы по технике</h3><p class="subtitle">Назначено: ${assigned.length} строк · ${rub(assigned.reduce((a,o)=>a+o.amount,0))}</p><div class="stats"><article class="stat"><div class="stat-label">Импортировано строк</div><div class="stat-value">${rows.length}</div></article><article class="stat"><div class="stat-label">Расходы из импортов</div><div class="stat-value">${rub(total)}</div></article></div><p class="subtitle">После подтверждения расходы появятся в разделе «Финансы» и в карточках техники <strong>в этом браузере</strong>. На другом устройстве они не появятся: серверной базы данных пока нет.</p></section>`;
}
let accountantPending=[];
function accountantBind(){
 document.querySelectorAll('.accountant-assign-save,.accountant-overhead').forEach(btn=>btn.addEventListener('click',()=>{
 const row=state.operations.find(o=>o.id===btn.dataset.id && o.source==='excel-demo' && !o.machine);
 if(!row)return;
 if(btn.classList.contains('accountant-overhead')){row.machine='';row.allocation='overhead';}
 else {const selected=document.querySelector('.accountant-assign[data-id="'+btn.dataset.id+'"]')?.value;if(!machines.some(m=>m.id===selected)){toast('Выберите технику.');return;}row.machine=selected;row.allocation='machine';}
 persist();render();toast('Назначение расхода сохранено.');
 }));
 document.getElementById('accountant-sample')?.addEventListener('click',()=>{
 const csv='Дата;Техника;Статья;Сумма;Комментарий\n2026-11-03;M001;Запчасти;12500;Фильтры\n2026-11-03;M002;Ремонт и ТО;34000;Гидравлика\n2026-11-03;M003;Зарплата;85000;Условный пример';
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download='mars-demo-1c.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 });
 document.getElementById('accountant-file')?.addEventListener('change',async e=>{
 const f=e.target.files?.[0];if(!f)return;const box=document.getElementById('accountant-preview');
 try{
 let data;
 if(f.name.toLowerCase().endsWith('.xlsx')){
 if(!globalThis.XLSX)throw Error('Библиотека XLSX не загрузилась. Используйте CSV.');
 const book=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:true});data=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,raw:false});
 }else{
 const txt=await f.text();const lines=txt.replace(/^\ufeff/,'').split(/\r?\n/).filter(Boolean);const sep=lines[0].includes(';')?';':',';data=lines.map(line=>line.split(sep).map(x=>x.trim().replace(/^"|"$/g,'')));
 }
 const head=data.shift().map(x=>String(x).trim().toLowerCase());
 const col=(...names)=>head.findIndex(x=>names.includes(x));
 const ix=[col('дата','date'),col('техника','машина','machine'),col('статья','категория','category'),col('сумма','amount'),col('комментарий','примечание','note')];
 if(ix.slice(0,4).some(x=>x<0))throw Error('Нужны колонки: Дата, Техника, Статья, Сумма.');
 const invalid=[];accountantPending=[];
 data.forEach((r,i)=>{
 const raw=String(r[ix[1]]||'').trim();const m=machines.find(x=>x.id.toLowerCase()===raw.toLowerCase()||x.name.toLowerCase()===raw.toLowerCase());
 const amount=Number(String(r[ix[3]]||'').replace(/\s/g,'').replace(',','.'));
 const ds=String(r[ix[0]]||'').trim();const date=/^\d{4}-\d{2}-\d{2}$/.test(ds)?ds:/^\d{2}\.\d{2}\.\d{4}$/.test(ds)?ds.slice(6)+'-'+ds.slice(3,5)+'-'+ds.slice(0,2):'';
 const category=String(r[ix[2]]||'').trim();
 if((raw && !m)||!Number.isFinite(amount)||amount<=0||!date||!category||!Number.isFinite(Date.parse(date))){invalid.push(i+2);return;}
 accountantPending.push({id:uid(),machine:m?.id||'',kind:'expense',category,amount,date,note:ix[4]>=0?String(r[ix[4]]||''):'',source:'excel-demo'});
 });
 if(invalid.length){accountantPending=[];throw Error('Некорректные строки: '+invalid.slice(0,12).join(', ')+'. Импорт отменён целиком.');}
 if(!accountantPending.length)throw Error('Нет строк для импорта.');
 box.innerHTML=`<div class="info-note">Проверено строк: <b>${accountantPending.length}</b>. Сумма: <b>${rub(accountantPending.reduce((a,x)=>a+x.amount,0))}</b>. Перед подтверждением убедитесь, что файл не загружался ранее.</div><button class="btn primary" id="accountant-confirm">Подтвердить импорт</button>`;
 document.getElementById('accountant-confirm').onclick=()=>{
 const fingerprint=x=>[x.date,x.machine,x.category,x.amount,x.note].join('|');
 const existing=new Set(state.operations.filter(x=>x.source==='excel-demo').map(fingerprint));
 if(accountantPending.some(x=>existing.has(fingerprint(x)))){toast('Обнаружены совпадающие строки. Импорт отменён для защиты от дублей.');return;}
 state.operations.push(...accountantPending);accountantPending=[];persist();render();toast('Демо-расходы добавлены. Перейдите в профиль руководителя.');
 };
 }catch(err){box.textContent='Ошибка импорта: '+err.message;}
 });
}
