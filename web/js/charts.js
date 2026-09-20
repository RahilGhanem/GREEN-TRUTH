"use strict";
/* Hand-rolled SVG charts. Drawn at the container's real pixel width (see
   mountChart in util.js) so labels stay legible on small screens.

   Provenance styles — never shared:
     observed   solid line + filled dots          --c-observed
     projected  dashed line + hatched 90% band    --c-projected
     required   dotted line                       --c-required
     target     diamond marker                    --c-target
     claimed    dashed line + open marker         --c-claimed          */

function svgIn(host, H, label) {
  host.innerHTML = "";
  const W = Math.max(260, Math.round(host.clientWidth || 600));
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("role", "img");
  if (label) svg.setAttribute("aria-label", label);
  host.appendChild(svg);
  return { svg, W, H };
}

function add(parent, tag, attrs, text) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
  if (text != null) el.textContent = text;
  parent.appendChild(el);
  return el;
}

function drawIn(el) {
  // Line draw-in for solid observed lines only; dashed styles keep their dashes.
  try {
    const len = Math.ceil((el.getTotalLength && el.getTotalLength()) || 800);
    if (len > 0) {
      el.style.strokeDasharray = `${len}px`;
      el.style.strokeDashoffset = `${len}px`;
      void el.getBoundingClientRect();
      el.style.transition = "stroke-dashoffset 0.75s cubic-bezier(0.16, 1, 0.3, 1)";
      requestAnimationFrame(() => {
        el.style.strokeDashoffset = "0px";
      });
      setTimeout(() => {
        if (el) {
          el.style.strokeDasharray = "";
          el.style.strokeDashoffset = "";
          el.style.transition = "";
        }
      }, 800);
    }
  } catch {}
}

function niceStep(span, target) {
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}
/* decimals needed to label multiples of a step exactly (2.5 must not print as 3) */
function stepDecimals(step) {
  let d = 0;
  while (d < 4 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-9) d++;
  return d;
}

function hatchDef(svg, id, color) {
  const defs = add(svg, "defs", {});
  const pat = add(defs, "pattern", { id, width: 6, height: 6, patternUnits: "userSpaceOnUse",
    patternTransform: "rotate(45)" });
  add(pat, "line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: color, "stroke-width": 2, "stroke-opacity": .35 });
  return `url(#${id})`;
}

/* ------------------------------------------------------------- legend */

function legendSample(kind) {
  const s = (inner) => `<svg width="30" height="14" viewBox="0 0 30 14" aria-hidden="true">${inner}</svg>`;
  switch (kind) {
    case "observed":  return s(`<line x1="1" y1="7" x2="29" y2="7" stroke="var(--c-observed)" stroke-width="2.5"/><circle cx="15" cy="7" r="3.2" fill="var(--c-observed)"/>`);
    case "projected": return s(`<line x1="1" y1="7" x2="29" y2="7" stroke="var(--c-projected)" stroke-width="2.2" stroke-dasharray="6 4"/>`);
    case "band":      return s(`<rect x="1" y="2" width="28" height="10" fill="var(--c-projected)" fill-opacity=".14" stroke="var(--c-projected)" stroke-opacity=".4"/>`);
    case "required":  return s(`<line x1="1" y1="7" x2="29" y2="7" stroke="var(--c-required)" stroke-width="2" stroke-dasharray="1.5 4" stroke-linecap="round"/>`);
    case "target":    return s(`<rect x="10" y="2" width="10" height="10" fill="var(--c-target)" transform="rotate(45 15 7)"/>`);
    case "claimed":   return s(`<line x1="1" y1="7" x2="29" y2="7" stroke="var(--c-claimed)" stroke-width="2" stroke-dasharray="5 4"/><circle cx="26" cy="7" r="3" fill="var(--card)" stroke="var(--c-claimed)" stroke-width="2"/>`);
    case "interval":  return s(`<rect x="2" y="3.5" width="26" height="7" rx="3.5" fill="var(--c-interval)"/>`);
    case "point":     return s(`<circle cx="15" cy="7" r="5" fill="var(--c-observed)" stroke="var(--bead-ring)" stroke-width="1.8"/>`);
    default: return "";
  }
}
const legend = items => `<div class="legend">${items.map(([k, l]) =>
  `<span class="li">${legendSample(k)}${esc(l)}</span>`).join("")}</div>`;

/* ------------------------------------------------ decision-region strip */

// Mirrors greentruth/verdict.py::_region exactly. flat_band comes from the
// analysis block (the value the verdict used); regions are only redrawn here.
function regionOf(x, claimed, flat) {
  if (claimed != null && x <= claimed) return 0;
  if (x < -flat) return claimed != null ? 1 : 0;
  if (x <= flat) return 2;
  return 3;
}
const REGION_FILL = ["var(--green-tint)", "var(--amber-tint)", "var(--grey-tint)", "var(--red-tint)"];
const REGION_INK = ["var(--green-ink)", "var(--amber-ink)", "var(--grey-ink)", "var(--red-ink)"];
const REGION_SHORT = ["meets claim", "fell, less", "flat", "rose"];

function drawUncertainty(host, a) {
  const H = 176;
  const [lo, hi] = a.interval;
  const pt = a.observed_change, claimed = a.claimed_change;
  const flat = a.flat_band != null ? a.flat_band : 0.05;
  const labels = a.region_labels || {};
  const { svg, W } = svgIn(host, H,
    `Uncertainty. Observed change ${fmtPct(pt)}. 90% interval ${fmtPct(lo)} to ${fmtPct(hi)}.` +
    (claimed != null ? ` Claimed ${fmtPct(claimed)}.` : "") +
    ` The interval touches ${a.region_span + 1} decision region${a.region_span ? "s" : ""}.`);

  const uid = Math.random().toString(36).slice(2, 8), ref = n => `url(#${n}-${uid})`;
  const defs = add(svg, "defs", {});

  // 1. Sleek glass gradients & filters
  const capsuleGrad = add(defs, "linearGradient", { id: `unc-capsule-${uid}`, x1: 0, y1: 0, x2: 0, y2: 1 });
  add(capsuleGrad, "stop", { offset: "0%", "stop-color": "rgba(56, 189, 248, 0.28)" });
  add(capsuleGrad, "stop", { offset: "100%", "stop-color": "rgba(6, 182, 212, 0.12)" });

  const densityGrad = add(defs, "linearGradient", { id: `unc-density-${uid}`, x1: 0, y1: 0, x2: 1, y2: 0 });
  add(densityGrad, "stop", { offset: "0%", "stop-color": "#38bdf8", "stop-opacity": "0.05" });
  add(densityGrad, "stop", { offset: "50%", "stop-color": "#38bdf8", "stop-opacity": "0.22" });
  add(densityGrad, "stop", { offset: "100%", "stop-color": "#38bdf8", "stop-opacity": "0.05" });

  // Diagonal cybernetic telemetry hatch pattern
  const hatch = add(defs, "pattern", { id: `unc-hatch-${uid}`, width: 8, height: 8, patternTransform: "rotate(45)", patternUnits: "userSpaceOnUse" });
  add(hatch, "line", { x1: 0, y1: 0, x2: 0, y2: 8, stroke: "rgba(56, 189, 248, 0.22)", "stroke-width": 1.2 });

  const glow = (id, sd, color = "#38bdf8") => {
    const f = add(defs, "filter", { id: `${id}-${uid}`, x: "-40%", y: "-100%", width: "180%", height: "300%" });
    add(f, "feDropShadow", { dx: 0, dy: 0, stdDeviation: sd, "flood-color": color, "flood-opacity": 0.5 });
  };
  glow("unc-glow", 4, "#38bdf8");
  glow("unc-bead", 4.5, "#10b981");

  // Domain scaling
  const keys = [pt, claimed ?? 0, 0, -flat, flat];
  const kmin = Math.min(...keys), kmax = Math.max(...keys);
  const capLo = Math.max(-1.05, kmin - 1.5), capHi = kmax + 1.5;
  let dmin = Math.max(Math.min(lo, kmin), capLo);
  let dmax = Math.min(Math.max(hi, kmax), capHi);
  const pad = (dmax - dmin) * 0.08;
  dmin -= pad; dmax += pad;
  const L = 16, R = 16;
  const X = v => L + (v - dmin) / (dmax - dmin) * (W - L - R);
  const top = 32, bot = 142, barY = 92, barH = 18, cy = barY + barH / 2;

  // Outcome regions
  const cuts = [claimed, -flat, flat].filter(v => v != null && v > dmin && v < dmax).sort((p, q) => p - q);
  const pts = [dmin, ...cuts, dmax];
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const r = regionOf((pts[i] + pts[i + 1]) / 2, claimed, flat);
    const last = segs[segs.length - 1];
    if (last && last.r === r) last.b = pts[i + 1];
    else segs.push({ a: pts[i], b: pts[i + 1], r });
  }

  // Rounded container frame for regions
  const clip = add(defs, "clipPath", { id: `unc-clip-${uid}` });
  add(clip, "rect", { x: L, y: top, width: W - L - R, height: bot - top, rx: 8 });
  const zones = add(svg, "g", { "clip-path": ref("unc-clip") });

  const REGION_THEMES = [
    { bg: "rgba(16, 185, 129, 0.09)", line: "rgba(16, 185, 129, 0.65)", ink: "#10b981", tag: "MEETS CLAIM" },
    { bg: "rgba(245, 158, 11, 0.09)", line: "rgba(245, 158, 11, 0.65)", ink: "#f59e0b", tag: "FELL, LESS" },
    { bg: "rgba(100, 116, 139, 0.09)", line: "rgba(148, 163, 184, 0.5)", ink: "#94a3b8", tag: "FLAT (±5%)" },
    { bg: "rgba(239, 68, 68, 0.09)", line: "rgba(239, 68, 68, 0.65)", ink: "#ef4444", tag: "ROSE" },
  ];

  for (const s of segs) {
    const x0 = X(s.a), x1 = X(s.b), w = x1 - x0;
    const theme = REGION_THEMES[s.r] || REGION_THEMES[2];
    add(zones, "rect", { x: x0, y: top, width: Math.max(0, w), height: bot - top, fill: theme.bg });
    add(zones, "rect", { x: x0, y: top, width: Math.max(0, w), height: 3, fill: theme.line });
    const full = labels[String(s.r)] || REGION_SHORT[s.r] || theme.tag;
    const txt = full.length * 6.5 < w - 10 ? full : (theme.tag.length * 6.5 < w - 8 ? theme.tag : null);
    if (txt) {
      add(svg, "text", {
        x: x0 + w / 2, y: top + 17, "text-anchor": "middle",
        "font-size": 10.5, "font-weight": 700, "letter-spacing": "0.04em",
        fill: theme.ink, "font-family": "var(--mono)"
      }, txt);
    }
  }

  // Zone divider lines
  for (const c of cuts) {
    add(zones, "line", { x1: X(c), x2: X(c), y1: top, y2: bot,
      stroke: "rgba(255, 255, 255, 0.12)", "stroke-width": 1, "stroke-dasharray": "3 3" });
  }

  // Baseline 0% reference line
  if (0 > dmin && 0 < dmax) {
    add(zones, "line", { x1: X(0), x2: X(0), y1: top, y2: bot,
      stroke: "rgba(255, 255, 255, 0.35)", "stroke-width": 1.5, "stroke-dasharray": "4 4" });
  }

  add(svg, "rect", { x: L + 0.5, y: top + 0.5, width: W - L - R - 1, height: bot - top - 1, rx: 8,
    fill: "none", stroke: "rgba(255, 255, 255, 0.1)" });

  // Axis
  add(svg, "line", { x1: L, x2: W - R, y1: bot, y2: bot, stroke: "var(--line-strong)" });
  const step = niceStep(dmax - dmin, W < 480 ? 4 : 7);
  for (let v = Math.ceil(dmin / step) * step; v <= dmax + 1e-9; v += step) {
    const x = X(v);
    add(svg, "line", { x1: x, x2: x, y1: bot, y2: bot + 4, stroke: "var(--line-strong)" });
    add(svg, "text", {
      x, y: bot + 18, "text-anchor": "middle",
      "font-size": 11, "font-family": "var(--mono)", fill: "var(--muted)"
    }, Math.abs(v) < 1e-9 ? "0%" : fmtPct(v, stepDecimals(step * 100)));
  }

  // ================= 90% RANGE: Modern Glass Capsule with Calipers
  const xa = X(Math.max(lo, dmin)), xb = X(Math.min(hi, dmax)), bw = Math.max(barH, xb - xa);

  // 1. Translucent capsule body
  add(svg, "rect", {
    x: xa, y: barY, width: bw, height: barH, rx: barH / 2,
    fill: ref("unc-capsule"), stroke: "#38bdf8", "stroke-width": 1.6,
    filter: ref("unc-glow"), class: "unc-capsule-bar"
  });

  // 2. Probability density gradient overlay
  add(svg, "rect", {
    x: xa, y: barY, width: bw, height: barH, rx: barH / 2,
    fill: ref("unc-density"), "pointer-events": "none"
  });

  // 3. Cybernetic diagonal telemetry hatch
  add(svg, "rect", {
    x: xa, y: barY, width: bw, height: barH, rx: barH / 2,
    fill: ref("unc-hatch"), opacity: 0.75, "pointer-events": "none"
  });

  // 4. Glass top specular sheen
  if (bw > barH + 4) {
    add(svg, "rect", {
      x: xa + barH / 2, y: barY + 2, width: bw - barH, height: 2.5, rx: 1.2,
      fill: "#ffffff", opacity: 0.5, "pointer-events": "none"
    });
  }

  // 5. Calibrated Optical Caliper Brackets
  // Left Caliper (Lower Bound)
  add(svg, "line", { x1: xa, x2: xa, y1: barY - 5, y2: barY + barH + 5, stroke: "#38bdf8", "stroke-width": 2.2, "stroke-linecap": "round" });
  add(svg, "line", { x1: xa, x2: xa + 6, y1: barY - 5, y2: barY - 5, stroke: "#38bdf8", "stroke-width": 2, "stroke-linecap": "round" });
  add(svg, "line", { x1: xa, x2: xa + 6, y1: barY + barH + 5, y2: barY + barH + 5, stroke: "#38bdf8", "stroke-width": 2, "stroke-linecap": "round" });

  // Right Caliper (Upper Bound)
  add(svg, "line", { x1: xb, x2: xb, y1: barY - 5, y2: barY + barH + 5, stroke: "#38bdf8", "stroke-width": 2.2, "stroke-linecap": "round" });
  add(svg, "line", { x1: xb - 6, x2: xb, y1: barY - 5, y2: barY - 5, stroke: "#38bdf8", "stroke-width": 2, "stroke-linecap": "round" });
  add(svg, "line", { x1: xb - 6, x2: xb, y1: barY + barH + 5, y2: barY + barH + 5, stroke: "#38bdf8", "stroke-width": 2, "stroke-linecap": "round" });

  // Endpoint Badges
  const loTxt = (lo < dmin ? "to " : "") + fmtPct(lo), hiTxt = (hi > dmax ? "to " : "") + fmtPct(hi);
  const tagY = barY + barH + 19;

  if (xb - xa > 110) {
    // Left endpoint tag
    const twA = loTxt.length * 7 + 14;
    const ax = Math.max(L + twA / 2, Math.min(W - R - twA / 2, xa));
    add(svg, "rect", { x: ax - twA / 2, y: tagY - 12, width: twA, height: 18, rx: 4,
      fill: "rgba(11, 19, 34, 0.95)", stroke: "#38bdf8", "stroke-width": 1.2 });
    add(svg, "text", { x: ax, y: tagY + 1, "text-anchor": "middle",
      "font-size": 11, "font-weight": 700, "font-family": "var(--mono)", fill: "#38bdf8" }, loTxt);

    // Right endpoint tag
    const twB = hiTxt.length * 7 + 14;
    const bx = Math.max(L + twB / 2, Math.min(W - R - twB / 2, xb));
    add(svg, "rect", { x: bx - twB / 2, y: tagY - 12, width: twB, height: 18, rx: 4,
      fill: "rgba(11, 19, 34, 0.95)", stroke: "#38bdf8", "stroke-width": 1.2 });
    add(svg, "text", { x: bx, y: tagY + 1, "text-anchor": "middle",
      "font-size": 11, "font-weight": 700, "font-family": "var(--mono)", fill: "#38bdf8" }, hiTxt);
  } else {
    const fullRange = `${loTxt} … ${hiTxt}`;
    const twC = fullRange.length * 7 + 16;
    const cx = (xa + xb) / 2;
    add(svg, "rect", { x: cx - twC / 2, y: tagY - 12, width: twC, height: 18, rx: 4,
      fill: "rgba(11, 19, 34, 0.95)", stroke: "#38bdf8", "stroke-width": 1.2 });
    add(svg, "text", { x: cx, y: tagY + 1, "text-anchor": "middle",
      "font-size": 11, "font-weight": 700, "font-family": "var(--mono)", fill: "#38bdf8" }, fullRange);
  }

  // ================= CLAIMED TARGET LINE & BADGE
  if (claimed != null && claimed >= dmin && claimed <= dmax) {
    const x = X(claimed);
    add(svg, "line", { x1: x, x2: x, y1: top - 4, y2: bot,
      stroke: "#f59e0b", "stroke-width": 2, "stroke-dasharray": "4 3" });

    // Floating Claim Badge Pill
    const cTxt = `CLAIM: ${fmtPct(claimed)}`;
    const cW = cTxt.length * 7 + 16;
    const cx = Math.max(L + cW / 2 + 2, Math.min(W - R - cW / 2 - 2, x));
    add(svg, "rect", {
      x: cx - cW / 2, y: 5, width: cW, height: 20, rx: 4,
      fill: "#0b1322", stroke: "#f59e0b", "stroke-width": 1.3
    });
    add(svg, "text", {
      x: cx, y: 19, "text-anchor": "middle",
      "font-size": 10.5, "font-weight": 800, "font-family": "var(--mono)", fill: "#f59e0b"
    }, cTxt);
    // Downward pointer tip
    add(svg, "polygon", { points: `${x - 3},25 ${x + 3},25 ${x},28`, fill: "#f59e0b" });
  }

  // ================= OBSERVED POINT TELEMETRY BEACON
  if (pt >= dmin && pt <= dmax) {
    const x = X(pt);

    // Crosshair reference line
    add(svg, "line", { x1: x, x2: x, y1: barY - 14, y2: barY + barH + 6,
      stroke: "rgba(16, 185, 129, 0.45)", "stroke-width": 1.2, "stroke-dasharray": "2 2" });

    // Concentric pulsing radar waves
    add(svg, "circle", { cx: x, cy, r: 15, fill: "rgba(16, 185, 129, 0.16)" });
    add(svg, "circle", { cx: x, cy, r: 10, fill: "none", stroke: "#10b981", "stroke-width": 1.8, class: "bead-ping" });
    add(svg, "circle", { cx: x, cy, r: 10, fill: "none", stroke: "#10b981", "stroke-width": 1.8, class: "bead-ping d2" });

    // Core telemetry bead
    add(svg, "circle", { cx: x, cy, r: 8, fill: "#10b981", stroke: "#ffffff", "stroke-width": 2.5, filter: ref("unc-bead") });
    add(svg, "circle", { cx: x, cy, r: 2.8, fill: "#ffffff" });

    // Floating Obsidian HUD Pill for Observed Value
    const oTxt = `OBSERVED ${fmtPct(pt)}`;
    const oW = oTxt.length * 7 + 16;
    const ox = Math.max(L + oW / 2 + 2, Math.min(W - R - oW / 2 - 2, x));
    const oY = barY - 30;

    add(svg, "rect", {
      x: ox - oW / 2, y: oY, width: oW, height: 21, rx: 4,
      fill: "rgba(7, 15, 26, 0.95)", stroke: "#10b981", "stroke-width": 1.4,
      filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.6))"
    });
    add(svg, "text", {
      x: ox, y: oY + 15, "text-anchor": "middle",
      "font-size": 11, "font-weight": 800, "font-family": "var(--mono)", fill: "#10b981"
    }, oTxt);
    // Pointer down to bead
    add(svg, "polygon", { points: `${ox - 4},${oY + 21} ${ox + 4},${oY + 21} ${ox},${oY + 25}`, fill: "#10b981" });
  }
}

/* ------------------------------------------------ historical series */

function frame(svg, W, H, M, x0, x1, ymax, opts = {}) {
  const X = v => M.l + (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0)) * (W - M.l - M.r);
  const Y = v => H - M.b - (v / ymax) * (H - M.t - M.b);
  const ystep = niceStep(ymax, 4);
  const dec = stepDecimals(ystep);

  for (let v = 0; v <= ymax + 1e-9; v += ystep) {
    add(svg, "line", { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), stroke: "var(--line-soft)" });
    add(svg, "text", {
      x: M.l - 8, y: Y(v) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)", "font-family": "var(--mono)"
    }, opts.yfmt ? opts.yfmt(v) : String(+v.toFixed(dec)));
  }

  const xstep = Math.max(1, Math.ceil((x1 - x0) / Math.max(3, Math.floor((W - M.l - M.r) / 58))));
  for (let v = x0; v <= x1; v += xstep) {
    add(svg, "text", { x: X(v), y: H - M.b + 17, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, v);
  }

  if (opts.unit) {
    add(svg, "text", { x: M.l, y: 11, "font-size": 11, fill: "var(--muted)" }, opts.unit);
  }
  return { X, Y };
}

function drawSeries(host, c) {
  const a = c.analysis, ev = c.evidence;
  if (!ev || !ev.years.length) { host.innerHTML = ""; return; }

  const H = 260, M = { l: 48, r: 24, t: 36, b: 32 };
  const claimedEnd = a.claimed_change != null ? a.baseline_value * (1 + a.claimed_change) : null;
  const { svg, W } = svgIn(host, H,
    `Observed annual flaring at ${ev.field_name}, ${ev.years[0]} to ${ev.years[ev.years.length - 1]}. ` +
    `${a.baseline_year}: ${a.baseline_value}; ${a.comparison_year}: ${a.comparison_value} ${ev.unit}.`);

  const uid = Math.random().toString(36).slice(2, 8);
  const defs = add(svg, "defs", {});

  const areaGrad = add(defs, "linearGradient", { id: `series-area-${uid}`, x1: 0, y1: 0, x2: 0, y2: 1 });
  add(areaGrad, "stop", { offset: "0%", "stop-color": "#10b981", "stop-opacity": "0.32" });
  add(areaGrad, "stop", { offset: "70%", "stop-color": "#06b6d4", "stop-opacity": "0.08" });
  add(areaGrad, "stop", { offset: "100%", "stop-color": "#06b6d4", "stop-opacity": "0.0" });

  const glow = add(defs, "filter", { id: `glow-${uid}`, x: "-20%", y: "-40%", width: "140%", height: "180%" });
  add(glow, "feDropShadow", { dx: 0, dy: 0, stdDeviation: 3.5, "flood-color": "#10b981", "flood-opacity": 0.55 });

  const ymax = Math.max(...ev.values, claimedEnd || 0) * 1.15 || 1;
  const { X, Y } = frame(svg, W, H, M, ev.years[0], ev.years[ev.years.length - 1], ymax, { unit: unitShort(ev.unit) });

  for (const [yr, lab] of [[a.baseline_year, "baseline"], [a.comparison_year, "outcome"]]) {
    add(svg, "line", { x1: X(yr), x2: X(yr), y1: M.t, y2: H - M.b, stroke: "var(--muted)", "stroke-dasharray": "3 4", opacity: .7 });
    const lx = X(yr), anchor = lx > W - M.r - 50 ? "end" : lx < M.l + 50 ? "start" : "middle";
    add(svg, "text", { x: lx, y: M.t - 6, "text-anchor": anchor, "font-size": 11, "font-weight": 700, fill: "var(--muted)" }, `${lab} ${yr}`);
  }

  if (a.baseline_year && a.comparison_year) {
    const bx = X(a.baseline_year), ox = X(a.comparison_year);
    const minX = Math.min(bx, ox), maxX = Math.max(bx, ox);
    add(svg, "rect", {
      x: minX, y: M.t, width: maxX - minX, height: H - M.t - M.b,
      fill: "rgba(56, 189, 248, 0.04)", stroke: "rgba(56, 189, 248, 0.12)",
      "stroke-dasharray": "3 3", rx: 4
    });
  }

  const areaPoints = [
    `${X(ev.years[0])},${Y(0)}`,
    ...ev.years.map((y, i) => `${X(y)},${Y(ev.values[i])}`),
    `${X(ev.years[ev.years.length - 1])},${Y(0)}`
  ].join(" ");
  add(svg, "polygon", { points: areaPoints, fill: `url(#series-area-${uid})` });

  for (const [yr, lab, col, val] of [
    [a.baseline_year, "BASELINE", "#38bdf8", a.baseline_value],
    [a.comparison_year, "OUTCOME", "#10b981", a.comparison_value]
  ]) {
    const lx = X(yr);
    add(svg, "line", { x1: lx, x2: lx, y1: M.t, y2: H - M.b, stroke: col, "stroke-dasharray": "4 4", opacity: 0.75, "stroke-width": 1.4 });
    const pillTxt = `${lab} ${yr} · ${fmtNum(val, 2)}`;
    const tw = pillTxt.length * 6.5 + 14;
    const px = Math.max(M.l + tw / 2, Math.min(W - M.r - tw / 2, lx));
    add(svg, "rect", {
      x: px - tw / 2, y: M.t - 22, width: tw, height: 18, rx: 4,
      fill: "rgba(11, 19, 34, 0.95)", stroke: col, "stroke-width": 1.2
    });
    add(svg, "text", {
      x: px, y: M.t - 9, "text-anchor": "middle",
      "font-size": 10, "font-weight": 800, "font-family": "var(--mono)", fill: col
    }, pillTxt);
  }

  const observedLine = add(svg, "polyline", {
    points: ev.years.map((y, i) => `${X(y)},${Y(ev.values[i])}`).join(" "),
    fill: "none", stroke: "var(--c-observed)", "stroke-width": 2.8, "stroke-linejoin": "round",
    filter: `url(#glow-${uid})`
  });
  drawIn(observedLine);

  if (claimedEnd != null) {
    add(svg, "line", { x1: X(a.baseline_year), y1: Y(a.baseline_value), x2: X(a.comparison_year), y2: Y(claimedEnd),
      stroke: "var(--c-claimed)", "stroke-width": 2, "stroke-dasharray": "5 4" });
    const claimedDot = add(svg, "circle", { cx: X(a.comparison_year), cy: Y(claimedEnd), r: 5, fill: "var(--card)", stroke: "var(--c-claimed)", "stroke-width": 2.2, tabindex: 0 });
    hover(claimedDot, `<div class="tip-k">${a.comparison_year} — implied by the claim</div><div class="tip-v">${fmtNum(claimedEnd, 2)} ${esc(unitShort(ev.unit))}</div><div class="tip-k">arithmetic on the claim, not an observation</div>`);

    const cx = X(a.comparison_year), cy = Y(claimedEnd);
    const claimHalo = add(svg, "circle", { cx, cy, r: 6, fill: "#0b1322", stroke: "#f59e0b", "stroke-width": 2.4, tabindex: 0 });
    hover(claimHalo, `<div class="tip-k">${a.comparison_year} — implied by claim</div><div class="tip-v">${fmtNum(claimedEnd, 2)} ${esc(unitShort(ev.unit))}</div><div class="tip-k">arithmetic on the claim, not an observation</div>`);

    const cTxt = `CLAIM: ${fmtPct(a.claimed_change)}`;
    const cW = cTxt.length * 6.5 + 14;
    const cpx = Math.max(M.l + cW / 2, Math.min(W - M.r - cW / 2, cx));
    add(svg, "rect", {
      x: cpx - cW / 2, y: cy - 24, width: cW, height: 18, rx: 4,
      fill: "#0b1322", stroke: "#f59e0b", "stroke-width": 1.2
    });
    add(svg, "text", {
      x: cpx, y: cy - 11, "text-anchor": "middle",
      "font-size": 10, "font-weight": 800, "font-family": "var(--mono)", fill: "#f59e0b"
    }, cTxt);
  }

  ev.years.forEach((y, i) => {
    const key = y === a.baseline_year || y === a.comparison_year;
    const isOutcome = y === a.comparison_year;
    const isBaseline = y === a.baseline_year;
    const cx = X(y), cy = Y(ev.values[i]);

    const dot = add(svg, "circle", {
      cx, cy, r: key ? 6 : 3.5,
      fill: isOutcome ? "#10b981" : isBaseline ? "#38bdf8" : "var(--c-observed)",
      stroke: "var(--card)", "stroke-width": key ? 2.5 : 1.5
    });

    if (isOutcome) {
      add(svg, "circle", { cx, cy, r: 12, fill: "none", stroke: "#10b981", "stroke-width": 1.6, class: "bead-ping" });
    }
    add(svg, "circle", { cx, cy, r: 1.8, fill: "#ffffff" });
    hover(dot, `<div class="tip-k">${y} — observed (VIIRS)</div><div class="tip-v">${fmtNum(ev.values[i], 3)} ${esc(unitShort(ev.unit))}</div>`);
  });
}

/* ------------------------------------------------ trajectory */

function drawTrajectory(host, t) {
  const H = 290, M = { l: 48, r: 20, t: 28, b: 32 };
  const years = [...t.observed.map(p => p.year), ...t.projected.map(p => p.year)];
  const x0 = Math.min(...years), x1 = Math.max(...years, t.target.year);
  const last = t.last_observed, p = t.projection_at_target;
  const { svg, W } = svgIn(host, H,
    `Observed ${t.observed[0].year} to ${last.year}, projected to ${t.target.year}. ` +
    `Projection at ${t.target.year}: ${p.value} (90% band ${p.lower} to ${p.upper}); target ${t.target.value}.`);
  const ymax = Math.max(...t.observed.map(q => q.value), ...t.projected.map(q => q.upper), t.target.value, 0.1) * 1.15;

  const uid = Math.random().toString(36).slice(2, 8);
  const defs = add(svg, "defs", {});
  const hatch = hatchDef(svg, `hatch-${uid}`, "var(--c-projected)");

  const { X, Y } = frame(svg, W, H, M, x0, x1, ymax, { unit: "bcm/yr" });

  add(svg, "rect", { x: X(last.year), y: M.t, width: X(x1) - X(last.year), height: H - M.t - M.b,
    fill: "var(--blue-tint)", opacity: .45 });
  add(svg, "text", { x: X(last.year) + 6, y: M.t + 13, "font-size": 11, "font-weight": 700, fill: "var(--blue-ink)" }, "PROJECTED");
  add(svg, "text", { x: X(last.year) - 6, y: M.t + 13, "text-anchor": "end", "font-size": 11, "font-weight": 700, fill: "var(--c-observed)" }, "OBSERVED");
  add(svg, "line", { x1: X(last.year), x2: X(last.year), y1: M.t - 6, y2: H - M.b, stroke: "var(--text)", "stroke-width": 1.5 });
  add(svg, "text", { x: X(last.year), y: M.t - 10, "text-anchor": "middle", "font-size": 11, fill: "var(--text)" }, `last observation ${last.year}`);

  const lastX = X(last.year), endX = X(x1);
  add(svg, "rect", {
    x: lastX, y: M.t, width: endX - lastX, height: H - M.t - M.b,
    fill: "rgba(56, 189, 248, 0.05)", stroke: "rgba(56, 189, 248, 0.15)", rx: 4
  });
  add(svg, "text", { x: lastX + 8, y: M.t + 14, "font-size": 10.5, "font-weight": 800, "font-family": "var(--mono)", fill: "#38bdf8" }, "PROJECTED");
  add(svg, "text", { x: lastX - 8, y: M.t + 14, "text-anchor": "end", "font-size": 10.5, "font-weight": 800, "font-family": "var(--mono)", fill: "#10b981" }, "OBSERVED");
  add(svg, "line", { x1: lastX, x2: lastX, y1: M.t - 6, y2: H - M.b, stroke: "#38bdf8", "stroke-width": 1.6, "stroke-dasharray": "3 3" });
  add(svg, "text", { x: lastX, y: M.t - 10, "text-anchor": "middle", "font-size": 10.5, "font-family": "var(--mono)", fill: "var(--muted)" }, `last obs ${last.year}`);

  const fit = y => Math.max(0, p.value + (t.observed_annual_rate || 0) * (y - t.target.year));
  add(svg, "line", { x1: X(t.observed[0].year), y1: Y(fit(t.observed[0].year)), x2: X(last.year), y2: Y(fit(last.year)),
    stroke: "var(--c-projected)", "stroke-width": 1.5, "stroke-dasharray": "7 5", opacity: .55 });

  if (t.projected.length) {
    const up = t.projected.map(q => `${X(q.year)},${Y(q.upper)}`);
    const dn = t.projected.map(q => `${X(q.year)},${Y(q.lower)}`).reverse();
    const pts = [...up, ...dn].join(" ");
    add(svg, "polygon", { points: pts, fill: "var(--c-projected)", "fill-opacity": .08 });
    add(svg, "polygon", { points: pts, fill: hatch });
  }

  if (t.required && t.required.length > 1) {
    add(svg, "polyline", { points: t.required.map(q => `${X(q.year)},${Y(q.value)}`).join(" "),
      fill: "none", stroke: "var(--c-required)", "stroke-width": 2, "stroke-dasharray": "1.5 5", "stroke-linecap": "round" });
  }

  const observedSeries = add(svg, "polyline", {
    points: t.observed.map(q => `${X(q.year)},${Y(q.value)}`).join(" "),
    fill: "none", stroke: "var(--c-observed)", "stroke-width": 2.8, "stroke-linejoin": "round"
  });
  drawIn(observedSeries);

  add(svg, "polyline", { points: [`${X(last.year)},${Y(fit(last.year))}`, ...t.projected.map(q => `${X(q.year)},${Y(q.value)}`)].join(" "),
    fill: "none", stroke: "var(--c-projected)", "stroke-width": 2.2, "stroke-dasharray": "7 5" });

  add(svg, "polyline", {
    points: [`${lastX},${Y(fit(last.year))}`, ...t.projected.map(q => `${X(q.year)},${Y(q.value)}`)].join(" "),
    fill: "none", stroke: "var(--c-projected)", "stroke-width": 2.4, "stroke-dasharray": "6 4"
  });

  t.observed.forEach(q => {
    const dot = add(svg, "circle", { cx: X(q.year), cy: Y(q.value), r: 4, fill: "var(--c-observed)", stroke: "#070e1b", "stroke-width": 1.8 });
    hover(dot, `<div class="tip-k">${q.year} — observed</div><div class="tip-v">${fmtNum(q.value, 3)} bcm/yr</div>`);
  });

  t.projected.forEach(q => {
    const dot = add(svg, "circle", { cx: X(q.year), cy: Y(q.value), r: 3.5, fill: "#0b1322", stroke: "var(--c-projected)", "stroke-width": 2 });
    hover(dot, `<div class="tip-k">${q.year} — projected (not observed)</div><div class="tip-v">${fmtNum(q.value, 2)} bcm/yr</div><div class="tip-k">90% band ${fmtNum(q.lower, 2)} – ${fmtNum(q.upper, 2)}</div>`);
  });

  const tx = X(t.target.year), ty = Y(t.target.value);
  const dia = add(svg, "rect", { x: tx - 7, y: ty - 7, width: 14, height: 14, fill: "var(--c-target)",
    stroke: "var(--card)", "stroke-width": 2, transform: `rotate(45 ${tx} ${ty})`, tabindex: 0 });
  hover(dia, `<div class="tip-k">${t.target.year} — target</div><div class="tip-v">${fmtNum(t.target.value, 2)} bcm/yr</div><div class="tip-k">${esc(t.target.basis)}</div>`);
  add(svg, "text", { x: tx - 12, y: ty - 10, "text-anchor": "end", "font-size": 12, "font-weight": 700, fill: "var(--c-target)" },
    `target ${fmtNum(t.target.value, 2)}`);

  add(svg, "rect", {
    x: tx - 7.5, y: ty - 7.5, width: 15, height: 15, fill: "#a855f7",
    stroke: "#ffffff", "stroke-width": 2, transform: `rotate(45 ${tx} ${ty})`, tabindex: 0
  });

  const diaHover = add(svg, "rect", {
    x: tx - 10, y: ty - 10, width: 20, height: 20, fill: "transparent",
    transform: `rotate(45 ${tx} ${ty})`, tabindex: 0
  });
  hover(diaHover, `<div class="tip-k">${t.target.year} — target</div><div class="tip-v">${fmtNum(t.target.value, 2)} bcm/yr</div><div class="tip-k">${esc(t.target.basis)}</div>`);

  const tTxt = `TARGET ${fmtNum(t.target.value, 2)} bcm/yr`;
  const tW = tTxt.length * 6.5 + 14;
  add(svg, "rect", {
    x: tx - tW - 12, y: ty - 22, width: tW, height: 19, rx: 4,
    fill: "rgba(11, 19, 34, 0.95)", stroke: "#c084fc", "stroke-width": 1.2
  });
  add(svg, "text", {
    x: tx - 12 - tW / 2, y: ty - 9, "text-anchor": "middle",
    "font-size": 10.5, "font-weight": 800, "font-family": "var(--mono)", fill: "#c084fc"
  }, tTxt);
}

/* ------------------------------------------------ sparkline (string) */

function sparkline(years, values, { w = 120, h = 32, mark = true } = {}) {
  if (!values || values.length < 2) return `<span class="muted xs">no series</span>`;
  const max = Math.max(...values) || 1, min = 0;
  const X = i => 2 + i / (values.length - 1) * (w - 4);
  const Y = v => h - 3 - (v - min) / (max - min) * (h - 6);
  const pts = values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const lastI = values.length - 1;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"
    aria-label="Observed ${years[0]}–${years[lastI]}: ${fmtNum(values[0], 2)} to ${fmtNum(values[lastI], 2)}">
    <polyline points="${pts}" fill="none" stroke="var(--c-observed)" stroke-width="1.8" stroke-linejoin="round"/>
    ${mark ? `<circle cx="${X(lastI)}" cy="${Y(values[lastI])}" r="2.6" fill="var(--c-observed)"/>` : ""}
  </svg>`;
}

/* ------------------------------------------------ research charts */

function drawCoverageByGap(host, byGap, nominal) {
  const gaps = Object.keys(byGap).map(Number).sort((p, q) => p - q);
  const H = 230, M = { l: 46, r: 16, t: 16, b: 34 };
  const { svg, W } = svgIn(host, H,
    `Measured coverage of the shipped interval by year gap, nominal ${pct1(nominal)}: ` +
    gaps.map(g => `${g} years ${pct1(byGap[g])}`).join(", "));
  const lo = 0.75, hi = 1.02;
  const X = g => M.l + (g - gaps[0]) / (gaps[gaps.length - 1] - gaps[0]) * (W - M.l - M.r);
  const Y = v => H - M.b - (v - lo) / (hi - lo) * (H - M.t - M.b);
  for (const v of [0.8, 0.85, 0.9, 0.95, 1.0]) {
    add(svg, "line", { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), stroke: "var(--line-soft)" });
    add(svg, "text", { x: M.l - 8, y: Y(v) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" }, `${Math.round(v * 100)}%`);
  }
  add(svg, "line", { x1: M.l, x2: W - M.r, y1: Y(nominal), y2: Y(nominal), stroke: "var(--c-claimed)", "stroke-dasharray": "6 4", "stroke-width": 1.6 });
  add(svg, "text", { x: W - M.r, y: Y(nominal) - 6, "text-anchor": "end", "font-size": 11, "font-weight": 700, fill: "var(--c-claimed)" }, `nominal ${Math.round(nominal * 100)}%`);
  gaps.forEach(g => add(svg, "text", { x: X(g), y: H - M.b + 16, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, g));
  add(svg, "text", { x: (M.l + W - M.r) / 2, y: H - 4, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, "year gap between baseline and outcome");
  const line = add(svg, "polyline", { points: gaps.map(g => `${X(g)},${Y(byGap[g])}`).join(" "), fill: "none", stroke: "var(--c-observed)", "stroke-width": 2.4 });
  drawIn(line);
  gaps.forEach(g => {
    const under = byGap[g] < nominal - 0.03;
    const d = add(svg, "circle", { cx: X(g), cy: Y(byGap[g]), r: under ? 6 : 4, fill: under ? "var(--card)" : "var(--c-observed)",
      stroke: under ? "var(--red-ink)" : "var(--card)", "stroke-width": 2 });
    hover(d, `<div class="tip-k">${g}-year gap</div><div class="tip-v">${pct1(byGap[g])} measured coverage</div>${under ? '<div class="tip-k">under-covers vs nominal</div>' : ""}`);
  });
}

function drawAbstentionByWindow(host, rows) {
  const keys = Object.keys(rows).map(Number).sort((p, q) => p - q);
  const H = 230, M = { l: 44, r: 12, t: 22, b: 34 };
  const { svg, W } = svgIn(host, H, "Abstention rate by claim window length: " +
    keys.map(k => `${k} years ${pct1(rows[k].abstention_rate)} (n=${rows[k].n})`).join(", "));
  const Y = v => H - M.b - v * (H - M.t - M.b);
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    add(svg, "line", { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), stroke: "var(--line-soft)" });
    add(svg, "text", { x: M.l - 8, y: Y(v) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" }, `${v * 100}%`);
  }
  const bw = (W - M.l - M.r) / keys.length;
  keys.forEach((k, i) => {
    const r = rows[k], x = M.l + i * bw + bw * 0.18, w = bw * 0.64;
    const b = add(svg, "rect", { x, y: Y(r.abstention_rate), width: w, height: Y(0) - Y(r.abstention_rate), fill: "var(--indigo)", "fill-opacity": .78, rx: 1 });
    hover(b, `<div class="tip-k">${k}-year claim window · n=${r.n}</div><div class="tip-v">${pct1(r.abstention_rate)} abstained</div><div class="tip-k">median interval width ${r.median_interval_width}</div>`);
    if (bw > 34) add(svg, "text", { x: x + w / 2, y: Y(r.abstention_rate) - 5, "text-anchor": "middle", "font-size": 10.5, fill: "var(--text-2)" }, `${Math.round(r.abstention_rate * 100)}%`);
    add(svg, "text", { x: x + w / 2, y: H - M.b + 16, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, k);
  });
  add(svg, "text", { x: (M.l + W - M.r) / 2, y: H - 4, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, "claim window (years)");
}
