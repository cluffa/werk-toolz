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

  // Seed with a few empty rows to start.
  rows.push(makeRow(), makeRow(), makeRow());
  render();
})();
