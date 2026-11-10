"""Offline browser regression: python tests/browser/manager-calendar.py.

Requires Python Playwright and Chromium. Only synthetic localStorage is used;
all page requests are intercepted from dist. MARS_CHROMIUM_PATH overrides Chrome.
Includes six date-display contexts (demo/working × UTC/Los Angeles/Tokyo).
"""
import json
import mimetypes
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
KEYS = {"demo": "mars-director-presentation-v1", "working": "mars-working-data-v1"}
MANAGERS = ["Алексей Иванов", "Дмитрий Петров"]

SEED = r"""
if(!sessionStorage.getItem('calendar-test-seeded')) {
 const day=TEST_DAY,date=n=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const data=window.MARS_DIRECTOR_DEMO.createState(day),ids=['asset-test-a','asset-test-b','asset-test-c'];
 data.machines=data.machines.slice(0,3).map((m,i)=>({...m,id:ids[i],name:'Синтетическая техника '+(i+1)+' с длинным наименованием оборудования и навесного комплекта',registration:'ТЕСТ-'+i,operator:'Синтетический машинист '+i,demo:false}));
 data.objects[0].name='Синтетический объект с очень длинным названием строительной площадки и участка выполнения работ';
 data.operations=[{id:'income-test',machine:ids[0],kind:'income',category:'Синтетическая выручка',amount:1000,date:day,note:'Не менять'}, {id:'expense-test',machine:ids[0],kind:'expense',category:'Синтетический расход',amount:100,date:day,note:'Не менять'}];
 const owners=['Алексей Иванов','Дмитрий Петров'];
 data.equipmentRequests=ids.map((id,i)=>({id:'request-test-'+i,number:'ЗТ-ТЕСТ-'+i,owner:owners[i%2],customer:'Синтетический заказчик '+i,object:data.objects[0].name,status:'Назначена',dispatchStage:'Назначена',arrival:'Запланирована',releaseConfirmed:false,followup:'Не уточняли',comment:'Комментарий с длинным описанием условий подачи и контактов. '.repeat(5),contact:'Синтетический представитель заказчика '+i,phone:'+7 000 000-00-0'+i,items:[{machine:id,operator:data.machines[i].operator,start:day+'T08:00',end:date(1)+'T18:00'}],history:Array.from({length:18},(_,j)=>({by:owners[i%2],at:day+'T09:00:00Z',action:'История '+j,reason:'Синтетическая проверка записи '+j,changes:[{field:'Комментарий',from:'Ранее',to:'Уточнено'}]}))}));
 data.maintenance=[
  {id:'repair-test-plan',number:'РЕМ-ТЕСТ-ПЛАН',machine:ids[2],kind:'repair',type:'Синтетическая неисправность гидравлического оборудования с длинным описанием',note:'Проверить оборудование; причина неисправности записана в исходной заявке.',date:date(-2),startedAt:date(-1)+'T10:00:00Z',dueDate:date(1),status:'progress',assignee:'Синтетический ответственный механик',blocking:true,readyConfirmed:false,history:[],parts:[],photos:[]},
  {id:'repair-test-unknown',number:'РЕМ-ТЕСТ-НЕИЗВЕСТНО',machine:ids[2],kind:'repair',type:'Проверка неизвестного срока',note:'Плановое окончание не известно.',date:date(-3),status:'waiting',assignee:'Синтетический механик 2',blocking:true,readyConfirmed:false,history:[],parts:[],photos:[]},
  {id:'repair-test-overdue',number:'РЕМ-ТЕСТ-ПРОСРОЧЕН',machine:ids[2],kind:'repair',type:'Проверка допуска после ремонта',note:'Ожидается подтверждение технической готовности.',date:date(-4),dueDate:date(-1),status:'done',assignee:'Синтетический механик 3',blocking:true,history:[],parts:[],photos:[]}
 ];
 data.shifts=[];data.recordAudit=[];data.machinePhotos={};data.sentinel='preserved-test-data';
 DATE_DISPLAY_FIXTURE
 localStorage.setItem(ACTIVE_KEY,JSON.stringify(data));localStorage.setItem(INACTIVE_KEY,'preserved-inactive-bytes');
 localStorage.setItem('monarch-im-control-v1','preserved-legacy-bytes');localStorage.setItem('mars-catalog-archive-v1','preserved-archive-bytes');
 sessionStorage.setItem('calendar-test-seeded','true');
}
WORKING_SETUP
"""

DATE_DISPLAY_FIXTURE = r"""
for(const r of data.equipmentRequests.slice(0,2)) {
 const item=r.items[0],prefix=item.machine+' / '+item.operator+' / ';
 r.items=[
  {...item,start:'2026-11-10T00:15',end:'2026-11-11T23:45'},
  {...item,start:'2026-11-10T01:05+03:00',end:'2026-11-11T22:55Z'},
  {machine:item.machine,operator:item.operator,end:null},
  {...item,start:'2026-02-30T08:00',end:'not-a-date'}
 ];
 r.history=[{by:r.owner,at:'2026-11-10T09:00:00Z',action:'Изменение назначения',reason:'Синтетическая проверка отображения',changes:[
  {field:'Назначение №1',from:prefix+'2026-11-09T23:45 / 2026-11-10T00:15',to:prefix+'2026-11-10T00:15 / 2026-11-11T23:45'},
  {field:'Комментарий',from:'Сохранить 2026-11-10T00:15 как текст',to:'Без изменения'}
 ]}];
}
"""


class Scenario:
    def __init__(self, browser, mode, width, name, timezone_id="UTC", date_display=False):
        self.mode, self.name, self.active = mode, name, KEYS[mode]
        self.context = browser.new_context(viewport={"width": width, "height": 820}, timezone_id=timezone_id)
        self.errors = []
        seed = SEED.replace("INACTIVE_KEY", json.dumps(KEYS["working" if mode == "demo" else "demo"]))
        seed = seed.replace("ACTIVE_KEY", json.dumps(self.active)).replace("WORKING_SETUP", "delete window.MARS_DIRECTOR_DEMO;" if mode == "working" else "")
        seed = seed.replace("TEST_DAY", "'2026-11-10'" if date_display else "new Date().toISOString().slice(0,10)")
        seed = seed.replace("DATE_DISPLAY_FIXTURE", DATE_DISPLAY_FIXTURE if date_display else "")

        def route_request(route):
            url = urlparse(route.request.url)
            if url.hostname != "mars-calendar.test":
                route.abort()
                return
            path = ROOT / "dist" / ("index.html" if url.path == "/" else url.path.lstrip("/"))
            if not path.is_file():
                route.fulfill(status=404, body="not found")
                return
            body = path.read_bytes()
            if path.name == "app.js":
                body = seed.encode() + body
            route.fulfill(status=200, body=body, content_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream")

        self.context.route("**/*", route_request)
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        if date_display:
            self.page.clock.install(time=datetime(2026, 11, 10, 12, tzinfo=timezone.utc))
        self.page.goto("https://mars-calendar.test/", wait_until="load")
        self.page.wait_for_selector("#app .layout")
        self.protected = self.page.evaluate("key=>Object.fromEntries(Object.keys(localStorage).filter(k=>k!==key&&k!=='mars-demo-manager').map(k=>[k,localStorage.getItem(k)]))", self.active)
        self.financial = self.page.evaluate("JSON.stringify(state.operations)")

    def manager(self, index):
        self.page.evaluate("name=>{closeModal(false);role='dispatcher';localStorage.setItem('mars-demo-manager',name);view='requests';render();}", MANAGERS[index])

    def state(self):
        return self.page.evaluate("JSON.stringify(state)")

    def stored(self):
        return self.page.evaluate("key=>localStorage.getItem(key)", self.active)

    def geometry(self, editor=False):
        result = self.page.evaluate(r"""editor=>{
         const modal=document.querySelector('.modal'),content=modal.querySelector('.modal-content'),rect=content.getBoundingClientRect(),close=modal.querySelector('.close-button').getBoundingClientRect();
         const overflow=[...modal.querySelectorAll('input,select,textarea')].filter(el=>el.offsetParent!==null).map(el=>({name:el.name,rect:el.getBoundingClientRect()})).filter(x=>x.rect.left<rect.left-1||x.rect.right>rect.right+1).map(x=>x.name);
         const collisions=[];
         if(editor)for(const label of modal.querySelectorAll('#request-form label')){
          const input=label.querySelector('input:not([type=checkbox]),select,textarea'),text=[...label.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());
          if(!input||!text)continue;const range=document.createRange();range.selectNodeContents(text);const a=range.getBoundingClientRect(),b=input.getBoundingClientRect();if(a.bottom>b.top+1)collisions.push(input.name);
         }
         return {overflow,collisions,width:modal.scrollWidth-clientWidth(modal),closeVisible:close.top>=0&&close.bottom<=innerHeight,scrollable:modal.scrollHeight>modal.clientHeight};
         function clientWidth(el){return el.clientWidth;}
        }""", editor)
        assert not result["overflow"], (self.name, result)
        assert not result["collisions"], (self.name, result)
        assert result["width"] <= 2, (self.name, result)
        assert result["closeVisible"], (self.name, result)
        assert result["scrollable"], (self.name, "long card must scroll", result)
        return result

    def close(self):
        assert self.page.evaluate("JSON.stringify(state.operations)") == self.financial
        assert self.page.evaluate("key=>Object.fromEntries(Object.keys(localStorage).filter(k=>k!==key&&k!=='mars-demo-manager').map(k=>[k,localStorage.getItem(k)]))", self.active) == self.protected
        assert not self.errors, (self.name, self.errors)
        self.context.close()
        print("PASS", self.mode, self.name, flush=True)


def date_display(s):
    before, stored = s.state(), s.stored()
    raw_start, raw_end = "2026-11-10T00:15", "2026-11-11T23:45"
    expected = ["10.11.2026, 00:15", "11.11.2026, 23:45"]

    def request_row(request_id):
        return s.page.locator("section.panel").filter(has=s.page.get_by_role("heading", name="Все заявки на технику", exact=True)).locator("tr").filter(has=s.page.locator(f"button[data-request-open='{request_id}']"))

    def close_modal():
        s.page.locator(".modal [data-close-modal]").click()
        s.page.wait_for_selector(".modal", state="detached")

    def assert_details():
        card = s.page.locator(".request-details")
        assert card.is_visible()
        assert s.page.locator(".modal input,.modal select,.modal textarea,.modal form").count() == 0
        assignments = card.locator(".request-assignment")
        assert assignments.count() == 4
        assert assignments.nth(0).locator("dd").all_inner_texts()[-2:] == expected
        assert assignments.nth(1).locator("dd").all_inner_texts()[-2:] == ["10.11.2026, 01:05 UTC+03:00", "11.11.2026, 22:55 UTC"]
        assert assignments.nth(2).locator("dd").all_inner_texts()[-2:] == ["—", "—"]
        assert assignments.nth(3).locator("dd").all_inner_texts()[-2:] == ["Некорректная дата", "Некорректная дата"]
        history = card.locator(".request-history-entry div").all_inner_texts()
        assert "09.11.2026, 23:45" in history[0] and all(value in history[0] for value in expected)
        assert raw_start not in history[0] and raw_end not in history[0]
        assert "Сохранить 2026-11-10T00:15 как текст" in history[1]
        assert "Invalid Date" not in card.inner_text()

    def assert_raw_editor(request_id):
        request_row(request_id).locator("button[data-request-open]").click()
        first = s.page.locator("#request-form .request-item").first
        assert first.locator("input[name=start]").input_value() == raw_start
        assert first.locator("input[name=end]").input_value() == raw_end
        close_modal()

    for selected, request_id in [("director", "request-test-0"), ("dispatcher:" + MANAGERS[0], "request-test-1"), ("dispatcher:" + MANAGERS[1], "request-test-0"), ("mechanic", "request-test-0")]:
        s.page.locator("#role").select_option(selected)
        if selected in ["director", "mechanic"]:
            s.page.locator(".sidebar [data-nav=requests]").click()
        row_text = request_row(request_id).inner_text()
        assert all(value in row_text for value in expected), (s.name, selected, row_text)
        assert raw_start not in row_text and raw_end not in row_text
        if selected == "director":
            # Director's normal row action opens its editor; exercise the shared
            # readonly renderer directly without changing the role or records.
            s.page.evaluate("id=>requestDetails(id)", request_id)
        else:
            request_row(request_id).locator("button[data-request-open]").click()
        assert_details()
        close_modal()
        if selected == "director":
            assert_raw_editor("request-test-0")
        elif selected.startswith("dispatcher:"):
            assert_raw_editor("request-test-0" if selected.endswith(MANAGERS[0]) else "request-test-1")
        assert s.state() == before and s.stored() == stored

    # The mechanic warning shares exactly the same visible assignment dates.
    s.page.locator(".sidebar [data-nav=maintenance]").click()
    s.page.locator(".heading-actions [data-action=add-service]").click()
    s.page.locator("#repair-form [name=machine]").select_option("asset-test-a")
    s.page.locator("#repair-form [name=dueDate]").fill("2026-11-11")
    warning = s.page.locator("#repair-booking-warning").inner_text()
    assert all(value in warning for value in expected)
    assert raw_start not in warning and raw_end not in warning
    close_modal()
    assert s.state() == before and s.stored() == stored
    s.page.reload(wait_until="load")
    s.page.wait_for_selector("#app .layout")
    assert s.state() == before and s.stored() == stored
    s.page.evaluate("requestDetails('request-test-0')")
    assert_details()
    s.close()


def main():
    count = 0
    with sync_playwright() as p:
        executable = os.environ.get("MARS_CHROMIUM_PATH") or ("/usr/bin/chromium" if Path("/usr/bin/chromium").exists() else None)
        browser = p.chromium.launch(executable_path=executable, headless=True, args=["--no-sandbox"])
        for mode in ["demo", "working"]:
            for index, width in [(0, 375), (1, 390)]:
                s = Scenario(browser, mode, width, f"manager {index+1} own edit, failed write, retry and reload")
                s.manager(index)
                s.page.locator(f".request-calendar-booking[data-request-open='request-test-{index}']").first.click()
                form = s.page.locator("#request-form")
                assert form.is_visible()
                s.geometry(editor=True)
                form.locator("[name=comment]").fill("Исправление своего заказа в браузере")
                form.locator("[name=changeReason]").fill("Проверка собственного изменения")
                before, saved = s.state(), s.stored()
                s.page.evaluate("key=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('synthetic quota','QuotaExceededError');return window.originalSetItem.call(this,k,v);};}", s.active)
                form.locator("[type=submit]").click()
                assert s.state() == before and s.stored() == saved
                assert form.is_visible()
                assert form.locator("[name=comment]").input_value() == "Исправление своего заказа в браузере"
                s.page.evaluate("() => {Storage.prototype.setItem=window.originalSetItem;}")
                form.locator("[type=submit]").click()
                s.page.wait_for_selector("#request-form", state="detached")
                assert s.page.evaluate("id=>state.equipmentRequests.find(r=>r.id===id).comment", f"request-test-{index}") == "Исправление своего заказа в браузере"
                committed = s.state()
                s.page.reload(wait_until="load")
                assert s.state() == committed
                s.close(); count += 1

            for index, width in [(0, 320), (1, 390)]:
                s = Scenario(browser, mode, width, f"manager {index+1} foreign readonly complete card and mobile scroll")
                s.manager(index)
                before, saved = s.state(), s.stored()
                foreign = 1-index
                s.page.locator(f".request-calendar-booking[data-request-open='request-test-{foreign}']").first.click()
                card = s.page.locator(".request-details")
                assert card.is_visible()
                assert s.page.locator(".modal input,.modal select,.modal textarea,.modal form").count() == 0
                text = card.inner_text()
                for value in [f"ЗТ-ТЕСТ-{foreign}", MANAGERS[foreign], f"Синтетический заказчик {foreign}", "asset-test-", "Машинист", "Начало", "Окончание", "Комментарий", "Контакт", "+7 000", "История 17"]:
                    assert value in text, (s.name, value)
                dates = s.page.evaluate("id=>state.equipmentRequests.find(r=>r.id===id).items[0]", f"request-test-{foreign}")
                for key in ["start", "end"]:
                    assert datetime.fromisoformat(dates[key]).strftime("%d.%m.%Y, %H:%M") in text
                assert all(label in ["Закрыть", ""] for label in s.page.locator(".modal button").all_inner_texts())
                s.geometry()
                s.page.evaluate("const modal=document.querySelector('.modal');modal.scrollTop=modal.scrollHeight")
                assert card.locator("[data-close]").is_visible()
                assert s.state() == before and s.stored() == saved
                s.close(); count += 1

            s = Scenario(browser, mode, 375, "repair calendar overlap, multiple repairs, unknown deadline and no automatic release")
            s.manager(0)
            cell = s.page.locator(".request-calendar-cell").filter(has=s.page.locator("[data-request-open='request-test-2']")).first
            assert cell.locator("[data-request-open]").count() > 0
            assert cell.locator("[data-calendar-repair-machine]").count() == 2
            assert "Конфликт" in cell.inner_text()
            before, saved = s.state(), s.stored()
            cell.locator("[data-calendar-repair-machine]").first.click()
            card = s.page.locator(".calendar-repair-details")
            assert card.locator(".calendar-repair-card").count() == 3
            for value in ["РЕМ-ТЕСТ-ПЛАН", "РЕМ-ТЕСТ-НЕИЗВЕСТНО", "РЕМ-ТЕСТ-ПРОСРОЧЕН", "Срок не указан", "Срок прошёл", "Не подтверждена", "Эксплуатация запрещена"]:
                assert value in card.inner_text(), value
            assert s.page.locator(".modal input,.modal select,.modal textarea,.modal form").count() == 0
            s.geometry()
            assert s.state() == before and s.stored() == saved
            assert s.page.evaluate("machine('asset-test-c').status") == "repair"
            assert s.page.evaluate("state.maintenance.find(r=>r.id==='repair-test-overdue').readyConfirmed") is False
            s.close(); count += 1

            s = Scenario(browser, mode, 1280, "director both requests and stale manager submit guard")
            s.page.evaluate("role='director';view='requests';render();")
            for index in [0, 1]:
                s.page.locator(f".request-calendar-booking[data-request-open='request-test-{index}']").first.click()
                assert s.page.locator("#request-form").is_visible()
                s.page.locator("[data-close-modal]").click()
            s.manager(0)
            s.page.locator(".request-calendar-booking[data-request-open='request-test-0']").first.click()
            before, saved = s.state(), s.stored()
            s.page.evaluate("name=>{localStorage.setItem('mars-demo-manager',name);const f=document.querySelector('#request-form');f.onsubmit({target:f,preventDefault(){}});}", MANAGERS[1])
            assert s.state() == before and s.stored() == saved
            s.close(); count += 1
        original_count = count
        for mode in ["demo", "working"]:
            for timezone_id in ["UTC", "America/Los_Angeles", "Asia/Tokyo"]:
                s = Scenario(browser, mode, 1280, "request date display, raw editors, readonly roles and reload · " + timezone_id, timezone_id=timezone_id, date_display=True)
                date_display(s)
                count += 1
        browser.close()
    print(f"PASSED {count} browser scenarios ({original_count} calendar + {count-original_count} date-display contexts)", flush=True)


if __name__ == "__main__":
    main()
