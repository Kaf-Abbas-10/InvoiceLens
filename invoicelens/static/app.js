"use strict";

const $ = id => document.getElementById(id);
const state = { entries: [], active: null, page: 1, selected: null, original: false, busy: false, request: 0 };
const icon = name => { const el = document.createElementNS("http://www.w3.org/2000/svg", "svg"); const use = document.createElementNS(el.namespaceURI, "use"); use.setAttribute("href", `#i-${name}`); el.append(use); el.setAttribute("aria-hidden", "true"); return el; };
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const money = value => { if (value === null || value === undefined) return "—"; const currency = state.active?.extraction.currency; const number = Number(value); return currency ? new Intl.NumberFormat("en-US", {style:"currency",currency}).format(number) : new Intl.NumberFormat("en-US", {minimumFractionDigits:2,maximumFractionDigits:2}).format(number); };

function showError(message) { $("error").textContent = message; $("error").hidden = false; }
function toast(message) { $("toast").textContent = message; $("toast").hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $("toast").hidden = true; }, 3500); }
function busy(value, message = "Reading the document…") { state.busy = value; $("loading").hidden = !value; $("loading-text").textContent = message; $("upload-button").disabled = value; $("browse-button").disabled = value; document.querySelectorAll("[data-sample]").forEach(b => { b.disabled = value; }); $("more-samples").disabled = value; }
async function fetchJSON(url, options) { const response = await fetch(url, options); let data; try { data = await response.json(); } catch { throw new Error("The server returned an unreadable response. Check that InvoiceLens is running."); } if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "This document could not be processed."); return data; }

async function loadSample(id) {
  if (state.busy) return;
  const request = ++state.request;
  $("error").hidden = true; busy(true, "Running the layout rules…");
  try {
    const data = await fetchJSON(`/api/samples/${encodeURIComponent(id)}`);
    if (request !== state.request) return;
    addEntry({...data, sampleId:id, originalUrl:`/api/samples/${encodeURIComponent(id)}/pdf`, originalType:"application/pdf"});
  } catch (error) { showError(error.message || "Could not load the sample."); if (!state.active) $("empty-state").hidden = false; }
  finally { busy(false); $("more-samples").value = ""; }
}

async function upload(file) {
  if (!file || state.busy) return;
  $("error").hidden = true;
  if (file.size > 20 * 1024 * 1024) { showError("This file is larger than 20 MB. Please choose a smaller invoice."); return; }
  if (!/\.(pdf|png|jpe?g|tiff?|json)$/i.test(file.name)) { showError("Choose a PDF, PNG, JPG, TIFF, or normalized word JSON file."); return; }
  busy(true, "Extracting words, locating charges, and checking the maths…");
  const form = new FormData(); form.append("file", file);
  try {
    const data = await fetchJSON("/api/extract", { method:"POST", body:form });
    const pdf = /\.pdf$/i.test(file.name), image = /\.(png|jpe?g)$/i.test(file.name);
    addEntry({...data, originalUrl:pdf || image ? URL.createObjectURL(file) : null, originalType:pdf ? "application/pdf" : image ? "image" : null});
    toast("Extraction complete. Inspect the results before using them.");
  } catch (error) { showError(error.message || "Upload failed. Check your connection to the local server."); }
  finally { busy(false); $("file-input").value = ""; }
}

function addEntry(entry) {
  entry.key = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  state.entries.unshift(entry);
  if (state.entries.length > 12) { const removed = state.entries.pop(); release(removed); }
  activate(entry);
}
function release(entry) { if (entry?.originalUrl?.startsWith("blob:")) URL.revokeObjectURL(entry.originalUrl); }
function renderHistory() {
  $("session-count").textContent = state.entries.length;
  $("history").replaceChildren();
  for (const entry of state.entries) {
    const button = node("button", undefined, `history-item${state.active === entry ? " selected" : ""}`);
    button.append(icon("file"), node("span", entry.extraction.filename)); button.title = entry.extraction.filename;
    button.addEventListener("click", () => activate(entry)); $("history").append(button);
  }
  if (!state.entries.length) $("history").append(node("p", "Your invoices will appear here.", "history-empty"));
}
function activate(entry) {
  state.active = entry; state.page = 1; state.selected = null; state.original = false;
  $("clear-highlight").hidden = true;
  $("empty-state").hidden = true; $("results").hidden = false;
  $("details-tab").click(); renderHistory(); render();
}

function render() {
  const entry = state.active, result = entry.extraction;
  $("filename").textContent = result.filename;
  const sources = [...new Set(entry.document.pages.map(p => p.source))].map(s => ({provided:"Word geometry", digital:"PDF text layer", ocr:"Local OCR"}[s])).join(" + ");
  $("file-meta").textContent = `${result.page_count} ${result.page_count === 1 ? "page" : "pages"} · ${sources}${entry.synthetic ? " · Synthetic example" : ""}`;
  $("metric-lines").textContent = result.line_items.length;
  $("metric-pages").textContent = `${result.page_count} ${result.page_count === 1 ? "page" : "pages"} processed`;
  const passes = result.checks.filter(c => c.status === "pass").length;
  $("metric-checks").textContent = `${passes} / ${result.checks.length}`;
  $("metric-flags").textContent = result.flags.length;
  $("metric-status").textContent = result.needs_review ? "A second look needed" : "No rule flags";
  $("status-badge").textContent = result.needs_review ? "Needs review" : "Checks passed";
  $("status-badge").className = `status-badge ${result.needs_review ? "review" : "good"}`;
  $("fields").replaceChildren();
  for (const [label, value] of [["Vendor",result.vendor],["Invoice number",result.invoice_number],["Invoice date",result.date],["Currency",result.currency]]) {
    const block = node("div"); block.append(node("dt", label), node("dd", value || "Needs review", value ? "" : "missing")); $("fields").append(block);
  }
  $("line-count").textContent = result.line_items.length;
  $("line-items").replaceChildren();
  result.line_items.forEach((line, index) => {
    const row = node("tr"); row.dataset.index = index;
    const description = node("td"), button = node("button", line.description, "line-button");
    button.setAttribute("aria-label", `Inspect source for ${line.description}, page ${line.page}`); button.addEventListener("click", () => highlight(index)); description.append(button);
    if (line.confidence < .8) description.append(node("span", "Check OCR", "line-low"));
    if (line.section || result.page_count > 1) description.append(node("span", [line.section, result.page_count > 1 ? `Page ${line.page}` : null].filter(Boolean).join(" · "), "line-section"));
    row.append(description, node("td", line.quantity === null ? "—" : Number(line.quantity).toLocaleString()), node("td", money(line.unit_price)), node("td", money(line.amount)));
    $("line-items").append(row);
  });
  if (!result.line_items.length) { const row = node("tr"), cell = node("td", "No charge rows found. Review the source document."); cell.colSpan = 4; row.append(cell); $("line-items").append(row); }
  $("totals").replaceChildren();
  for (const [label, key] of [["Subtotal","subtotal"],["Tax","tax"],["Shipping","shipping"],["Discount","discount"],["Invoice total","total"]]) {
    if (["tax","shipping","discount"].includes(key) && result[key] === null) continue;
    const row = node("div", undefined, `total-row${key === "total" ? " grand" : ""}`);
    row.append(node("span", label), node("span", (key === "discount" ? "− " : "") + money(result[key]))); $("totals").append(row);
  }
  $("math-checks").replaceChildren();
  const checkNames = {lines_match_subtotal:"Line items match subtotal",total_reconciles:"Invoice total reconciles",quantity_times_price:"Quantity × unit price",section_subtotal:"Job subtotal matches"};
  result.checks.forEach(check => {
    const row = node("div", undefined, `math-row ${check.status}`), description = node("div");
    description.append(node("strong", checkNames[check.name] || check.name));
    const detail = check.status === "unavailable" ? "A required amount was not found." : `${money(check.expected)} expected · ${money(check.actual)} found${check.status === "fail" ? ` · ${money(check.difference)} difference` : ""}`;
    description.append(node("small", detail));
    row.title = check.detail; row.append(icon(check.status === "pass" ? "check" : "alert"), description, node("span", {pass:"Passed",fail:"Mismatch",unavailable:"Not checked"}[check.status], "check-state")); $("math-checks").append(row);
  });
  $("review-flags").hidden = !result.flags.length; $("review-flags").replaceChildren();
  if (result.flags.length) {
    const heading = node("h4"); heading.append(icon("alert"), document.createTextNode("A second look is needed"));
    const list = node("ul"); for (const f of result.flags) list.append(node("li", `${f.message}${f.page ? ` (page ${f.page})` : ""}`));
    $("review-flags").append(heading, list);
  }
  $("confidence-note").textContent = `Rule confidence: ${Math.round(result.confidence * 100)}%. This is a heuristic, not a probability of accuracy. Review before accounting use.`;
  $("json-view").textContent = JSON.stringify(result, null, 2);
  $("page-select").replaceChildren(...entry.document.pages.map(p => { const option = node("option", `Page ${p.number} of ${result.page_count}`); option.value = p.number; return option; }));
  document.querySelectorAll("[data-sample]").forEach(button => button.classList.toggle("active", entry.sampleId === button.dataset.sample));
  showSource();
}

function highlight(index) {
  state.selected = index; state.page = state.active.extraction.line_items[index].page; state.original = false;
  $("page-select").value = state.page; $("clear-highlight").hidden = false;
  document.querySelectorAll("#line-items tr").forEach(row => row.classList.toggle("line-selected", Number(row.dataset.index) === index));
  showSource();
}
function showSource() {
  if (!state.active) return;
  const entry = state.active, page = entry.document.pages[state.page - 1];
  $("source-label").textContent = {provided:"Provided word geometry",digital:"PDF text layer geometry",ocr:"Local OCR word geometry"}[page.source];
  $("word-view").classList.toggle("selected", !state.original); $("word-view").setAttribute("aria-pressed", !state.original);
  $("original-view").classList.toggle("selected", state.original); $("original-view").setAttribute("aria-pressed", state.original);
  $("document-canvas").hidden = state.original;
  $("pdf-preview").hidden = $("image-preview").hidden = $("original-unavailable").hidden = true;
  if (!state.original) { requestAnimationFrame(drawDocument); return; }
  if (entry.originalType === "application/pdf") { $("pdf-preview").hidden = false; $("pdf-preview").src = `${entry.originalUrl}#page=${state.page}&toolbar=0&navpanes=0`; }
  else if (entry.originalType === "image") { $("image-preview").hidden = false; $("image-preview").src = entry.originalUrl; }
  else $("original-unavailable").hidden = false;
}
function drawDocument() {
  if (!state.active || state.original) return;
  const page = state.active.document.pages[state.page - 1], canvas = $("document-canvas");
  const displayWidth = canvas.getBoundingClientRect().width || 500;
  const scale = Math.min(2.5, window.devicePixelRatio || 1) * displayWidth / page.width;
  canvas.width = Math.ceil(page.width * scale); canvas.height = Math.ceil(page.height * scale);
  const ctx = canvas.getContext("2d"); ctx.scale(scale, scale); ctx.fillStyle = "white"; ctx.fillRect(0,0,page.width,page.height);
  if (state.selected !== null) {
    const item = state.active.extraction.line_items[state.selected];
    if (item.page === page.number) { const b = item.bbox; ctx.fillStyle = "#e8f0ff"; ctx.fillRect(b.x0 - 7,b.y0 - 5,b.x1 - b.x0 + 14,b.y1 - b.y0 + 10); ctx.strokeStyle = "#6d9cf0"; ctx.lineWidth = 1; ctx.strokeRect(b.x0 - 7,b.y0 - 5,b.x1 - b.x0 + 14,b.y1 - b.y0 + 10); }
  }
  for (const word of page.words) {
    const b = word.bbox, size = (b.y1 - b.y0) * .86;
    ctx.font = `${size}px Consolas, 'Courier New', monospace`; ctx.textBaseline = "top"; ctx.fillStyle = word.confidence < .8 ? "#aa781f" : "#283d58";
    ctx.fillText(word.text,b.x0,b.y0, b.x1 - b.x0 + 1);
  }
}

function csvCell(value) { let text = String(value ?? ""); if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"','""') + '"'; }
function exportData() {
  if (!state.active) return;
  const result = state.active.extraction, csv = $("export-format").value === "csv";
  const content = csv ? [
    ["vendor","invoice_number","date","currency","description","quantity","unit_price","amount","page","section","confidence","needs_review"].join(","),
    ...result.line_items.map(line => [result.vendor,result.invoice_number,result.date,result.currency,line.description,line.quantity,line.unit_price,line.amount,line.page,line.section,line.confidence,result.needs_review].map(csvCell).join(","))
  ].join("\r\n") : JSON.stringify(result,null,2);
  const blob = new Blob([content],{type:csv ? "text/csv;charset=utf-8" : "application/json"}), url = URL.createObjectURL(blob), link = node("a");
  link.href = url; link.download = result.filename.replace(/\.[^.]+$/," ").trim().replace(/[^a-zA-Z0-9_-]/g,"_") + `-extracted.${csv ? "csv" : "json"}`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
  toast(csv ? "Line items exported as CSV." : "Extraction, checks, and review flags exported as JSON.");
}

$("upload-button").addEventListener("click", () => $("file-input").click());
$("browse-button").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", event => upload(event.target.files[0]));
for (const type of ["dragover","dragenter"]) $("dropzone").addEventListener(type, event => { event.preventDefault(); $("dropzone").classList.add("dragover"); });
for (const type of ["dragleave","drop"]) $("dropzone").addEventListener(type, event => { event.preventDefault(); $("dropzone").classList.remove("dragover"); });
$("dropzone").addEventListener("drop", event => { const files = event.dataTransfer.files; if (files.length > 1) { showError("Upload one invoice at a time. Multi-page PDFs are supported."); return; } upload(files[0]); });
document.querySelectorAll("[data-sample]").forEach(button => button.addEventListener("click", () => loadSample(button.dataset.sample)));
$("more-samples").addEventListener("change", event => { if (event.target.value) loadSample(event.target.value); });
$("page-select").addEventListener("change", event => { state.page = Number(event.target.value); showSource(); });
$("word-view").addEventListener("click", () => { state.original = false; showSource(); });
$("original-view").addEventListener("click", () => { state.original = true; showSource(); });
$("clear-highlight").addEventListener("click", () => { state.selected = null; $("clear-highlight").hidden = true; document.querySelectorAll(".line-selected").forEach(row => row.classList.remove("line-selected")); drawDocument(); });
$("export-button").addEventListener("click", exportData);
function tab(json) { $("details-view").hidden = json; $("json-view").hidden = !json; $("details-tab").classList.toggle("selected",!json); $("json-tab").classList.toggle("selected",json); $("details-tab").setAttribute("aria-selected",!json); $("json-tab").setAttribute("aria-selected",json); }
$("details-tab").addEventListener("click", () => tab(false)); $("json-tab").addEventListener("click", () => tab(true));
for (const id of ["details-tab","json-tab"]) $(id).addEventListener("keydown", event => { if (["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) { event.preventDefault(); const json = event.key === "End" || (event.key !== "Home" && id === "details-tab"); tab(json); $(json ? "json-tab" : "details-tab").focus(); } });
$("guide-button").addEventListener("click", () => $("guide-dialog").showModal()); $("close-guide").addEventListener("click", () => $("guide-dialog").close());
$("guide-dialog").addEventListener("click", event => { if (event.target === $("guide-dialog")) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
$("workspace-nav").addEventListener("click", () => window.scrollTo({top:0,behavior:"smooth"}));
$("clear-session").addEventListener("click", () => { if (state.busy) return; state.entries.forEach(release); state.entries = []; state.active = null; $("results").hidden = true; $("empty-state").hidden = false; $("pdf-preview").src = "about:blank"; $("image-preview").removeAttribute("src"); renderHistory(); toast("Session cleared. No uploads were saved on the server."); });
new ResizeObserver(() => { if (state.active && !state.original) requestAnimationFrame(drawDocument); }).observe($("document-viewer"));
fetchJSON("/api/health").then(data => { $("ocr-status").textContent = data.ocr_available ? "Local Tesseract available" : "Digital PDF & JSON ready · Tesseract not installed"; }).catch(() => { $("ocr-status").textContent = "Local server unavailable"; });
loadSample("fleet-service");
