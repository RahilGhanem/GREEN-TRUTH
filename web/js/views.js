"use strict";
/* Views: the workspace (report → claims → evidence story) and demo mode.
   Both render the same evidence story (components.js), so a judge sees one
   consistent way of presenting evidence everywhere. */

const PIPELINE_STEPS = [
  ["Detect", "Extract claim statements via ClimateBERT or rule-based fallback"],
  ["Decompose", "Isolate historical deltas from future trajectory pledges"],
  ["Resolve", "Map facility or company to satellite basin centroid"],
  ["Observe", "Retrieve calibrated VIIRS Nightfire flaring time series"],
  ["Compare", "Compute empirical change vs claimed reduction rate"],
  ["Uncertainty", "90% residual bootstrap calibration & confidence band"],
  ["Evidence", "Cross-validate against national totals and Sentinel-5P methane"],
  ["Verdict", "Synthesize defensible audit verdict and limitations"],
];

/* ================================================================ workspace */

function renderWorkspaceEmpty() {
  const host = $("#wsResults");
  unmountCharts(host);
  const cov = state.meta && state.meta.coverage;
  host.innerHTML = `
    ${cov && !cov.has_real_data ? noDataState() : ""}
    <div class="panel onboard-card reveal">
      <span class="kicker">Orbital Evidence Pipeline</span>
      <h2 class="panel-title">Automated Satellite Verification for Climate Claims</h2>
      <ol class="story-preview">
        <li><b>1. Claim Decomposition</b><span>Extracts metric, baseline year, outcome year, and claimed reduction rate.</span></li>
        <li><b>2. Earth Observation</b><span>Queries multi-year VIIRS Nightfire satellite radiometric flare series.</span></li>
        <li><b>3. Uncertainty & Abstention</b><span>Calculates 90% bootstrap interval. Multi-zone spread triggers abstention.</span></li>
        <li><b>4. Multi-Sensor Corroboration</b><span>Cross-checks basin trend against national total and Sentinel-5P methane.</span></li>
        <li><b>5. Defensible Audit Verdict</b><span>Transparent audit trail detailing what observations establish.</span></li>
      </ol>
      <div class="row" style="margin-top:18px">
        <button class="btn btn-primary" type="button" data-case-go="1">Run Abstention Case</button>
        <button class="btn btn-ghost" type="button" data-go="demo">Guided Pipeline Demo</button>
      </div>
    </div>`;
  bindActs(host);
  $$("[data-case-go]", host).forEach(b => b.addEventListener("click", () => runCaseInWorkspace(+b.dataset.caseGo)));
}

function noDataState() {
  return stateCard({ tone: "bad", sym: "!", title: "Real evidence is currently unavailable",
    what: "The server started without the flaring observation series, so flaring claims cannot be checked.",
    why: "The real-data files have not been produced in this copy. GreenTruth never substitutes synthetic or generated data.",
    next: "Run the real-data pipeline to restore this evidence source, then restart the server.",
    extra: techDetails("Missing file: <code>data/real/flaring_by_field.csv</code>. It is produced by <code>notebooks/03_real_satellite_data_pipeline.ipynb</code> from the public World Bank release.") });
}

function renderLoading() {
  const host = $("#wsResults");
  unmountCharts(host);
  host.innerHTML = `<div class="panel"><p class="muted" style="display:flex;gap:10px;align-items:center;margin:0 0 16px">
      <span class="spinner dark"></span>Running the pipeline on real observations…</p>
    <div class="skel" style="height:120px"></div><div class="skel" style="height:260px;margin-top:20px"></div></div>`;
}

function renderError(msg, retry) {
  const host = $("#wsResults");
  unmountCharts(host);
  host.innerHTML = stateCard({ tone: "bad", sym: "!", title: "The analysis could not be completed",
    what: "No result was returned for this request, so nothing is shown in its place.",
    why: "The evidence server could not be reached, or it could not process this request.",
    next: "Make sure the GreenTruth server is running, then retry.",
    extra: techDetails(esc(msg)),
    actions: `<button class="btn btn-primary btn-sm" type="button" data-act="retry">Retry</button>` });
  const b = $('[data-act="retry"]', host);
  if (b) b.addEventListener("click", retry);
}

/* A one-line summary of the report plus a tab per atomic claim. */
function reportBar(r) {
  const s = r.summary, d = r.detector || {}, f = r.field;
  return `<div class="report-bar">
    <p class="rb-meta"><b>${s.total}</b> claim${s.total === 1 ? "" : "s"} found
      ${f ? ` · field <b>${esc(f.name)}</b>${r.field_ambiguous ? " (ambiguous)" : ""}` : " · no field resolved"}
      · detector <b>${d.detector === "climatebert" ? "ClimateBERT" : "rule-based"}</b>${d.fallback ? `
      <button class="linklike" type="button" data-act="det-why" aria-expanded="false">why?</button>` : ""}</p>
    ${d.fallback ? `<div class="det-note" hidden>The ClimateBERT model is not loaded in this deployment, so sentences were
      found by the transparent rule detector. Decomposition, evidence and verdicts work identically, but the rules find fewer
      claims${state.research && state.research.detector && state.research.detector.rule_based
        ? ` (measured claim recall ${fmtNum(state.research.detector.rule_based.recall_claim, 2)} vs ${fmtNum(state.research.detector.transformer.claim_recall, 2)})` : ""}.
      ${techDetails(`${esc(d.reason || "The rule detector was requested explicitly.")}<br>To load ClimateBERT, run the server from an environment with <code>torch</code> and <code>transformers</code> (see README).`)}</div>` : ""}
    ${r.claims.length > 1 ? `<div class="claim-tabs" role="tablist" aria-label="Claims in this report">${r.claims.map((c, i) => {
      const st = vstyle(c.verdict);
      return `<button type="button" role="tab" class="ctab tone-${st.tone}" data-i="${i}" aria-selected="${i === state.selected}">
        <span class="ctab-v"><span aria-hidden="true">${st.sym}</span> ${esc(shortLabel(c.verdict_label))}</span>
        <span class="ctab-t">${esc(c.text)}</span></button>`;
    }).join("")}</div>` : ""}
  </div>`;
}

function ambiguityNotice(r) {
  if (!r.field_ambiguous) return "";
  return stateCard({ compact: true, tone: "partial", sym: "?", title: "The field is ambiguous",
    what: `The selection matches ${r.field_candidates.length} monitored fields: ${r.field_candidates.map(esc).join(", ")}.`,
    why: `${esc(r.field.name)} was analysed. That choice is not evidence-based, and the evidence audit records it.`,
    next: "Choose the field the claim is about:",
    actions: r.field_candidates.map(n => `<button class="btn btn-ghost btn-sm" type="button" data-field="${esc(n)}">${esc(n)}</button>`).join("") });
}

function renderResult() {
  const r = state.result, host = $("#wsResults");
  unmountCharts(host);
  const notices = [r.coverage && !r.coverage.has_real_data ? noDataState() : "", ambiguityNotice(r)].join("");
  if (!r.claims.length) {
    host.innerHTML = reportBar(r) + notices + stateCard({ tone: "none", sym: "∅",
      title: "No checkable environmental claim found",
      what: "No sentence was recognised as a claim GreenTruth can check.",
      why: "A checkable claim needs a metric (for example gas flaring) plus a number, a period or an achievement/commitment verb. Narrative framing (“we care about the environment”) is deliberately not treated as a claim.",
      next: "Paste a sentence with a quantity and a period, or try a prepared case.",
      actions: `<button class="btn btn-primary btn-sm" type="button" data-act="demo-text">Load demo text</button>
                <button class="btn btn-ghost btn-sm" type="button" data-go="demo">Guided demo</button>` });
    bindActs(host);
    return;
  }
  host.innerHTML = reportBar(r) + notices + `<div id="wsStory"></div>`;
  bindActs(host);
  $$("[data-field]", host).forEach(b => b.addEventListener("click", () => {
    $("#fieldSel").value = b.dataset.field; analyze();
  }));
  const tabs = $$(".ctab", host);
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => selectClaim(i));
    b.addEventListener("keydown", e => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const j = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      tabs[j].focus(); selectClaim(j);
    });
  });
  renderSelected();
}

function selectClaim(i) {
  state.selected = i;
  $$(".ctab").forEach(b => b.setAttribute("aria-selected", String(+b.dataset.i === i)));
  renderSelected();
}

function renderSelected() {
  const r = state.result, c = r && r.claims[state.selected], host = $("#wsStory");
  if (!c || !host) return;
  unmountCharts(host);
  host.innerHTML = evidenceStory(c, r);
  $$(".story > *", host).forEach((el, i) => { el.classList.add("reveal"); el.style.setProperty("--i", i); });
  activateStory(host, c);
}

function bindActs(root) {
  $$("[data-go]", root).forEach(b => b.addEventListener("click", () => show(b.dataset.go)));
  $$('[data-act="demo-text"]', root).forEach(b => b.addEventListener("click", loadDemoText));
  $$('[data-act="det-why"]', root).forEach(b => b.addEventListener("click", () => {
    const n = $(".det-note", root);
    if (!n) return;
    n.hidden = !n.hidden;
    b.setAttribute("aria-expanded", String(!n.hidden));
  }));
}

/* ================================================================ demo mode */

const DEMO_STEPS = ["Detect", "Decompose", "Resolve", "Observe", "Compare", "Uncertainty", "Evidence", "Verdict"];

/* The two prepared server cases, plus the pledge from the backend's own demo
   text (/api/demo) so the 2030 trajectory is one click away. */
function allCases() {
  const base = state.cases && Array.isArray(state.cases.cases) ? state.cases.cases : [];
  const list = [...base];
  if (state.pledgeCase) list.push(state.pledgeCase);
  return list;
}
const focusIndex = (r, cs) => {
  if (!cs || !cs.focus) return 0;
  const i = r.claims.findIndex(c => c.claim.claim_type === cs.focus);
  return i >= 0 ? i : 0;
};
const CASE_TONE = { SUPPORTED: "ok", ABSTAIN: "abstain", TRAJECTORY: "traj-bad" };
const CASE_OUTCOME = { SUPPORTED: "Reaches a verdict", ABSTAIN: "Abstains — and says why", TRAJECTORY: "A pledge, projected" };

function caseButtonsHTML() {
  if (!state.cases) return stateCard({ compact: true, tone: "none", sym: "!", title: "Demo cases unavailable",
    what: "The prepared cases could not be loaded from the server.", next: "Check that the server is running and reload." });
  return allCases().map((c, i) => `
    <button class="case-btn tone-${CASE_TONE[c.expected] || "none"}" type="button" data-case="${i}">
      <span class="case-num">${i + 1}</span>
      <span><span class="t">${esc(c.title)}</span><span class="m">${esc(c.field)} · ${esc(CASE_OUTCOME[c.expected] || c.expected)}</span></span>
    </button>`).join("");
}

function renderDemoCases() {
  const host = $("#demoCases");
  if (!state.cases) { host.innerHTML = caseButtonsHTML(); return; }
  host.innerHTML = allCases().map((c, i) => `
    <button type="button" class="chapter tone-${CASE_TONE[c.expected] || "none"}" data-run="${i}" aria-pressed="${state.demo.active === i}">
      <span class="ch-n">Case ${i + 1} · ${esc(c.field)}</span>
      <span class="ch-t">${esc(c.title)}</span>
      <span class="ch-o">${esc(CASE_OUTCOME[c.expected] || "")}</span>
    </button>`).join("");
  $$("[data-run]", host).forEach(b => b.addEventListener("click", () => runDemo(+b.dataset.run)));
}

function stepOutputs(r, idx = 0) {
  const c = r.claims[idx];
  if (!c) return DEMO_STEPS.map((_, i) => i < 2 ? { out: i === 0 ? "no claim flagged" : "0 atomic claims" } : { na: true, out: "not reached" });
  const d = r.detector || {}, a = c.analysis, t = c.trajectory, ev = c.evidence;
  return [
    { out: `${d.detector === "climatebert" ? "ClimateBERT" : "Rule-based"}${c.claim.detector_score != null ? ` · score ${fmtNum(c.claim.detector_score, 2)}` : ""}` },
    { out: `${r.claims.length} claim${r.claims.length === 1 ? "" : "s"} · ${c.claim.claim_type_label}` },
    r.field ? { out: `${r.field.name}` } : { na: true, out: "no field resolved" },
    ev ? { out: `${ev.years.length} annual obs` } : { na: true, out: "no series" },
    a && a.observed_change != null ? { out: `${fmtPct(a.observed_change)} vs ${fmtPct(a.claimed_change)}` }
      : t && t.feasible ? { out: `projected to ${t.target.year}` } : { na: true, out: "not comparable" },
    a && a.interval ? { out: `${fmtPct(a.interval[0])} … ${fmtPct(a.interval[1])}` }
      : t && t.feasible ? { out: `band ${fmtNum(t.projection_at_target.lower, 2)}–${fmtNum(t.projection_at_target.upper, 2)}` } : { na: true, out: "not computed" },
    { out: `${LEVEL_LABEL[c.sufficiency.level] || c.sufficiency.level}` },
    { out: shortLabel(c.verdict_label) },
  ];
}

function stepperHTML(outs, running) {
  return `<ol class="stepper" aria-label="Pipeline progress">${DEMO_STEPS.map((n, i) => {
    const o = outs && outs[i];
    const cls = running ? "running" : o ? (o.na ? "na" : "done") : "";
    const badge = !running && o && !o.na ? `<span class="step-check" aria-hidden="true">${ICONS.pass || "✓"}</span>` : `${i + 1}`;
    return `<li class="step ${cls}" style="--i:${i}">
      <span class="sd" aria-hidden="true">${badge}</span>
      <span class="sn">${n}</span>
      <span class="so">${running ? "processing…" : o ? esc(o.out) : ""}</span>
      <span class="sr-only">${running ? "running" : o ? (o.na ? "not applicable" : "done") : ""}</span></li>`;
  }).join("")}</ol>`;
}

async function runDemo(i) {
  if (!state.cases || state.demo.running) return;
  const cs = allCases()[i];
  state.demo.active = i; state.demo.running = true;
  renderDemoCases();
  const host = $("#demoRun");
  unmountCharts(host);
  host.innerHTML = `<div class="panel">${stepperHTML(null, true)}</div>`;
  announce(`Running case ${i + 1}`);
  try {
    const t0 = performance.now();
    const r = await postJSON("/api/analyze", { text: cs.text, company: cs.field });
    const ms = performance.now() - t0;
    state.demo.result = r; state.demo.ms = ms;
    recordHistory(r);
    renderDemoResult(i, r, ms);
    const fc = r.claims[focusIndex(r, cs)];
    announce(`Case ${i + 1}: ${fc ? fc.verdict_label : "no claim"}`);
  } catch (e) {
    host.innerHTML = stateCard({ tone: "bad", sym: "!", title: "The demo case could not run",
      what: "No result was produced for this case, so nothing is shown in its place.",
      why: "The evidence server could not be reached, or the result could not be displayed.",
      next: "Make sure the GreenTruth server is running, then run the case again.",
      extra: techDetails(esc(e.message || String(e))),
      actions: `<button class="btn btn-primary btn-sm" type="button" data-run-again>Retry</button>` });
    const b = $("[data-run-again]", host);
    if (b) b.addEventListener("click", () => { state.demo.running = false; runDemo(i); });
  } finally {
    state.demo.running = false;
  }
}

function renderDemoResult(i, r, ms, sel = null) {
  const host = $("#demoRun"), cases = allCases(), cs = cases[i], focus = focusIndex(r, cs);
  const idx = sel ?? focus, c = r.claims[idx];
  const next = i + 1 < cases.length ? i + 1 : null;
  // A text that splits into several claims: show the split, and let each claim's story be opened here.
  const split = r.claims.length > 1 ? `<div class="demo-split">
      <p class="section-label">Report decomposed into ${r.claims.length} atomic claims — each checked independently</p>
      <div class="claim-tabs" role="tablist" aria-label="Claims in this case">${r.claims.map((k, j) => {
        const st = vstyle(k.verdict);
        return `<button type="button" role="tab" class="ctab tone-${st.tone}" data-claim="${j}" aria-selected="${j === idx}">
          <span class="ctab-v"><span class="ctab-ico" aria-hidden="true">${st.sym}</span> ${esc(shortLabel(k.verdict_label))}${j === focus ? " · this case" : ""}</span>
          <span class="ctab-t">${esc(k.text)}</span></button>`;
      }).join("")}</div></div>` : "";
  host.innerHTML = `
    <div class="panel demo-head">
      ${stepperHTML(stepOutputs(r, idx), false)}
      <p class="timing">Live pipeline executed in <b>${Math.round(ms)} ms</b></p>
      <div class="lookfor"><b>Case Focus:</b> ${esc(cs.what_to_look_for)}
        <span class="muted">${esc(cs.note || (state.cases ? state.cases.note : ""))}</span></div>
      ${split}
    </div>
    <div id="demoStory">${c ? evidenceStory(c, r) : stateCard({ title: "No claim detected", what: "The case text produced no checkable claim." })}</div>
    <div class="demo-next">
      ${next != null ? `<button class="btn btn-primary" type="button" data-next="${next}">Next: ${esc(cases[next].title)} →</button>` : `<button class="btn btn-primary" type="button" data-go="research">See the measured results →</button>`}
      <button class="btn btn-ghost" type="button" data-open-ws>Open in the workspace</button>
    </div>`;
  if (c) {
    $$(".story > *", host).forEach((el, k) => { el.classList.add("reveal"); el.style.setProperty("--i", k); });
    activateStory(host, c);
  }
  bindActs(host);
  $("[data-open-ws]", host).addEventListener("click", () => {
    $("#reportBox").value = cs.text;
    $("#fieldSel").value = cs.field;
    setDemoNote(cs);
    state.result = r; state.selected = idx;
    show("workspace");
    renderResult();
  });
  const pickClaim = k => {
    if (k === idx) return;
    unmountCharts(host);
    renderDemoResult(i, r, ms, k);
    const t = $(`[data-claim="${k}"]`, host);
    if (t) t.focus({ preventScroll: true });
    announce(`Showing claim ${r.claims[k].id}: ${r.claims[k].verdict_label}`);
  };
  $$("[data-claim]", host).forEach(b => {
    b.addEventListener("click", () => pickClaim(+b.dataset.claim));
    b.addEventListener("keydown", e => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const n = r.claims.length;
      pickClaim((+b.dataset.claim + (e.key === "ArrowRight" ? 1 : n - 1)) % n);
    });
  });
  $$("[data-next]", host).forEach(b => b.addEventListener("click", () => {
    $("#view-demo").scrollIntoView({ behavior: "smooth", block: "start" });
    runDemo(+b.dataset.next);
  }));
}

function recordHistory(r) {
  if (!r || !r.field) return;
  state.history.unshift({ fieldId: r.field.id, fieldName: r.field.name,
    claims: r.claims.map(c => {
      const a = c.analysis, t = c.trajectory, co = c.corroboration, m = c.methane;
      return {
        id: c.id, text: c.text, verdict: c.verdict, verdict_label: c.verdict_label,
        level: c.sufficiency && c.sufficiency.level,
        uncertainty: a && a.interval ? `${fmtPct(a.observed_change)} observed · 90% interval ${fmtPct(a.interval[0])} to ${fmtPct(a.interval[1])}`
          : t && t.feasible ? `projected ${t.target.year}: ${fmtNum(t.projection_at_target.value, 2)} (band ${fmtNum(t.projection_at_target.lower, 2)}–${fmtNum(t.projection_at_target.upper, 2)}) vs target ${fmtNum(t.target.value, 2)}` : null,
        national: co && co.available ? `${co.label}: field ${fmtPct(co.field_change)} vs national ${fmtPct(co.country_change)}` : null,
        methane: m ? (m.available ? `${m.label} (anomaly ${fmtSigned(m.anomaly_change_ppb, 1)} ppb)` : "unavailable for this field or window") : null,
      };
    }) });
  state.history = state.history.slice(0, 20);
}
