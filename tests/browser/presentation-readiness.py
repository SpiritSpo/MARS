"""Offline presentation regression: python tests/browser/presentation-readiness.py.

Requires Python Playwright and Chromium (MARS_CHROMIUM_PATH overrides its path).
Every scenario gets a new, non-persistent browser context. All requests are
intercepted from dist; no live site or existing browser storage is accessed.
The original demo factory is anchored to 2026-11-10, including its unchanged
synthetic financial operations. Accounting imports use a separate context. A cached
SheetJS file at /tmp/mars-xlsx-0.18.5.min.js enables the optional real XLSX preview.
Use --case TEXT to run only matching scenario names while developing.
"""

import argparse
import json
import mimetypes
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
DAY = "2026-11-10"
NOW = datetime(2026, 11, 10, 12, tzinfo=timezone.utc)
ORIGIN = "https://mars-presentation.test"
KEYS = {"demo": "mars-director-presentation-v1", "working": "mars-working-data-v1"}
MANAGERS = ["Алексей Иванов", "Дмитрий Петров"]
ROLES = ["director", *["dispatcher:" + name for name in MANAGERS], "mechanic", "operator", "accountant"]
LANDINGS = {"director": "dashboard", "dispatcher": "requests", "mechanic": "maintenance", "operator": "shifts", "accountant": "accountant"}
PRIMARY = {
    "director": ["dashboard", "requests", "fleet", "maintenance", "finance"],
    "dispatcher": ["requests", "fleet", "objects", "maintenance"],
    "mechanic": ["maintenance", "requests", "fleet", "inventory"],
    "operator": ["shifts", "maintenance"],
    "accountant": ["accountant"],
}
CSV_HEADER = "Дата;Техника;Статья;Сумма;Комментарий;Номер документа;ID документа;ID строки;Источник;Ремонт\n"
XLSX = Path(os.environ.get("MARS_XLSX_PATH", "/tmp/mars-xlsx-0.18.5.min.js"))


def day(offset=0):
    return (datetime.fromisoformat(DAY) + timedelta(days=offset)).date().isoformat()


class Scenario:
    def __init__(self, browser, mode, width, name, accounting=False):
        self.name, self.mode, self.width, self.active = name, mode, width, KEYS[mode]
        self.context = browser.new_context(viewport={"width": width, "height": 900}, timezone_id="Europe/Moscow", has_touch=width < 760)
        self.errors = []
        self.blocked = []
        seed = """
if(!sessionStorage.getItem('presentation-test-seeded')){
 const data=window.MARS_DIRECTOR_DEMO.createState(DAY_VALUE);
 const inactive=structuredClone(data);inactive.sentinel='protected inactive dataset';
 ACCOUNTING_FIXTURE
 localStorage.setItem(ACTIVE_KEY,JSON.stringify(data));
 localStorage.setItem(INACTIVE_KEY,JSON.stringify(inactive));
 localStorage.setItem('monarch-im-control-v1','protected legacy bytes');
 localStorage.setItem('mars-catalog-archive-v1','protected archive bytes');
 sessionStorage.setItem('presentation-test-seeded','true');
}
WORKING_SETUP
""".replace("DAY_VALUE", json.dumps(DAY)).replace("INACTIVE_KEY", json.dumps(KEYS["working" if mode == "demo" else "demo"])).replace("ACTIVE_KEY", json.dumps(self.active))
        seed = seed.replace("WORKING_SETUP", "delete window.MARS_DIRECTOR_DEMO;" if mode == "working" else "")
        seed = seed.replace("ACCOUNTING_FIXTURE", """
 data.operations=[
  {id:'synthetic-income',machine:'M002',kind:'income',category:'Синтетическая выручка',amount:10000,date:DAY_VALUE,note:'Сохраняемый источник'},
  {id:'synthetic-expense',machine:'M001',kind:'expense',category:'Синтетический расход',amount:37,date:DAY_VALUE,note:'Сохраняемый источник'}
 ];data.accountantImports=[];
""".replace("DAY_VALUE", json.dumps(DAY)) if accounting else "")
        if accounting == "review":
            seed = seed.replace("data.accountantImports=[];", """
 data.accountantImports=[];
 data.operations.push(
  {id:'review-canonical',machine:'M002',kind:'expense',allocation:'machine',category:'Синтетический расход',amount:137,date:DAY_VALUE,note:'Первичный документ для проверки'},
  {id:'review-imported',machine:'M002',kind:'expense',allocation:'machine',category:'Синтетический расход',amount:137,date:DAY_VALUE,note:'Импортированный документ с длинным описанием условий распределения и сверки',source:'excel-demo',importMachine:'M002',importFile:'synthetic.csv',importSheet:'Расходы',importLine:2},
  {id:'review-overhead',machine:'',kind:'expense',allocation:'overhead',category:'Синтетический расход',amount:37,date:DAY_VALUE,note:'Перераспределяемый расход',source:'excel-demo',importMachine:'ОБЩЕХОЗ',importFile:'synthetic.csv',importSheet:'Расходы',importLine:3}
 );
""".replace("DAY_VALUE", json.dumps(DAY)))

        def route_request(route):
            url = urlparse(route.request.url)
            if url.hostname == "cdn.jsdelivr.net" and url.path.endswith("/xlsx.full.min.js"):
                if XLSX.is_file():
                    route.fulfill(status=200, body=XLSX.read_bytes(), content_type="application/javascript")
                else:
                    route.fulfill(status=200, body="/* optional offline XLSX library unavailable */", content_type="application/javascript")
                return
            if url.hostname != "mars-presentation.test":
                self.blocked.append(route.request.url)
                route.abort()
                return
            asset = (ROOT / "dist" / (unquote(url.path).lstrip("/") or "index.html")).resolve()
            if not asset.is_relative_to(ROOT / "dist") or not asset.is_file():
                route.fulfill(status=404, body="not found")
                return
            content = asset.read_bytes()
            if asset.name == "app.js":
                content = seed.encode() + content
            route.fulfill(status=200, body=content, content_type=mimetypes.guess_type(asset.name)[0] or "application/octet-stream")

        self.context.route("**/*", route_request)
        self.page = self.context.new_page()
        self.page.set_default_timeout(8000)
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.clock.install(time=NOW)
        self.page.goto(ORIGIN + "/", wait_until="load")
        try:
            self.page.wait_for_selector("#app .layout")
        except Exception as error:
            self.context.close()
            raise AssertionError(("app startup failed", self.errors)) from error
        self.initial = self.state()
        self.protected = self.protected_storage()
        self.financial = self.page.evaluate("JSON.stringify(state.operations)")
        self.baseline = self.finance()

    def state(self):
        return self.page.evaluate("JSON.parse(JSON.stringify(state))")

    def stored(self):
        return self.page.evaluate("key=>localStorage.getItem(key)", self.active)

    def protected_storage(self):
        return self.page.evaluate("key=>Object.fromEntries(Object.keys(localStorage).filter(k=>k!==key&&k!=='mars-demo-manager').map(k=>[k,localStorage.getItem(k)]))", self.active)

    def finance(self):
        return self.page.evaluate("({company:overallFinance(),machines:Object.fromEntries(machines.map(m=>[m.id,{income:sums([m]).income,expense:sums([m]).expense,result:result(m)}]))})")

    def role(self, value):
        self.page.locator("#role").select_option(value)
        self.page.wait_for_function("expected=>view===expected", arg=LANDINGS[value.split(":")[0]])

    def nav(self, target):
        shell = ".mobile-nav" if self.width < 760 else ".sidebar"
        control = self.page.locator(f"{shell} [data-nav='{target}']")
        if not control.count():
            self.page.locator(f"{shell} [data-nav='more']").click()
            control = self.page.locator(f".more-card[data-nav='{target}']")
        control.click()
        self.page.wait_for_function("expected=>view===expected", arg=target)

    def close_modal(self):
        self.page.locator(".modal [data-close-modal]").click()
        self.page.wait_for_selector(".modal", state="detached")

    def geometry(self, modal=False, targets=False):
        result = self.page.evaluate(r"""({modal,targets})=>{
 const root=modal?document.querySelector('.modal'):document.documentElement;
 const content=modal?root.querySelector('.modal-content'):root;
 const bounds=content.getBoundingClientRect();
 const overflow=modal?[...content.querySelectorAll('input:not([type=checkbox]):not([type=file]),select,textarea')].filter(e=>e.offsetParent!==null).filter(e=>{const r=e.getBoundingClientRect();return r.left<bounds.left-1||r.right>bounds.right+1;}).map(e=>e.name||e.id):[];
 const targetSelector=modal?'button,select,input:not([type=checkbox]):not([type=file]),textarea,label.btn,label:has(input[type=checkbox])':'#role,.mobile-nav button,.accountant-control,.accountant-action,[data-accountant-tab]';
 const controls=targets?[...root.querySelectorAll(targetSelector)].filter(e=>e.offsetParent!==null&&!e.disabled).filter(e=>{const r=e.getBoundingClientRect();return r.width>1&&r.height>1&&r.width<innerWidth+1;}):[];
 const small=controls.filter(e=>e.getBoundingClientRect().height<43.5).map(e=>({tag:e.tagName,name:e.name||e.id||e.textContent.trim().slice(0,60),height:e.getBoundingClientRect().height}));
 const close=modal?root.querySelector('[data-close-modal]').getBoundingClientRect():null;
 return {documentOverflow:document.documentElement.scrollWidth-innerWidth,modalOverflow:modal?root.scrollWidth-root.clientWidth:0,overflow,small,closeVisible:!close||(close.top>=0&&close.bottom<=innerHeight)};
}""", {"modal": modal, "targets": targets})
        assert result["documentOverflow"] <= 2, (self.name, result)
        assert result["modalOverflow"] <= 2 and not result["overflow"], (self.name, result)
        assert result["closeVisible"], (self.name, result)
        assert not result["small"], (self.name, result)

    def fail_writes(self):
        self.page.evaluate("key=>{window.presentationOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('synthetic quota','QuotaExceededError');return window.presentationOriginalSetItem.call(this,k,v);};}", self.active)

    def restore_writes(self):
        self.page.evaluate("() => {Storage.prototype.setItem=window.presentationOriginalSetItem;}")

    def reload(self):
        before = self.state()
        self.page.reload(wait_until="load")
        self.page.wait_for_selector("#app .layout")
        assert self.state() == before, (self.name, "state changed after reload")

    def finish(self, finance_unchanged=True):
        assert self.protected_storage() == self.protected, (self.name, "working/inactive/archive storage changed")
        if finance_unchanged:
            assert self.page.evaluate("JSON.stringify(state.operations)") == self.financial
            assert self.finance() == self.baseline, (self.name, "financial calculator changed")
        assert not self.errors, (self.name, self.errors)
        assert not self.blocked, (self.name, self.blocked)
        self.context.close()


def landing(s, selected):
    s.role(selected)
    base = selected.split(":")[0]
    expected = PRIMARY[base]
    assert s.page.locator(".sidebar .nav-button").evaluate_all("es=>es.map(e=>e.dataset.nav)") == expected + ["more"]
    assert s.page.locator(".mobile-nav [data-nav]").evaluate_all("es=>es.map(e=>e.dataset.nav)") == expected[:4] + ["more"]
    if base in ["operator", "accountant"]:
        assert s.page.locator("#global-search").count() == 0
    if base == "accountant":
        assert s.page.locator("#period").count() == 0
    if base == "operator":
        assert s.page.locator(".heading-actions [data-action='add-service']").count() == 0
        assert s.page.locator("[data-action='add-shift']").is_visible()
    if s.width < 760:
        s.geometry(targets=True)
    for target in expected:
        s.nav(target)
        if s.width < 760:
            s.geometry(targets=True)
    s.nav("more")
    assert set(s.page.locator(".more-card").evaluate_all("es=>es.map(e=>e.dataset.nav)")) == set(s.page.evaluate("allowed[role]"))
    s.finish()


def manager_story(s):
    s.role("dispatcher:" + MANAGERS[0])
    original_requests = s.state()["equipmentRequests"]
    s.page.locator("[data-action='add-request']").click()
    form = s.page.locator("#request-form")
    form.locator("[name=customer]").fill("Синтетический заказ браузерной проверки")
    form.locator("[name=contact]").fill("Синтетический контакт")
    form.locator("[name=phone]").fill("+7 000 000-00-00")
    form.locator("[name=comment]").fill("Свободная JCB после действующей заявки")
    form.locator("[name=machine]").select_option("M002")
    form.locator("[name=operator]").select_option("Михаил Иванов")
    form.locator("[name=start]").fill(day(3) + "T08:00")
    form.locator("[name=end]").fill(day(3) + "T18:00")
    s.geometry(modal=True, targets=True)
    form.locator("[type=submit]").click()
    s.page.wait_for_selector("#request-form", state="detached")
    record = s.state()["equipmentRequests"][-1]
    assert record["owner"] == MANAGERS[0] and record["items"][0]["machine"] == "M002"
    assert s.state()["equipmentRequests"][:-1] == original_requests
    assert s.page.locator(f".request-calendar-booking[data-request-open='{record['id']}']").count() == 1
    s.role("dispatcher:" + MANAGERS[1])
    before, stored = s.state(), s.stored()
    s.page.locator(f".request-calendar-booking[data-request-open='{record['id']}']").click()
    assert s.page.locator(".request-details").is_visible()
    assert s.page.locator(".modal input,.modal select,.modal textarea,.modal form").count() == 0
    assert all(text in s.page.locator(".request-details").inner_text() for text in [MANAGERS[0], record["number"], "M002", "Синтетический контакт", "+7 000", "Журнал изменений"])
    s.geometry(modal=True, targets=True)
    s.close_modal()
    assert s.state() == before and s.stored() == stored
    assert s.page.locator("[data-action='add-service'],[data-approve],[data-return]").count() == 0
    s.page.evaluate("repairForm();handleAction('add-service');approveShift('shift-101');")
    assert s.page.locator("#repair-form").count() == 0
    assert s.state() == before and s.stored() == stored
    s.role("mechanic")
    s.nav("requests")
    assert s.page.locator("[data-action='add-request']").count() == 0
    for request in s.state()["equipmentRequests"]:
        assert s.page.locator(f"[data-request-open='{request['id']}']").count() > 0
    s.page.locator(f".request-calendar-booking[data-request-open='{record['id']}']").click()
    assert s.page.locator(".request-details").is_visible()
    assert s.page.locator(".modal input,.modal select,.modal textarea,.modal form").count() == 0
    s.close_modal()
    before, stored = s.state(), s.stored()
    s.page.evaluate("requestModal();handleAction('add-request');")
    assert s.page.locator("#request-form").count() == 0
    assert s.state() == before and s.stored() == stored
    s.page.locator("[data-calendar-repair-machine='M008']").first.click()
    assert s.page.locator(".calendar-repair-details").is_visible()
    assert "Ремонт гидравлики" in s.page.locator(".calendar-repair-details").inner_text()
    assert s.page.locator(".modal input,.modal select,.modal textarea,.modal form").count() == 0
    s.geometry(modal=True, targets=True)
    s.close_modal()
    assert s.state() == before and s.stored() == stored
    s.reload()
    s.finish()


def mechanic_story(s):
    s.role("mechanic")
    requests, original_repairs = s.state()["equipmentRequests"], s.state()["maintenance"]
    s.page.locator("[data-action='add-service']").click()
    form = s.page.locator("#repair-form")
    form.locator("[name=machine]").select_option("M010")
    form.locator("[name=type]").fill("Браузерная проверка ремонта")
    form.locator("[name=note]").fill("Проверка перед будущей подачей техники")
    form.locator("[name=assignee]").select_option("Демо · Механик № 1")
    form.locator("[name=dueDate]").fill(day(5))
    warning = s.page.locator("#repair-booking-warning")
    assert warning.is_visible()
    assert "ЗТ-0005" in warning.inner_text() and MANAGERS[1] in warning.inner_text()
    assert len(s.state()["maintenance"]) == len(original_repairs)
    assert s.state()["equipmentRequests"] == requests
    s.geometry(modal=True, targets=True)
    before, stored = s.state(), s.stored()
    s.fail_writes()
    form.locator("[type=submit]").click()
    assert s.state() == before and s.stored() == stored
    assert form.is_visible() and warning.is_visible()
    assert form.locator("[name=type]").input_value() == "Браузерная проверка ремонта"
    assert "Не удалось сохранить" in s.page.locator("#form-error").inner_text()
    s.restore_writes()
    form.locator("[type=submit]").click()
    s.page.wait_for_selector("#repair-form", state="detached")
    repair = s.state()["maintenance"][-1]
    assert repair["status"] == "new" and repair["machine"] == "M010" and repair["blocking"]
    assert s.page.evaluate("machine('M010').status") == "repair"
    assert s.state()["maintenance"][:-1] == original_repairs and s.state()["equipmentRequests"] == requests
    if not s.page.locator("#repair-update-form").count():
        s.page.locator(f"[data-repair='{repair['id']}']").first.click()
    update = s.page.locator("#repair-update-form")
    assert "ЗТ-0005" in s.page.locator("#repair-update-booking-warning").inner_text()
    update.locator("[name=status]").select_option("progress")
    update.locator("[type=submit]").click()
    s.page.wait_for_function("id=>state.maintenance.find(r=>r.id===id).status==='progress'", arg=repair["id"])
    s.page.locator("#repair-complete").click()
    close = s.page.locator("#repair-close-form")
    close.locator("[name=result]").fill("Работы выполнены; требуется отдельный допуск")
    close.locator("[type=submit]").click()
    s.page.wait_for_selector("#repair-close-form", state="detached")
    closed = next(r for r in s.state()["maintenance"] if r["id"] == repair["id"])
    assert closed["status"] == "done" and closed["blocking"] and not closed["readyConfirmed"]
    assert s.page.evaluate("machine('M010').status") == "repair"
    if not s.page.locator("#repair-release").count():
        s.page.locator(f"[data-repair='{repair['id']}']").first.click()
    s.page.locator("#repair-release").click()
    expected_released_status = "free" if s.mode == "demo" else "unknown"
    assert s.page.evaluate("machine('M010').status") == expected_released_status
    s.close_modal()
    s.role("dispatcher:" + MANAGERS[0])
    assert s.page.locator(".request-calendar-booking[data-request-open='req-0005']").count() > 0
    # Closed repair history remains readable; its uncertainty markers disappear
    # after the mechanic confirms release. The future booking remains intact.
    assert s.page.locator(".request-calendar-repair.uncertain[data-calendar-repair-machine='M010']").count() == 0
    assert s.state()["equipmentRequests"] == requests
    s.reload()
    assert s.page.evaluate("machine('M010').status") == expected_released_status
    s.finish()


def operator_story(s):
    s.role("operator")
    assert s.page.locator("[data-action='add-service'],[data-approve],[data-return]").count() == 0
    s.page.locator("[data-action='add-shift']").click()
    form = s.page.locator("#shift-form")
    assert form.locator("[name=machine]").input_value() == "M001"
    assert form.locator("[name=meter]").input_value() == "1256"
    assert form.locator("[name=meter]").get_attribute("min") == "1256"
    form.locator("[name=date]").fill(day(-1))
    form.locator("[name=hours]").fill("7.5")
    form.locator("[name=meter]").fill("1264")
    form.locator("[name=condition]").select_option("issue")
    form.locator("[name=note]").fill("Синтетическое замечание: требуется осмотр гидравлики")
    s.geometry(modal=True, targets=True)
    before, stored = s.state(), s.stored()
    s.fail_writes()
    form.locator("[type=submit]").click()
    assert s.state() == before and s.stored() == stored
    assert form.is_visible() and form.locator("[name=hours]").input_value() == "7.5"
    assert "Не удалось сохранить" in s.page.locator("#form-error").inner_text()
    s.restore_writes()
    form.locator("[type=submit]").click()
    s.page.wait_for_selector("#shift-form", state="detached")
    shift = s.state()["shifts"][-1]
    assert {k: shift[k] for k in ["machine", "date", "hours", "meter", "condition", "status"]} == {"machine": "M001", "date": day(-1), "hours": 7.5, "meter": 1264, "condition": "issue", "status": "pending"}
    repair = next(r for r in s.state()["maintenance"] if r["id"] == shift["repairId"])
    assert repair["sourceShift"] == shift["id"] and repair["note"] == shift["note"]
    assert len(s.state()["shifts"]) == len(before["shifts"]) + 1
    assert len(s.state()["maintenance"]) == len(before["maintenance"]) + 1
    assert s.page.locator("[data-approve],[data-return]").count() == 0
    guarded, saved = s.state(), s.stored()
    s.page.evaluate("id=>approveShift(id)", shift["id"])
    s.page.evaluate("repairForm();handleAction('add-service');")
    assert s.state() == guarded and s.stored() == saved and s.page.locator("#repair-form").count() == 0
    s.nav("maintenance")
    assert s.page.locator(f"[data-repair='{repair['id']}']").count() > 0
    s.page.locator(f"[data-repair='{repair['id']}']").first.click()
    assert "Синтетическое замечание" in s.page.locator(".modal").inner_text()
    assert s.page.locator("#repair-update-form,#repair-complete,#repair-release").count() == 0
    s.close_modal()
    s.reload()
    assert next(x for x in s.state()["shifts"] if x["id"] == shift["id"])["status"] == "pending"
    s.finish()


def upload(s, payload, name="synthetic.csv", mime="text/csv"):
    s.page.set_input_files("#accountant-file", {"name": name, "mimeType": mime, "buffer": payload})
    s.page.wait_for_function("accountantPreview!==null||document.querySelector('#accountant-preview').textContent.includes('Ошибка импорта')")
    parsed = s.page.evaluate("accountantPreview&&({rows:accountantPreview.rows.length,processed:accountantPreview.processed.length,review:accountantPreview.review.length,errors:accountantPreview.errors})")
    assert parsed is not None, s.page.locator("#accountant-preview").inner_text()
    assert parsed["errors"] == [], parsed
    return parsed


def accountant_story(s):
    s.role("accountant")
    assert s.page.locator("#global-search,#period").count() == 0
    row = f"{DAY};M002;Ремонт и ТО;137;Синтетический документ браузера;TEST-001;test-document-001;1;synthetic-browser;\n"
    payload = (CSV_HEADER + row).encode()
    before, stored = s.state(), s.stored()
    assert upload(s, payload) == {"rows": 1, "processed": 0, "review": 0, "errors": []}
    assert s.state() == before and s.stored() == stored, "preview must not commit"
    s.geometry(targets=True)
    s.page.locator("#accountant-confirm").click()
    s.page.wait_for_function("accountantPreview===null&&accountantTab==='history'")
    after = s.state()
    assert after["operations"][:2] == before["operations"]
    assert len(after["operations"]) == 3 and after["operations"][-1]["amount"] == 137
    assert s.finance()["company"] == {"income": 10000, "expense": 174}
    s.page.locator("[data-accountant-tab='upload']").click()
    assert upload(s, payload, "renamed-identical.csv") == {"rows": 0, "processed": 1, "review": 0, "errors": []}
    assert "Уже обработано" in s.page.locator("#accountant-preview").inner_text()
    s.page.locator("#accountant-confirm").click()
    s.page.wait_for_function("accountantPreview===null&&accountantTab==='history'")
    assert len(s.state()["operations"]) == 3
    s.reload()
    assert s.finance()["company"] == {"income": 10000, "expense": 174}
    for key in ["equipmentRequests", "maintenance", "shifts", "purchaseRequests", "stock", "stockMoves"]:
        assert s.state()[key] == before[key], key
    s.role("accountant")
    s.page.locator("[data-accountant-tab='upload']").click()
    if XLSX.is_file():
        # Produce a genuine ZIP-based workbook using the real loaded SheetJS
        # library, then exercise the browser File input and async parser.
        workbook = s.page.evaluate("csv=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(csv.trim().split('\\n').map(r=>r.split(';'))),'Расходы');return Array.from(new Uint8Array(XLSX.write(book,{bookType:'xlsx',type:'array'})));}", CSV_HEADER + row.replace("137", "251").replace("001", "xlsx", 2))
        before, stored = s.state(), s.stored()
        parsed = upload(s, bytes(workbook), "synthetic-real.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        assert parsed["rows"] == 1 and parsed["processed"] == 0
        assert s.state() == before and s.stored() == stored
        print("  XLSX real-library file preview passed (not confirmed)", flush=True)
    else:
        print("  SKIP real XLSX preview: set MARS_XLSX_PATH to an offline SheetJS 0.18.5 library", flush=True)
    s.finish(finance_unchanged=False)


def director_story(s):
    assert s.baseline["company"] == {"income": 6660000, "expense": 3472000}
    assert len(s.initial["operations"]) == 120
    expected = s.page.evaluate("({late:state.maintenance.filter(r=>r.status!=='done'&&r.dueDate&&r.dueDate<today()).length,blocked:machines.filter(m=>m.status==='repair').length,pending:state.shifts.filter(x=>x.status==='pending').length,due:requestList().filter(requestNeedsFollowup).length,unallocated:unallocatedExpenses().length,loss:machines.filter(m=>result(m)<0).length,stock:state.stock.filter(p=>p.qty<p.min).length,purchases:state.purchaseRequests.filter(p=>p.status==='На согласовании').length})")
    assert expected == {"late": 0, "blocked": 1, "pending": 2, "due": 0, "unallocated": 0, "loss": 0, "stock": 1, "purchases": 1}, expected
    assert s.page.locator(".director-operational .stat-value").all_inner_texts() == ["10", "3"]
    statuses = {"Свободны": 4 if s.mode == "demo" else 0, "Зарезервированы, без смены сегодня": 2, "Ремонт / нет допуска": 1, "Смена сегодня, без блокировки": 3}
    if s.mode == "working":
        statuses["Статус не подтверждён"] = 4
    for label, value in statuses.items():
        assert s.page.locator(".director-operational .status-card").filter(has_text=label).locator("strong").inner_text() == str(value)
    assert sum(statuses.values()) == 10
    assert s.page.locator(".attention-row .attention").all_inner_texts() == ["На ремонте: 1 →", "Смены на проверке: 2 →", "Закупки на согласовании: 1 →"]
    money = s.page.locator('[aria-label="Показатели компании"] .stat-value').all_inner_texts()
    assert money[:3] == [s.page.evaluate("n=>rub(n)", n) for n in [6660000, 3472000, 3188000]], money
    for selected in ROLES:
        s.role(selected)
        for target in PRIMARY[selected.split(":")[0]]:
            s.nav(target)
    s.role("director")
    assert s.page.locator('[aria-label="Показатели компании"] .stat-value').all_inner_texts() == money
    s.nav("finance")
    s.page.locator(".tabs [data-nav='efficiency']").click()
    assert s.page.evaluate("view") == "efficiency"
    assert s.finance() == s.baseline
    s.reload()
    s.finish()


def accountant_controls(s):
    s.role("accountant")
    before, stored = s.state(), s.stored()
    s.page.locator("[data-accountant-tab='allocation']").click()
    s.geometry(targets=True)
    s.page.locator(".accountant-reconcile[data-id='review-imported']").click()
    assert s.page.locator("#accountant-existing-review").is_visible()
    s.geometry(modal=True, targets=True)
    s.close_modal()
    s.page.locator(".accountant-assign[data-id='review-overhead']").select_option("M001")
    s.page.locator(".accountant-assign-save[data-id='review-overhead']").click()
    assert s.page.locator("#accountant-assignment-review").is_visible()
    s.geometry(modal=True, targets=True)
    s.close_modal()
    s.page.locator("[data-accountant-tab='history']").click()
    s.geometry(targets=True)
    s.page.locator("[data-accountant-tab='upload']").click()
    payload = (CSV_HEADER + f"{DAY};M002;Синтетический расход;137;Проверка сверки;TEST-REVIEW;preview-review;1;synthetic-browser;\n").encode()
    assert upload(s, payload)["review"] == 1
    assert s.page.locator("#accountant-preview .accountant-control").count() == 2
    s.geometry(targets=True)
    assert s.state() == before and s.stored() == stored
    s.finish()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", default="", help="Run scenario names containing this text")
    args = parser.parse_args()
    passed, failed = 0, []
    with sync_playwright() as playwright:
        executable = os.environ.get("MARS_CHROMIUM_PATH") or ("/usr/bin/chromium" if Path("/usr/bin/chromium").is_file() else None)
        browser = playwright.chromium.launch(executable_path=executable, headless=True, args=["--no-sandbox"])
        scenarios = []
        for mode in KEYS:
            for width in [320, 390, 1280]:
                for selected in ROLES:
                    scenarios.append((mode, width, f"role {selected} landing/navigation {width}px", lambda s, selected=selected: landing(s, selected), False))
            scenarios.extend([
                (mode, 390, "manager future-free booking / foreign readonly / mechanic calendar guards", manager_story, False),
                (mode, 320, "mechanic booking warning / failed save retry / close zero / release", mechanic_story, False),
                (mode, 390, "operator meter floor / actual issue shift / failed save retry / reload", operator_story, False),
                (mode, 320, "accountant isolated CSV confirm / repeat / reload / optional XLSX preview", accountant_story, True),
                (mode, 320, "accountant mobile allocation / existing review / reassignment / preview controls", accountant_controls, "review"),
                (mode, 1280, "director operational counts / original financial totals / all role navigation", director_story, False),
            ])
        for mode, width, name, run, accounting in scenarios:
            full_name = mode + " " + name
            if args.case and args.case not in full_name:
                continue
            scenario = None
            try:
                scenario = Scenario(browser, mode, width, name, accounting=accounting)
                run(scenario)
                passed += 1
                print("PASS", full_name, flush=True)
            except Exception as error:
                failed.append(full_name)
                print("FAIL", full_name, type(error).__name__, str(error), flush=True)
                if scenario:
                    scenario.context.close()
        browser.close()
    print(f"PASSED {passed}; FAILED {len(failed)} isolated Chromium scenarios", flush=True)
    print("Coverage: original demo + working mode, six role choices, 320/390/1280 navigation, real forms/calendar/file inputs, save failure/retry/reload, protected storage and unchanged original finance. No live backend, employee authentication, or device-specific iOS/Android keyboard behavior is exercised.", flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
