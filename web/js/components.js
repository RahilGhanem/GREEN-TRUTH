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

// One sentence that says why this verdict was reached, in plain language.
function whySentence(c) {
  const a = c.analysis, t = c.trajectory, v = c.verdict;
  if (a && a.interval && a.observed_change != null) {
    const [lo, hi] = a.interval, pt = a.observed_change, cl = a.claimed_change, L = a.region_labels || {};
    const iv = `the 90% interval (${fmtPct(lo)} to ${fmtPct(hi)})`;
    if (v === "abstain") {
      const r0 = Math.min(a.region_low, a.region_high), r1 = Math.max(a.region_low, a.region_high);
      return `The observed change (${fmtPct(pt)}) looks decisive, but ${iv} runs from “${L[r0]}” to “${L[r1]}”. These observations cannot tell those outcomes apart.`;
    }
    const r0 = Math.min(a.region_low, a.region_high), r1 = Math.max(a.region_low, a.region_high);
    const within = a.borderline ? `spans “${L[r0]}” and “${L[r1]}” — a borderline result` : `stays inside “${L[r0]}”`;
    if (v === "supported") return cl != null
      ? `Observed ${fmtPct(pt)} against a claimed ${fmtPct(cl)}, and ${iv} ${within}.`
      : `Flaring fell ${fmtPct(pt)}, and ${iv} ${within}.`;
    if (v === "partially_supported") return `Flaring fell (${fmtPct(pt)}), but by less than the claimed ${fmtPct(cl)}${a.borderline ? "; the interval reaches a neighbouring outcome, so this is borderline" : ""}.`;
    if (v === "contradicted") return `${cl != null ? `The claim was ${fmtPct(cl)}; ` : ""}the observed change was ${fmtPct(pt)} — ${a.region_point === 3 ? "a rise" : "essentially flat"}${a.borderline ? " (borderline)" : ""}.`;
  }
  if (isTrajectory(c)) {
    const p = t.projection_at_target, tg = t.target, span = `${t.observed[0].year}–${t.last_observed.year}`;
    if (v === "trajectory_consistent") return `Extending the observed ${span} trend, the whole 90% band at ${tg.year} (${fmtNum(p.lower, 2)}–${fmtNum(p.upper, 2)}) reaches the target of ${fmtNum(tg.value, 2)}.`;
    if (v === "trajectory_inconsistent") return `Extending the observed ${span} trend, even the lower end of the 90% band at ${tg.year} (${fmtNum(p.lower, 2)}) stays above the target of ${fmtNum(tg.value, 2)}.`;
    return `The 90% band at ${tg.year} (${fmtNum(p.lower, 2)}–${fmtNum(p.upper, 2)}) straddles the target of ${fmtNum(tg.value, 2)}, so the observed trend cannot tell whether it will be met.`;
  }
  if (v === "no_signal") return `GreenTruth has no satellite channel for ${esc(metricName(c))}, so this claim is recorded but not checked.`;
  if (v === "needs_clarification") return "The claim states no quantity or period, so checking it would mean guessing.";
  if (t && !t.feasible) return esc(t.reason);
  if (isSetupMessage(c.rationale)) return "Real evidence is currently unavailable for this claim in this deployment.";
  return esc(c.rationale);
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
  const lvl = [LEVEL_LABEL[s.level] || "—", "evidence sufficiency"];
  if (isHistorical(c)) return [
    ["Claimed", a.claimed_change != null ? fmtPct(a.claimed_change) : "a fall", "claim", cl.baseline_year ? `from ${cl.baseline_year}` : "no baseline stated"],
    ["Observed", fmtPct(a.observed_change), "obs", `${a.baseline_year} → ${a.comparison_year}`],
    ["90% interval", a.interval ? `${fmtPct(a.interval[0])} → ${fmtPct(a.interval[1])}` : "—", "", "residual bootstrap"],
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
  const s = vstyle(c.verdict), short = shortLabel(c.verdict_label);
  const lead = c.verdict === "abstain" ? "The evidence can't decide"
    : c.is_abstention ? "Not checkable on this evidence" : "Checked against observations";
  const fl = flags(c);
  return `<section class="banner-v tone-${s.tone}" aria-label="Verdict">
    <div class="bv-head">
      <div class="bv-sym" aria-hidden="true">${s.sym}</div>
      <div class="bv-titles">
        <span class="bv-kicker">${esc(c.id)} · ${esc(lead)}</span>
        <h2 class="bv-label">${esc(short)}</h2>
        ${short !== c.verdict_label ? `<span class="bv-full">${esc(c.verdict_label)}</span>` : ""}
      </div>
    </div>
    <p class="bv-why">${whySentence(c)}</p>
    <div class="facts">${keyFacts(c).map(([k, v, cls, sub]) => `<div class="fact-c ${cls}">
        <span class="k">${k}</span><span class="v">${v}</span><span class="s">${sub}</span></div>`).join("")}</div>
    ${fl.length ? `<div class="flags">${fl.map(([tone, sym, t]) => `<span class="flag tone-${tone}"><span aria-hidden="true">${sym}</span>${esc(t)}</span>`).join("")}</div>` : ""}
    <p class="bv-meaning">${esc(c.verdict_meaning)}</p>
  </section>`;
}

/* ================================================================ steps */

const step = (n, q, body, { id = "" } = {}) => `<section class="story-step" ${id ? `id="${id}"` : ""}>
  <div class="ss-n" aria-hidden="true">${n}</div>
  <div class="ss-body"><h3 class="ss-q">${q}</h3>${body}</div></section>`;

function stepClaim(c, r) {
  const cl = c.claim, f = r && r.field;
  const chips = [
    `<span class="tag"><b>${esc(cl.claim_type_label)}</b></span>`,
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
    ${c.text !== cl.source_text ? `<p class="hint">Split from: “${esc(cl.source_text)}”</p>` : ""}
    ${notes ? techDetails(`${notes}<br>Slot coverage ${cl.extract_confidence} — the share of required details stated in the text, not a probability${cl.missing_slots.length ? `; not stated: ${esc(humanSlots(cl.missing_slots))}` : ""}.`, "How the sentence was read") : ""}`;
}

function stepObserved(c) {
  const a = c.analysis, ev = c.evidence;
  return `<p class="ss-lead">Flaring at ${esc(ev.field_name)} went from <b>${fmtNum(a.baseline_value, 2)}</b> (${a.baseline_year}) to
      <b>${fmtNum(a.comparison_value, 2)}</b> bcm/yr (${a.comparison_year}): <b class="obs-txt">${fmtPct(a.observed_change)}</b>.</p>
    <div class="chart-host" data-chart="series"></div>
    ${legend([["observed", "Observed annual volume (VIIRS)"], ...(a.claimed_change != null ? [["claimed", "Change implied by the claim"]] : [])])}
    <p class="src-line">${esc(ev.dataset_name)} · ${ev.years.length} annual observations, ${ev.years[0]}–${ev.years[ev.years.length - 1]} ·
      flares within ${esc(String((c.evidence_chain.find(n => n.step === "facility") || { meta: {} }).meta.match_radius_km || "—"))} km of the field centre</p>`;
}

function stepDecide(c) {
  const a = c.analysis, cal = c.interval_calibration, n = a.region_span + 1;
  const abst = a.interval_spans_decision_regions, border = !!a.borderline;
  const [lo, hi] = a.interval, pt = a.observed_change;
  const answer = abst ? `<b>No.</b> The 90% interval spans ${n} possible outcomes, so GreenTruth abstains instead of trusting the point estimate.`
    : border ? `<b>Only just.</b> The interval crosses one boundary, so the verdict follows the point estimate and is marked borderline.`
    : `<b>Yes.</b> The whole 90% interval stays inside one outcome.`;
  const L = a.region_labels || {};
  const outside = pt < lo || pt > hi;
  return `<div class="answer tone-${abst ? "abstain" : border ? "partial" : vstyle(c.verdict).tone}">${answer}</div>
    <div class="chart-host" data-chart="unc"></div>
    <div class="region-key" aria-label="Possible outcomes">
      ${[0, 1, 2, 3].filter(r => a.claimed_change != null || r !== 1).map(r => `<span><span class="sw" style="background:${REGION_FILL[r]}"></span>${esc(L[r] || REGION_SHORT[r])}</span>`).join("")}
    </div>
    ${legend([["point", "Observed change"], ["interval", "90% interval"], ...(a.claimed_change != null ? [["claimed", "Claimed change"]] : [])])}
    <p class="src-line">How to read it: the coloured bands are the possible outcomes for this claim. The dark bar is the range
      the observations are consistent with. When it covers several bands, the data cannot choose between them.
      ${cal && cal.measured_coverage_at_this_gap != null ? `Measured in testing: intervals over a ${cal.year_gap}-year gap contained the realised change ${pct1(cal.measured_coverage_at_this_gap)} of the time (nominal ${Math.round(cal.nominal * 100)}%).` : ""}</p>
    ${outside ? `<p class="src-line"><b>Why the dot sits outside the bar:</b> the observed change compares two single years
      (${a.baseline_year} and ${a.comparison_year}); the interval is built from the scatter around the trend fitted to every year.
      When one of those two years is unusually high or low, the single-year change can fall outside it.</p>` : ""}
    ${techDetails(`${esc(a.interval_note)}
      ${a.decision_margin != null ? `<br>Decision margin ${a.decision_margin} (${esc(a.decision_margin_kind)}).` : ""}<br>There is no “confidence” figure anywhere in GreenTruth.`, "About this interval")}`;
}

function stepTrajectory(c) {
  const t = c.trajectory, p = t.projection_at_target, last = t.last_observed, first = t.observed[0];
  const obsSpan = Math.max(1, last.year - first.year), projSpan = Math.max(1, t.target.year - last.year);
  return `<p class="ss-lead">A pledge cannot be true or false yet. What can be checked is where the observed path is heading.</p>
    <div class="timeline" role="img" aria-label="Observed ${first.year} to ${last.year}, projected to ${t.target.year}, target ${t.target.value}">
      <div class="tl-track">
        <div class="tl-seg obs" style="flex:${obsSpan} 1 0"><div class="lab">Observed · ${first.year}–${last.year}</div>
          <div class="det">${fmtNum(last.value, 2)} bcm/yr in ${last.year}</div></div>
        <div class="tl-mark today" aria-hidden="true"></div>
        <div class="tl-seg proj" style="flex:${projSpan} 1 0"><div class="lab">Projected · ${last.year + 1}–${t.target.year}</div>
          <div class="det">${fmtNum(p.value, 2)} in ${t.target.year} (band ${fmtNum(p.lower, 2)}–${fmtNum(p.upper, 2)})</div></div>
        <div class="tl-mark target" aria-hidden="true"></div>
        <div class="tl-seg tgt"><div class="lab">Target ${t.target.year}</div><div class="det">${fmtNum(t.target.value, 2)} bcm/yr</div></div>
      </div>
    </div>
    <div class="chart-host" data-chart="traj"></div>
    ${legend([["observed", "Observed"], ["projected", `Linear trend fitted to ${first.year}–${last.year}, extended`], ["band", "90% band"], ["required", "Path required to meet the target"], ["target", "Target"]])}
    <p class="src-line">To reach the target, flaring would need to change by ${fmtSigned(t.required_annual_rate, 2)} bcm/yr each year from the
      last observation; the trend fitted to ${first.year}–${last.year} changes by ${fmtSigned(t.observed_annual_rate, 2)} bcm/yr each year.
      The projection extends that fitted line, which is why it does not start exactly at the last observed value. ${esc(t.method_caveat)}</p>
    ${techDetails(`${esc(t.reasoning)}<br>${esc(t.method)}`, "Method")}`;
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
    <p class="xc-note">${r.is_conflict ? "Not a contradiction: a field is a small part of a national footprint, so the two can move apart." : "Agreement here is weaker than two independent sensors would be — both series come from VIIRS."}</p>
    ${techDetails(`${esc(r.detail)}<br>${esc(r.caveat)}`, "Details")}
  </div>`;
}

function methaneCard(c) {
  const m = c.methane;
  if (!m) return "";
  if (!m.available) {
    const setup = isSetupMessage(m.detail);
    return `<div class="xcard muted-card"><div class="xc-k">Methane · independent satellite (Sentinel-5P)</div>
      <div class="xc-rel tone-none"><span aria-hidden="true">∅</span> Not available for this field or window</div>
      <p class="xc-note">${setup ? "The methane evidence source is not loaded in this deployment." : esc(m.detail)}</p>
      <p class="xc-note">The flaring result therefore stands on one instrument, and the conclusion is capped accordingly — nothing is filled in.</p>
      ${setup ? techDetails(esc(m.detail)) : ""}</div>`;
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
    <p class="xc-note">Raw column ${fmtSigned(m.methane_change_ppb_raw, 1)} ppb, minus the global background rise of
      ${fmtSigned(m.background_change_ppb, 1)} ppb = field anomaly ${fmtSigned(d, 1)} ppb (${m.baseline_year}→${m.comparison_year}).</p>
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
      <b>Cross-sensor tension.</b> Flaring fell while methane rose faster than the background. Flaring burns methane and venting
      releases it, so this is the pattern a shift to venting would produce — and also what unrelated regional sources would produce.
      At ~7 km the two cannot be separated, so it is flagged, not interpreted.
      ${y.possible_explanations && y.possible_explanations.length ? `<details class="more"><summary>Possible explanations (${y.possible_explanations.length})</summary>
        <ul class="explain-list">${y.possible_explanations.map(e => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}
    </div>` : ""}
    <p class="src-line">Sources are shown side by side, never averaged into a score: they measure different quantities at different scales. ${esc(y.not_an_accusation || "")}</p>`;
  return body;
}

/* -------------------------------------------------------- conclusion */

function canCannot(c, r) {
  const s = c.sufficiency || {}, oa = s.observable_vs_attributable || {}, m = c.methane, t = c.trajectory;
  const can = [], cannot = [];
  if (isHistorical(c) && oa.observable) can.push(esc(oa.observable.replace(/ The uncertainty around that figure is too wide to support a conclusion about the claim\.$/, "").replace(/ -(\d)/g, " −$1")));
  if (isHistorical(c) && c.verdict !== "abstain" && c.analysis.claimed_change != null)
    can.push(`That this observed change is ${c.verdict === "supported" ? "consistent" : c.verdict === "partially_supported" ? "in the claimed direction but smaller than" : "not consistent"} with the claimed ${fmtPct(c.analysis.claimed_change)}${c.analysis.borderline ? " (borderline)" : ""}.`);
  if (isTrajectory(c)) can.push(`Where the observed ${t.observed[0].year}–${t.last_observed.year} trend leads by ${t.target.year}: ${fmtNum(t.projection_at_target.value, 2)} bcm/yr (90% band ${fmtNum(t.projection_at_target.lower, 2)}–${fmtNum(t.projection_at_target.upper, 2)}).`);
  if (m && m.available) can.push(`How regional methane moved around the field relative to the background (${fmtSigned(m.anomaly_change_ppb, 1)} ppb).`);
  if (!c.claim.metric_supported) can.push(`That the report makes a claim about ${esc(metricName(c))} — it is recorded, not checked.`);

  if (c.verdict === "abstain" && c.analysis && c.analysis.claimed_change != null)
    cannot.push(`Whether the claimed ${fmtPct(c.analysis.claimed_change)} was met — the observations are consistent with outcomes from “${esc((c.analysis.region_labels || {})[Math.min(c.analysis.region_low, c.analysis.region_high)] || "a fall")}” to “${esc((c.analysis.region_labels || {})[Math.max(c.analysis.region_low, c.analysis.region_high)] || "a rise")}”.`);
  if (isTrajectory(c)) cannot.push("Whether the target will be met — a linear trend cannot anticipate policy changes, shutdowns or new production.");
  if (c.claim.metric_supported && oa.example_of_the_difference) cannot.push(`${esc(cap(oa.example_of_the_difference.not_supported_by_evidence))} — satellites observe a location, not an operator.`);
  if (m && m.available && m.relationship === "flaring_down_methane_up") cannot.push("Whether gas was vented — regional methane at ~7 km cannot separate venting from other sources.");
  if (c.claim.metric_supported && m && !m.available) cannot.push("Independent confirmation from a second sensor.");
  if (!c.claim.metric_supported) cannot.push(`Anything about ${esc(metricName(c))} from observations — GreenTruth has no channel for it.`);
  if (!can.length) can.push("Nothing beyond the claim itself — no usable observation reached this claim.");
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
    <p class="hint" style="margin:0 0 12px">Select a step to see its source, values, processing and limitations.</p>
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

function evidenceStory(c, r) {
  const parts = [verdictBanner(c)];
  let n = 1;
  parts.push(step(n++, "What was claimed?", stepClaim(c, r)));
  if (isHistorical(c)) {
    parts.push(step(n++, "What did the satellite observe?", stepObserved(c)));
    if (c.analysis.interval) parts.push(step(n++, "Can the data decide?", stepDecide(c)));
  } else if (isTrajectory(c)) {
    parts.push(step(n++, "Where is the observed path heading?", stepTrajectory(c)));
  } else {
    parts.push(step(n++, "Can it be checked?", limitationPanel(c, r)));
  }
  if (c.claim.metric_supported && (c.corroboration || c.methane)) parts.push(step(n++, "Do other sources agree?", stepSources(c)));
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
