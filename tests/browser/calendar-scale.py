#!/usr/bin/env python3
"""Offline calendar scale benchmark; timings are diagnostic, without thresholds.

Prerequisites: Node, Python with Playwright, and Chromium. No packages are installed.
Run: python tests/browser/calendar-scale.py --report /tmp/mars-scale-benchmark.json
Storage only: add --storage-only to preserve an existing render report and probe
real localStorage capacity in fresh HTTPS browser contexts without app startup.
Set MARS_CHROMIUM_PATH to select a browser; otherwise /usr/bin/chromium or the
installed Playwright Chromium is used. All browser traffic is intercepted locally.
"""

import argparse
import json
import os
import pathlib
import platform
import statistics
import subprocess
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright


ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = "http://mars-scale.test"
FIXED = "2026-11-09T12:00:00.000Z"
STORAGE_ORIGIN = "https://mars-scale-capacity.test"
STORAGE_KEY = "mars-scale-capacity-probe-v1"
CASES = [("representative", n, None) for n in (100, 250, 500)] + [
    ("dense-active", 500, 5000)
]


def fixture(machine_count, active_count):
    options = {
        "machineCount": machine_count,
        "requestCount": 5000,
        "repairCount": 2000,
        "baseDate": FIXED[:10],
    }
    if active_count is not None:
        options["activeRequestCount"] = active_count
    script = (
        "process.stdout.write(JSON.stringify("
        "require('./tests/fixtures/fleet-scale.cjs').createFleetScaleState("
        + json.dumps(options)
        + ")))"
    )
    return json.loads(subprocess.check_output(["node", "-e", script], cwd=ROOT))


def route_offline(route):
    url = urlparse(route.request.url)
    if url.netloc != "mars-scale.test":
        route.abort()
        return
    requested = unquote(url.path.lstrip("/")) or "index.html"
    file = (ROOT / "dist" / requested).resolve()
    if not file.is_file() or not file.is_relative_to(ROOT / "dist"):
        route.fulfill(status=404, body="Not found")
        return
    mime = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
        ".png": "image/png",
    }.get(file.suffix, "application/octet-stream")
    route.fulfill(status=200, content_type=mime, body=file.read_bytes())


def ms_summary(values):
    return {
        "samples": values,
        "median": round(statistics.median(values), 2),
        "min": round(min(values), 2),
        "max": round(max(values), 2),
    }


def bound_card_clicks(page):
    """Time actual bound calendar buttons and check that readonly cards preserve data."""
    before = page.evaluate("JSON.stringify(state)")
    request_samples, request_checks, repair_samples, repair_checks = [], [], [], []
    for _ in range(3):
        result = page.evaluate("""()=>{
          const btn=document.querySelector('.requests-calendar [data-request-open="request-scale-00002"]');
          const started=performance.now();btn.click();
          return {ms:performance.now()-started,readOnly:!document.querySelector('#request-form'),
            numberVisible:document.querySelector('#modal-root').innerText.includes('ЗТ-НАГРУЗКА-00002'),
            hasHistory:Boolean(document.querySelector('.request-history-entry'))};
        }""")
        request_samples.append(round(result.pop("ms"), 2))
        request_checks.append(result)
        page.evaluate("closeModal(false)")
    for _ in range(3):
        result = page.evaluate("""()=>{
          const btn=document.querySelector('.requests-calendar [data-calendar-repair-machine]');
          const started=performance.now();btn.click();
          return {ms:performance.now()-started,
            readOnly:!document.querySelector('#modal-root input,#modal-root select,#modal-root textarea'),
            repairCards:document.querySelectorAll('.calendar-repair-card').length};
        }""")
        repair_samples.append(round(result.pop("ms"), 2))
        repair_checks.append(result)
        page.evaluate("closeModal(false)")
    return {
        "requestReadOnlyBoundClick": {**ms_summary(request_samples), "checks": request_checks},
        "repairReadOnlyBoundClick": {**ms_summary(repair_samples), "checks": repair_checks},
        "readOnlyCardsPreserveData": before == page.evaluate("JSON.stringify(state)"),
    }


def probe_storage_capacity(browser, scenario, machine_count, active_count):
    """Use an empty origin and default browser quotas; never read application data."""
    context = browser.new_context()

    def isolated_page(route):
        if route.request.url == STORAGE_ORIGIN + "/":
            route.fulfill(status=200, content_type="text/html", body="<!doctype html><title>Isolated storage capacity probe</title>")
        else:
            route.abort()

    context.route("**/*", isolated_page)
    page = context.new_page()
    page.goto(STORAGE_ORIGIN, wait_until="domcontentloaded")
    data = fixture(machine_count, active_count)
    result = page.evaluate("""({data,key})=>{
      const initialKeyCount=localStorage.length,encoded=JSON.stringify(data);
      const result={origin:location.origin,initialKeyCount,keyCharacters:key.length,
        jsonCharacters:encoded.length,jsonUtf8Bytes:new TextEncoder().encode(encoded).length,
        stringifyMs:null,writeMs:null,readMs:null,parseMs:null,equalityMs:null,
        writeSucceeded:false,readEqualsWritten:false,parsedEqualsWritten:false,error:null};
      const stringifyStarted=performance.now();JSON.stringify(data);
      result.stringifyMs=performance.now()-stringifyStarted;
      const started=performance.now();let phase='write',phaseStarted=started;
      try {
        // A new context must start empty; do not remove any unrelated keys.
        if(initialKeyCount!==0)throw new Error('Storage probe origin was not empty');
        localStorage.setItem(key,encoded);
        result.writeMs=performance.now()-phaseStarted;result.writeSucceeded=true;
        phase='read';phaseStarted=performance.now();const restored=localStorage.getItem(key);
        result.readMs=performance.now()-phaseStarted;result.readEqualsWritten=restored===encoded;
        phase='parse';phaseStarted=performance.now();const parsed=JSON.parse(restored);
        result.parseMs=performance.now()-phaseStarted;
        phase='equality';phaseStarted=performance.now();result.parsedEqualsWritten=JSON.stringify(parsed)===encoded;
        result.equalityMs=performance.now()-phaseStarted;
      } catch(error) {
        result.error={name:error.name,message:error.message,phase,
          phaseElapsedMs:performance.now()-phaseStarted};
      } finally {
        result.totalAttemptMs=performance.now()-started;
        localStorage.removeItem(key);
        result.finalKeyCount=localStorage.length;
        result.probeKeyRemoved=localStorage.getItem(key)===null;
      }
      return result;
    }""", {"data": data, "key": STORAGE_KEY})
    context.close()
    return {
        "scenario": scenario, "machines": len(data["machines"]),
        "requests": len(data["equipmentRequests"]),
        "activeRequests": sum(r["status"] != "Отменена" and not r["releaseConfirmed"] for r in data["equipmentRequests"]),
        "repairs": len(data["maintenance"]), **result,
    }


def benchmark_case(browser, scenario, machine_count, active_count):
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
    context.route("**/*", route_offline)
    context.add_init_script("""(() => {
      const fixed=Date.parse('""" + FIXED + """'),ActualDate=Date;
      window.Date=class extends ActualDate {
        constructor(...args){super(...(args.length?args:[fixed]));}
        static now(){return fixed;}
      };
    })();""")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_function("typeof requestsPage==='function' && typeof calendarRepairIndex==='function' && document.querySelector('#role')")
    data = fixture(machine_count, active_count)
    counts = {
        "machines": len(data["machines"]),
        "requests": len(data["equipmentRequests"]),
        "activeRequests": sum(r["status"] != "Отменена" and not r["releaseConfirmed"] for r in data["equipmentRequests"]),
        "repairs": len(data["maintenance"]),
        "blockingUnreleasedRepairs": sum(r["blocking"] and not r["readyConfirmed"] for r in data["maintenance"]),
    }
    # Warm data in memory: this benchmark measures rendering, not storage startup.
    page.evaluate("""data=>{
      replaceState(data);initializeWorkshop();role='dispatcher';
      localStorage.setItem('mars-demo-manager','Алексей Иванов');view='requests';render();
    }""", data)
    page.wait_for_selector(".requests-calendar tbody tr")
    render_samples, layout_samples = [], []
    for _ in range(5):
        result = page.evaluate("""async()=>{
          const started=performance.now();render();const js=performance.now()-started;
          document.querySelector('.requests-calendar').getBoundingClientRect();
          await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
          return {js,total:performance.now()-started};
        }""")
        render_samples.append(round(result["js"], 2))
        layout_samples.append(round(result["total"], 2))
    filter_samples, filter_matches = [], None
    for _ in range(5):
        result = page.evaluate("""()=>{
          const started=performance.now(),owner='Алексей Иванов',query='заказчик';
          const matches=requestList().filter(r=>r.owner===owner&&
            `${r.number} ${r.customer} ${r.object}`.toLocaleLowerCase('ru').includes(query));
          return {ms:performance.now()-started,count:matches.length};
        }""")
        filter_samples.append(round(result["ms"], 2))
        filter_matches = result["count"]
    dom = page.evaluate("""()=>{
      const grid=document.querySelector('.requests-calendar'),table=grid.querySelector('table');
      const scroll=grid.querySelector('.table-scroll'),rect=table.getBoundingClientRect();
      return {elements:document.querySelectorAll('*').length,calendarElements:grid.querySelectorAll('*').length,
        calendarRows:table.tBodies[0].rows.length,calendarCells:table.querySelectorAll('tbody td').length,
        requestButtons:grid.querySelectorAll('[data-request-open]').length,
        repairButtons:grid.querySelectorAll('[data-calendar-repair-machine]').length,
        bodyScrollHeight:document.documentElement.scrollHeight,tableWidth:Math.round(rect.width),
        scrollClientWidth:scroll.clientWidth,scrollWidth:scroll.scrollWidth};
    }""")
    scroll = page.evaluate("""async()=>{
      const box=document.querySelector('.requests-calendar .table-scroll'),started=performance.now();
      box.scrollLeft=box.scrollWidth;window.scrollTo(0,document.documentElement.scrollHeight);
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const result={ms:performance.now()-started,scrollLeft:box.scrollLeft,scrollTop:window.scrollY};
      window.scrollTo(0,0);return result;
    }""")
    request_id = page.locator(".requests-calendar [data-request-open]").first.get_attribute("data-request-open")
    request_open = page.evaluate("""id=>{
      const started=performance.now();requestModal(id);
      return {ms:performance.now()-started,title:document.querySelector('#modal-title').innerText,
        requestId:id,historyCount:document.querySelectorAll('.request-history-entry').length,
        hasForm:Boolean(document.querySelector('#request-form'))};
    }""", request_id)
    page.evaluate("closeModal(false)")
    repair_button = page.locator(".requests-calendar [data-calendar-repair-machine]").first
    repair_open = None
    if repair_button.count():
        repair_open = page.evaluate("""args=>{
          const started=performance.now();openCalendarRepairs(args[0],args[1]);
          return {ms:performance.now()-started,title:document.querySelector('#modal-title').innerText,
            machineId:args[0],repairLinks:document.querySelectorAll('#modal-root [data-repair]').length,
            formControls:document.querySelectorAll('#modal-root input,#modal-root select,#modal-root textarea').length};
        }""", [repair_button.get_attribute("data-calendar-repair-machine"), repair_button.get_attribute("data-calendar-repair-day") or ""])
        page.evaluate("closeModal(false)")
    card_checks = bound_card_clicks(page)
    integrity = page.evaluate("""()=>{
      const m=machines[0],id=m.id,r=requestList().find(r=>r.items.some(x=>x.machine===id));
      const repair=state.maintenance.find(r=>r.machine===id);
      m.name='Переименованная машина';m.inventory='ДРУГОЙ-НОМЕР';render();
      const html=document.querySelector('.requests-calendar').outerHTML;
      return {machineId:id,requestId:r?.id,requestMachineMatches:r?.items.some(x=>x.machine===id),
        repairMachineMatches:repair?.machine===id,renamedLabelVisible:html.includes('Переименованная машина'),
        requestLinkStillPresent:r?html.includes('data-request-open="'+r.id+'"'):false};
    }""")
    result = {
        "scenario": scenario, **counts,
        "renderAndBindMs": ms_summary(render_samples),
        "renderThroughLayoutTwoFramesMs": ms_summary(layout_samples),
        "ownerAndTextArrayFilterMs": ms_summary(filter_samples),
        "filterMatches": filter_matches, "requestOpen": request_open,
        "repairOpen": repair_open, "dom": dom, "scroll": scroll,
        "stableIdRenameCheck": integrity, **card_checks, "pageErrors": errors,
    }
    context.close()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=pathlib.Path, default=pathlib.Path("/tmp/mars-scale-benchmark.json"))
    parser.add_argument("--storage-only", action="store_true", help="Probe default localStorage capacity only; preserve any existing render results")
    args = parser.parse_args()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    executable = os.environ.get("MARS_CHROMIUM_PATH")
    if not executable and pathlib.Path("/usr/bin/chromium").is_file():
        executable = "/usr/bin/chromium"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=executable, headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-crash-reporter"])
        report = {"environment": {
            "browser": browser.version, "platform": platform.platform(),
            "viewport": "1440x1000", "clock": FIXED,
            "method": "Offline intercepted dist; warm in-memory data; five measured renders after one warmup; three readonly bound card clicks; no remote/Timeweb access; timings hardware-specific, no pass threshold.",
        }, "cases": []}
        if args.storage_only and args.report.is_file():
            report = json.loads(args.report.read_text())
        if not args.storage_only:
            for scenario, count, active_count in CASES:
                result = benchmark_case(browser, scenario, count, active_count)
                report["cases"].append(result)
                args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2))
                print(json.dumps(result, ensure_ascii=False), flush=True)
        report["storageProbeEnvironment"] = {
            "browser": browser.version, "platform": platform.platform(),
            "origin": STORAGE_ORIGIN,
            "method": "Fresh isolated HTTPS browser context per case; empty origin; generated data without photos; real localStorage setItem/getItem and JSON equality; default browser quota, no quota flags; only probe key removed afterward. Does not measure an app save with other demo/working keys present.",
        }
        report["storageCapacityProbes"] = []
        for scenario, count, active_count in CASES:
            result = probe_storage_capacity(browser, scenario, count, active_count)
            report["storageCapacityProbes"].append(result)
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2))
            print(json.dumps({"storageCapacityProbe": result}, ensure_ascii=False), flush=True)
        browser.close()
    print(str(args.report))


if __name__ == "__main__":
    main()
