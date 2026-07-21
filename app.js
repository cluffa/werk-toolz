(function () {
  "use strict";

  const cols = { personal: [], business: [], number: [] };
  let nextId = 1;

  function makeEntry(value) { return { id: nextId++, value: value || "" }; }

  function initCols() {
    cols.personal = [makeEntry(), makeEntry(), makeEntry()];
    cols.business = [makeEntry(), makeEntry(), makeEntry()];
    cols.number   = [makeEntry(), makeEntry(), makeEntry()];
  }

  function digitsOnly(v) { return (v || "").replace(/\D/g, ""); }

  function formatPersonal(d) {
    if (d.length !== 9) return null;
    return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  }

  function formatBusiness(d) {
    if (d.length !== 9) return null;
    return `${d.slice(0, 2)}-${d.slice(2)}`;
  }

  function tinVariants(rawValue, formatter) {
    const raw = (rawValue || "").trim();
    if (!raw) return [];
    const digits = digitsOnly(raw);
    if (!digits) return [raw];
    const variants = [digits, `T${digits}`];
    const formatted = formatter(digits);
    variants.push(formatted ? `{${formatted}}` : `{${digits}}`);
    return variants;
  }

  function numberVariants(rawValue) {
    const raw = (rawValue || "").trim();
    return raw ? [raw] : [];
  }

  const output      = document.getElementById("output-string");
  const copyBtn     = document.getElementById("copy-btn");
  const clearBtn    = document.getElementById("clear-rows-btn");

  function buildOutput() {
    const seen = new Set();
    const terms = [];
    const add = (list) => list.forEach((t) => {
      if (!seen.has(t)) { seen.add(t); terms.push(t); }
    });
    cols.personal.forEach((e) => add(tinVariants(e.value, formatPersonal)));
    cols.business.forEach((e) => add(tinVariants(e.value, formatBusiness)));
    cols.number.forEach((e)   => add(numberVariants(e.value)));
    output.value = terms.join(" OR ");
  }

  function renderCol(name) {
    const entries = cols[name];
    const tbody   = document.getElementById(`col-rows-${name}`);
    tbody.innerHTML = "";

    entries.forEach((entry, idx) => {
      const tr = document.createElement("tr");

      const numTd = document.createElement("td");
      numTd.className = "row-num";
      numTd.textContent = idx + 1;
      tr.appendChild(numTd);

      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.value = entry.value;

      input.addEventListener("input", (e) => {
        entry.value = e.target.value;
        buildOutput();
      });

      input.addEventListener("paste", (e) => {
        const text = (e.clipboardData || window.clipboardData).getData("text");
        const parts = text.split(/\r?\n/);
        while (parts.length > 1 && parts[parts.length - 1].trim() === "") parts.pop();
        if (parts.length <= 1) return;
        e.preventDefault();
        parts.forEach((val, i) => {
          if (idx + i < entries.length) {
            entries[idx + i].value = val;
          } else {
            entries.push(makeEntry(val));
          }
        });
        render();
      });

      td.appendChild(input);
      tr.appendChild(td);

      const actionTd = document.createElement("td");
      const del = document.createElement("button");
      del.type = "button";
      del.className = "delete-row-btn";
      del.textContent = "×";
      del.title = "Delete row";
      del.addEventListener("click", () => {
        entries.splice(idx, 1);
        if (entries.length === 0) entries.push(makeEntry());
        render();
      });
      actionTd.appendChild(del);
      tr.appendChild(actionTd);

      tbody.appendChild(tr);
    });
  }

  function render() {
    renderCol("personal");
    renderCol("business");
    renderCol("number");
    buildOutput();
  }

  document.querySelectorAll(".col-add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      cols[btn.dataset.col].push(makeEntry());
      render();
    });
  });

  clearBtn.addEventListener("click", () => { initCols(); render(); });

  copyBtn.addEventListener("click", async () => {
    if (!output.value) return;
    try {
      await navigator.clipboard.writeText(output.value);
    } catch {
      output.select();
      document.execCommand("copy");
    }
    copyBtn.textContent = "Copied!";
    copyBtn.classList.add("copied");
    setTimeout(() => {
      copyBtn.textContent = "Copy";
      copyBtn.classList.remove("copied");
    }, 1200);
  });

  initCols();
  render();
})();

// Excel function builder: rewrite sheet-qualified references to point at
// another open workbook via INDIRECT so the file name can be concatenated in.
(function () {
  "use strict";

  const input    = document.getElementById("excel-input");
  if (!input) return;
  const fileInput = document.getElementById("excel-file");
  const output    = document.getElementById("excel-output");
  const status     = document.getElementById("excel-status");
  const hint       = document.getElementById("excel-hint");
  const copyBtn    = document.getElementById("excel-copy-btn");
  const modeRadios = document.querySelectorAll('input[name="excel-file-mode"]');

  // A1, $A$1, A1:B10, A:A, 1:1 (with optional $ anchors).
  const RANGE = "(?:\\$?[A-Za-z]{1,3}\\$?[0-9]+(?::\\$?[A-Za-z]{1,3}\\$?[0-9]+)?" +
                "|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}" +
                "|\\$?[0-9]+:\\$?[0-9]+)";
  // Sheet1 or 'My Sheet' (apostrophes inside a quoted name are doubled).
  const SHEET = "(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)";
  const REF_RE = new RegExp("(" + SHEET + ")!(" + RANGE + ")", "g");

  function currentMode() {
    let m = "cell";
    modeRadios.forEach((r) => { if (r.checked) m = r.value; });
    return m;
  }

  // Escape a literal for use inside an Excel double-quoted string.
  function dq(s) { return s.replace(/"/g, '""'); }

  // Split a formula into string-literal and non-string segments so we never
  // rewrite references that appear inside quoted text.
  function splitStrings(f) {
    const parts = [];
    let cur = "", inStr = false, i = 0;
    while (i < f.length) {
      const c = f[i];
      if (inStr) {
        if (c === '"') {
          if (f[i + 1] === '"') { cur += '""'; i += 2; continue; }
          cur += '"'; parts.push({ t: cur, s: true }); cur = ""; inStr = false; i++;
        } else { cur += c; i++; }
      } else if (c === '"') {
        if (cur) parts.push({ t: cur, s: false });
        cur = '"'; inStr = true; i++;
      } else { cur += c; i++; }
    }
    if (cur) parts.push({ t: cur, s: inStr });
    return parts;
  }

  // Build the INDIRECT() replacement for one sheet-qualified reference.
  function wrapRef(sheetRaw, rangeRaw, mode, file) {
    let pre, post;
    if (sheetRaw[0] === "'") {
      const inner = sheetRaw.slice(1, -1);
      pre  = "'[";
      post = "]" + inner + "'!" + rangeRaw;
    } else {
      pre  = "[";
      post = "]" + sheetRaw + "!" + rangeRaw;
    }
    if (mode === "literal") {
      return 'INDIRECT("' + dq(pre + file + post) + '")';
    }
    // Cell-reference mode: concatenate the file name in from the cell.
    return 'INDIRECT("' + dq(pre) + '"&' + file + '&"' + dq(post) + '")';
  }

  function updateHint(mode) {
    if (mode === "cell") {
      fileInput.placeholder = "$A$1";
      hint.textContent =
        "Enter the cell that holds the workbook name (e.g. $A$1). That cell " +
        "should contain the name as shown in Excel's title bar, e.g. Book1.xlsx. " +
        "The workbook must be open.";
    } else {
      fileInput.placeholder = "Book1.xlsx";
      hint.textContent =
        "Type the workbook name exactly as shown in Excel's title bar, " +
        "e.g. Book1.xlsx. The workbook must be open.";
    }
  }

  function convert() {
    const mode = currentMode();
    const file = fileInput.value.trim();
    updateHint(mode);

    if (!input.value.trim()) {
      output.value = ""; status.textContent = ""; status.className = "excel-status";
      return;
    }
    if (!file) {
      output.value = "";
      status.textContent = mode === "cell"
        ? "Enter the cell that holds the workbook name (e.g. $A$1)."
        : "Enter the workbook file name (e.g. Book1.xlsx).";
      status.className = "excel-status warn";
      return;
    }

    let f = input.value.trim();
    const hadEq = f[0] === "=";
    if (hadEq) f = f.slice(1);

    let count = 0;
    const rebuilt = splitStrings(f).map((p) => {
      if (p.s) return p.t;
      return p.t.replace(REF_RE, (m, sheet, range) => {
        count++;
        return wrapRef(sheet, range, mode, file);
      });
    }).join("");

    output.value = (hadEq ? "=" : "") + rebuilt;
    if (count === 0) {
      status.textContent =
        "No sheet-qualified references found — nothing to redirect. " +
        "Add a sheet name like Sheet1!A1.";
      status.className = "excel-status warn";
    } else {
      status.textContent =
        "Redirected " + count + " reference" + (count === 1 ? "" : "s") +
        " to the target workbook.";
      status.className = "excel-status ok";
    }
  }

  input.addEventListener("input", convert);
  fileInput.addEventListener("input", convert);
  modeRadios.forEach((r) => r.addEventListener("change", convert));

  copyBtn.addEventListener("click", async () => {
    if (!output.value) return;
    try { await navigator.clipboard.writeText(output.value); }
    catch { output.select(); document.execCommand("copy"); }
    copyBtn.textContent = "Copied!";
    copyBtn.classList.add("copied");
    setTimeout(() => {
      copyBtn.textContent = "Copy";
      copyBtn.classList.remove("copied");
    }, 1200);
  });

  updateHint(currentMode());
})();

// Notes: copy a formula snippet to the clipboard.
document.querySelectorAll(".note-copy-btn").forEach(function (btn) {
  btn.addEventListener("click", async function () {
    var code = btn.parentElement.querySelector("code");
    if (!code) return;
    var text = code.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      var range = document.createRange();
      range.selectNodeContents(code);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("copy");
      sel.removeAllRanges();
    }
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(function () {
      btn.textContent = "Copy";
      btn.classList.remove("copied");
    }, 1200);
  });
});

// Nav switching
document.querySelectorAll(".tool-nav-btn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var tool = btn.dataset.tool;
    document.querySelectorAll(".tool-nav-btn").forEach(function (b) {
      b.classList.toggle("active", b === btn);
    });
    document.querySelectorAll(".tool-panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "tool-" + tool);
    });
  });
});

// Show / hide source code
// In single-file mode reads from bundled inline tags; otherwise fetches from server.
document.querySelectorAll(".show-code-btn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var targetId = btn.dataset.target;
    var filename = btn.dataset.file;
    var pre = document.getElementById(targetId);
    var codeEl = pre.querySelector("code");

    if (pre.hidden) {
      if (!codeEl.dataset.loaded) {
        if (document.documentElement.dataset.singleFile) {
          if (filename === "style.css") {
            codeEl.textContent = document.getElementById("bundled-style").textContent;
          } else if (filename === "app.js") {
            codeEl.textContent = document.getElementById("bundled-script").textContent;
          } else {
            codeEl.textContent = document.documentElement.outerHTML;
          }
          codeEl.dataset.loaded = "1";
        } else {
          fetch(filename)
            .then(function (r) { return r.text(); })
            .then(function (text) {
              codeEl.textContent = text;
              codeEl.dataset.loaded = "1";
            })
            .catch(function () {
              if (filename === "index.html") {
                codeEl.textContent = document.documentElement.outerHTML;
                codeEl.dataset.loaded = "1";
              } else {
                codeEl.textContent =
                  "Source unavailable in this browser.\n" +
                  "Open via a local server, or use Ctrl+U / Cmd+U to view source.";
              }
            });
        }
      }
      pre.hidden = false;
      btn.textContent = "Hide Code";
      btn.classList.add("open");
    } else {
      pre.hidden = true;
      btn.textContent = "Show Code";
      btn.classList.remove("open");
    }
  });
});

// Download as single self-contained HTML file
document.getElementById("download-btn").addEventListener("click", async function () {
  const btn = this;
  btn.textContent = "Building…";
  btn.disabled = true;
  try {
    var html;
    if (document.documentElement.dataset.singleFile) {
      html = "<!doctype html>\n" + document.documentElement.outerHTML;
    } else {
      const [cssText, jsText] = await Promise.all([
        fetch("style.css").then((r) => r.text()),
        fetch("app.js").then((r) => r.text()),
      ]);
      // Clone the live DOM and swap the external link/script for inline equivalents.
      const root = document.documentElement.cloneNode(true);
      root.setAttribute("data-single-file", "1");

      const style = document.createElement("style");
      style.id = "bundled-style";
      style.textContent = cssText;
      root.querySelector('link[rel="stylesheet"]').replaceWith(style);

      const script = document.createElement("script");
      script.id = "bundled-script";
      script.textContent = jsText;
      root.querySelector('script[src]').replaceWith(script);

      // Replace the export button with a "Get Latest" link back to the live page.
      const exportBtn = root.querySelector("#download-btn");
      const latestLink = document.createElement("a");
      latestLink.href = window.location.href;
      latestLink.textContent = "Get Latest";
      latestLink.className = exportBtn.className;
      latestLink.target = "_blank";
      latestLink.rel = "noopener";
      exportBtn.replaceWith(latestLink);

      html = "<!doctype html>\n" + root.outerHTML;
    }
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "werk-toolz.html";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Download failed:", e);
    btn.textContent = "Failed";
    setTimeout(function () {
      btn.textContent = "Download";
      btn.disabled = false;
    }, 2000);
    return;
  }
  btn.textContent = "Download";
  btn.disabled = false;
});
