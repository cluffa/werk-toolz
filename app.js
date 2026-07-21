/*<<MOD:search-string>>*/
(function () {
  "use strict";

  if (!document.getElementById("output-string")) return;

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
/*<</MOD:search-string>>*/

/*<<MOD:excelref>>*/
// Shared Excel reference helpers: detect sheet-qualified references and rewrite
// them to point at another open workbook via INDIRECT (file name concatenated in).
var ExcelRef = (function () {
  "use strict";

  // A1, $A$1, A1:B10, A:A, 1:1 (with optional $ anchors).
  const RANGE = "(?:\\$?[A-Za-z]{1,3}\\$?[0-9]+(?::\\$?[A-Za-z]{1,3}\\$?[0-9]+)?" +
                "|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}" +
                "|\\$?[0-9]+:\\$?[0-9]+)";
  // Sheet1 or 'My Sheet' (apostrophes inside a quoted name are doubled).
  const SHEET = "(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)";
  const REF_RE = new RegExp("(" + SHEET + ")!(" + RANGE + ")", "g");

  // Escape a literal for use inside an Excel double-quoted string.
  function dq(s) { return s.replace(/"/g, '""'); }

  // Split a formula into string-literal and non-string segments so callers
  // never rewrite text that appears inside quotes.
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

  // Rewrite every sheet-qualified reference in a formula fragment.
  // Returns { out, count }; refs inside quoted strings are untouched.
  function redirect(text, mode, file) {
    let count = 0;
    const out = splitStrings(text).map(function (p) {
      if (p.s) return p.t;
      return p.t.replace(REF_RE, function (m, sheet, range) {
        count++;
        return wrapRef(sheet, range, mode, file);
      });
    }).join("");
    return { out: out, count: count };
  }

  return { redirect: redirect, splitStrings: splitStrings };
})();
/*<</MOD:excelref>>*/

/*<<MOD:excel>>*/
// Excel Function tool: redirect a whole formula to another open workbook.
(function () {
  "use strict";

  const input     = document.getElementById("excel-input");
  if (!input) return;
  const fileInput = document.getElementById("excel-file");
  const output    = document.getElementById("excel-output");
  const status    = document.getElementById("excel-status");
  const hint      = document.getElementById("excel-hint");
  const copyBtn   = document.getElementById("excel-copy-btn");
  const modeRadios = document.querySelectorAll('input[name="excel-file-mode"]');

  function currentMode() {
    let m = "cell";
    modeRadios.forEach((r) => { if (r.checked) m = r.value; });
    return m;
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

    const res = ExcelRef.redirect(f, mode, file);
    output.value = (hadEq ? "=" : "") + res.out;
    if (res.count === 0) {
      status.textContent =
        "No sheet-qualified references found — nothing to redirect. " +
        "Add a sheet name like Sheet1!A1.";
      status.className = "excel-status warn";
    } else {
      status.textContent =
        "Redirected " + res.count + " reference" + (res.count === 1 ? "" : "s") +
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
/*<</MOD:excel>>*/

/*<<MOD:lookup>>*/
// Lookup Builder: assemble an XLOOKUP / VLOOKUP, optionally redirected to
// another open workbook via the shared ExcelRef helper.
(function () {
  "use strict";

  const out = document.getElementById("lk-output");
  if (!out) return;
  const kindRadios = document.querySelectorAll('input[name="lookup-kind"]');
  const modeRadios = document.querySelectorAll('input[name="lk-file-mode"]');
  const extBox     = document.getElementById("lk-external");
  const extOpts    = document.getElementById("lk-external-opts");
  const fileInput  = document.getElementById("lk-file");
  const copyBtn    = document.getElementById("lk-copy");
  const xFields    = document.querySelectorAll(".lk-x");
  const vFields    = document.querySelectorAll(".lk-v");

  function val(id) { return document.getElementById(id).value.trim(); }
  function radioVal(list) {
    let v = null;
    list.forEach((r) => { if (r.checked) v = r.value; });
    return v;
  }

  function redir(ref) {
    if (!extBox.checked) return ref;
    const file = fileInput.value.trim();
    if (!file) return ref;
    return ExcelRef.redirect(ref, radioVal(modeRadios), file).out;
  }

  function build() {
    const kind = radioVal(kindRadios);
    const isX = kind === "xlookup";
    xFields.forEach((el) => { el.hidden = !isX; });
    vFields.forEach((el) => { el.hidden = isX; });
    extOpts.hidden = !extBox.checked;

    const value = val("lk-value");

    if (isX) {
      const la = val("lk-lookup-array");
      const ra = val("lk-return-array");
      const nf = val("lk-notfound");
      if (!value || !la || !ra) { out.value = ""; return; }
      const args = [value, redir(la), redir(ra)];
      if (nf) args.push(nf);
      out.value = "=XLOOKUP(" + args.join(", ") + ")";
    } else {
      const table = val("lk-table");
      const col = val("lk-col");
      const exact = document.getElementById("lk-exact").checked;
      if (!value || !table || !col) { out.value = ""; return; }
      out.value = "=VLOOKUP(" + value + ", " + redir(table) + ", " + col +
                  ", " + (exact ? "FALSE" : "TRUE") + ")";
    }
  }

  document.querySelectorAll(
    "#tool-lookup input[type=text], #tool-lookup input[type=radio], #tool-lookup input[type=checkbox]"
  ).forEach((el) => {
    el.addEventListener("input", build);
    el.addEventListener("change", build);
  });

  copyBtn.addEventListener("click", async () => {
    if (!out.value) return;
    try { await navigator.clipboard.writeText(out.value); }
    catch { out.select(); document.execCommand("copy"); }
    copyBtn.textContent = "Copied!";
    copyBtn.classList.add("copied");
    setTimeout(() => {
      copyBtn.textContent = "Copy";
      copyBtn.classList.remove("copied");
    }, 1200);
  });

  build();
})();
/*<</MOD:lookup>>*/

/*<<MOD:refs>>*/
// Reference Toolkit: column letter/number, $ anchoring, sheet!range builder.
(function () {
  "use strict";

  const colInput = document.getElementById("col-input");
  if (!colInput) return;

  // --- Column letter <-> number ---
  function colToNum(s) {
    s = s.toUpperCase();
    let n = 0;
    for (const ch of s) {
      if (ch < "A" || ch > "Z") return null;
      n = n * 26 + (ch.charCodeAt(0) - 64);
    }
    return n;
  }
  function numToCol(n) {
    if (!Number.isInteger(n) || n < 1 || n > 16384) return null;
    let s = "";
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  const colResult = document.getElementById("col-result");
  function updateCol() {
    const raw = colInput.value.trim();
    if (!raw) { colResult.textContent = ""; colResult.className = "inline-result"; return; }
    if (/^[0-9]+$/.test(raw)) {
      const c = numToCol(parseInt(raw, 10));
      if (c) { colResult.textContent = "→ column " + c; colResult.className = "inline-result ok"; }
      else { colResult.textContent = "1–16384 only"; colResult.className = "inline-result warn"; }
    } else if (/^[A-Za-z]{1,3}$/.test(raw)) {
      const n = colToNum(raw);
      if (n && n <= 16384) { colResult.textContent = "→ number " + n; colResult.className = "inline-result ok"; }
      else { colResult.textContent = "A–XFD only"; colResult.className = "inline-result warn"; }
    } else {
      colResult.textContent = "Enter a letter (AA) or number (27)";
      colResult.className = "inline-result warn";
    }
  }
  colInput.addEventListener("input", updateCol);

  // --- Absolute / relative anchoring ---
  const anchorInput = document.getElementById("anchor-input");
  const anchorOutput = document.getElementById("anchor-output");
  // A cell reference not embedded in a longer identifier or a function call.
  const CELL_RE = /(?<![A-Za-z0-9_.])(\$?)([A-Za-z]{1,3})(\$?)([0-9]+)(?![A-Za-z0-9_(])/g;
  function anchor(mode) {
    const text = anchorInput.value;
    if (!text.trim()) { anchorOutput.textContent = ""; return; }
    anchorOutput.textContent = ExcelRef.splitStrings(text).map(function (p) {
      if (p.s) return p.t;
      return p.t.replace(CELL_RE, function (m, d1, col, d2, row) {
        const cd = (mode === "abs" || mode === "col") ? "$" : "";
        const rd = (mode === "abs" || mode === "row") ? "$" : "";
        return cd + col + rd + row;
      });
    }).join("");
  }
  document.querySelectorAll("[data-anchor]").forEach(function (btn) {
    btn.addEventListener("click", function () { anchor(btn.dataset.anchor); });
  });
  anchorInput.addEventListener("input", function () {
    if (anchorOutput.textContent) anchorOutput.textContent = "";
  });

  // --- Sheet & range builder ---
  const srSheet = document.getElementById("sr-sheet");
  const srRange = document.getElementById("sr-range");
  const srOutput = document.getElementById("sr-output");
  function needsQuote(name) { return !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name); }
  function buildSheetRef() {
    const sheet = srSheet.value.trim();
    const range = srRange.value.trim();
    if (!range) { srOutput.textContent = ""; return; }
    if (!sheet) { srOutput.textContent = range; return; }
    const s = needsQuote(sheet) ? "'" + sheet.replace(/'/g, "''") + "'" : sheet;
    srOutput.textContent = s + "!" + range;
  }
  srSheet.addEventListener("input", buildSheetRef);
  srRange.addEventListener("input", buildSheetRef);
})();
/*<</MOD:refs>>*/

/*<<MOD:format>>*/
// Formula Formatter: pretty-print / minify an Excel formula (string-aware).
(function () {
  "use strict";

  const input = document.getElementById("fmt-input");
  if (!input) return;
  const output = document.getElementById("fmt-output");
  const indentSel = document.getElementById("fmt-indent");
  const copyBtn = document.getElementById("fmt-copy");

  // Copy a quoted string literal verbatim (handles doubled "" escapes),
  // advancing i past it; returns { s, i }.
  function readString(f, i) {
    let s = f[i]; i++;
    while (i < f.length) {
      s += f[i];
      if (f[i] === '"') {
        if (f[i + 1] === '"') { s += f[i + 1]; i += 2; continue; }
        i++; break;
      }
      i++;
    }
    return { s: s, i: i };
  }

  function unit() {
    const v = indentSel.value;
    return v === "tab" ? "\t" : " ".repeat(parseInt(v, 10));
  }

  function pretty(f) {
    const pad = unit();
    let out = "", depth = 0, i = 0;
    while (i < f.length) {
      const c = f[i];
      if (c === '"') { const r = readString(f, i); out += r.s; i = r.i; continue; }
      if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
      if (c === "(") { out += "(\n" + pad.repeat(depth + 1); depth++; i++; continue; }
      if (c === ",") { out = out.replace(/\s+$/, ""); out += ",\n" + pad.repeat(depth); i++; continue; }
      if (c === ")") {
        depth = Math.max(0, depth - 1);
        out = out.replace(/\s+$/, "");
        out += out.endsWith("(") ? ")" : "\n" + pad.repeat(depth) + ")";
        i++; continue;
      }
      out += c; i++;
    }
    return out;
  }

  function minify(f) {
    let out = "", i = 0;
    while (i < f.length) {
      const c = f[i];
      if (c === '"') { const r = readString(f, i); out += r.s; i = r.i; continue; }
      if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
      out += c; i++;
    }
    return out;
  }

  document.getElementById("fmt-pretty").addEventListener("click", function () {
    output.value = pretty(input.value.trim());
  });
  document.getElementById("fmt-min").addEventListener("click", function () {
    output.value = minify(input.value.trim());
  });
  indentSel.addEventListener("change", function () {
    if (output.value && output.value.indexOf("\n") !== -1) output.value = pretty(input.value.trim());
  });

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
})();
/*<</MOD:format>>*/

/*<<MOD:reconcile>>*/
// List Reconciliation: compare two line-based lists.
(function () {
  "use strict";

  const a = document.getElementById("recon-a");
  if (!a) return;
  const b = document.getElementById("recon-b");
  const trimBox = document.getElementById("recon-trim");
  const ciBox = document.getElementById("recon-ci");
  const blanksBox = document.getElementById("recon-blanks");

  const aOnly = document.getElementById("recon-a-only");
  const bOnly = document.getElementById("recon-b-only");
  const both  = document.getElementById("recon-both");

  // Build a Map of normalized key -> first original value seen.
  function toMap(text) {
    const map = new Map();
    let total = 0;
    text.split(/\r?\n/).forEach(function (line) {
      const orig = trimBox.checked ? line.trim() : line;
      if (blanksBox.checked && orig === "") return;
      total++;
      const key = ciBox.checked ? orig.toLowerCase() : orig;
      if (!map.has(key)) map.set(key, orig);
    });
    return { map: map, total: total };
  }

  function setStat(id, total, unique) {
    document.getElementById(id).textContent =
      total ? "— " + total + " line" + (total === 1 ? "" : "s") +
              ", " + unique + " unique" : "";
  }

  function run() {
    const A = toMap(a.value);
    const B = toMap(b.value);
    const aList = [], bList = [], bothList = [];
    A.map.forEach(function (orig, key) {
      if (B.map.has(key)) bothList.push(orig); else aList.push(orig);
    });
    B.map.forEach(function (orig, key) {
      if (!A.map.has(key)) bList.push(orig);
    });

    aOnly.value = aList.join("\n");
    bOnly.value = bList.join("\n");
    both.value = bothList.join("\n");
    document.getElementById("recon-a-only-count").textContent = aList.length;
    document.getElementById("recon-b-only-count").textContent = bList.length;
    document.getElementById("recon-both-count").textContent = bothList.length;
    setStat("recon-a-stat", A.total, A.map.size);
    setStat("recon-b-stat", B.total, B.map.size);
  }

  [a, b].forEach((el) => el.addEventListener("input", run));
  [trimBox, ciBox, blanksBox].forEach((el) => el.addEventListener("change", run));

  document.querySelectorAll(".recon-copy").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      const ta = document.getElementById(btn.dataset.target);
      if (!ta.value) return;
      try { await navigator.clipboard.writeText(ta.value); }
      catch { ta.select(); document.execCommand("copy"); }
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(function () {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 1200);
    });
  });

  run();
})();
/*<</MOD:reconcile>>*/

/*<<MOD:notes>>*/
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
/*<</MOD:notes>>*/

/*<<MOD:nav>>*/
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
/*<</MOD:nav>>*/

/*<<MOD:source>>*/
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
/*<</MOD:source>>*/

/*<<MOD:export>>*/
// Export: build a self-contained HTML file from a chosen set of tools.
// One tool -> its own sidebar-free page; several -> the sidebar is kept so the
// pages stay navigable. Only the code each selected tool needs is inlined.
(function () {
  "use strict";

  const dlBtn = document.getElementById("download-btn");
  if (!dlBtn) return;
  const menu    = document.getElementById("export-menu");
  const goBtn   = document.getElementById("export-go");
  const allBtn  = document.getElementById("export-select-all");

  // Human labels + canonical (sidebar) order for the exportable tools.
  const TOOL_ORDER = ["search-string", "reconcile", "excel", "lookup", "refs", "format", "notes"];
  const TOOL_LABELS = {
    "search-string": "Search String", reconcile: "Reconcile", excel: "Excel Function",
    lookup: "Lookup", refs: "References", format: "Format", notes: "Notes",
  };

  // Which JS modules each tool needs (ExcelRef is a shared dependency).
  const TOOL_DEPS = {
    "search-string": ["search-string"],
    reconcile: ["reconcile"],
    excel: ["excelref", "excel"],
    lookup: ["excelref", "lookup"],
    refs: ["excelref", "refs"],
    format: ["format"],
    notes: ["notes"],
  };
  // Emit modules in source order so ExcelRef is defined before its users.
  const MODULE_ORDER = ["search-string", "excelref", "excel", "lookup", "refs", "format", "reconcile", "notes", "nav"];

  function boxes() { return Array.from(document.querySelectorAll(".export-tool")); }
  function selectedTools() {
    const chosen = boxes().filter((b) => b.checked).map((b) => b.value);
    return TOOL_ORDER.filter((t) => chosen.includes(t));
  }

  function extractModule(src, name) {
    const open = "/*<<MOD:" + name + ">>*/";
    const close = "/*<</MOD:" + name + ">>*/";
    const i = src.indexOf(open);
    const j = src.indexOf(close);
    if (i === -1 || j === -1) return "";
    return src.slice(i + open.length, j).trim();
  }

  // Assemble only the JS the selected tools need. Nav is added for multi-tool
  // exports; the source viewer and this export module are never included.
  function buildJs(src, tools, multi) {
    const needed = new Set();
    tools.forEach((t) => (TOOL_DEPS[t] || []).forEach((m) => needed.add(m)));
    if (multi) needed.add("nav");
    return MODULE_ORDER
      .filter((m) => needed.has(m))
      .map((m) => extractModule(src, m))
      .filter(Boolean)
      .join("\n\n");
  }

  function buildHtml(tools, cssText, jsText) {
    const multi = tools.length > 1;
    const root = document.documentElement.cloneNode(true);
    root.removeAttribute("data-single-file");

    // Never ship the export control or the source viewer.
    const expWrap = root.querySelector(".export-wrap");
    if (expWrap) expWrap.remove();
    const srcPanel = root.querySelector("#tool-source");
    if (srcPanel) srcPanel.remove();
    const srcNav = root.querySelector('.tool-nav-btn[data-tool="source"]');
    if (srcNav && srcNav.closest("li")) srcNav.closest("li").remove();

    // Keep only the chosen tool panels; the first one is active.
    root.querySelectorAll(".tool-panel").forEach(function (p) {
      const id = p.id.replace(/^tool-/, "");
      if (!tools.includes(id)) { p.remove(); return; }
      p.classList.toggle("active", id === tools[0]);
    });

    if (multi) {
      // Prune the sidebar nav down to the chosen tools.
      root.querySelectorAll(".tool-nav-btn").forEach(function (btn) {
        const t = btn.dataset.tool;
        if (!tools.includes(t)) { if (btn.closest("li")) btn.closest("li").remove(); return; }
        btn.classList.toggle("active", t === tools[0]);
      });
    } else {
      // Single tool: drop the sidebar entirely.
      const sidebar = root.querySelector(".sidebar");
      if (sidebar) sidebar.remove();
      const app = root.querySelector(".app");
      if (app) app.classList.add("solo");
    }

    const titleEl = root.querySelector("title");
    if (titleEl) titleEl.textContent = multi ? "Tools" : (TOOL_LABELS[tools[0]] || "Tool");

    const style = document.createElement("style");
    style.textContent = cssText;
    const link = root.querySelector('link[rel="stylesheet"]');
    if (link) link.replaceWith(style);

    const script = document.createElement("script");
    script.textContent = buildJs(jsText, tools, multi);
    const oldScript = root.querySelector("script[src]");
    if (oldScript) oldScript.replaceWith(script);

    return "<!doctype html>\n" + root.outerHTML;
  }

  function triggerDownload(html, filename) {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- Dropdown open/close ---
  function setOpen(open) {
    menu.hidden = !open;
    dlBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  dlBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    setOpen(menu.hidden);
  });
  menu.addEventListener("click", function (e) { e.stopPropagation(); });
  document.addEventListener("click", function () { if (!menu.hidden) setOpen(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !menu.hidden) setOpen(false);
  });

  allBtn.addEventListener("click", function () {
    const all = boxes();
    const makeAll = all.some((b) => !b.checked);
    all.forEach((b) => { b.checked = makeAll; });
    allBtn.textContent = makeAll ? "Clear all" : "Select all";
  });

  goBtn.addEventListener("click", async function () {
    const tools = selectedTools();
    if (!tools.length) {
      goBtn.textContent = "Pick one";
      setTimeout(function () { goBtn.textContent = "Export"; }, 1200);
      return;
    }
    goBtn.textContent = "Building…";
    goBtn.disabled = true;
    try {
      const [cssText, jsText] = await Promise.all([
        fetch("style.css").then((r) => r.text()),
        fetch("app.js").then((r) => r.text()),
      ]);
      const multi = tools.length > 1;
      const html = buildHtml(tools, cssText, jsText);
      triggerDownload(html, multi ? "werk-toolz.html" : "werk-" + tools[0] + ".html");
      setOpen(false);
    } catch (e) {
      console.error("Export failed:", e);
      goBtn.textContent = "Failed";
      setTimeout(function () { goBtn.textContent = "Export"; goBtn.disabled = false; }, 2000);
      return;
    }
    goBtn.textContent = "Export";
    goBtn.disabled = false;
  });
})();
/*<</MOD:export>>*/
