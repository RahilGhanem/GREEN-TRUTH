"use strict";
/* The evidence story for one atomic claim.

   One claim is presented as a single, ordered argument rather than a set of
   parallel panels:

     verdict banner   the outcome, one plain-language reason, four key facts
     1  What was claimed?
     2  What did the satellite observe?
     3  Can the data decide?            (or: where does the observed path lead?)
     4  Do other sources agree?
     5  What can — and cannot — be concluded?
     trace            the 13-step evidence chain, one click away

   Every value is a field of the /api/analyze response. The only derivation is
   wording and plain arithmetic, labelled as such. Implementation detail (raw
   metadata, file paths) is kept behind "Technical details"; scientific
   limitations never are. */

const lc = s => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// Backend messages that are setup instructions rather than scientific reasons.
const isSetupMessage = s => /notebook|data\/real|\.csv\b/i.test(String(s || ""));
const checkOf = (c, key) => ((c.sufficiency && c.sufficiency.checks) || []).find(k => k.key === key);
const ST = { pass: ["st-pass", "✓"], warn: ["st-warn", "⚠"], fail: ["st-fail", "✕"], info: ["st-info", "i"], none: ["st-none", "–"] };
const stIcon = s => { const [cls, sym] = ST[s] || ST.none; return `<span class="st ${cls}" aria-hidden="true">${sym}</span>`; };
const metricName = c => lc(c.observable || c.claim.metric || "an unidentified metric");
const isHistorical = c => c.analysis && c.analysis.observed_change != null && c.evidence;
const isTrajectory = c => c.trajectory && c.trajectory.feasible;

function kvRows(pairs) {
  const rows = pairs.filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length));
  return rows.length ? `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>` : "";
}
const link = (url, text) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text || url)}</a>` : null;
const list = arr => arr && arr.length ? `<ul>${arr.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : null;

/* ================================================================ reasons */

// The verdict in one short plain sentence. The step below it shows why.
function headline(c) {
  const a = c.analysis || {}, t = c.trajectory, cl = a.claimed_change != null ? fmtPct(a.claimed_change) : null;
  const yr = t && t.target ? t.target.year : "";
  switch (c.verdict) {
    case "abstain": return cl ? `The data can't tell whether the claimed ${cl} happened.` : "The data can't tell which way flaring moved.";
    case "supported": return `The observations back the claim${cl ? ` of ${cl}` : ""}${a.borderline ? " — only just" : ""}.`;
    case "partially_supported": return `Flaring fell, but by less than the claimed ${cl}.`;
    case "contradicted": return `The observations don't show the claimed ${cl || "fall"}.`;
    case "trajectory_consistent": return `The observed trend reaches the ${yr} target.`;
    case "trajectory_inconsistent": return `The observed trend doesn't reach the ${yr} target.`;
    case "trajectory_uncertain": return `The observed trend can't tell whether the ${yr} target will be met.`;
    case "no_signal": return `Not checkable: there is no satellite data for ${esc(metricName(c))}.`;
    case "needs_clarification": return "Not checkable: the claim gives no number or period.";
    default: return "Not checkable on the available observations.";
  }
}

// Short flags that qualify the verdict. Each has a symbol and words, never colour alone.
function flags(c) {
  const out = [], a = c.analysis || {}, m = c.methane, co = c.corroboration, cal = c.interval_calibration;
  if (a.borderline) out.push(["partial", "◐", "Borderline"]);
  (a.assumptions || []).forEach(s => {
    const m1 = /outcome year taken as (\d{4})/.exec(s), m0 = /baseline taken as (\d{4})/.exec(s);
    if (m1) out.push(["none", "i", `Outcome year assumed: ${m1[1]}`]);
    if (m0) out.push(["none", "i", `Baseline assumed: ${m0[1]}`]);
  });
  if (m && m.available && m.relationship === "flaring_down_methane_up") out.push(["partial", "⇅", "Methane moved the other way"]);
  if (co && co.available && co.is_conflict) out.push(["partial", "⇄", "National trend differs"]);
  if (c.claim.metric_supported && m && !m.available) out.push(["none", "∅", "No independent sensor here"]);
  if (cal && cal.under_covers_here) out.push(["partial", "!", "Interval under-covers at this horizon"]);
  if (isTrajectory(c)) out.push(["none", "↗", "Projection, not observation"]);
  return out.slice(0, 4);
}

/* ================================================================ banner */

function keyFacts(c) {
  const a = c.analysis, t = c.trajectory, cl = c.claim, s = c.sufficiency || {};
  const lvl = [LEVEL_LABEL[s.level] || "—", "see step below"];
  if (isHistorical(c)) return [
    ["Claimed", a.claimed_change != null ? fmtPct(a.claimed_change) : "a fall", "claim", cl.baseline_year ? `from ${cl.baseline_year}` : "no baseline stated"],
    ["Observed", fmtPct(a.observed_change), "obs", `${a.baseline_year} → ${a.comparison_year}`],
    ["90% range", a.interval ? `${fmtPct(a.interval[0])} → ${fmtPct(a.interval[1])}` : "—", "", "what the data allow"],
    ["Evidence", lvl[0], "", lvl[1]],
  ];
  if (isTrajectory(c)) {
    const p = t.projection_at_target;
    return [
      ["Target", fmtNum(t.target.value, 2), "target", `bcm/yr by ${t.target.year}`],
      [`Projected ${t.target.year}`, fmtNum(p.value, 2), "proj", `band ${fmtNum(p.lower, 2)}–${fmtNum(p.upper, 2)}`],
      ["Observed trend", `${fmtSigned(t.observed_annual_rate, 2)}/yr`, "obs", `required ${fmtSigned(t.required_annual_rate, 2)}/yr`],
      ["Evidence", lvl[0], "", lvl[1]],
    ];
  }
  return [
    ["Claim", esc(cap(cl.claim_type_label)), "", esc(c.observable || cl.metric || "no metric")],
    ["Observed", cl.metric_supported ? "—" : "no channel", "", cl.metric_supported ? "no usable series" : "not observable here"],
    ["Evidence", lvl[0], "", lvl[1]],
  ];
}

function verdictBanner(c) {
  const s = vstyle(c.verdict), fl = flags(c);
  return `<section class="banner-v tone-${s.tone}" aria-label="Verdict">
    <div class="bv-head">
      <div class="bv-sym" aria-hidden="true">${s.sym}</div>
      <div class="bv-titles">
        <span class="bv-kicker">Claim ${esc(c.id)}</span>
        <h2 class="bv-label">${esc(shortLabel(c.verdict_label))}</h2>
      </div>
    </div>
    <p class="bv-why">${headline(c)}</p>
    <div class="facts">${keyFacts(c).map(([k, v, cls, sub]) => `<div class="fact-c ${cls}">
        <span class="k">${k}</span><span class="v">${v}</span><span class="s">${sub}</span></div>`).join("")}</div>
    ${fl.length ? `<div class="flags">${fl.map(([tone, sym, t]) => `<span class="flag tone-${tone}"><span aria-hidden="true">${sym}</span>${esc(t)}</span>`).join("")}</div>` : ""}
  </section>`;
}

/* ================================================================ steps */

// Each step is a question with a short answer beside it, so the titles alone tell the story.
const step = (n, q, body, ans = null) => `<section class="story-step">
  <div class="ss-n" aria-hidden="true">${n}</div>
  <div class="ss-body"><h3 class="ss-q"><span>${q}</span>${ans ? `<span class="ss-a ${ans[0]}">${ans[1]}</span>` : ""}</h3>${body}</div></section>`;

function stepClaim(c, r) {
  const cl = c.claim, f = r && r.field;
  const chips = [
    `<span class="tag">${esc(c.observable || cl.metric || "no metric")}${cl.metric_supported ? "" : " · no channel"}</span>`,
    cl.claimed_change_percent != null ? `<span class="tag tag-claim">claimed <b>${fmtPct(cl.claimed_change_percent / 100)}</b></span>` : "",
    cl.baseline_year ? `<span class="tag">baseline <b>${cl.baseline_year}</b></span>` : "",
    cl.comparison_year ? `<span class="tag">outcome <b>${cl.comparison_year}</b></span>` : "",
    cl.commitment_year ? `<span class="tag">target year <b>${cl.commitment_year}</b></span>` : "",
    cl.target_value === 0 ? `<span class="tag">target <b>zero</b></span>` : "",
    f ? `<span class="tag"><span class="ico" aria-hidden="true">&#xe915;</span>${esc(f.name)}, ${esc(f.country)}</span>` : "",
  ].join("");
  const notes = (cl.extraction_notes || []).map(esc).join(" ");
  return `<blockquote class="quote">“${esc(c.text)}”</blockquote>
    <div class="row">${chips}</div>
    ${c.text !== cl.source_text ? `<p class="hint">Part of: “${esc(cl.source_text)}”</p>` : ""}
    ${notes ? techDetails(`${notes}<br>Slot coverage ${cl.extract_confidence} — the share of required details stated in the text, not a probability${cl.missing_slots.length ? `; not stated: ${esc(humanSlots(cl.missing_slots))}` : ""}.`, "How the sentence was read") : ""}`;
}

function stepObserved(c) {
  const a = c.analysis, ev = c.evidence;
  return `<p class="ss-lead"><span class="muted">${a.baseline_year}</span> <b>${fmtNum(a.baseline_value, 2)}</b> →
      <span class="muted">${a.comparison_year}</span> <b>${fmtNum(a.comparison_value, 2)}</b> bcm/yr flared at ${esc(ev.field_name)}</p>
    <div class="chart-host" data-chart="series"></div>
    ${legend([["observed", "Observed annual volume (VIIRS)"], ...(a.claimed_change != null ? [["claimed", "Change implied by the claim"]] : [])])}
    <p class="src-line">${esc(ev.dataset_name)} · ${ev.years.length} annual observations, ${ev.years[0]}–${ev.years[ev.years.length - 1]} ·
      flares within ${esc(String((c.evidence_chain.find(n => n.step === "facility") || { meta: {} }).meta.match_radius_km || "—"))} km of the field centre</p>`;
}

function stepDecide(c) {
  const a = c.analysis, cal = c.interval_calibration, n = a.region_span + 1;
  const abst = a.interval_spans_decision_regions, border = !!a.borderline;
  const [lo, hi] = a.interval, pt = a.observed_change;
  const answer = abst ? `The 90% range covers ${n} outcomes, so the dot alone can't be trusted.`
    : border ? "The range touches two outcomes, so the result is borderline."
    : "The whole 90% range stays inside one outcome.";
  const L = a.region_labels || {};
  const outside = pt < lo || pt > hi;
  return `<p class="ss-lead">${answer}</p>
    <div class="chart-host" data-chart="unc"></div>
    <div class="region-key narrow-only" aria-label="Possible outcomes">
      ${[0, 1, 2, 3].filter(r => a.claimed_change != null || r !== 1).map(r => `<span><span class="sw" style="background:${REGION_FILL[r]}"></span>${esc(L[r] || REGION_SHORT[r])}</span>`).join("")}
    </div>
    ${legend([["point", "Observed change"], ["interval", "90% range"], ...(a.claimed_change != null ? [["claimed", "Claimed change"]] : [])])}
    <p class="src-line">One colour under the bar: decided. Several: the data can't tell.
      ${outside ? ` The dot compares two single years; the bar comes from the trend over all years, so the dot can sit outside it.` : ""}</p>
    ${techDetails(`${cal && cal.measured_coverage_at_this_gap != null ? `Measured in testing: intervals over a ${cal.year_gap}-year gap contained the realised change ${pct1(cal.measured_coverage_at_this_gap)} of the time (nominal ${Math.round(cal.nominal * 100)}%).<br>` : ""}${esc(a.interval_note)}
      ${a.decision_margin != null ? `<br>Decision margin ${a.decision_margin} (${esc(a.decision_margin_kind)}).` : ""}<br>There is no “confidence” figure anywhere in GreenTruth.`, "About this interval")}`;
}

function stepTrajectory(c) {
  const t = c.trajectory, last = t.last_observed, first = t.observed[0];
  return `<p class="ss-lead">A pledge can't be checked yet. What can be checked is where the observed trend leads.</p>
    <div class="chart-host" data-chart="traj"></div>
    ${legend([["observed", "Observed"], ["projected", "Trend (fitted, extended)"], ["band", "90% band"], ["required", "Path to the target"], ["target", "Target"]])}
    <div class="rates">
      <div><span class="k">Needed</span><b>${fmtSigned(t.required_annual_rate, 2)}</b><span class="s">bcm/yr each year</span></div>
      <div><span class="k">Observed trend</span><b>${fmtSigned(t.observed_annual_rate, 2)}</b><span class="s">bcm/yr each year</span></div>
    </div>
    <p class="src-line">A trend, not a forecast.</p>
    ${techDetails(`${esc(t.reasoning)}<br>The projection extends the line fitted to ${first.year}–${last.year}, which is why it does not start exactly at the last observed value. ${esc(t.method_caveat)}<br>${esc(t.method)}`, "Method")}`;
}

/* -------------------------------------------------------- cross-checks */

function divBars(rows, fmt) {
  const m = Math.max(...rows.map(r => Math.abs(r.v)), 1e-9) * 1.15;
  return `<div class="bars">${rows.map(r => {
    const w = Math.abs(r.v) / m * 50, left = r.v >= 0 ? 50 : 50 - w;
    return `<div class="bar-row"><span class="bl" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="bar-track" role="img" aria-label="${esc(r.label)} ${fmt(r.v)}"><span class="bar-zero" style="left:50%"></span>
        <span class="bar-fill" style="left:${left}%;width:${w}%;background:${r.color}"></span></span>
      <span class="bv">${fmt(r.v)}</span></div>`;
  }).join("")}</div>`;
}

const REL_UI = {
  corroborates: ["ok", "✓", "Moves with the national trend"],
  same_direction: ["none", "≈", "Same direction, different size"],
  diverges: ["partial", "⇄", "Opposite to the national trend"],
  both_down: ["ok", "✓", "Methane also fell"],
  both_up: ["none", "≈", "Methane also rose"],
  methane_flat: ["none", "=", "Methane essentially flat"],
  flaring_down_methane_up: ["partial", "⇅", "Methane rose while flaring fell"],
  flaring_up_methane_down: ["none", "⇅", "Methane fell while flaring rose"],
};

function nationalCard(c) {
  const r = c.corroboration;
  if (!r) return "";
  if (!r.available) return `<div class="xcard"><div class="xc-k">National total · same instrument</div>
    <p class="xc-none">Not comparable here. ${esc(r.detail)}</p></div>`;
  const [tone, sym, lab] = REL_UI[r.relationship] || ["none", "·", r.label];
  return `<div class="xcard">
    <div class="xc-k">National total · same instrument (VIIRS)</div>
    ${divBars([{ label: r.field_name || "Field", v: r.field_change, color: "var(--c-observed)" },
               { label: `${r.country_name || "Country"}`, v: r.country_change, color: "var(--grey)" }], v => fmtPct(v))}
    <div class="xc-rel tone-${tone}"><span aria-hidden="true">${sym}</span> ${lab}</div>
    ${r.is_conflict ? `<p class="xc-note">Not a contradiction: one field can move apart from its country.</p>` : ""}
    ${techDetails(`${esc(r.detail)}<br>${esc(r.caveat)}<br>Both series come from VIIRS, so agreement here is weaker than two independent sensors would be.`, "Details")}
  </div>`;
}

function methaneCard(c) {
  const m = c.methane;
  if (!m) return "";
  if (!m.available) {
    const setup = isSetupMessage(m.detail);
    // Coverage below the 60% threshold, or a claim window outside the 2019+ methane record.
    const why = setup ? "Not loaded in this deployment."
      : m.completeness != null && m.completeness < 0.6 ? `Only ${pct1(m.completeness)} of months usable here.`
      : "No methane data for these years (Sentinel-5P starts in 2019).";
    return `<div class="xcard muted-card"><div class="xc-k">Methane · independent satellite (Sentinel-5P)</div>
      <div class="xc-rel tone-none"><span aria-hidden="true">∅</span> No usable data</div>
      <p class="xc-note">${why} The result rests on one instrument.</p>
      ${techDetails(esc(m.detail), "Details")}</div>`;
  }
  const f = m.flaring_change, d = m.anomaly_change_ppb;
  const dir = v => (v == null || Math.abs(v) < 1e-9 ? "flat" : v < 0 ? "down" : "up");
  const arrow = v => (dir(v) === "down" ? "&#xe90c;" : dir(v) === "up" ? "&#xe933;" : "&#xe91b;");
  const mdir = m.relationship === "methane_flat" ? "flat" : dir(d);
  const [tone, sym, lab] = REL_UI[m.relationship] || ["none", "·", m.label];
  return `<div class="xcard">
    <div class="xc-k">Methane · independent satellite (Sentinel-5P)</div>
    <div class="pair">
      <div class="pv ${dir(f)}"><span class="ico" aria-hidden="true">${arrow(f)}</span><b>${fmtPct(f)}</b><span>flaring</span></div>
      <div class="pv ${mdir}"><span class="ico" aria-hidden="true">${arrow(mdir === "flat" ? 0 : d)}</span><b>${fmtSigned(d, 1)} ppb</b><span>methane anomaly</span></div>
    </div>
    <div class="xc-rel tone-${tone}"><span aria-hidden="true">${sym}</span> ${lab}</div>
    <p class="xc-eq">raw ${fmtSigned(m.methane_change_ppb_raw, 1)} − background ${fmtSigned(m.background_change_ppb, 1)} = <b>${fmtSigned(d, 1)} ppb</b>
      <span class="muted">(${m.baseline_year}→${m.comparison_year})</span></p>
    ${techDetails(`${divBars([{ label: "Raw column change", v: m.methane_change_ppb_raw, color: "var(--grey)" },
        { label: "Background (other fields)", v: m.background_change_ppb, color: "var(--line-strong)" },
        { label: "Field anomaly", v: d, color: m.relationship === "flaring_down_methane_up" ? "var(--orange)" : "var(--c-observed)" }], v => `${fmtSigned(v, 1)} ppb`)}
      <p style="margin:8px 0 0">${esc(m.detail)}</p><p style="margin:6px 0 0">Retrieval coverage ${pct1(m.completeness)} of possible months. ${esc(m.attribution_warning)}</p>
      ${link(m.source && m.source.official_url, "Dataset page") || ""}`, "Background correction and details")}
  </div>`;
}

function stepSources(c) {
  const y = c.synthesis || {}, m = c.methane;
  const tension = m && m.available && m.relationship === "flaring_down_methane_up";
  const body = `<div class="xgrid">${nationalCard(c)}${methaneCard(c)}</div>
    ${tension ? `<div class="tension">
      <b>⚠ Flaring fell, methane rose.</b> Venting could cause this, and so could other regional sources.
      At ~7 km they can't be told apart, so it is flagged, not interpreted.
      ${y.possible_explanations && y.possible_explanations.length ? `<details class="more"><summary>Possible explanations (${y.possible_explanations.length})</summary>
        <ul class="explain-list">${y.possible_explanations.map(e => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}
    </div>` : ""}
    <p class="src-line">Side by side, never averaged. A disagreement is not evidence of wrongdoing.</p>`;
  return body;
}

/* -------------------------------------------------------- conclusion */

function canCannot(c, r) {
  const a = c.analysis, m = c.methane, t = c.trajectory, cl = a && a.claimed_change != null ? fmtPct(a.claimed_change) : null;
  const can = [], cannot = [];
  if (isHistorical(c)) can.push(`Flaring at ${esc(c.evidence.field_name)} changed ${fmtPct(a.observed_change)} (${a.baseline_year}→${a.comparison_year}).`);
  if (isHistorical(c) && c.verdict !== "abstain" && cl)
    can.push(c.verdict === "supported" ? `That fits the claimed ${cl}${a.borderline ? " (borderline)" : ""}.`
      : c.verdict === "partially_supported" ? `That is a fall, but smaller than the claimed ${cl}.`
      : `That does not fit the claimed ${cl}.`);
  if (isTrajectory(c)) can.push(`The trend leads to ${fmtNum(t.projection_at_target.value, 2)} bcm/yr by ${t.target.year} (90% band ${fmtNum(t.projection_at_target.lower, 2)}–${fmtNum(t.projection_at_target.upper, 2)}).`);
  if (m && m.available) can.push(`Methane near the field moved ${fmtSigned(m.anomaly_change_ppb, 1)} ppb against the background.`);
  if (!c.claim.metric_supported) can.push(`The report makes a claim about ${esc(metricName(c))}. It is recorded, not checked.`);

  if (c.verdict === "abstain" && cl) cannot.push(`Whether the claimed ${cl} happened.`);
  if (isTrajectory(c)) cannot.push("Whether the target will be met: a trend can't foresee policy changes or shutdowns.");
  if (c.claim.metric_supported) cannot.push("Who caused it: satellites see places, not operators.");
  if (m && m.available && m.relationship === "flaring_down_methane_up") cannot.push("Whether gas was vented.");
  if (c.claim.metric_supported && m && !m.available) cannot.push("Confirmation from a second, independent sensor.");
  if (!c.claim.metric_supported) cannot.push(`Anything about ${esc(metricName(c))} from observations.`);
  if (!can.length) can.push("Nothing beyond the claim itself.");
  return { can, cannot };
}

function auditDetails(c) {
  const s = c.sufficiency;
  if (!s) return "";
  const groups = { pass: [], warn: [], fail: [] };
  (s.checks || []).forEach(k => (groups[k.status] || groups.warn).push(k));
  const item = k => `<li><b>${esc(k.label)}.</b> ${esc(k.detail)}</li>`;
  const g = (st, title, arr) => arr.length ? `<div class="audit-group"><div class="audit-gh">${stIcon(st)}${title} <span class="c">(${arr.length})</span></div>
      <ul class="audit-list">${arr.map(item).join("")}</ul></div>` : "";
  return `<details class="more audit"><summary>Show the evidence audit — ${(s.checks || []).length} checks</summary>
    ${g("pass", "Met", groups.pass)}${g("warn", "Met with a limitation", groups.warn)}${g("fail", "Not met", groups.fail)}
    <p class="hint">${esc(s.summary)}</p></details>`;
}

function stepConclude(c, r) {
  const s = c.sufficiency || {}, { can, cannot } = canCannot(c, r), lv = s.level;
  return `<div class="conclude">
      <div class="cc can"><div class="cc-k">✓ You can conclude</div><ul>${can.map(x => `<li>${x}</li>`).join("")}</ul></div>
      <div class="cc cannot"><div class="cc-k">✕ You cannot conclude</div><ul>${cannot.map(x => `<li>${x}</li>`).join("")}</ul></div>
    </div>
    <div class="ceiling-row">
      <div class="levels" role="img" aria-label="Evidence sufficiency: ${esc(LEVEL_LABEL[lv] || lv)} (one of Insufficient, Partially sufficient, Sufficient)">
        <div class="level ${lv === "INSUFFICIENT" ? "on" : ""}">Insufficient</div>
        <div class="level ${lv === "PARTIALLY_SUFFICIENT" ? "on" : ""}">Partially</div>
        <div class="level ${lv === "SUFFICIENT" ? "on" : ""}">Sufficient</div>
      </div>
      <p class="ceiling-txt"><b>Evidence ceiling:</b> ${esc(s.evidence_ceiling || "—")}</p>
    </div>
    ${auditDetails(c)}
    ${c.rationale ? techDetails(esc(c.rationale), "Full rationale") : ""}`;
}

/* ================================================================ limitation */

function limitationPanel(c, r) {
  const t = c.trajectory, cl = c.claim;
  if (t && !t.feasible) return stateCard({ compact: true, tone: "none", sym: "~", title: "Projection unavailable",
    what: esc(t.reason), why: "A trajectory needs a target year after the last observation and at least five annual observations.",
    next: "State the target year and value explicitly, e.g. “eliminate routine flaring by 2030”." });
  if (c.verdict === "no_signal") return stateCard({ compact: true, tone: "none", sym: "∅", title: "No satellite channel for this metric",
    what: `The claim is about ${esc(metricName(c))}. It was detected and split out, and is listed rather than silently dropped.`,
    why: esc(c.rationale),
    next: "Only gas flaring is wired to real Earth-observation data. <a href=\"#about\">Method & data</a> lists what is not available and why." });
  if (c.verdict === "needs_clarification") return stateCard({ compact: true, tone: "none", sym: "?", title: "Claim needs clarification",
    what: esc(c.rationale), why: "Checking it would mean guessing the quantity, period or place.",
    next: "Rephrase with a number and a period, e.g. “reduced flaring by 30% from 2019 levels”." });
  if (r && !r.field) return stateCard({ compact: true, tone: "none", sym: "?", title: "No monitored field identified",
    what: "The claim was understood, but no field could be resolved, so no observation series was retrieved.",
    why: "The field selector is set to detect the field from the text, and the text names no monitored field or country.",
    next: "Choose a field in the selector and check again.",
    actions: `<button class="btn btn-primary btn-sm" type="button" data-act="focus-field">Choose a field</button>` });
  if (isSetupMessage(c.rationale)) return stateCard({ compact: true, tone: "none", sym: "–", title: "Real evidence is currently unavailable",
    what: "The observation series for this field is not loaded.", why: "GreenTruth never substitutes synthetic data.",
    next: "Run the real-data pipeline to restore this evidence source, then check the claim again.", extra: techDetails(esc(c.rationale)) });
  const fail = ((c.sufficiency && c.sufficiency.checks) || []).find(k => k.status === "fail");
  return stateCard({ compact: true, tone: "none", sym: "–", title: c.verdict_label,
    what: esc(c.rationale), why: fail ? esc(fail.detail) : esc(c.verdict_meaning),
    next: "Adjust the claim period to 2012–2024, or choose another field." });
}

/* ================================================================ chain */

const CHAIN_ICON = {
  report: "&#xe937;", claim: "&#xe90e;", metric: "&#xe935;", facility: "&#xe918;", location: "&#xe915;",
  dataset: "&#xe908;", observations: "&#xe904;", analysis: "&#xe927;", uncertainty: "±",
  corroboration: "&#xe913;", independent_instrument: "&#xe934;", sufficiency: "&#xe906;", verdict: "&#xe92d;",
};
const CHAIN_STATUS = {
  ok: ["✓", "st-pass", "established"], conflict: ["!", "st-warn", "sources disagree"],
  unavailable: ["–", "st-none", "unavailable"], insufficient: ["✕", "st-fail", "insufficient"],
  unresolved: ["?", "st-none", "unresolved"],
};

function chainBlock(c) {
  const nodes = c.evidence_chain || [];
  return `<details class="trace" data-trace>
    <summary><span class="ico" aria-hidden="true">&#xe90f;</span> Trace this result — ${nodes.length} steps from sentence to verdict</summary>
    <div class="chain" role="group" aria-label="Evidence chain">
      ${nodes.map((n, i) => {
        const [sym, cls, word] = CHAIN_STATUS[n.status] || CHAIN_STATUS.unavailable;
        const icon = CHAIN_ICON[n.step] || "&#xe90b;";
        return `<button type="button" class="cnode s-${esc(n.status)}" data-i="${i}" aria-expanded="false" aria-label="${esc(n.label)}: ${esc(word)}">
          <span class="cdot"><span class="${icon.startsWith("&") ? "ico" : ""}" aria-hidden="true">${icon}</span>
            <span class="cst ${cls}" aria-hidden="true">${sym}</span></span>
          <span class="clab">${esc(n.label)}</span></button>`;
      }).join("")}
    </div>
    <div class="chain-detail" data-chain-detail></div>
  </details>`;
}

function chainDetail(n) {
  const m = n.meta || {};
  const [, , word] = CHAIN_STATUS[n.status] || CHAIN_STATUS.unavailable;
  let body = "";
  switch (n.step) {
    case "report": body = kvRows([["Detector", m.detector === "climatebert" ? "ClimateBERT (fine-tuned transformer)" : "Rule-based (transparent fallback)"], ["Detector score", m.detector_score != null ? fmtNum(m.detector_score, 3) + " (model probability for this sentence)" : "none — the rule detector does not score"]]); break;
    case "claim": body = kvRows([["Slot coverage", `${m.slot_coverage} <span class="muted">(share of required details stated — not a probability)</span>`], ["Stated", esc(humanSlots(m.filled)) || "none"], ["Not stated", esc(humanSlots(m.missing)) || "none"]]); break;
    case "metric": body = kvRows([["Observation channel", m.has_observation_channel ? "yes — real Earth-observation data" : "no"], ["Reason", esc(m.reason)]]); break;
    case "facility": body = kvRows([["Country", esc(m.country)], ["Match radius", m.match_radius_km != null ? `${m.match_radius_km} km around the field centre` : null]]); break;
    case "location": body = kvRows([["Latitude", m.lat], ["Longitude", m.lon], ["Note", "Approximate public centroid; flares within the match radius are grouped to it."]]); break;
    case "dataset": body = kvRows([["Provider", esc(m.provider)], ["Measurement", esc(m.measurement_type)], ["Spatial resolution", esc(m.spatial_resolution)], ["Temporal resolution", esc(m.temporal_resolution)], ["Processing", esc(m.processing)], ["Licence", esc(m.licence)], ["Pipeline run", m.access_date ? `${esc(m.access_date)} <span class="muted">(local file date, not a release date)</span>` : "unknown"], ["Official source", link(m.official_url)], ["Limitations", list(m.limitations)]]); break;
    case "observations": body = kvRows([["Values", m.years ? m.years.map((y, i) => `${y}: ${fmtNum(m.values[i], 3)}`).join(" · ") : null], ["Unit", esc(m.unit)], ["Value provenance", esc(m.value_provenance)]]); break;
    case "analysis": body = kvRows([["Baseline", `${m.baseline_year} · ${fmtNum(m.baseline_value, 3)}`], ["Comparison", `${m.comparison_year} · ${fmtNum(m.comparison_value, 3)}`], ["Observed change", fmtPct(m.observed_change, 1)], ["Claimed change", m.claimed_change != null ? fmtPct(m.claimed_change, 1) : "not stated"], ["Assumptions", list(m.assumptions) || "none"]]); break;
    case "uncertainty": body = kvRows([["Interval", m.interval ? `${fmtPct(m.interval[0], 1)} to ${fmtPct(m.interval[1], 1)}` : null], ["Method", "90% residual bootstrap"], ["Note", esc(m.interval_note)]]); break;
    case "corroboration": body = kvRows([["Relationship", esc(m.label)], ["Field change", fmtPct(m.field_change)], ["National change", fmtPct(m.country_change)], ["Second source", m.second_source ? `${esc(m.second_source.dataset_name)} — ${esc(m.second_source.provider)}` : null], ["Caveat", esc(m.caveat)]]); break;
    case "independent_instrument": body = kvRows([["Relationship", esc(m.label)], ["Raw column change", m.methane_change_ppb_raw != null ? `${fmtSigned(m.methane_change_ppb_raw, 1)} ppb` : null], ["Background change", m.background_change_ppb != null ? `${fmtSigned(m.background_change_ppb, 1)} ppb` : null], ["Field anomaly", m.anomaly_change_ppb != null ? `${fmtSigned(m.anomaly_change_ppb, 1)} ppb` : null], ["Retrieval coverage", m.completeness != null ? pct1(m.completeness) : null], ["Attribution", esc(m.attribution_warning)]]); break;
    case "sufficiency": body = kvRows([["Level", esc(LEVEL_LABEL[m.level] || m.level)], ["Evidence ceiling", esc(m.evidence_ceiling)]]); break;
    default: body = "";
  }
  return `<span class="kicker">Step · ${esc(word)}</span><h4>${esc(n.label)}</h4>
    <p class="prose" style="margin:0">${isSetupMessage(n.detail) ? "Not available in this deployment." : esc(n.detail || "—")}</p>${body}
    ${Object.keys(m).length ? techDetails(`<pre class="raw">${esc(JSON.stringify(m, null, 2))}</pre>`, "Technical details (raw metadata)") : ""}`;
}

/* ================================================================ story */

const SHORT_REL = {
  corroborates: "agrees", same_direction: "same direction", diverges: "opposite",
  both_down: "also fell", both_up: "also rose", methane_flat: "flat",
  flaring_down_methane_up: "rose", flaring_up_methane_down: "fell",
};
const TRAJ_ANS = {
  trajectory_consistent: ["tone-ok", "Trend reaches it"],
  trajectory_inconsistent: ["tone-traj-bad", "Trend falls short"],
  trajectory_uncertain: ["tone-abstain", "Can't tell"],
};

function sourcesAnswer(c) {
  const co = c.corroboration, m = c.methane, parts = [];
  if (co) parts.push(`National: ${co.available ? SHORT_REL[co.relationship] || esc(co.label) : "n/a"}`);
  if (m) parts.push(`Methane: ${m.available ? SHORT_REL[m.relationship] || esc(m.label) : "no data"}`);
  const tension = (m && m.available && m.relationship === "flaring_down_methane_up") || (co && co.available && co.is_conflict);
  return [tension ? "tone-partial" : "tone-none", parts.join(" · ")];
}

function evidenceStory(c, r) {
  const parts = [verdictBanner(c)], a = c.analysis;
  let n = 1;
  parts.push(step(n++, "What was claimed?", stepClaim(c, r), ["tone-none", esc(c.claim.claim_type_label)]));
  if (isHistorical(c)) {
    parts.push(step(n++, "What did the satellite observe?", stepObserved(c), ["obs", fmtPct(a.observed_change)]));
    if (a.interval) parts.push(step(n++, "Can the data decide?", stepDecide(c),
      a.interval_spans_decision_regions ? ["tone-abstain", "No"] : a.borderline ? ["tone-partial", "Only just"] : [`tone-${vstyle(c.verdict).tone}`, "Yes"]));
  } else if (isTrajectory(c)) {
    parts.push(step(n++, "Where is the observed trend heading?", stepTrajectory(c), TRAJ_ANS[c.verdict] || null));
  } else {
    parts.push(step(n++, "Can it be checked?", limitationPanel(c, r), ["tone-none", "No"]));
  }
  if (c.claim.metric_supported && (c.corroboration || c.methane)) parts.push(step(n++, "Do other sources agree?", stepSources(c), sourcesAnswer(c)));
  parts.push(step(n++, "What can — and cannot — be concluded?", stepConclude(c, r)));
  parts.push(chainBlock(c));
  return `<article class="story">${parts.join("")}</article>`;
}

function activateStory(root, c) {
  const u = $('[data-chart="unc"]', root);
  if (u && c.analysis && c.analysis.interval) mountChart(u, h => drawUncertainty(h, c.analysis));
  const s = $('[data-chart="series"]', root);
  if (s && c.evidence) mountChart(s, h => drawSeries(h, c));
  const t = $('[data-chart="traj"]', root);
  if (t && isTrajectory(c)) mountChart(t, h => drawTrajectory(h, c.trajectory));

  const trace = $("[data-trace]", root);
  if (trace) {
    const detail = $("[data-chain-detail]", trace), nodes = $$(".cnode", trace);
    const pick = i => {
      nodes.forEach((b, j) => b.setAttribute("aria-expanded", String(j === i)));
      detail.innerHTML = chainDetail(c.evidence_chain[i]);
    };
    nodes.forEach((b, i) => {
      b.addEventListener("click", () => pick(i));
      b.addEventListener("keydown", e => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const j = Math.min(nodes.length - 1, Math.max(0, i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1)));
        nodes[j].focus(); pick(j);
      });
    });
    if (nodes.length) {
      const first = c.evidence_chain.findIndex(nd => nd.status === "conflict" || nd.status === "insufficient");
      pick(first >= 0 ? first : nodes.length - 1);
    }
  }
  $$('[data-act="focus-field"]', root).forEach(b => b.addEventListener("click", () => {
    show("workspace"); $("#fieldSel").focus();
  }));
}
