"use strict";
/* GreenTruth — 3D Earth Field Map Controller.
   Real coordinates (data/facilities_international.json) and real
   annual values (/api/map); Natural Earth 110m basemap geometry.
   Zero interpolation: fields without observations are rendered as hollow pings.

   Operates purely through the 3D Globe with orbiting satellites (VIIRS-N20 & Sentinel-5P).
   Clicking any field focuses the 3D Earth directly onto its real coordinates.
*/

function valueAt(p, year) {
  const i = p.years.indexOf(year);
  return i === -1 ? null : p.values[i];
}

const mapMode = () => "globe";

async function ensureMap() {
  try { localStorage.removeItem("gt-map-mode"); } catch { /* ignore */ }

  const cv = $("#globeCanvas");
  if (cv) cv.hidden = false;

  if (state.geo) {
    if (state.globe3d) {
      state.globe3d.resize();
      state.globe3d.start();
      state.globe3d.draw();
    } else if (cv && window.Globe3D && state.world) {
      state.globe3d = new Globe3D(cv, { onSelectSite: f => selectField(f.properties.id) });
      state.globe3d.prepare(state.world);
      state.globe3d.start();
      state.globe3d.draw();
    }
    requestAnimationFrame(() => {
      if (state.globe3d) {
        state.globe3d.resize();
        state.globe3d.draw();
      }
    });
    renderFieldPanel();
    return;
  }

  try {
    const [geo, world] = await Promise.all([getJSON("/api/map"), getJSON("/api/basemap")]);
    if (!state.methaneCov) {
      try { state.methaneCov = await getJSON("/api/methane/coverage"); } catch { /* shown as unavailable */ }
    }
    state.geo = geo; state.world = world;

    const years = geo.features.flatMap(f => f.properties.years);
    const sl = $("#mapSlider");
    if (years.length) {
      const lo = Math.min(...years), hi = Math.max(...years);
      sl.min = lo; sl.max = hi; sl.value = hi; state.mapYear = hi;
      $("#mapYear").textContent = hi;
    } else {
      sl.disabled = true; $("#mapPlay").disabled = true;
      $("#mapYear").textContent = "—";
      $("#mapFrame").insertAdjacentHTML("beforebegin", stateCard({ compact: true, tone: "bad", sym: "!",
        title: "Real evidence is currently unavailable", what: "The fields are shown at their real coordinates, but no flaring series is loaded.",
        why: "The real-data files have not been produced in this copy; nothing is substituted.",
        next: "Run the real-data pipeline to restore this evidence source, then restart the server.",
        extra: techDetails("Missing file: <code>data/real/flaring_by_field.csv</code> (notebook 03).") }) + `<div style="height:16px"></div>`);
    }

    sl.addEventListener("input", () => {
      state.mapYear = +sl.value;
      $("#mapYear").textContent = sl.value;
      if (state.globe3d) state.globe3d.draw();
      renderLegend();
      renderFieldPanel();
    });

    $("#mapSrc").innerHTML = `Flaring: ${link(geo.source.url, geo.source.dataset)} — ${esc(geo.source.measurement)}, ${esc(geo.source.unit)}.
      Basemap: ${esc(world.attribution)} ${link(world.source_url, "source")}.`;

    if ($("#globeCanvas") && window.Globe3D) {
      state.globe3d = new Globe3D($("#globeCanvas"), { onSelectSite: f => selectField(f.properties.id) });
      state.globe3d.prepare(world);
      state.globe3d.start();
      state.globe3d.draw();
      requestAnimationFrame(() => {
        if (state.globe3d) {
          state.globe3d.resize();
          state.globe3d.draw();
        }
      });
    }

    bindMapControls();
    renderHowTo();
    renderLegend();
    renderFieldTable();
    renderFieldPanel();
  } catch (e) {
    console.warn("Map data load notice:", e);
    const notice = stateCard({ tone: "bad", sym: "!", title: "Map data connection notice",
      what: esc(e.message), why: "The server did not return the field GeoJSON or the basemap.",
      next: "The field table below still lists what is known. Reload once the server is running." });
    const existing = $("#mapFrame .state-card");
    if (!existing) $("#mapFrame").insertAdjacentHTML("afterbegin", notice);
    $("#fieldPanel").innerHTML = "";
  }
}

function renderHowTo() {
  const el = $("#mapHow");
  if (!el) return;
  el.textContent = "Drag to spin the 3D Earth, scroll or use +/− to zoom, and click any flaring field to inspect its satellite ground truth.";
}

function renderLegend() {
  const el = $("#mapLegend");
  if (!el) return;
  const yrTxt = state.mapYear == null ? "any year" : state.mapYear;
  el.innerHTML = `<span><span class="sw" style="background:var(--green)"></span>circle area ∝ observed flared volume, ${yrTxt}</span>
    <span><span class="sw" style="border:1px dashed var(--muted)"></span>no observation</span>`;
}

function selectField(id) {
  state.mapSel = id;
  renderFieldPanel();
  $$("#fieldTable tr[data-id]").forEach(tr => tr.classList.toggle("sel", tr.dataset.id === id));

  // Turn the 3D Earth until the selected field faces the reader
  if (state.globe3d && state.geo) {
    const f = state.geo.features.find(x => x.properties.id === id);
    if (f) state.globe3d.focusOnCoordinate(f.geometry.coordinates[0], f.geometry.coordinates[1]);
  }
  if (window.innerWidth < 1200) $("#fieldPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function bindMapControls() {
  $("#zoomIn").addEventListener("click", () => {
    if (state.globe3d) state.globe3d.zoomBy(1.25);
  });
  $("#zoomOut").addEventListener("click", () => {
    if (state.globe3d) state.globe3d.zoomBy(1 / 1.25);
  });
  $("#zoomRst").addEventListener("click", () => {
    if (state.globe3d) state.globe3d.reset();
  });

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
    }, 850);
  });
}

function stopPlay() {
  clearInterval(state.playTimer); state.playTimer = null;
  const play = $("#mapPlay");
  if (play) { play.textContent = "▶ Play years"; play.setAttribute("aria-pressed", "false"); }
}

/* ---------------------------------------------------------- field panel */

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
      <p class="prose" style="margin-top:6px">Pick a field on the 3D Globe to see its observed trend, which evidence exists for it,
        and any claims checked for it in this session.</p>
      <ul class="avail field-list">${state.geo.features.slice().sort((a, b) => (b.properties.latest_value || 0) - (a.properties.latest_value || 0)).slice(0, 5).map(x =>
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
  if (!el || !state.geo) return;
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
        <td>${p.has_country_series ? `${stIcon("pass")} <span class="small">${esc(p.country_series_key)}</span>` : `${stIcon("fail")} none`}</td>
        <td class="nowrap">${!m ? `${stIcon("fail")} not loaded` : m.usable ? `${stIcon("pass")} usable <span class="muted xs">(${pct1(m.completeness)})</span>` : `${stIcon("fail")} too sparse <span class="muted xs">(${pct1(m.completeness)})</span>`}</td>
      </tr>`;
    }).join("")}</tbody></table>`;
  $$("[data-id]", el).forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.id;
    selectField(id);
    $("#mapFrame").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }));
}
