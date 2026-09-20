"use strict";
/* Research results (three experiments) and the Method & data reference page. */

/* =============================================================== research */

function experiment({ n, source, question, headline, sub, figure, caption, shows, notShows, details }) {
  return `<section class="panel experiment" aria-labelledby="exp-${n}">
    <div class="exp-head">
      <span class="measured-tag">Experiment ${n} · ${source}</span>
      <h2 class="panel-title" id="exp-${n}">${question}</h2>
    </div>
    <div class="exp-grid">
      <div class="exp-headline">
        <div class="big-figure">${headline}</div>
        <p class="exp-sub">${sub}</p>
        <div class="shows"><div class="k ok">Shows</div><p>${shows}</p>
          <div class="k no">Does not show</div><p>${notShows}</p></div>
      </div>
      <figure class="exp-fig">${figure}<figcaption>${caption}</figcaption></figure>
    </div>
    ${details}
  </section>`;
}

async function renderResearch() {
  const el = $("#researchBody");
  let d = state.research;
  if (!d) {
    try { d = state.research = await getJSON("/api/research"); }
    catch (e) {
      el.innerHTML = stateCard({ tone: "bad", sym: "!", title: "Measured results could not be loaded",
        what: "The server did not return the research results.", next: "Reload once the server is running.", extra: techDetails(esc(e.message)) });
      return;
    }
  }
  if (!d.available) {
    el.innerHTML = stateCard({ tone: "none", sym: "∅", title: "No measured results in this copy",
      what: "The evaluation registry has not been built.", next: "Rebuild it from the executed notebook results. Nothing is shown in place of a missing measurement.",
      extra: techDetails("Missing: <code>evaluation/experiment_registry.json</code> — built by <code>python scripts/build_experiment_registry.py</code>.") });
    return;
  }
  const det = d.detector, t = det && det.transformer, rb = det && det.rule_based;
  const iv = d.interval, ab = d.ablation, methods = d.calibration_methods || [];
  const F = ab && ab.configurations && ab.configurations.F_full_system;
  const cmpRow = (label, a, b) => `<div class="cmp-row">
      <div class="cl"><span>${label}</span><span><b>${fmtNum(a, 2)}</b> · ${b == null ? "—" : fmtNum(b, 2)}</span></div>
      <div class="cmp-track" title="ClimateBERT ${fmtNum(a, 4)}"><div class="cmp-fill" data-w="${a * 100}" style="background:var(--green-ink)"></div></div>
      ${b != null ? `<div class="cmp-track thin" title="Rule-based ${fmtNum(b, 4)}"><div class="cmp-fill" data-w="${b * 100}" style="background:var(--grey)"></div></div>` : ""}
    </div>`;
  const cm = m => m ? `<table class="table table-condensed cm"><thead><tr><th></th><th>pred. not claim</th><th>pred. claim</th></tr></thead>
    <tbody><tr><th>not claim</th><td>${m[0][0]}</td><td>${m[0][1]}</td></tr><tr><th>claim</th><td>${m[1][0]}</td><td>${m[1][1]}</td></tr></tbody></table>` : "—";

  const exp1 = t ? experiment({
    n: 1, source: "executed notebook 02", question: "Can the claims be found?",
    headline: `${fmtNum(t.claim_recall, 2)} <small>claim recall</small>`,
    sub: `ClimateBERT finds ${Math.round(t.claim_recall * 100)}% of the claims in ${det.n_test} test sentences; the rules find ${rb ? Math.round(rb.recall_claim * 100) : "—"}%. Macro-F1 ${fmtNum(t.macro_f1, 4)} vs ${rb ? fmtNum(rb.macro_f1, 4) : "—"}.`,
    figure: `<div class="cmp">
        <div class="legend" style="margin:0 0 4px"><span class="li"><span class="sw-bar" style="background:var(--green-ink)"></span>ClimateBERT</span>
          <span class="li"><span class="sw-bar" style="background:var(--grey)"></span>Rule-based fallback</span></div>
        ${cmpRow("Claim recall", t.claim_recall, rb && rb.recall_claim)}
        ${cmpRow("Claim precision", t.claim_precision, rb && rb.precision_claim)}
        ${cmpRow("Claim F1", t.claim_f1, rb && rb.f1_claim)}
        ${cmpRow("Macro F1", t.macro_f1, rb && rb.macro_f1)}
        ${cmpRow("Accuracy", t.accuracy, rb && rb.accuracy)}</div>`,
    caption: `<b>Figure 1.</b> Same test split for both (<code>climatebert/environmental_claims</code>, n = ${det.n_test}, ${Math.round(det.positive_rate * 100)}% claims, threshold ${det.shipped_threshold}).`,
    shows: "How many claims each detector finds, and why the rules are only a fallback.",
    notShows: "Whether a claim is true (finding is not checking), or performance on other text or languages.",
    details: techDetails(`<div class="grid-2" style="gap:16px"><div><b>ClimateBERT</b>${cm(t.confusion_matrix)}</div><div><b>Rule-based</b>${cm(rb && rb.confusion_matrix)}</div></div>
      <p style="margin-top:10px">ROC AUC ${fmtNum(det.roc_auc, 4)} · Brier ${fmtNum(det.brier, 4)}. A threshold of ${det.best_threshold} scored macro-F1 ${fmtNum(det.best_threshold_macro_f1, 4)}, but it was selected on the test split, so it is diagnostic only and is not used.</p>
      <p>Source: <code>notebooks/executed/02_claim_detector_evaluation.ipynb</code> → <code>evaluation/experiment_registry.json</code>; rule arm <code>scripts/eval_rule_detector.py</code> → <code>evaluation/rule_baseline_metrics.json</code>.</p>`, "Confusion matrices, calibration and source"),
  }) : "";

  const exp2 = iv ? experiment({
    n: 2, source: "executed notebook 05", question: "Is the uncertainty honest?",
    headline: `${pct1(iv.marginal_coverage)} <small>coverage at a ${Math.round(iv.nominal * 100)}% target</small>`,
    sub: `Testing one held-out field at a time (${iv.n_fields} fields, ${iv.n_observations} changes), the 90% range held the real change ${pct1(iv.marginal_coverage)} of the time, but only ${pct1(iv.conditional_range[0])} at 3–4-year gaps.`,
    figure: `<div class="chart-host" data-chart="gap"></div>
      <table class="table table-condensed methods"><thead><tr><th>Interval method</th><th class="num-c">Coverage</th><th class="num-c">Median width</th></tr></thead>
        <tbody>${methods.map(m => `<tr class="${m.is_shipped ? "sel" : ""}"><td>${esc(m.method.replace(/^[ABC]\. /, ""))}${m.is_shipped ? " <span class=\"tag tag-obs\">used</span>" : ""}</td>
          <td class="num-c">${fmtNum(m.marginal_coverage, 4)}</td><td class="num-c">${fmtNum(m.median_width, 3)}</td></tr>`).join("")}</tbody></table>`,
    caption: `<b>Figure 2.</b> Coverage by gap between baseline and outcome; hollow points fall more than 3 points short. The conformal alternatives cover about the same but are ~50% wider.`,
    shows: "How often the range that decides abstention really contains the change. Each verdict quotes the figure for its own gap.",
    notShows: "A guarantee for any single verdict: 12 fields can reveal miscalibration, not rule it out.",
    details: techDetails(`Mean conditional deviation: ${methods.map(m => `${esc(m.method)} ${fmtNum(m.mean_abs_conditional_deviation, 4)}`).join(" · ")}. Protocol: ${esc(iv.protocol)}.<br>Source: <code>notebooks/executed/05_uncertainty_calibration.ipynb</code> → <code>evaluation/experiment_registry.json</code>.`, "Method comparison and source"),
  }) : "";

  const h = ab && ab.headline;
  const withheld = h ? h.unsupported_verdicts_prevented : 0, total = h ? h.of_verdicts_a_point_estimate_would_issue : 0;
  const exp3 = ab ? experiment({
    n: 3, source: "executed notebook 06", question: "What does taking uncertainty seriously change?",
    headline: `${withheld} <small>of ${total} verdicts withheld</small>`,
    sub: `On ${total} test claims from real data, trusting the single estimate answers all of them. Letting the 90% range decide withholds ${withheld} (${pct1(h.prevention_rate)}). Not an accuracy figure: a withheld verdict is not a wrong one.`,
    figure: `<div class="dve" role="img" aria-label="Point-estimate system: ${total} verdicts. With uncertainty: ${total - withheld} verdicts and ${withheld} abstentions.">
        <div class="dve-row"><span class="dve-l">Point estimate only</span><span class="dve-bar"><span class="seg v" style="width:100%">${total} verdicts</span></span></div>
        <div class="dve-row"><span class="dve-l">Interval decides</span><span class="dve-bar"><span class="seg v" style="width:${(total - withheld) / total * 100}%">${total - withheld}</span><span class="seg a" style="width:${withheld / total * 100}%">${withheld} abstain</span></span></div>
      </div>
      <div class="chart-host" data-chart="win" style="margin-top:18px"></div>`,
    caption: `<b>Figure 3.</b> Top: without and with the uncertainty check. Bottom: abstention by claim length; longer claims are decided more often. Sources disagreed on ${pct1(h.cross_source_disagreement_rate)} of assessed claims.`,
    shows: "How often real observations are too uncertain to settle a claim, and how that depends on claim length.",
    notShows: "Accuracy: the test claims sit near the observed change, and no true/false claim set exists.",
    details: techDetails(`<table class="table table-condensed"><thead><tr><th>Configuration</th><th>Adds</th></tr></thead><tbody>${Object.values(ab.configurations).map(cf => `<tr><td class="nowrap"><b>${esc(cf.name)}</b></td><td>${esc(cf.adds)}</td></tr>`).join("")}</tbody></table>
      ${F ? `<p style="margin-top:10px">Full system: ${Object.entries(F.synthesis_states).filter(([, v]) => v).map(([k, v]) => `${esc(k.replace(/_/g, " "))} ${pct1(v)}`).join(" · ")}. Sufficiency: ${Object.entries(F.sufficiency_levels).map(([k, v]) => `${esc(LEVEL_LABEL[k] || k)} ${pct1(v)}`).join(" · ")}. Independent instrument available for ${pct1(F.independent_instrument_rate)} of probes (most windows start before Sentinel-5P's 2019 launch).</p>` : ""}
      <p>Source: <code>scripts/run_ablation.py</code> (wrapped by notebook 06, re-executed for this build) → <code>evaluation/ablation_results.json</code>. Every observation is real; probe claims are labelled as probes.</p>`, "Configurations, synthesis states and source"),
  }) : "";

  el.innerHTML = `
    ${exp1}${exp2}${exp3}
    <section class="panel">
      ${techDetails(`Registry built from <code>${esc((d.provenance || {}).built_from || "")}</code> by <code>scripts/build_experiment_registry.py</code>. ${esc((d.provenance || {}).integrity_rule || "")}`, "Where every number comes from")}
    </section>`;

  requestAnimationFrame(() => $$(".cmp-fill", el).forEach(f => { f.style.width = f.dataset.w + "%"; }));
  if (iv) mountChart($('[data-chart="gap"]', el), hst => drawCoverageByGap(hst, iv.coverage_by_gap, iv.nominal));
  if (ab && ab.abstention_by_window_length) mountChart($('[data-chart="win"]', el), hst => drawAbstentionByWindow(hst, ab.abstention_by_window_length));
}

/* ======================================================= method & data */

async function renderAbout() {
  const el = $("#aboutBody");
  if (!state.meta) {
    el.innerHTML = stateCard({ tone: "bad", sym: "!", title: "Server unreachable", what: "Reference information could not be loaded.", next: "Start the server and reload." });
    return;
  }
  if (!state.methaneCov) { try { state.methaneCov = await getJSON("/api/methane/coverage"); } catch { /* shown as unavailable */ } }
  const vocab = state.meta.verdict_vocabulary || [], cov = state.meta.coverage || {}, mc = state.methaneCov;
  const chan = state.meta.unavailable_channels || {}, cal = state.research && state.research.interval;
  const names = {}; (state.fields || []).forEach(f => { names[f.id] = f.name; });
  const mRows = mc && mc.coverage ? Object.entries(mc.coverage).sort((p, q) => q[1].completeness - p[1].completeness) : [];
  // backend text may list field ids; show the field names a reader knows
  const withNames = txt => Object.entries(names).reduce((t, [id, nm]) => t.split(id).join(nm), String(txt || ""));

  el.innerHTML = `
    <nav class="subnav" aria-label="On this page">
      <a href="#m-how" data-jump>How it decides</a><a href="#m-verdicts" data-jump>Verdicts</a><a href="#m-data" data-jump>Data</a><a href="#m-limits" data-jump>Limitations</a>
    </nav>

    <section class="panel" id="m-how">
      <h2 class="panel-title">How GreenTruth decides</h2>
      <ol class="pipeline-h">${PIPELINE_STEPS.map(([nm, dsc], i) => `<li class="ph"><b>${i + 1} · ${nm}</b><span>${dsc}</span></li>`).join("")}</ol>
      <div class="grid-2" style="margin-top:26px">
        <div>
          <h3 class="panel-title-sm">The interval decides, not the point estimate</h3>
          <svg viewBox="0 0 520 150" width="100%" role="img" aria-label="Schematic, not data: four outcome bands and three example intervals — inside one band gives a verdict, two neighbouring bands gives a borderline verdict, three or more gives an abstention">
            <rect x="10" y="10" width="140" height="112" fill="var(--green-tint)"/><rect x="150" y="10" width="120" height="112" fill="var(--amber-tint)"/>
            <rect x="270" y="10" width="70" height="112" fill="var(--grey-tint)"/><rect x="340" y="10" width="170" height="112" fill="var(--red-tint)"/>
            <g font-size="11" font-weight="700" text-anchor="middle">
              <text x="80" y="27" fill="var(--green-ink)">met the claim</text><text x="210" y="27" fill="var(--amber-ink)">fell, by less</text>
              <text x="305" y="27" fill="var(--grey-ink)">flat ±5%</text><text x="425" y="27" fill="var(--red-ink)">rose</text></g>
            <g fill="var(--c-interval)"><rect x="40" y="46" width="80" height="9" rx="2"/><rect x="110" y="72" width="90" height="9" rx="2"/><rect x="120" y="98" width="300" height="9" rx="2"/></g>
            <g font-size="11" fill="var(--text-2)"><text x="128" y="54">one band → verdict</text><text x="208" y="80">two → borderline</text><text x="426" y="106">three+ → abstain</text></g>
            <text x="10" y="142" font-size="11" fill="var(--muted)">Schematic, not data.</text>
          </svg>
          ${cal ? `<p class="prose">No analytical guarantee: measured coverage ${pct1(cal.marginal_coverage)} (nominal ${Math.round(cal.nominal * 100)}%). Each verdict quotes the figure for its own gap.</p>` : ""}
        </div>
        <div>
          <h3 class="panel-title-sm">Observed is never drawn like projected</h3>
          <div class="legend" style="flex-direction:column;gap:10px;margin:12px 0 0">
            <span class="li">${legendSample("observed")}<b>Observed</b>&nbsp;— straight from the source dataset</span>
            <span class="li">${legendSample("claimed")}<b>Claimed</b>&nbsp;— arithmetic on the claim itself</span>
            <span class="li">${legendSample("projected")}<b>Projected</b>&nbsp;— linear trend, never a measurement</span>
            <span class="li">${legendSample("band")}<b>Projection band</b>&nbsp;— 90% residual bootstrap</span>
            <span class="li">${legendSample("required")}<b>Required</b>&nbsp;— path needed to meet a target</span>
            <span class="li">${legendSample("target")}<b>Target</b>&nbsp;— what was committed</span>
          </div>
          <p class="prose" style="margin-top:14px">Other sources (the national total from the same satellite, and methane from a different
            one) are shown side by side, never combined into a score.</p>
        </div>
      </div>
    </section>

    <section class="panel" id="m-verdicts">
      <h2 class="panel-title">Verdicts</h2>
      <p class="panel-sub">Consistency statements about observations — never about intent or honesty. Five of the ten are valid “cannot decide” outcomes.</p>
      ${vocab.length ? `<div class="table-wrap"><table class="table table-condensed"><tbody>${vocab.map(v =>
        `<tr><td class="nowrap">${vbadge({ verdict: v.id, verdict_label: v.label })}</td><td>${esc(v.meaning)}</td></tr>`).join("")}</tbody></table></div>`
        : stateCard({ compact: true, title: "Vocabulary unavailable", what: "The server did not return the verdict vocabulary." })}
    </section>

    <section class="panel" id="m-data">
      <h2 class="panel-title">Data</h2>
      <p class="panel-sub">${cov.has_real_data ? `<b>${cov.n_observations}</b> real annual observations for <b>${cov.n_fields}</b> fields, ${cov.year_min}–${cov.year_max}; national totals for ${cov.n_countries} countries.` : "Real evidence is currently unavailable in this copy."}
        No synthetic data is used anywhere.</p>
      <div class="grid-3" style="margin-top:18px">
        ${[["Field flaring", "Primary evidence — the only source that issues verdicts", "World Bank Global Gas Flaring Tracker", "VIIRS (Suomi-NPP / NOAA-20)", "Annual, 2012–2024 · flares grouped to each field by radius", "https://www.worldbank.org/en/programs/gasflaringreduction/global-flaring-data", "ok"],
           ["National flaring", "Cross-scale context — same instrument, not independent", "World Bank Global Gas Flaring Tracker (country totals)", "VIIRS — same instrument", "Annual, 2012–2024 · national totals", "https://www.worldbank.org/en/programs/gasflaringreduction/global-flaring-data", "none"],
           ["Methane anomaly", "Independent instrument — a different satellite", "Sentinel-5P / TROPOMI OFFL L3 CH4 (Copernicus)", "TROPOMI — ~7 km, regional", "Monthly, 2019–2024 · background-corrected", "https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_CH4", "abstain"]]
          .map(([nm, role, ds, inst, res, url, tone]) => `<div class="dcard tone-${tone}"><span class="kicker">${role}</span><h3 class="panel-title-sm">${nm}</h3>
            <p class="prose" style="margin:6px 0 0">${ds}<br><span class="muted">${inst} · ${res}</span></p><p style="margin:8px 0 0">${link(url, "Official source")}</p></div>`).join("")}
      </div>
      <div class="grid-2" style="margin-top:24px">
        <div>
          <h3 class="panel-title-sm">Where the independent satellite can be used</h3>
          ${mc && mc.available ? `<div class="table-wrap"><table class="table table-condensed"><thead><tr><th>Field</th><th class="num-c">Months retrieved</th><th>Status</th></tr></thead>
            <tbody>${mRows.map(([id, v]) => `<tr><td>${esc(names[id] || id)}</td><td class="num-c">${pct1(v.completeness)}</td>
              <td>${v.usable ? "✓ usable" : "✕ too sparse — refused"}</td></tr>`).join("")}</tbody></table></div>
            <p class="hint">Retrievals fail over water, under cloud and over dark surfaces. Fields below ${pct1(mc.min_completeness_required)} of months are refused, not interpolated.</p>`
            : `<p class="prose">The methane series is not loaded in this copy.</p>${techDetails("Missing: <code>data/real/methane_by_field_s5p.csv</code> — produced by notebook 03, Part B (free Earth Engine account).")}`}
        </div>
        <div>
          <h3 class="panel-title-sm">Declared, not hidden</h3>
          ${Object.values(chan).map(c => `<div class="decl"><b>${esc(c.name)}</b><p>${esc(withNames(c.why_unavailable))}</p></div>`).join("") || `<p class="prose">Every documented channel is available.</p>`}
          <p class="prose" style="margin-top:12px">Claim-side reference: the World Bank <em>Zero Routine Flaring by 2030</em> initiative
            (not ingested; demo claims are written for the demo). Map outlines: Natural Earth, public domain — no value is derived from them.</p>
          ${techDetails(`Source label in the data: <span class="mono">${esc(cov.source_label || "—")}</span>. Pipeline last run ${esc(cov.data_file_modified || "unknown")} (${esc(cov.data_file_modified_note || "")}).`, "Provenance of this copy")}
        </div>
      </div>
    </section>

    <section class="panel" id="m-limits">
      <h2 class="panel-title">Limitations</h2>
      <ul class="limits">
        <li><b>Location, not operator.</b> VIIRS observes flares at a place and TROPOMI a ~7 km column. Neither observes a company; no result attributes a change.</li>
        <li><b>Twelve geographic units, thirteen years.</b> Enough to measure interval miscalibration, not to certify a guarantee; short claims are rarely decidable.</li>
        <li><b>Partial independence.</b> Field and national flaring share the VIIRS instrument; only methane is independent, and only from 2019 for 9 of 12 fields.</li>
        <li><b>No end-to-end ground truth.</b> No adjudicated true/false corpus exists, so verification accuracy is never reported.</li>
        <li><b>One complete channel.</b> Only gas flaring is checked against observations; other metrics are reported as “no signal to check”.</li>
        <li><b>Projections are not predictions.</b> A linear trend cannot anticipate policy changes, shutdowns or new production.</li>
      </ul>
    </section>`;
  // in-page links must not trigger the hash router
  $$("[data-jump]", el).forEach(a => a.addEventListener("click", e => {
    e.preventDefault();
    const t = $(a.getAttribute("href"));
    if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}
