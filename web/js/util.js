"use strict";
/* GreenTruth interface — shared helpers.

   No framework, no CDN, no build step: every dependency is a way for a live demo
   to fail, and none of this needs one. Scripts load in order (util, charts,
   components, views, map, app) and share these globals.

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
  history: [],                // {fieldId, fieldName, claims:[{text, verdict, verdict_label}]}
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

/* ------------------------------------------------------------ verdicts */

// Tone and symbol per verdict. Colour is never the only carrier: every badge
// also has a symbol and the backend's own label.
const VERDICT_STYLE = {
  supported:               { tone: "ok",       sym: "✓" },
  partially_supported:     { tone: "partial",  sym: "◐" },
  contradicted:            { tone: "bad",      sym: "✕" },
  insufficient_evidence:   { tone: "none",     sym: "–" },
  no_signal:               { tone: "none",     sym: "∅" },
  abstain:                 { tone: "abstain",  sym: "?" },
  needs_clarification:     { tone: "none",     sym: "?" },
  trajectory_consistent:   { tone: "ok",       sym: "↘" },
  trajectory_uncertain:    { tone: "abstain",  sym: "~" },
  trajectory_inconsistent: { tone: "traj-bad", sym: "↛" },
};
const vstyle = v => VERDICT_STYLE[v] || { tone: "none", sym: "·" };
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

async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}
async function postJSON(url, body) {
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

/* A state card: WHAT happened · WHY · WHAT CAN STILL BE DONE. Used for every
   empty, limitation and failure state, so none of them fails silently. */
function stateCard({ tone = "none", sym = "i", title, what, why, next, actions = "", compact = false, extra = "" }) {
  return `<div class="state tone-${tone}${compact ? " compact" : ""}" role="status">
    <div class="state-ico" aria-hidden="true">${sym}</div>
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

/* Internal detail (dependency errors, file paths, raw payloads) is kept one
   click away rather than in the reader's path. Scientific limitations are never
   put behind this — only implementation detail. */
function techDetails(html, label = "Technical details") {
  return html ? `<details class="more"><summary>${esc(label)}</summary><div class="more-body">${html}</div></details>` : "";
}

// Readable names for the structured-claim slots.
const SLOT_NAMES = {
  metric: "metric", claimed_change_percent: "claimed change", baseline_year: "baseline year",
  comparison_year: "outcome year", commitment_year: "target year", target_value: "target value",
  claimed_value: "claimed value", unit: "unit",
};
const humanSlots = arr => (arr || []).map(s => SLOT_NAMES[s] || s.replace(/_/g, " ")).join(", ");

/* Charts are drawn at their real pixel width so text stays legible on a phone;
   they are re-drawn when their container changes size. */
const drawers = new Map();
const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(entries => {
  for (const e of entries) {
    const d = drawers.get(e.target);
    if (!d) continue;
    const w = Math.round(e.contentRect.width);
    if (w && w !== d.w) { d.w = w; requestAnimationFrame(() => d.fn(e.target)); }
  }
}) : null;

function mountChart(host, fn) {
  if (!host) return;
  const prev = drawers.get(host);
  if (prev && ro) ro.unobserve(host);
  drawers.set(host, { fn, w: host.clientWidth });
  fn(host);
  if (ro) ro.observe(host);
}
function unmountCharts(root) {
  for (const host of [...drawers.keys()]) {
    if (!root || root.contains(host)) {
      if (ro) ro.unobserve(host);
      drawers.delete(host);
    }
  }
}
