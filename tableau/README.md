# Tableau filter automation (Selenium + Python)

`tableau_filter.py` opens a web page with an embedded Tableau dashboard and sets its filters.
It's a single file, and the only dependency is `selenium`.

## Use it

1. Edit the block at the top of `tableau_filter.py`:
   ```python
   PAGE_URL = "https://your-company-site/page-with-the-dashboard"
   FILTERS  = {"Region": ["West", "East"], "Category": ["Furniture"]}
   BROWSER  = "edge"                         # or "chrome"
   DRIVER_PATH = r"C:\tools\msedgedriver.exe"  # needed on an offline PC
   ```
2. `python tableau_filter.py`

Field names and values must match Tableau exactly, including case. The script
tells you if a field wasn't found on any worksheet.

If the dashboard needs a login (SSO etc.), set `PAUSE_FOR_LOGIN = True`. The script
then waits while you log in in the browser window, and continues when you press Enter.

## How it works

It tries two methods, in this order:

| Page embeds Tableau with... | What the script does |
|---|---|
| Tableau Embedding API (`<tableau-viz>` tag = v3, or `new tableau.Viz(...)` = v2) | Calls Tableau's own `applyFilterAsync()` via `driver.execute_script`. No clicking, and no CSS selectors that break when Tableau updates. The filter is applied to every worksheet on the dashboard that has that field. |
| A plain `<iframe src=".../views/...">` | Reads the iframe's URL, adds Tableau URL filter parameters (`?Region=West,East`) and opens that URL. The browser then shows the dashboard itself, not the page around it. |

## Moving it to an offline PC

You need 3 things on the offline PC: Python, the selenium wheels, and a browser driver.

**1. Selenium + dependencies:** already included in the `wheels/` folder (selenium 4.49,
15 pure-Python wheels). They work on Windows with **Python 3.11 or newer**. For Python 3.10, or to
get newer versions, re-download them on a PC with internet:
```
pip download selenium --only-binary=:all: --platform win_amd64 --python-version 3.12 -d wheels
```
(set `--python-version` to the offline PC's version, from `python --version`)

**2. Download the browser driver.** Its version must match the browser on the offline PC.
- **Edge** (installed on every Windows PC): find the version at `edge://version`, then get
  the same version of `msedgedriver.exe` from https://developer.microsoft.com/microsoft-edge/tools/webdriver
- **Chrome**: find the version at `chrome://version`, then get the matching `chromedriver.exe` from
  https://googlechromelabs.github.io/chrome-for-testing/

**3. Copy these to the offline PC** (USB etc.): the `wheels` folder, `tableau_filter.py`, and the driver `.exe`.

**4. On the offline PC:**
```
pip install --no-index --find-links wheels selenium
```
Then set `DRIVER_PATH` in the script to the driver `.exe`. Without it, Selenium tries to
download a driver from the internet and fails.

> Browsers update automatically. When Edge/Chrome updates, the driver stops matching and
> you get a "session not created: This version of ... only supports version N" error. Download
> the matching driver again when that happens.

## Finding the exact field names

The titles on the dashboard's filter cards are often **not** the field names, because the
author can rename them. Let the dashboard tell you the real names:

```
python tableau_filter.py --list
```

It opens the page and prints each filter's real field name, which worksheets it's on,
and its values. Copy the names and values into `FILTERS` exactly as printed:

```
Filters on this dashboard (use these exact names in FILTERS):

  "Region"   (categorical, on 4 worksheet(s): SaleMap, Total Sales, SalesbyProduct, SalesbySegment)
      values: "Central", "East", "South", "West"
```

- Works for all three embed types. For a plain `<iframe>`, it loads Tableau's Embedding API
  (v3) from your Tableau server and embeds a second copy of the dashboard at the top of the page
  so it can read the names. This needs Tableau Server 2021.4 or newer, and it takes ~20 seconds.
- `Action (...)` filters are skipped. They come from clicking on the charts, not from filter cards.
- Date *range* filters and *parameters* are listed but not set by this script. It only sets
  categorical (list) filters: dropdowns, checkbox lists, single-value lists.

If `--list` can't read the names (some pages block extra scripts), find them by hand:
- **Download > Crosstab** (or Data) in the dashboard toolbar: the column headers are field names.
- **Hover over a chart**: tooltips usually show field names (unless the author customized them).
- Ask the dashboard author. In Tableau Desktop, the names are in the Data pane.

## Linked filters: order matters

Filters are applied in the order you list them in `FILTERS`. If the dashboard's filters show
"only relevant values", a later filter can narrow an earlier one. Example from testing:
`Region=[West, East]` then `State=[California]` ends up as Region = West, because California is only in
the West. Tableau behaves the same way when you click the filters by hand.

## Testing

Tested with Chrome 152 / Selenium 4.49 against a public Tableau dashboard
(Superstore), embedded three ways: v3 `<tableau-viz>`, v2 `tableau.Viz`, and a plain `<iframe>`.
Built with AI assistance (Claude Code).
