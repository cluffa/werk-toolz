(function () {
  "use strict";

  // Data lives in memory only (never persisted) since rows can hold sensitive
  // identifiers/account numbers.
  let rows = [];
  let nextId = 1;

  const sheetBody = document.getElementById("sheet-body");
  const output = document.getElementById("output-string");
  const addRowBtn = document.getElementById("add-row-btn");
  const clearRowsBtn = document.getElementById("clear-rows-btn");
  const copyBtn = document.getElementById("copy-btn");
  const quoteToggle = document.getElementById("quote-toggle");

  function makeRow() {
    return { id: nextId++, personal: "", business: "", number: "" };
  }

  function addRow() {
    rows.push(makeRow());
    render();
  }

  function removeRow(id) {
    rows = rows.filter((r) => r.id !== id);
    if (rows.length === 0) rows.push(makeRow());
    render();
  }

  function clearAll() {
    rows = [makeRow()];
    render();
  }

  function digitsOnly(value) {
    return (value || "").replace(/\D/g, "");
  }

  // SSN-style: XXX-XX-XXXX
  function formatPersonal(digits) {
    if (digits.length !== 9) return null;
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }

  // EIN-style: XX-XXXXXXX
  function formatBusiness(digits) {
    if (digits.length !== 9) return null;
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
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

  function buildOutput() {
    const wrapInQuotes = quoteToggle.checked;
    const seen = new Set();
    const terms = [];

    rows.forEach((row) => {
      const all = [
        ...tinVariants(row.personal, formatPersonal),
        ...tinVariants(row.business, formatBusiness),
        ...numberVariants(row.number),
      ];
      all.forEach((term) => {
        if (!seen.has(term)) {
          seen.add(term);
          terms.push(wrapInQuotes ? `"${term}"` : term);
        }
      });
    });

    output.value = terms.join(" OR ");
  }

  function render() {
    sheetBody.innerHTML = "";

    rows.forEach((row, index) => {
      const tr = document.createElement("tr");

      const numTd = document.createElement("td");
      numTd.className = "row-num";
      numTd.textContent = String(index + 1);
      tr.appendChild(numTd);

      ["personal", "business", "number"].forEach((field) => {
        const td = document.createElement("td");
        const input = document.createElement("input");
        input.type = "text";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.value = row[field];
        input.addEventListener("input", (e) => {
          row[field] = e.target.value;
          buildOutput();
        });
        input.addEventListener("paste", (e) => {
          const text = (e.clipboardData || window.clipboardData).getData("text");
          const parts = text.split(/\r?\n/);
          while (parts.length > 1 && parts[parts.length - 1].trim() === "") parts.pop();
          if (parts.length <= 1) return;
          e.preventDefault();
          const rowIndex = rows.indexOf(row);
          row[field] = parts[0];
          const newRows = parts.slice(1).map((val) => {
            const r = makeRow();
            r[field] = val;
            return r;
          });
          rows.splice(rowIndex + 1, 0, ...newRows);
          render();
        });
        td.appendChild(input);
        tr.appendChild(td);
      });

      const actionTd = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "delete-row-btn";
      delBtn.textContent = "×";
      delBtn.title = "Delete row";
      delBtn.addEventListener("click", () => removeRow(row.id));
      actionTd.appendChild(delBtn);
      tr.appendChild(actionTd);

      sheetBody.appendChild(tr);
    });

    buildOutput();
  }

  addRowBtn.addEventListener("click", addRow);
  clearRowsBtn.addEventListener("click", clearAll);
  quoteToggle.addEventListener("change", buildOutput);

  copyBtn.addEventListener("click", async () => {
    if (!output.value) return;
    try {
      await navigator.clipboard.writeText(output.value);
    } catch (err) {
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

  rows.push(makeRow(), makeRow(), makeRow());
  render();
})();

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
