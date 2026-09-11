"""
Set filters on an embedded Tableau dashboard with Selenium.

Only dependency: selenium  (plus a browser driver on offline PCs, see README.md)

How it works (tries these in order):
  1. Tableau JavaScript API  - if the page embeds the viz with Tableau's
     Embedding API (v3 <tableau-viz> tag or the older v2 tableau.Viz), we call
     applyFilterAsync() directly. No clicking, no fragile CSS selectors.
  2. URL parameters          - if the page just has a plain <iframe> pointing at
     Tableau, we open that iframe's URL with ?Field=Value1,Value2 added.

Run:
  python tableau_filter.py          apply FILTERS below
  python tableau_filter.py --list   print the real filter field names + values (use these in FILTERS)
"""
import sys
import time
from urllib.parse import quote, urlsplit

from selenium import webdriver
from selenium.webdriver.common.by import By

# ============================ EDIT THESE ====================================
PAGE_URL = "https://your-company-site/page-with-the-dashboard"

# Field names must match Tableau exactly (case-sensitive), values too.
# Run with --list to see the real names - filter card titles can differ.
FILTERS = {
    "Region": ["West", "East"],
    # "Category": ["Furniture"],
}

BROWSER = "edge"        # "edge" or "chrome"
DRIVER_PATH = None      # offline PC: r"C:\tools\msedgedriver.exe"  (None = auto)
PAUSE_FOR_LOGIN = False # True = wait for you to log in / press Enter first
WAIT_SECONDS = 90       # how long to wait for the dashboard to load
SCREENSHOT = "after_filters.png"  # None to skip
# ============================================================================


# Finds the viz via the Tableau JS API (v3 or v2) and wraps the few calls we need
# so the rest of the JS doesn't care which API version the page uses.
FIND_VIZ_JS = r"""
function findViz() {
  const v3 = document.querySelector('tableau-viz');
  const sheet3 = v3 && v3.workbook && v3.workbook.activeSheet;
  if (sheet3) {
    return {api: 'v3', sheets: sheet3.sheetType === 'dashboard' ? sheet3.worksheets : [sheet3],
      name: s => s.name,
      apply: (s, f, vals) => s.applyFilterAsync(f, vals, 'replace'),
      filters: async s => Promise.all((await s.getFiltersAsync()).map(async f => {
        let values = (f.appliedValues || []).map(v => v.formattedValue);
        if (f.filterType === 'categorical' && (f.isAllSelected || !values.length)) {
          try { values = (await f.getDomainAsync('database')).values.map(v => v.formattedValue); } catch (e) {}
        }
        return {field: f.fieldName, type: f.filterType, values: values};
      }))};
  }
  if (window.tableau && tableau.VizManager && tableau.VizManager.getVizs().length) {
    const sheet = tableau.VizManager.getVizs()[0].getWorkbook().getActiveSheet();
    return {api: 'v2', sheets: sheet.getSheetType() === 'dashboard' ? sheet.getWorksheets() : [sheet],
      name: s => s.getName(),
      apply: (s, f, vals) => s.applyFilterAsync(f, vals, tableau.FilterUpdateType.REPLACE),
      filters: async s => (await s.getFiltersAsync()).map(f => ({
        field: f.getFieldName(), type: f.getFilterType(),
        values: (f.getAppliedValues ? f.getAppliedValues() : []).map(v => v.formattedValue)}))};
  }
  return null;
}
"""

# Applies each filter to every worksheet that has that field.
APPLY_FILTERS_JS = FIND_VIZ_JS + r"""
const filters = arguments[0];
const done = arguments[arguments.length - 1];
const viz = findViz();
if (!viz) { done({api: null}); return; }

(async () => {
  const result = {api: viz.api, applied: {}};
  for (const [field, values] of Object.entries(filters)) {
    result.applied[field] = [];
    for (const s of viz.sheets) {
      try { await viz.apply(s, field, values); result.applied[field].push(viz.name(s)); }
      catch (e) { /* this worksheet doesn't use that field - skip it */ }
    }
  }
  done(result);
})().catch(e => done({api: viz.api, error: String(e)}));
"""

# Lists every filter on every worksheet: {sheetName: [{field, type, values}]}
LIST_FILTERS_JS = FIND_VIZ_JS + r"""
const done = arguments[arguments.length - 1];
const viz = findViz();
if (!viz) { done(null); return; }
(async () => {
  const out = {};
  for (const s of viz.sheets) out[viz.name(s)] = await viz.filters(s);
  done(out);
})().catch(e => done({error: String(e)}));
"""

# True once a JS-API viz (v3 or v2) is interactive.
READY_JS = r"""
const v3 = document.querySelector('tableau-viz');
try { if (v3.workbook.activeSheet.sheetType) return true; } catch (e) {}
if (window.tableau && tableau.VizManager) {
  try { tableau.VizManager.getVizs()[0].getWorkbook().getActiveSheet(); return true; } catch (e) {}
}
return false;
"""

# For a plain iframe: load Tableau's v3 Embedding API from the Tableau server itself
# and embed a second copy of the view with it, so we can ask it for filter names.
# (v3 is a module script, so it can be added after page load - v2 can't.)
INJECT_API_JS = r"""
const [apiUrl, viewUrl] = arguments;
const s = document.createElement('script');
s.type = 'module';
s.src = apiUrl;
document.head.appendChild(s);
const viz = document.createElement('tableau-viz');
viz.setAttribute('src', viewUrl);
viz.setAttribute('width', '1000');
viz.setAttribute('height', '800');
document.body.prepend(viz);
"""


def make_driver():
    if BROWSER == "chrome":
        service = webdriver.ChromeService(executable_path=DRIVER_PATH) if DRIVER_PATH else None
        return webdriver.Chrome(service=service)
    service = webdriver.EdgeService(executable_path=DRIVER_PATH) if DRIVER_PATH else None
    return webdriver.Edge(service=service)


def tableau_iframe_src(driver):
    # <tableau-viz> hides its iframe in shadow DOM, but its src attribute is the view URL
    for viz in driver.find_elements(By.CSS_SELECTOR, "tableau-viz[src]"):
        return viz.get_attribute("src")
    for frame in driver.find_elements(By.TAG_NAME, "iframe"):
        src = frame.get_attribute("src") or ""
        if "/views/" in src or "tableau" in src.lower():
            return src
    return None


def wait_for_api(driver, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if driver.execute_script(READY_JS):
            return True
        time.sleep(1)
    return False


def wait_for_dashboard(driver):
    """Poll until the JS API is ready ('api') or only a plain iframe exists ('iframe')."""
    deadline = time.time() + WAIT_SECONDS
    iframe_seen_at = None
    while time.time() < deadline:
        if driver.execute_script(READY_JS):
            return "api"
        if tableau_iframe_src(driver):
            iframe_seen_at = iframe_seen_at or time.time()
            # Give a JS-API viz ~15s to become interactive before treating it as a plain iframe.
            if time.time() - iframe_seen_at > 15:
                return "iframe"
        time.sleep(1)
    raise TimeoutError(f"No Tableau dashboard found on the page within {WAIT_SECONDS}s")


def url_with_filters(src, filters):
    """Tableau URL filter syntax: ?Field=Value1,Value2  (commas inside values escaped as \\,)."""
    parts = []
    for field, values in filters.items():
        joined = ",".join(str(v).replace(",", r"\,") for v in values)
        parts.append(f"{quote(field)}={quote(joined)}")
    return src + ("&" if "?" in src else "?") + "&".join(parts)


def list_filters(driver, mode):
    if mode == "iframe":
        src = tableau_iframe_src(driver)
        server = "{0.scheme}://{0.netloc}".format(urlsplit(src))
        print(f"Plain iframe - loading Tableau's JS API from {server} to read the filter names...")
        driver.execute_script(INJECT_API_JS, server + "/javascripts/api/tableau.embedding.3.latest.min.js", src.split("?")[0])
        if not wait_for_api(driver, WAIT_SECONDS):
            print("Couldn't load the JS API from the Tableau server (needs Tableau Server 2021.4+,\n"
                  "and the page may block extra scripts).\n"
                  "Find names by hand instead - see 'Finding the exact field names' in README.md.")
            return

    result = driver.execute_async_script(LIST_FILTERS_JS)
    if not result or "error" in result:
        print(f"Couldn't read filters: {result}")
        return

    # Merge the same field across worksheets. Skip "Action (...)" filters - those
    # come from clicking marks (dashboard actions), not from filter cards.
    fields = {}
    for sheet, filters in result.items():
        for f in filters:
            if f["field"].startswith("Action ("):
                continue
            entry = fields.setdefault(f["field"], {"type": f["type"], "sheets": [], "values": f["values"]})
            entry["sheets"].append(sheet)
            if len(f["values"]) > len(entry["values"]):
                entry["values"] = f["values"]

    print("\nFilters on this dashboard (use these exact names in FILTERS):\n")
    for field, e in fields.items():
        print(f'  "{field}"   ({e["type"]}, on {len(e["sheets"])} worksheet(s): {", ".join(e["sheets"])})')
        if e["type"] != "categorical":
            print("      not a list filter - this script only sets categorical (list) filters")
        elif e["values"]:
            shown = ", ".join(f'"{v}"' for v in e["values"][:25])
            more = f" ... (+{len(e['values']) - 25} more)" if len(e["values"]) > 25 else ""
            print(f"      values: {shown}{more}")
    print()


def main():
    driver = make_driver()
    driver.set_script_timeout(WAIT_SECONDS)
    driver.get(PAGE_URL)

    if PAUSE_FOR_LOGIN:
        input("Log in in the browser window if needed, then press Enter here...")

    mode = wait_for_dashboard(driver)

    if "--list" in sys.argv:
        list_filters(driver, mode)
        input("Press Enter to close the browser...")
        driver.quit()
        return

    if mode == "api":
        result = driver.execute_async_script(APPLY_FILTERS_JS, FILTERS)
        if result.get("error"):
            raise RuntimeError(f"Tableau API error: {result['error']}")
        print(f"Used Tableau JS API ({result['api']})")
        for field, sheets in result["applied"].items():
            print(f"  {field}: {'applied to ' + ', '.join(sheets) if sheets else 'NOT FOUND on any worksheet (run with --list to see real names)'}")
    else:
        url = url_with_filters(tableau_iframe_src(driver), FILTERS)
        print(f"Plain iframe - opening dashboard URL with filters:\n  {url}")
        driver.get(url)
        time.sleep(10)  # let the dashboard render

    if SCREENSHOT:
        driver.save_screenshot(SCREENSHOT)
        print(f"Saved {SCREENSHOT}")

    input("Done. Press Enter to close the browser...")
    driver.quit()


if __name__ == "__main__":
    main()
