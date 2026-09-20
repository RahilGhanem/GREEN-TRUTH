"use strict";
/* GreenTruth interface — shared helpers.

   No framework, no CDN, no build step: every dependency is a way for a live demo
   to fail, and none of this needs one. Scripts load in order (util, charts,
   components, views, pages, globe3d, map, app, reactive3d) and share these globals.

   House rules mirrored from the backend:
     * every number shown comes from an API response — nothing is invented;
     * a value is drawn in the style of its provenance (observed / projected /
       required / target / claimed never share a style);
     * there is no "confidence" anywhere; intervals are named for what they are. */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NS = "http://www.w3.org/2000/svg";
const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  meta: null, research: null, methaneCov: null, cases: null,
  result: null, selected: null, chainSel: null,
  history: [],
  view: null,
  fields: [], geo: null, world: null, mapYear: null, mapSel: null,
  mapT: { k: 1, x: 0, y: 0 }, playTimer: null,
  demo: { active: null, result: null, ms: null, running: false },
};

/* ------------------------------------------------------------ formatting */

const fmtPct = (v, d = 0) => (v == null || !isFinite(v) ? "—"
  : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%`);
const fmtPP = v => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(0)} pp`);
const fmtNum = (v, d = 2) => (v == null || !isFinite(v) ? "—" : Number(v).toFixed(d));
const fmtSigned = (v, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`);
const pct1 = v => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const unitShort = u => (u && /billion m3/.test(u) ? "bcm/yr" : (u || ""));

/* ------------------------------------------------------------ vector icons */

const ICONS = {
  pass: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  fail: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
  warn: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  info: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
  question: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  partial: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor"></path></svg>`,
  none: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>`,
  minus: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
  down_right: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="7" x2="17" y2="17"></line><polyline points="17 10 17 17 10 17"></polyline></svg>`,
  up_right: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="10 7 17 7 17 14"></polyline></svg>`,
  approx: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9c2-2 4-2 6 0s4 2 6 0"></path><path d="M5 15c2-2 4-2 6 0s4 2 6 0"></path></svg>`,
  conflict: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 8 16 13"></polyline><line x1="4" y1="8" x2="21" y2="8"></line><polyline points="8 21 3 16 8 11"></polyline><line x1="20" y1="16" x2="3" y2="16"></line></svg>`,
  up_down: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="3" x2="8" y2="21"></line><polyline points="4 7 8 3 12 7"></polyline><line x1="16" y1="21" x2="16" y2="3"></line><polyline points="20 17 16 21 12 17"></polyline></svg>`,
  moon: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,
  sun: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
  alert: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
  bolt: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
  dot: `<svg class="svg-icon" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"></circle></svg>`,
  ring: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="6"></circle></svg>`,
};

/* ------------------------------------------------------------ verdicts */

const VERDICT_STYLE = {
  supported:               { tone: "ok",       sym: ICONS.pass },
  partially_supported:     { tone: "partial",  sym: ICONS.partial },
  contradicted:            { tone: "bad",      sym: ICONS.fail },
  insufficient_evidence:   { tone: "none",     sym: ICONS.minus },
  no_signal:               { tone: "none",     sym: ICONS.none },
  abstain:                 { tone: "abstain",  sym: ICONS.question },
  needs_clarification:     { tone: "none",     sym: ICONS.question },
  trajectory_consistent:   { tone: "ok",       sym: ICONS.down_right },
  trajectory_uncertain:    { tone: "abstain",  sym: ICONS.approx },
  trajectory_inconsistent: { tone: "traj-bad", sym: ICONS.conflict },
};

const vstyle = v => VERDICT_STYLE[v] || { tone: "none", sym: ICONS.info };
const shortLabel = label => String(label || "").split(" / ")[0];

function vbadge(c) {
  const s = vstyle(c.verdict);
  return `<span class="vbadge tone-${s.tone}"><span class="sym" aria-hidden="true">${s.sym}</span>${esc(c.verdict_label)}</span>`;
}

const LEVEL_LABEL = {
  SUFFICIENT: "Sufficient",
  PARTIALLY_SUFFICIENT: "Partially sufficient",
  INSUFFICIENT: "Insufficient",
};

/* ------------------------------------------------------------ network */

function resolveApiUrl(url) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (typeof window !== "undefined" && (window.location.protocol === "file:" || (window.location.port && window.location.port !== "8000"))) {
    return `http://localhost:8000${url}`;
  }
  return url;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { ...options, signal: controller ? controller.signal : undefined });
    if (timer) clearTimeout(timer);
    return res;
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (url.includes("localhost:8000")) {
      const altUrl = url.replace("localhost:8000", "127.0.0.1:8000");
      try {
        return await fetch(altUrl, { ...options });
      } catch {}
    }
    throw err;
  }
}

async function getJSON(url) {
  const target = resolveApiUrl(url);
  const r = await fetchWithTimeout(target, { headers: { Accept: "application/json" } }, 3500);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

async function postJSON(url, body) {
  const target = resolveApiUrl(url);
  const r = await fetchWithTimeout(target, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 12000);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

/* ------------------------------------------------------------ small UI */

function announce(msg) {
  const a = $("#announcer");
  if (!a) return;
  a.textContent = "";
  setTimeout(() => { a.textContent = msg; }, 30);
}

function hover(el, html) {
  const tip = $("#tip");
  if (!tip) return;
  const place = e => {
    const x = Math.min(e.clientX + 14, window.innerWidth - 270);
    tip.style.left = x + "px";
    tip.style.top = (e.clientY - 12) + "px";
  };
  el.addEventListener("mouseenter", e => { tip.innerHTML = html; tip.classList.add("on"); place(e); });
  el.addEventListener("mousemove", place);
  el.addEventListener("mouseleave", () => tip.classList.remove("on"));
  el.addEventListener("focus", () => {
    const r = el.getBoundingClientRect();
    tip.innerHTML = html; tip.classList.add("on");
    tip.style.left = Math.min(r.right + 8, window.innerWidth - 270) + "px";
    tip.style.top = r.top + "px";
  });
  el.addEventListener("blur", () => tip.classList.remove("on"));
}

/* A state card: WHAT happened · WHY · WHAT CAN STILL BE DONE. */
function stateCard({ tone = "none", sym = ICONS.info, title, what, why, next, actions = "", compact = false, extra = "" }) {
  let iconSvg = sym;
  if (sym === "!" || sym === "warn") iconSvg = ICONS.alert;
  else if (sym === "?" || sym === "none") iconSvg = ICONS.question;
  else if (sym === "i" || sym === "info") iconSvg = ICONS.info;
  else if (sym === "∅") iconSvg = ICONS.none;
  else if (sym === "–" || sym === "~") iconSvg = ICONS.minus;

  return `<div class="state tone-${tone}${compact ? " compact" : ""}" role="status">
    <div class="state-ico" aria-hidden="true">${iconSvg}</div>
    <div>
      <h3>${esc(title)}</h3>
      <dl>
        ${what ? `<dt>What happened</dt><dd>${what}</dd>` : ""}
        ${why ? `<dt>Why</dt><dd>${why}</dd>` : ""}
        ${next ? `<dt>What you can do</dt><dd>${next}</dd>` : ""}
      </dl>
      ${extra}
      ${actions ? `<div class="row">${actions}</div>` : ""}
    </div>
  </div>`;
}

function techDetails(html, label = "Technical details") {
  return html ? `<details class="more"><summary>${esc(label)}</summary><div class="more-body">${html}</div></details>` : "";
}

const SLOT_NAMES = {
  metric: "metric", claimed_change_percent: "claimed change", baseline_year: "baseline year",
  comparison_year: "outcome year", commitment_year: "target year", target_value: "target value",
  claimed_value: "claimed value", unit: "unit",
};
const humanSlots = arr => (arr || []).map(s => SLOT_NAMES[s] || s.replace(/_/g, " ")).join(", ");

const drawers = new Map();
const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(entries => {
  for (const e of entries) {
    const d = drawers.get(e.target);
    if (!d) continue;
    const w = Math.round(e.contentRect.width);
    if (w > 40 && Math.abs(w - d.w) >= 4) {
      d.w = w;
      requestAnimationFrame(() => {
        if (drawers.has(e.target)) d.fn(e.target);
      });
    }
  }
}) : null;

function mountChart(host, fn) {
  if (!host) return;
  const prev = drawers.get(host);
  if (prev && ro) ro.unobserve(host);
  const w = Math.max(260, Math.round(host.clientWidth || (host.parentElement && host.parentElement.clientWidth) || 600));
  drawers.set(host, { fn, w });
  try { fn(host); } catch (err) { console.warn("Chart render error:", err); }
  if (ro) ro.observe(host);
  requestAnimationFrame(() => {
    if (!host.firstChild || (host.clientWidth && Math.abs(host.clientWidth - w) > 10)) {
      drawers.set(host, { fn, w: host.clientWidth || w });
      try { fn(host); } catch {}
    }
  });
}

function unmountCharts(root) {
  if (!root) return;
  for (const host of [...drawers.keys()]) {
    if (root === host || root.contains(host)) {
      if (ro) ro.unobserve(host);
      drawers.delete(host);
    }
  }
}
