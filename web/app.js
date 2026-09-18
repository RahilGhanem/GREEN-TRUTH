"use strict";
/* GreenTruth interface — boot, landing, routing and the workspace input.
   Shared helpers live in js/util.js; components in js/components.js; views in
   js/views.js, js/pages.js and js/map.js. */

const VIEWS = ["demo", "workspace", "map", "research", "about"];
// Older links keep working: the claims list now lives in the workspace, and
// methodology and data sources are one page.
const VIEW_ALIASES = { claims: "workspace", method: "about", sources: "about" };
let casesReady = null;

init();

async function init() {
  initTheme();
  bindShell();
  bindWorkspace();

  casesReady = loadCases();
  getJSON("/api/research").then(d => { state.research = d; }).catch(() => {});
  getJSON("/api/fields").then(d => { state.fields = d.fields || []; }).catch(() => {});
  getJSON("/api/methane/coverage").then(d => { state.methaneCov = d; renderLandingFacts(); }).catch(() => {});
  await loadMeta();
  renderWorkspaceEmpty();
  route();
}

/* ------------------------------------------------------------------ theme */

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("gt-theme"); } catch { /* storage blocked */ }
  if (saved === "dark" || saved === "light") document.documentElement.dataset.theme = saved;
  syncThemeBtn();
  $("#themeBtn").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("gt-theme", next); } catch { /* not persisted */ }
    syncThemeBtn();
  });
}
function syncThemeBtn() {
  const dark = document.documentElement.dataset.theme === "dark";
  const b = $("#themeBtn");
  b.textContent = dark ? "◐ Light theme" : "◐ Dark theme";
  b.setAttribute("aria-pressed", String(dark));
}

/* ------------------------------------------------------- landing + routing */

function bindShell() {
  $$("[data-enter]").forEach(b => b.addEventListener("click", () => show(b.dataset.enter)));
  $("#watchDemoBtn").addEventListener("click", async () => {
    show("demo");
    await casesReady;
    if (state.cases) runDemo(0);
  });
  $("#homeBtn").addEventListener("click", () => goHome());
  $$(".menu-item").forEach(b => b.addEventListener("click", () => show(b.dataset.view)));
  window.addEventListener("popstate", route);
  window.addEventListener("hashchange", route);
}

function route() {
  const h = location.hash.replace("#", "");
  if (!h || h === "home") { goHome(false); return; }
  if ((VIEW_ALIASES[h] || h) === state.view && !$("#app").hidden) return;
  show(h, { push: false });
}

function enterApp() {
  if (!$("#app").hidden) return;
  $("#landing").hidden = true;
  $("#app").hidden = false;
  const v = $("#heroVideo");
  if (v) v.pause();
}

function goHome(push = true) {
  stopPlay();
  $("#app").hidden = true;
  $("#landing").hidden = false;
  state.view = null;
  const v = $("#heroVideo");
  if (v) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
  if (push) history.pushState(null, "", location.pathname);
  window.scrollTo({ top: 0 });
}

function show(view, { push = true } = {}) {
  view = VIEW_ALIASES[view] || view;
  if (!VIEWS.includes(view)) view = "workspace";
  enterApp();
  state.view = view;
  $$(".menu-item").forEach(b => b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"));
  $$(".view").forEach(v => { v.hidden = v.id !== `view-${view}`; });
  if (view !== "map") stopPlay();
  if (view === "map") ensureMap();
  if (view === "research") renderResearch();
  if (view === "about") renderAbout();
  if (view === "demo") renderDemoCases();
  if (push && location.hash !== `#${view}`) history.pushState(null, "", `#${view}`);
  window.scrollTo({ top: 0 });
  const h1 = $(`#view-${view} h1`);
  if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
}

/* ------------------------------------------------------------ server data */

async function loadMeta() {
  try {
    state.meta = await getJSON("/api/meta");
  } catch (e) {
    state.meta = null;
    $("#dataChip").innerHTML = `<span class="pip err"></span>Evidence server unreachable`;
    $("#detChip").innerHTML = `<span class="pip err"></span>Detector unknown`;
    renderLandingFacts(e);
    const sel = $("#fieldSel");
    sel.innerHTML = `<option value="">Fields unavailable — server unreachable</option>`;
    return;
  }
  const m = state.meta, cov = m.coverage || {}, d = m.detector || {};
  const sel = $("#fieldSel");
  sel.innerHTML = `<option value="">Detect from the report text</option>` +
    m.fields.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  sel.value = m.fields.includes("Bakken") ? "Bakken" : "";
  $("#dataChip").innerHTML = cov.has_real_data
    ? `<span class="pip"></span><b>${cov.n_observations}</b> real observations · ${cov.n_fields} fields · ${cov.year_min}–${cov.year_max}`
    : `<span class="pip warn"></span>Real evidence unavailable`;
  const det = $("#detChip");
  det.innerHTML = d.fallback
    ? `<span class="pip warn"></span>Detector: <b>rule-based</b> (fallback)`
    : `<span class="pip"></span>Detector: <b>${d.detector === "climatebert" ? "ClimateBERT" : esc(d.detector)}</b>`;
  det.setAttribute("aria-label", d.fallback
    ? "Claim detector: rule-based fallback. The ClimateBERT model is not loaded in this deployment."
    : "Claim detector: ClimateBERT, model inference running.");
  hover(det, d.fallback
    ? `<div class="tip-v">Rule-based fallback</div><div>The ClimateBERT model is not loaded in this deployment; the transparent rule detector is used and every result says so.</div>`
    : `<div class="tip-v">ClimateBERT</div><div>Fine-tuned claim detector · threshold ${d.threshold ?? "—"}</div>`);
  renderLandingFacts();
}

function renderLandingFacts(err) {
  const el = $("#landingFacts");
  if (err) {
    el.innerHTML = `<span class="fact"><span class="pip err"></span>Evidence server unreachable — start <b>python server.py</b> and reload.</span>`;
    return;
  }
  const m = state.meta;
  if (!m) return;
  const cov = m.coverage || {}, d = m.detector || {}, mc = state.methaneCov;
  const facts = [];
  facts.push(cov.has_real_data
    ? `<span class="fact"><span class="pip"></span><b>${cov.n_observations}</b> real annual observations</span>
       <span class="fact"><b>${cov.n_fields}</b> monitored fields · <b>${cov.year_min}–${cov.year_max}</b></span>
       <span class="fact">World Bank Global Gas Flaring Tracker (VIIRS)</span>`
    : `<span class="fact"><span class="pip warn"></span>No real observations loaded — flaring claims will report insufficient evidence</span>`);
  if (mc && mc.available) {
    const rows = Object.values(mc.coverage || {});
    facts.push(`<span class="fact">Sentinel-5P methane usable for <b>${rows.filter(r => r.usable).length} of ${rows.length}</b> fields</span>`);
  }
  facts.push(`<span class="fact"><span class="pip ${d.fallback ? "warn" : ""}"></span>Detector: <b>${d.fallback ? "rule-based (fallback)" : "ClimateBERT"}</b></span>`);
  el.innerHTML = facts.join("");
}

async function loadCases() {
  try {
    state.cases = await getJSON("/api/demo/cases");
  } catch {
    state.cases = null;
  }
  try {
    const d = await getJSON("/api/demo");
    state.pledgeCase = {
      title: "A 2030 pledge, checked against the observed path",
      field: d.suggested_field, text: d.text, expected: "TRAJECTORY", focus: "future_commitment",
      note: d.note,
      what_to_look_for: "One sentence, four claims. The 2030 pledge can't be checked yet, so the observed " +
        "trend is extended and compared with the path to the target. The methane and net-zero clauses have " +
        "no satellite channel, so they are listed, not checked.",
    };
  } catch { state.pledgeCase = null; }
  const host = $("#wsCases");
  host.innerHTML = caseButtonsHTML();
  $$("[data-case]", host).forEach(b => b.addEventListener("click", () => runCaseInWorkspace(+b.dataset.case)));
  if (state.view === "demo") renderDemoCases();
}

/* ------------------------------------------------------------- workspace */

function bindWorkspace() {
  $("#analyzeBtn").addEventListener("click", analyze);
  $("#demoTextBtn").addEventListener("click", loadDemoText);
  $("#clearBtn").addEventListener("click", () => {
    $("#reportBox").value = "";
    $("#demoNote").hidden = true;
    state.result = null; state.selected = null;
    renderWorkspaceEmpty();
    $("#reportBox").focus();
  });
  $("#reportBox").addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); analyze(); }
  });
  $("#reportBox").addEventListener("input", () => { $("#demoNote").hidden = true; });

  const drop = $("#fileDrop"), input = $("#fileInput");
  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", e => { if (e.target.files[0]) readFile(e.target.files[0]); input.value = ""; });
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
}

function readFile(file) {
  // Plain text only. A PDF/DOCX extractor would need a dependency the app does
  // not carry; saying so is better than silently mangling a binary file.
  if (!/\.(txt|md|markdown)$/i.test(file.name) && !(file.type || "").startsWith("text/")) {
    $("#wsResults").innerHTML = stateCard({ tone: "partial", sym: "!", title: "This file cannot be read",
      what: `“${esc(file.name)}” is not a plain-text file.`,
      why: "GreenTruth reads .txt and .md only. Extracting text from PDF or DOCX would need a dependency the app deliberately does not carry.",
      next: "Copy the report text and paste it into the report box." });
    return;
  }
  const r = new FileReader();
  r.onload = () => { $("#reportBox").value = r.result; $("#demoNote").hidden = true; analyze(); };
  r.onerror = () => { $("#wsResults").innerHTML = stateCard({ tone: "bad", sym: "!", title: "The file could not be read", what: esc(file.name), next: "Paste the text instead." }); };
  r.readAsText(file);
}

function setDemoNote(cs) {
  const note = $("#demoNote");
  note.innerHTML = `<strong>Demo case — ${esc(cs.title)}.</strong> ${esc(cs.note || (state.cases ? state.cases.note : ""))}`;
  note.hidden = false;
}

function runCaseInWorkspace(i) {
  const cs = allCases()[i];
  if (!cs) return;
  $("#reportBox").value = cs.text;
  $("#fieldSel").value = cs.field;
  setDemoNote(cs);
  if (state.view !== "workspace") show("workspace");
  analyze({ focus: cs.focus });
}

async function loadDemoText() {
  try {
    const d = await getJSON("/api/demo");
    if (state.view !== "workspace") show("workspace");
    $("#reportBox").value = d.text;
    if (d.suggested_field) $("#fieldSel").value = d.suggested_field;
    const note = $("#demoNote");
    note.innerHTML = `<strong>Demo text.</strong> ${esc(d.note)}`;
    note.hidden = false;
    analyze();
  } catch (e) {
    renderError(`Could not load the demo text (${e.message}).`, loadDemoText);
  }
}

async function analyze(opts = {}) {
  const text = $("#reportBox").value.trim();
  if (!text) {
    $("#wsResults").innerHTML = stateCard({ tone: "none", sym: "i", title: "Nothing to check yet",
      what: "The report box is empty.", next: "Paste a report or a public commitment, or load the demo text.",
      actions: `<button class="btn btn-primary btn-sm" type="button" data-act="demo-text">Load demo text</button>` });
    bindActs($("#wsResults"));
    $("#reportBox").focus();
    return;
  }
  const btn = $("#analyzeBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Checking…';
  renderLoading();
  announce("Checking claims");
  try {
    const r = await postJSON("/api/analyze", { text, company: $("#fieldSel").value || null });
    state.result = r;
    state.selected = r.claims.length ? focusIndex(r, opts) : null;
    recordHistory(r);
    renderResult();
    announce(r.claims.length ? `${r.claims.length} atomic claim${r.claims.length === 1 ? "" : "s"} checked. First verdict: ${r.claims[0].verdict_label}.`
      : "No checkable claim detected.");
  } catch (e) {
    renderError(e.message || String(e), analyze);
  } finally {
    btn.disabled = false;
    btn.textContent = "Check claims";
  }
}
