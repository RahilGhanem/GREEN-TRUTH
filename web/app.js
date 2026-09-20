"use strict";
/* GreenTruth interface — boot, landing, routing and the workspace input.
   Shared helpers live in js/util.js; components in js/components.js; views in
   js/views.js, js/pages.js and js/map.js. */

const VIEWS = ["demo", "workspace", "map", "research", "about"];
// Older links keep working: the claims list now lives in the workspace, and
// methodology and data sources are one page.
const VIEW_ALIASES = { claims: "workspace", method: "about", sources: "about" };
const DEFAULT_FIELDS = [
  "Bakken", "Cantarell / Campeche", "Hassi Messaoud", "Hassi R'Mel", "Lake Maracaibo",
  "Niger Delta", "Permian Basin", "Priobskoye / West Siberia", "Rumaila / Basra",
  "Sirte Basin", "South Pars / Asaluyeh", "Tengiz"
];

const DEFAULT_META = {
  fields: DEFAULT_FIELDS,
  unit: "billion m3 flared per year",
  has_real_data: true,
  claim_source: "World Bank Zero Routine Flaring by 2030 (ZRF)",
  coverage: {
    has_real_data: true,
    n_observations: 156,
    n_fields: 12,
    year_min: 2012,
    year_max: 2024
  },
  detector: { detector: "rule-based", fallback: true }
};

const DEFAULT_CASES = [
  {
    id: "case1",
    title: "Evidence supports the claim",
    field: "Niger Delta",
    text: "We reduced routine gas flaring by 40% by 2023 from 2012 levels.",
    what_to_look_for: "−42% observed against −40% claimed. The 90% range (−44% to −13%) touches two outcomes, so the verdict is Supported but borderline. Methane data is too sparse here (24% of months), so the evidence is only partially sufficient.",
    expected: "SUPPORTED"
  },
  {
    id: "case2",
    title: "Evidence cannot decide, and instruments disagree",
    field: "Permian Basin",
    text: "We reduced routine gas flaring by 25% from 2019 levels.",
    what_to_look_for: "−29% looks like success, but the 90% range runs from −25% to +127%, so GreenTruth abstains. Methane rose +12.1 ppb above the background while flaring fell: flagged as tension, not as wrongdoing.",
    expected: "ABSTAIN"
  }
];

const DEFAULT_DEMO = {
  text: "We reduced routine gas flaring by 40% from 2019 levels and will eliminate routine flaring by 2030. We also cut methane emissions by 30% and are committed to reaching net zero by 2050.",
  suggested_field: "Bakken",
  note: "Written for the demo, not quoted from any company. The data it is checked against is real.",
  is_demo: true
};

let casesReady = null;

init();

async function init() {
  initTheme();
  bindShell();
  bindWorkspace();

  // Instant hydration so the page is operational from millisecond 0
  state.meta = DEFAULT_META;
  renderLandingFacts();
  renderDetector(DEFAULT_META.detector);
  const sel = $("#fieldSel");
  if (sel) {
    sel.innerHTML = `<option value="">Detect from the report text</option>` +
      DEFAULT_FIELDS.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
    sel.value = "Bakken";
  }

  casesReady = loadCases();
  loadMeta().catch(() => {});
  getJSON("/api/research").then(d => { state.research = d; }).catch(() => {});
  getJSON("/api/fields").then(d => { state.fields = d.fields || []; }).catch(() => {});
  getJSON("/api/methane/coverage").then(d => { state.methaneCov = d; renderLandingFacts(); }).catch(() => {});
  renderWorkspaceEmpty();
  route();
}

/* ------------------------------------------------------------------ theme */

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("gt-theme"); } catch { /* storage blocked */ }
  if (saved === "dark" || saved === "light") document.documentElement.dataset.theme = saved;
  // Guaranteed default: dark mode unless user explicitly selected light
  const theme = saved === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  syncThemeBtn();
  $("#themeBtn").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("gt-theme", next); } catch { /* not persisted */ }
    syncThemeBtn();
    if (state.globe3d) state.globe3d.draw();
  });
}
function syncThemeBtn() {
  const dark = document.documentElement.dataset.theme === "dark";
  const b = $("#themeBtn");
  if (!b) return;
  b.innerHTML = dark
    ? `${ICONS.sun}<span>Light mode</span>`
    : `${ICONS.moon}<span>Dark mode</span>`;
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
    state.meta = state.meta || DEFAULT_META;
  }
  const m = state.meta || DEFAULT_META, cov = m.coverage || {}, d = m.detector || {};
  const sel = $("#fieldSel");
  if (sel && m.fields) {
    sel.innerHTML = `<option value="">Detect from the report text</option>` +
      m.fields.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
    if (!sel.value) sel.value = m.fields.includes("Bakken") ? "Bakken" : "";
  }
  const dc = $("#dataChip");
  if (dc) {
    dc.innerHTML = cov.has_real_data
      ? `<span class="pip"></span><b>${cov.n_observations}</b> real observations · ${cov.n_fields} fields · ${cov.year_min}–${cov.year_max}`
      : `<span class="pip warn"></span>Real evidence unavailable`;
  }
  renderDetector(d);
  renderLandingFacts();
  // The model loads on first use. /api/meta never waits for it; /api/health
  // loads it and reports which detector actually runs.
  if (d.detector === "pending") {
    getJSON("/api/health").then(h => {
      if (state.meta && h && h.detector) { state.meta.detector = h.detector; renderDetector(h.detector); renderLandingFacts(); }
    }).catch(() => {});
  }
}

// "ClimateBERT" only when the backend says the model is running; otherwise the fallback or "loading".
function detKind(d) {
  if (!d) return "rules";
  if (d.detector === "climatebert" && d.fallback === false) return "model";
  if (d.detector === "pending") return "pending";
  return "rules";
}

function renderDetector(d) {
  const det = $("#detChip"), k = detKind(d);
  if (!det) return;
  det.innerHTML = k === "model" ? `<span class="pip"></span>Detector: <b>ClimateBERT</b>`
    : k === "pending" ? `<span class="pip idle"></span>Detector: <b>loading…</b>`
    : `<span class="pip warn"></span>Detector: <b>rule-based</b> (fallback)`;
  det.setAttribute("aria-label", k === "model" ? "Claim detector: ClimateBERT, model inference running on CPU."
    : k === "pending" ? "Claim detector: loading."
    : "Claim detector: rule-based fallback. The ClimateBERT model is not loaded in this deployment.");
  hover(det, k === "model"
    ? `<div class="tip-v">ClimateBERT</div><div>Fine-tuned claim detector · CPU · threshold ${d.threshold ?? "—"}</div>`
    : k === "pending" ? `<div class="tip-v">Loading the claim detector</div><div>The model loads on first use.</div>`
    : `<div class="tip-v">Rule-based fallback</div><div>The ClimateBERT model is not loaded in this deployment; the transparent rule detector is used and every result says so.</div>`);
}

function renderLandingFacts(err) {
  const el = $("#landingFacts");
  if (!el) return;
  const m = state.meta || DEFAULT_META;
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
  const k = detKind(d);
  facts.push(`<span class="fact"><span class="pip ${k === "rules" ? "warn" : k === "pending" ? "idle" : ""}"></span>Detector: <b>${k === "model" ? "ClimateBERT" : k === "pending" ? "loading…" : "rule-based (fallback)"}</b></span>`);
  el.innerHTML = facts.join("");
}

async function loadCases() {
  try {
    const d = await getJSON("/api/demo/cases");
    state.cases = d && Array.isArray(d.cases) ? d : { cases: DEFAULT_CASES, note: DEMO_NOTE };
  } catch {
    state.cases = { cases: DEFAULT_CASES, note: DEMO_NOTE };
  }
  if (!state.cases || !Array.isArray(state.cases.cases) || !state.cases.cases.length) {
    state.cases = { cases: DEFAULT_CASES, note: DEMO_NOTE };
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
  } catch {
    const d = DEFAULT_DEMO;
    state.pledgeCase = {
      title: "A 2030 pledge, checked against the observed path",
      field: d.suggested_field, text: d.text, expected: "TRAJECTORY", focus: "future_commitment",
      note: d.note,
      what_to_look_for: "One sentence, four claims. The 2030 pledge can't be checked yet, so the observed " +
        "trend is extended and compared with the path to the target. The methane and net-zero clauses have " +
        "no satellite channel, so they are listed, not checked.",
    };
  }
  const host = $("#wsCases");
  if (host) {
    host.innerHTML = caseButtonsHTML();
    $$("[data-case]", host).forEach(b => b.addEventListener("click", () => runCaseInWorkspace(+b.dataset.case)));
  }
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
