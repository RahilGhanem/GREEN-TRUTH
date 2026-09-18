"use strict";
/* Field map. Real coordinates (data/facilities_international.json) and real
   annual values (/api/map); country outlines are Natural Earth, public domain.
   Nothing is interpolated: a field with no value in a year is drawn as empty. */

// Equirectangular, cropped to 84°N–58°S (the monitored fields all lie inside).
const MAP_W = 1000, MAP_TOP = 84, MAP_BOT = -58;
const DEG = MAP_W / 360;
const MAP_H = Math.round((MAP_TOP - MAP_BOT) * DEG);
const projX = lon => (lon + 180) * DEG;
const projY = lat => (MAP_TOP - lat) * DEG;

async function ensureMap() {
  if (state.geo) { drawSites(); renderFieldPanel(); return; }
  const svg = $("#mapSvg");
  svg.setAttribute("viewBox", `0 0 ${MAP_W} ${MAP_H}`);
  try {
    const [geo, world] = await Promise.all([getJSON("/api/map"), getJSON("/api/basemap")]);
    if (!state.methaneCov) { try { state.methaneCov = await getJSON("/api/methane/coverage"); } catch { /* shown as unavailable */ } }
    state.geo = geo; state.world = world;
    const years = geo.features.flatMap(f => f.properties.years);
    const sl = $("#mapSlider");
    if (years.length) {
      const lo = Math.min(...years), hi = Math.max(...years);
      sl.min = lo; sl.max = hi; sl.value = hi; state.mapYear = hi;
      $("#mapYear").textContent = hi;
    } else {
      // Fields are still drawn at their real coordinates, as "no observation".
      sl.disabled = true; $("#mapPlay").disabled = true;
      $("#mapYear").textContent = "—";
      $("#mapFrame").insertAdjacentHTML("beforebegin", stateCard({ compact: true, tone: "bad", sym: "!",
        title: "Real evidence is currently unavailable", what: "The fields are shown at their real coordinates, but no flaring series is loaded.",
        why: "The real-data files have not been produced in this copy; nothing is substituted.",
        next: "Run the real-data pipeline to restore this evidence source, then restart the server.",
        extra: techDetails("Missing file: <code>data/real/flaring_by_field.csv</code> (notebook 03).") }) + `<div style="height:16px"></div>`);
    }
    sl.addEventListener("input", () => { state.mapYear = +sl.value; $("#mapYear").textContent = sl.value; drawSites(); renderFieldPanel(); });
    $("#mapSrc").innerHTML = `Flaring: ${link(geo.source.url, geo.source.dataset)} — ${esc(geo.source.measurement)}, ${esc(geo.source.unit)}.
      Basemap: ${esc(world.attribution)} ${link(world.source_url, "source")}. Ctrl + scroll (or pinch) to zoom, drag to pan.`;
    drawBasemap();
    bindMapControls();
    drawSites();
    renderFieldTable();
    renderFieldPanel();
  } catch (e) {
    $("#mapFrame").innerHTML = stateCard({ tone: "bad", sym: "!", title: "Map data unavailable",
      what: esc(e.message), why: "The server did not return the field GeoJSON or the basemap.",
      next: "The field table below still lists what is known. Reload once the server is running." });
    $("#fieldPanel").innerHTML = "";
  }
}

function drawBasemap() {
  const svg = $("#mapSvg");
  svg.innerHTML = "";
  const g = add(svg, "g", { id: "mapWorld" });
  for (let lon = -150; lon <= 150; lon += 30) add(g, "line", { x1: projX(lon), x2: projX(lon), y1: 0, y2: MAP_H, class: "map-grat" });
  for (let lat = -30; lat <= 60; lat += 30) add(g, "line", { x1: 0, x2: MAP_W, y1: projY(lat), y2: projY(lat), class: "map-grat" });
  for (const f of state.world.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const d = polys.map(rings => rings.map(r =>
      "M" + r.map(([lo, la]) => `${projX(lo).toFixed(1)},${projY(la).toFixed(1)}`).join("L") + "Z").join("")).join("");
    add(g, "path", { d, class: "map-country" });
  }
  add(g, "g", { id: "mapSites" });
  applyMapTransform();
}

function applyMapTransform() {
  const g = $("#mapWorld");
  if (g) g.setAttribute("transform", `translate(${state.mapT.x} ${state.mapT.y}) scale(${state.mapT.k})`);
}

function valueAt(p, year) {
  const i = p.years.indexOf(year);
  return i === -1 ? null : p.values[i];
}

function drawSites() {
  const host = $("#mapSites");
  if (!host || !state.geo) return;
  host.innerHTML = "";
  const yr = state.mapYear, k = state.mapT.k, shrink = Math.pow(k, 0.75);
  const yrTxt = yr == null ? "any year" : yr;
  const vmax = Math.max(0.001, ...state.geo.features.map(f => valueAt(f.properties, yr)).filter(v => v != null));
  const unit = unitShort(state.geo.source.unit);
  const feats = [...state.geo.features].sort((a, b) => (valueAt(b.properties, yr) || 0) - (valueAt(a.properties, yr) || 0));
  const labels = [];   // drawn after every circle so no neighbouring site covers them
  for (const f of feats) {
    const p = f.properties, v = valueAt(p, yr);
    const cx = projX(f.geometry.coordinates[0]), cy = projY(f.geometry.coordinates[1]);
    const r = (v == null ? 4 : 4 + Math.sqrt(v / vmax) * 16) / shrink;
    const sel = state.mapSel === p.id;
    const site = add(host, "g", { class: "site" + (sel ? " sel" : ""), tabindex: 0, role: "button",
      "aria-pressed": String(sel),
      "aria-label": `${p.name}, ${p.country}: ${v == null ? "no observation" : `${fmtNum(v, 2)} ${unit}`} in ${yrTxt}. Select to see its evidence.` });
    if (v != null) {
      add(site, "circle", { cx, cy, r: r * 1.7, class: "halo" });
      add(site, "circle", { cx, cy, r, class: "core" });
    } else {
      add(site, "circle", { cx, cy, r, class: "nd" });
    }
    add(site, "circle", { cx, cy, r: r + 5 / shrink, class: "ring" });
    if (k >= 2 || sel) labels.push([{ x: cx + r + 4 / k, y: cy + 4 / k, class: "slab",
      style: `font-size:${11 / k}px;stroke-width:${3 / k}px` }, p.name]);
    hover(site, `<div class="tip-v">${esc(p.name)}</div><div class="tip-k">${esc(p.country)}</div>
      <div style="margin-top:4px">${v == null ? "no observation this year" : `<b>${fmtNum(v, 2)}</b> ${esc(unit)} observed in ${yrTxt}`}</div>`);
    const pick = () => selectField(p.id);
    site.addEventListener("click", e => { if (!mapDrag.moved) pick(); e.stopPropagation(); });
    site.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
  }
  const lg = add(host, "g", { "aria-hidden": "true", style: "pointer-events:none" });
  for (const [attrs, name] of labels) add(lg, "text", attrs, name);
  const legendEl = $("#mapLegend");
  if (legendEl) legendEl.innerHTML = `<span><span class="sw" style="background:var(--green)"></span>circle area ∝ observed flared volume, ${yrTxt}</span>
    <span><span class="sw" style="border:1px dashed var(--muted)"></span>no observation</span>`;
}

function selectField(id) {
  state.mapSel = id;
  drawSites();
  renderFieldPanel();
  $$("#fieldTable tr[data-id]").forEach(tr => tr.classList.toggle("sel", tr.dataset.id === id));
  if (window.innerWidth < 1200) $("#fieldPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

const mapDrag = { on: false, moved: false, x: 0, y: 0, id: null };

function zoomAt(fx, fy, factor) {
  const t = state.mapT, k2 = Math.min(10, Math.max(1, t.k * factor));
  t.x = fx - (fx - t.x) * (k2 / t.k);
  t.y = fy - (fy - t.y) * (k2 / t.k);
  t.k = k2;
  if (k2 === 1) { t.x = 0; t.y = 0; }
  applyMapTransform();
  drawSites();
}

function bindMapControls() {
  const svg = $("#mapSvg");
  const unit = () => MAP_W / svg.clientWidth;
  $("#zoomIn").addEventListener("click", () => zoomAt(MAP_W / 2, MAP_H / 2, 1.6));
  $("#zoomOut").addEventListener("click", () => zoomAt(MAP_W / 2, MAP_H / 2, 1 / 1.6));
  $("#zoomRst").addEventListener("click", () => { state.mapT = { k: 1, x: 0, y: 0 }; applyMapTransform(); drawSites(); });
  svg.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    Object.assign(mapDrag, { on: true, moved: false, x: e.clientX, y: e.clientY, id: e.pointerId });
  });
  svg.addEventListener("pointermove", e => {
    if (!mapDrag.on || e.pointerId !== mapDrag.id) return;
    const dx = e.clientX - mapDrag.x, dy = e.clientY - mapDrag.y;
    if (!mapDrag.moved && Math.hypot(dx, dy) < 4) return;
    if (!mapDrag.moved) { mapDrag.moved = true; svg.setPointerCapture(e.pointerId); svg.classList.add("drag"); }
    state.mapT.x += dx * unit(); state.mapT.y += dy * unit();
    mapDrag.x = e.clientX; mapDrag.y = e.clientY;
    applyMapTransform();
  });
  const end = () => { mapDrag.on = false; svg.classList.remove("drag"); setTimeout(() => { mapDrag.moved = false; }, 0); };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("wheel", e => {
    if (!e.ctrlKey && !e.metaKey) return;          // plain scrolling keeps scrolling the page
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomAt((e.clientX - r.left) * unit(), (e.clientY - r.top) * unit(), e.deltaY < 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });

  const play = $("#mapPlay");
  play.addEventListener("click", () => {
    if (state.playTimer) { stopPlay(); return; }
    const sl = $("#mapSlider");
    if (+sl.value >= +sl.max) sl.value = sl.min;
    play.textContent = "❚❚ Pause"; play.setAttribute("aria-pressed", "true");
    state.playTimer = setInterval(() => {
      if (+sl.value >= +sl.max) { stopPlay(); return; }
      sl.value = +sl.value + 1;
      sl.dispatchEvent(new Event("input"));
    }, 750);
  });
}

function stopPlay() {
  clearInterval(state.playTimer); state.playTimer = null;
  const play = $("#mapPlay");
  if (play) { play.textContent = "▶ Play years"; play.setAttribute("aria-pressed", "false"); }
}

function fieldEvidence(p) {
  const mc = state.methaneCov, mrow = mc && mc.coverage ? mc.coverage[p.id] : null;
  const items = [];
  items.push(p.years.length
    ? ["pass", "Field observations (VIIRS)", `${p.years.length} annual values, ${p.years[0]}–${p.years[p.years.length - 1]} — primary evidence.`]
    : ["fail", "Field observations (VIIRS)", "No series loaded for this field."]);
  items.push(p.has_country_series
    ? ["warn", "National series (same instrument)", `${esc(p.country_series_key)} totals — same instrument, not independent.`]
    : ["fail", "National series", "No national series resolves for this field's country."]);
  if (!mc || !mc.available) items.push(["fail", "Independent instrument (Sentinel-5P)", "Methane series not loaded in this deployment."]);
  else if (!mrow) items.push(["fail", "Independent instrument (Sentinel-5P)", "No retrievals for this field."]);
  else items.push(mrow.usable
    ? ["pass", "Independent instrument (Sentinel-5P)", `Usable: ${pct1(mrow.completeness)} of possible months retrieved (${mrow.years[0]}–${mrow.years[mrow.years.length - 1]}).`]
    : ["fail", "Independent instrument (Sentinel-5P)", `Too sparse: ${pct1(mrow.completeness)} of months — below the ${pct1(mc.min_completeness_required)} threshold, so it is refused rather than interpolated.`]);
  items.push(["fail", "Operator attribution", "Never available: the instruments observe a location, not a company."]);
  return { items, methaneUsable: !!(mrow && mrow.usable) };
}

function renderFieldPanel() {
  const el = $("#fieldPanel");
  if (!el || !state.geo) return;
  const f = state.geo.features.find(x => x.properties.id === state.mapSel);
  if (!f) {
    el.innerHTML = `<span class="kicker">Field evidence</span><h2 class="panel-title-sm">Select a field</h2>
      <p class="prose" style="margin-top:6px">Choose a marker on the map to see its observed trend, which evidence exists for it,
        and any claims checked for it in this session.</p>
      <ul class="avail">${state.geo.features.slice().sort((a, b) => (b.properties.latest_value || 0) - (a.properties.latest_value || 0)).slice(0, 5).map(x =>
        `<li><span></span><div><button class="row-btn" type="button" data-pick="${esc(x.properties.id)}">${esc(x.properties.name)}</button>
          <span class="muted">${x.properties.latest_value != null ? `${fmtNum(x.properties.latest_value, 2)} bcm/yr in ${x.properties.latest_year}` : "no observation"}</span></div></li>`).join("")}</ul>
      <p class="hint">Largest flared volumes in the latest year.</p>`;
    $$("[data-pick]", el).forEach(b => b.addEventListener("click", () => selectField(b.dataset.pick)));
    return;
  }
  const p = f.properties, yr = state.mapYear, v = valueAt(p, yr), unit = unitShort(p.unit);
  const ev = fieldEvidence(p), hist = state.history.filter(h => h.fieldId === p.id);
  const first = p.first_value, last = p.latest_value;
  el.innerHTML = `
    <span class="kicker">Selected field</span>
    <h2 class="fp-name">${esc(p.name)}</h2>
    <p class="fp-sub">${esc(p.country)} · flares grouped within ${p.match_radius_km} km</p>
    <div style="margin-top:14px">${sparkline(p.years, p.values, { w: 320, h: 56 })}</div>
    <div class="fp-nums">
      <div><span class="k">${p.first_year ?? "—"}</span><span class="v">${fmtNum(first, 2)}</span><span class="s">first</span></div>
      <div><span class="k">${p.latest_year ?? "—"}</span><span class="v">${fmtNum(last, 2)}</span><span class="s">latest</span></div>
      ${yr != null && yr !== p.latest_year ? `<div><span class="k">${yr}</span><span class="v">${v == null ? "—" : fmtNum(v, 2)}</span><span class="s">selected year</span></div>` : ""}
    </div>
    <p class="hint">Observed flared volume, ${esc(unit)} (VIIRS).${first && last ? ` First-to-latest ${fmtPct((last - first) / first)} — arithmetic on two real values, not a verdict.` : ""}</p>

    <div class="section-label" style="margin-top:16px">What evidence exists here</div>
    <ul class="avail">${ev.items.map(([st, l, d]) => `<li>${stIcon(st)}<div><b>${esc(l)}</b>${d}</div></li>`).join("")}</ul>

    <div class="section-label" style="margin-top:16px">Checked in this session</div>
    ${hist.length ? hist.slice(0, 2).map(h => h.claims.map(c => `<div style="padding:8px 0;border-top:1px solid var(--line-soft)">
        ${vbadge(c)}<div class="small" style="margin-top:4px">“${esc(c.text)}”</div>
        ${c.uncertainty ? `<div class="hint" style="margin-top:2px">${esc(c.uncertainty)}${c.level ? ` · ${esc(LEVEL_LABEL[c.level] || c.level)}` : ""}</div>` : ""}</div>`).join("")).join("")
      : `<p class="prose" style="margin:0">No claim checked for this field yet.</p>`}
    <div class="row" style="margin-top:14px">
      <button class="btn btn-primary btn-sm" type="button" data-check-field="${esc(p.name)}">Check a claim for ${esc(p.name)}</button>
    </div>`;
  $("[data-check-field]", el).addEventListener("click", () => {
    $("#fieldSel").value = p.name;
    show("workspace");
    $("#reportBox").focus();
  });
}

function renderFieldTable() {
  const el = $("#fieldTable");
  const mc = state.methaneCov;
  el.innerHTML = `<table class="table table-condensed">
    <thead><tr><th>Field</th><th>Country</th><th class="num-c">Latest</th><th>Observed series</th><th>National series</th><th>Sentinel-5P</th></tr></thead>
    <tbody>${state.geo.features.map(f => {
      const p = f.properties, m = mc && mc.coverage ? mc.coverage[p.id] : null;
      return `<tr data-id="${esc(p.id)}" class="${state.mapSel === p.id ? "sel" : ""}">
        <td><button class="row-btn" type="button" data-id="${esc(p.id)}">${esc(p.name)}</button></td>
        <td>${esc(p.country)}</td>
        <td class="num-c nowrap">${p.latest_value != null ? `${fmtNum(p.latest_value, 2)} <span class="muted xs">(${p.latest_year})</span>` : "—"}</td>
        <td>${sparkline(p.years, p.values)}</td>
        <td>${p.has_country_series ? `✓ <span class="small">${esc(p.country_series_key)}</span>` : "✕ none"}</td>
        <td class="nowrap">${!m ? "✕ not loaded" : m.usable ? `✓ usable <span class="muted xs">(${pct1(m.completeness)})</span>` : `✕ too sparse <span class="muted xs">(${pct1(m.completeness)})</span>`}</td>
      </tr>`;
    }).join("")}</tbody></table>`;
  $$("button[data-id]", el).forEach(b => b.addEventListener("click", () => {
    selectField(b.dataset.id);
    $("#mapFrame").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }));
}
