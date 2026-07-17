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
  const quoteToggle = document.getElementById("quote-toggle");

  function buildOutput() {
    const wrap = quoteToggle.checked;
    const seen = new Set();
    const terms = [];
    const add = (list) => list.forEach((t) => {
      if (!seen.has(t)) { seen.add(t); terms.push(wrap ? `"${t}"` : t); }
    });
    cols.personal.forEach((e) => add(tinVariants(e.value, formatPersonal)));
    cols.business.forEach((e) => add(tinVariants(e.value, formatBusiness)));
    cols.number.forEach((e)   => add(numberVariants(e.value)));
    output.value = terms.join(" OR ");
  }

  function renderCol(name) {
    const entries  = cols[name];
    const container = document.getElementById(`col-rows-${name}`);
    container.innerHTML = "";

    entries.forEach((entry, idx) => {
      const row = document.createElement("div");
      row.className = "col-row";

      const num = document.createElement("span");
      num.className = "col-row-num";
      num.textContent = idx + 1;
      row.appendChild(num);

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

      row.appendChild(input);

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
      row.appendChild(del);

      container.appendChild(row);
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
  quoteToggle.addEventListener("change", buildOutput);

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
