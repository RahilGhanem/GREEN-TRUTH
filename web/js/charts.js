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
    const len = Math.ceil(el.getTotalLength());
    el.style.setProperty("--len", len);
    el.classList.add("chart-draw");
  } catch { /* not rendered yet — draw without animation */ }
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
    case "interval":  return s(`<rect x="2" y="4" width="26" height="6" rx="1" fill="var(--c-interval)"/>`);
    case "point":     return s(`<circle cx="15" cy="7" r="5" fill="var(--c-observed)" stroke="var(--card)" stroke-width="2"/>`);
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
  const H = 162;
  const [lo, hi] = a.interval;
  const pt = a.observed_change, claimed = a.claimed_change;
  const flat = a.flat_band != null ? a.flat_band : 0.05;
  const labels = a.region_labels || {};
  const { svg, W } = svgIn(host, H,
    `Uncertainty. Observed change ${fmtPct(pt)}. 90% interval ${fmtPct(lo)} to ${fmtPct(hi)}.` +
    (claimed != null ? ` Claimed ${fmtPct(claimed)}.` : "") +
    ` The interval touches ${a.region_span + 1} decision region${a.region_span ? "s" : ""}.`);

  // Domain: everything that matters, with the interval clipped where it runs
  // far past the key values (overflow is marked and its true value printed).
  const keys = [pt, claimed ?? 0, 0, -flat, flat];
  const kmin = Math.min(...keys), kmax = Math.max(...keys);
  const capLo = Math.max(-1.05, kmin - 1.5), capHi = kmax + 1.5;
  let dmin = Math.max(Math.min(lo, kmin), capLo);
  let dmax = Math.min(Math.max(hi, kmax), capHi);
  const pad = (dmax - dmin) * 0.06;
  dmin -= pad; dmax += pad;
  const L = 14, R = 14;
  // When the point lies outside the interval, leave room on that side for its
  // label so it sits beside the marker instead of on the claimed line.
  // Capped, so a narrow screen is not squeezed to make room for one label.
  const need = 118 / (W - L - R) * (dmax - dmin) * 1.15;
  if (need <= 0.4 * (dmax - dmin)) {
    if (pt < lo && pt - dmin < need) dmin = pt - need;
    if (pt > hi && dmax - pt < need) dmax = pt + need;
  }
  const X = v => L + (v - dmin) / (dmax - dmin) * (W - L - R);
  const top = 26, bot = 134, barY = 92, barH = 12, cy = barY + barH / 2;

  // regions
  const cuts = [claimed, -flat, flat].filter(v => v != null && v > dmin && v < dmax).sort((p, q) => p - q);
  const pts = [dmin, ...cuts, dmax];
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const r = regionOf((pts[i] + pts[i + 1]) / 2, claimed, flat);
    const last = segs[segs.length - 1];
    if (last && last.r === r) last.b = pts[i + 1];
    else segs.push({ a: pts[i], b: pts[i + 1], r });
  }
  for (const s of segs) {
    const x0 = X(s.a), x1 = X(s.b), w = x1 - x0;
    add(svg, "rect", { x: x0, y: top, width: Math.max(0, w), height: bot - top, fill: REGION_FILL[s.r] });
    const full = labels[String(s.r)] || REGION_SHORT[s.r];
    const txt = full.length * 6.1 < w - 10 ? full : (REGION_SHORT[s.r].length * 6.1 < w - 8 ? REGION_SHORT[s.r] : null);
    if (txt) add(svg, "text", { x: x0 + w / 2, y: top + 15, "text-anchor": "middle", "font-size": 11,
      "font-weight": 700, fill: REGION_INK[s.r] }, txt);
  }
  for (const c of cuts) add(svg, "line", { x1: X(c), x2: X(c), y1: top, y2: bot,
    stroke: "var(--line-strong)", "stroke-dasharray": "2 3" });

  // axis
  add(svg, "line", { x1: L, x2: W - R, y1: bot, y2: bot, stroke: "var(--line-strong)" });
  const step = niceStep(dmax - dmin, W < 480 ? 4 : 7);
  for (let v = Math.ceil(dmin / step) * step; v <= dmax + 1e-9; v += step) {
    const x = X(v);
    add(svg, "line", { x1: x, x2: x, y1: bot, y2: bot + 4, stroke: "var(--line-strong)" });
    add(svg, "text", { x, y: bot + 17, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" },
      Math.abs(v) < 1e-9 ? "0%" : fmtPct(v, stepDecimals(step * 100)));
  }
  if (0 > dmin && 0 < dmax) add(svg, "line", { x1: X(0), x2: X(0), y1: top, y2: bot, stroke: "var(--muted)", "stroke-width": 1 });

  // interval bar
  const xa = X(Math.max(lo, dmin)), xb = X(Math.min(hi, dmax));
  add(svg, "rect", { x: xa, y: barY, width: Math.max(2, xb - xa), height: barH, rx: 2, fill: "var(--c-interval)" });
  for (const [x, over] of [[xa, lo < dmin], [xb, hi > dmax]]) {
    if (!over) add(svg, "line", { x1: x, x2: x, y1: barY - 6, y2: barY + barH + 6, stroke: "var(--c-interval)", "stroke-width": 2 });
  }
  if (lo < dmin) add(svg, "path", { d: `M${xa - 9},${cy} L${xa + 1},${barY - 5} L${xa + 1},${barY + barH + 5} Z`, fill: "var(--c-interval)" });
  if (hi > dmax) add(svg, "path", { d: `M${xb + 9},${cy} L${xb - 1},${barY - 5} L${xb - 1},${barY + barH + 5} Z`, fill: "var(--c-interval)" });
  const endY = barY + barH + 16;
  const loTxt = (lo < dmin ? "to " : "") + fmtPct(lo), hiTxt = (hi > dmax ? "to " : "") + fmtPct(hi);
  if (xb - xa > 90) {
    add(svg, "text", { x: xa, y: endY, "text-anchor": xa < 40 ? "start" : "middle", "font-size": 12, "font-weight": 700, fill: "var(--text)" }, loTxt);
    add(svg, "text", { x: xb, y: endY, "text-anchor": xb > W - 40 ? "end" : "middle", "font-size": 12, "font-weight": 700, fill: "var(--text)" }, hiTxt);
  } else {
    add(svg, "text", { x: (xa + xb) / 2, y: endY, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: "var(--text)" }, `${loTxt} … ${hiTxt}`);
  }

  // claimed
  if (claimed != null && claimed >= dmin && claimed <= dmax) {
    const x = X(claimed);
    add(svg, "line", { x1: x, x2: x, y1: top - 4, y2: bot, stroke: "var(--c-claimed)", "stroke-width": 2, "stroke-dasharray": "5 4" });
    const t = `Claimed ${fmtPct(claimed)}`;
    const tx = Math.min(Math.max(x, t.length * 3.4 + 4), W - t.length * 3.4 - 4);
    add(svg, "text", { x: tx, y: 14, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: "var(--c-claimed)" }, t);
  }

  // point estimate
  if (pt >= dmin && pt <= dmax) {
    const x = X(pt);
    add(svg, "circle", { cx: x, cy, r: 8, fill: "var(--c-observed)", stroke: "var(--card)", "stroke-width": 2.5 });
    const t = `Observed ${fmtPct(pt)}`, tw = t.length * 6.8;
    // Outside the interval: label beside the marker on the open side, at bar
    // height, so it never sits on top of the claimed line. Inside: above.
    // On a phone the value is already stated above the chart, so the marker
    // stands alone rather than colliding with the claimed line.
    if (W < 480) {
      /* marker only */
    } else if (pt < lo && x - 12 - tw > L) {
      add(svg, "text", { x: x - 12, y: cy + 4, "text-anchor": "end", "font-size": 12, "font-weight": 700, fill: "var(--c-observed)" }, t);
    } else if (pt > hi && x + 12 + tw < W - R) {
      add(svg, "text", { x: x + 12, y: cy + 4, "text-anchor": "start", "font-size": 12, "font-weight": 700, fill: "var(--c-observed)" }, t);
    } else if (claimed != null && pt < lo && X(claimed) > x) {
      // above, extending away from the claimed line
      add(svg, "text", { x: Math.max(x + 6, L + tw), y: barY - 12, "text-anchor": "end", "font-size": 12, "font-weight": 700, fill: "var(--c-observed)" }, t);
    } else if (claimed != null && pt > hi && X(claimed) < x) {
      add(svg, "text", { x: Math.min(x - 6, W - R - tw), y: barY - 12, "text-anchor": "start", "font-size": 12, "font-weight": 700, fill: "var(--c-observed)" }, t);
    } else {
      const tx = Math.min(Math.max(x, tw / 2 + 4), W - tw / 2 - 4);
      add(svg, "text", { x: tx, y: barY - 12, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: "var(--c-observed)" }, t);
    }
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
    add(svg, "text", { x: M.l - 8, y: Y(v) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" },
      opts.yfmt ? opts.yfmt(v) : String(+v.toFixed(dec)));
  }
  const xstep = Math.max(1, Math.ceil((x1 - x0) / Math.max(3, Math.floor((W - M.l - M.r) / 58))));
  for (let v = x0; v <= x1; v += xstep) {
    add(svg, "text", { x: X(v), y: H - M.b + 17, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, v);
  }
  if (opts.unit) add(svg, "text", { x: M.l, y: 11, "font-size": 11, fill: "var(--muted)" }, opts.unit);
  return { X, Y };
}

function drawSeries(host, c) {
  const a = c.analysis, ev = c.evidence;
  if (!ev || !ev.years.length) { host.innerHTML = ""; return; }
  const H = 250, M = { l: 44, r: 16, t: 22, b: 28 };
  const claimedEnd = a.claimed_change != null ? a.baseline_value * (1 + a.claimed_change) : null;
  const { svg, W } = svgIn(host, H,
    `Observed annual flaring at ${ev.field_name}, ${ev.years[0]} to ${ev.years[ev.years.length - 1]}. ` +
    `${a.baseline_year}: ${a.baseline_value}; ${a.comparison_year}: ${a.comparison_value} ${ev.unit}.`);
  const ymax = Math.max(...ev.values, claimedEnd || 0) * 1.15 || 1;
  const { X, Y } = frame(svg, W, H, M, ev.years[0], ev.years[ev.years.length - 1], ymax, { unit: unitShort(ev.unit) });

  for (const [yr, lab] of [[a.baseline_year, "baseline"], [a.comparison_year, "outcome"]]) {
    add(svg, "line", { x1: X(yr), x2: X(yr), y1: M.t, y2: H - M.b, stroke: "var(--muted)", "stroke-dasharray": "3 4", opacity: .7 });
    const lx = X(yr), anchor = lx > W - M.r - 50 ? "end" : lx < M.l + 50 ? "start" : "middle";
    add(svg, "text", { x: lx, y: M.t - 6, "text-anchor": anchor, "font-size": 11, "font-weight": 700, fill: "var(--muted)" }, `${lab} ${yr}`);
  }
  const line = add(svg, "polyline", { points: ev.years.map((y, i) => `${X(y)},${Y(ev.values[i])}`).join(" "),
    fill: "none", stroke: "var(--c-observed)", "stroke-width": 2.5, "stroke-linejoin": "round" });
  drawIn(line);

  if (claimedEnd != null) {
    add(svg, "line", { x1: X(a.baseline_year), y1: Y(a.baseline_value), x2: X(a.comparison_year), y2: Y(claimedEnd),
      stroke: "var(--c-claimed)", "stroke-width": 2, "stroke-dasharray": "5 4" });
    const m = add(svg, "circle", { cx: X(a.comparison_year), cy: Y(claimedEnd), r: 5, fill: "var(--card)", stroke: "var(--c-claimed)", "stroke-width": 2.2, tabindex: 0 });
    hover(m, `<div class="tip-k">${a.comparison_year} — implied by the claim</div><div class="tip-v">${fmtNum(claimedEnd, 2)} ${esc(unitShort(ev.unit))}</div><div class="tip-k">arithmetic on the claim, not an observation</div>`);
  }
  ev.years.forEach((y, i) => {
    const key = y === a.baseline_year || y === a.comparison_year;
    const d = add(svg, "circle", { cx: X(y), cy: Y(ev.values[i]), r: key ? 6 : 3.5, fill: "var(--c-observed)",
      stroke: "var(--card)", "stroke-width": key ? 2.5 : 1.5 });
    hover(d, `<div class="tip-k">${y} — observed (VIIRS)</div><div class="tip-v">${fmtNum(ev.values[i], 3)} ${esc(unitShort(ev.unit))}</div>`);
  });
}

/* ------------------------------------------------ trajectory */

function drawTrajectory(host, t) {
  const H = 290, M = { l: 44, r: 18, t: 24, b: 28 };
  const years = [...t.observed.map(p => p.year), ...t.projected.map(p => p.year)];
  const x0 = Math.min(...years), x1 = Math.max(...years, t.target.year);
  const last = t.last_observed, p = t.projection_at_target;
  const { svg, W } = svgIn(host, H,
    `Observed ${t.observed[0].year} to ${last.year}, projected to ${t.target.year}. ` +
    `Projection at ${t.target.year}: ${p.value} (90% band ${p.lower} to ${p.upper}); target ${t.target.value}.`);
  const ymax = Math.max(...t.observed.map(q => q.value), ...t.projected.map(q => q.upper), t.target.value, 0.1) * 1.12;
  const { X, Y } = frame(svg, W, H, M, x0, x1, ymax, { unit: "bcm/yr" });
  const hatch = hatchDef(svg, "hatch-" + Math.random().toString(36).slice(2, 7), "var(--c-projected)");

  // projected zone
  add(svg, "rect", { x: X(last.year), y: M.t, width: X(x1) - X(last.year), height: H - M.t - M.b,
    fill: "var(--blue-tint)", opacity: .45 });
  add(svg, "text", { x: X(last.year) + 6, y: M.t + 13, "font-size": 11, "font-weight": 700, fill: "var(--blue-ink)" }, "PROJECTED");
  add(svg, "text", { x: X(last.year) - 6, y: M.t + 13, "text-anchor": "end", "font-size": 11, "font-weight": 700, fill: "var(--c-observed)" }, "OBSERVED");
  add(svg, "line", { x1: X(last.year), x2: X(last.year), y1: M.t - 6, y2: H - M.b, stroke: "var(--text)", "stroke-width": 1.5 });
  add(svg, "text", { x: X(last.year), y: M.t - 10, "text-anchor": "middle", "font-size": 11, fill: "var(--text)" }, `last observation ${last.year}`);

  // The projection is the straight line fitted to every observed year, so it does
  // not start from the last observation. Draw that line through the observed
  // years too (faint) instead of bridging from the last dot, which would invent
  // a jump the model does not contain. Display clamped at zero, like the band.
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
  const obs = add(svg, "polyline", { points: t.observed.map(q => `${X(q.year)},${Y(q.value)}`).join(" "),
    fill: "none", stroke: "var(--c-observed)", "stroke-width": 2.5, "stroke-linejoin": "round" });
  drawIn(obs);
  add(svg, "polyline", { points: [`${X(last.year)},${Y(fit(last.year))}`, ...t.projected.map(q => `${X(q.year)},${Y(q.value)}`)].join(" "),
    fill: "none", stroke: "var(--c-projected)", "stroke-width": 2.2, "stroke-dasharray": "7 5" });

  t.observed.forEach(q => {
    const d = add(svg, "circle", { cx: X(q.year), cy: Y(q.value), r: 3.5, fill: "var(--c-observed)", stroke: "var(--card)", "stroke-width": 1.5 });
    hover(d, `<div class="tip-k">${q.year} — observed</div><div class="tip-v">${fmtNum(q.value, 3)} bcm/yr</div>`);
  });
  t.projected.forEach(q => {
    const d = add(svg, "circle", { cx: X(q.year), cy: Y(q.value), r: 3, fill: "var(--card)", stroke: "var(--c-projected)", "stroke-width": 1.8 });
    hover(d, `<div class="tip-k">${q.year} — projected (not observed)</div><div class="tip-v">${fmtNum(q.value, 2)} bcm/yr</div><div class="tip-k">90% band ${fmtNum(q.lower, 2)} – ${fmtNum(q.upper, 2)}</div>`);
  });
  const tx = X(t.target.year), ty = Y(t.target.value);
  const dia = add(svg, "rect", { x: tx - 7, y: ty - 7, width: 14, height: 14, fill: "var(--c-target)",
    stroke: "var(--card)", "stroke-width": 2, transform: `rotate(45 ${tx} ${ty})`, tabindex: 0 });
  hover(dia, `<div class="tip-k">${t.target.year} — target</div><div class="tip-v">${fmtNum(t.target.value, 2)} bcm/yr</div><div class="tip-k">${esc(t.target.basis)}</div>`);
  add(svg, "text", { x: tx - 12, y: ty - 10, "text-anchor": "end", "font-size": 12, "font-weight": 700, fill: "var(--c-target)" },
    `target ${fmtNum(t.target.value, 2)}`);
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
