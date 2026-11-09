"""Offline browser regression: python tests/browser/manager-calendar.py.

Requires Python Playwright and Chromium. Only synthetic localStorage is used;
all page requests are intercepted from dist. MARS_CHROMIUM_PATH overrides Chrome.
"""
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
KEYS = {"demo": "mars-director-presentation-v1", "working": "mars-working-data-v1"}
MANAGERS = ["Алексей Иванов", "Дмитрий Петров"]

SEED = r"""
if(!sessionStorage.getItem('calendar-test-seeded')) {
 const day=new Date().toISOString().slice(0,10),date=n=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
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
 localStorage.setItem(ACTIVE_KEY,JSON.stringify(data));localStorage.setItem(INACTIVE_KEY,'preserved-inactive-bytes');
 localStorage.setItem('monarch-im-control-v1','preserved-legacy-bytes');localStorage.setItem('mars-catalog-archive-v1','preserved-archive-bytes');
 sessionStorage.setItem('calendar-test-seeded','true');
}
WORKING_SETUP
"""


class Scenario:
    def __init__(self, browser, mode, width, name):
        self.mode, self.name, self.active = mode, name, KEYS[mode]
        self.context = browser.new_context(viewport={"width": width, "height": 820}, timezone_id="UTC")
        self.errors = []
        seed = SEED.replace("INACTIVE_KEY", json.dumps(KEYS["working" if mode == "demo" else "demo"]))
        seed = seed.replace("ACTIVE_KEY", json.dumps(self.active)).replace("WORKING_SETUP", "delete window.MARS_DIRECTOR_DEMO;" if mode == "working" else "")

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
        browser.close()
    print(f"PASSED {count} browser scenarios", flush=True)


if __name__ == "__main__":
    main()
