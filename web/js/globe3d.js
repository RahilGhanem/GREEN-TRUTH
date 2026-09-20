"use strict";
/* GreenTruth — 3D Earth Globe & Orbital Telemetry Engine.
   Pure vanilla HTML5 Canvas & modern ES6. Zero dependencies, zero build step.

   Orthographic projection of the real Natural Earth outlines and the 12
   monitored fields at their real coordinates. Nothing is interpolated: a field
   with no value in the selected year is drawn hollow and labelled "no
   observation", never as zero.

   Visual Systems:
     1. Multi-Layer Atmospheric Corona (Rayleigh scattering, ozone limb glow, twilight rim).
     2. Deep Space Cosmos & Cosmic Dust (Twinkling multi-magnitude stars, nebula gradients).
     3. Photorealistic Ocean Abyss with Dynamic Solar Specular Glint.
     4. Natural Earth 110m Topographical Continents with Illuminated Coastal Shelves.
     5. Day/Night Terminator with Night Hemisphere City & Thermal Flare Radiance.
     6. 3D Holographic Data Pillars & Multi-Ring Sonar Beacons for the 12 Monitored Basins.
     7. Dual 3D Orbiting Satellites (VIIRS-N20 & Sentinel-5P) with Ground Scan Footprints.
     8. True North Orbital Compass & Cybernetic Aerospace Mission HUD.
*/

const GLOBE_MAX_ZOOM = 2.6;
const GLOBE_MIN_ZOOM = 0.7;

class Globe3D {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.options = options;

    this.yaw = -0.6;                 // radians; view centre longitude
    this.pitch = 0.35;               // radians; view centre latitude
    this.zoom = 1;
    this.spin = 0.0014;              // gentle idle rotation until user takes over
    this.drag = { on: false, moved: false, x: 0, y: 0, id: null };
    this.velocity = 0;
    this.time = 0;
    this.running = false;
    this.raf = null;
    this.sites = [];                 // projected, for hit testing
    this.hover = null;
    this.focus = null;               // active fly-to target { yaw, pitch }
    this.land = null;                // prepared geometry rings
    this.stars = null;               // background starfield
    this.shootingStars = [];         // occasional meteors
    this.onScreen = true;

    this.reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (this.reduce && this.reduce.addEventListener) {
      this.reduce.addEventListener("change", () => { if (this.reduce.matches) this.spin = 0; });
    }
    if (this.reduce && this.reduce.matches) this.spin = 0;

    this.resize();
    this.bind();
  }

  /* ------------------------------------------------------------- geometry */

  // Longitude/latitude (degrees) -> 3D unit vector
  static vec(lonDeg, latDeg) {
    const lon = lonDeg * Math.PI / 180, lat = latDeg * Math.PI / 180;
    const c = Math.cos(lat);
    return [c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon)];
  }

  prepare(world) {
    const rings = [];
    for (const f of (world && world.features) || []) {
      const g = f.geometry;
      if (!g) continue;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          const a = new Float32Array(ring.length * 3);
          for (let i = 0; i < ring.length; i++) {
            const v = Globe3D.vec(ring[i][0], ring[i][1]);
            a[i * 3] = v[0]; a[i * 3 + 1] = v[1]; a[i * 3 + 2] = v[2];
          }
          rings.push(a);
        }
      }
    }
    this.land = rings;
  }

  // Rotate a 3D vector into view space: yaw about Y-axis, then pitch about X-axis
  rot(x, y, z) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  }

  project(lonDeg, latDeg) {
    const v = Globe3D.vec(lonDeg, latDeg);
    const [x, y, z] = this.rot(v[0], v[1], v[2]);
    const r = this.r();
    return { x: this.width / 2 + x * r, y: this.height / 2 - y * r, z, visible: z > 0 };
  }

  r() { return this.radius * this.zoom; }

  /* -------------------------------------------------- sizing & events */

  resize() {
    const box = this.canvas.parentElement;
    if (!box) return;
    const cw = this.canvas.clientWidth || box.clientWidth || 800;
    const ch = this.canvas.clientHeight || box.clientHeight || 540;
    let w = Math.round(cw);
    let h = Math.round(ch);
    if (w <= 0) w = 800;
    if (h <= 0) h = 540;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.height = h + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const minDim = Math.min(w, h);
    this.radius = minDim * (w < 600 ? 0.40 : 0.44);

    this.initCosmos(w, h);
    this.onScreen = true;
  }

  initCosmos(w, h) {
    this.stars = [];
    const count = Math.round((w * h) / 7500);
    for (let i = 0; i < count; i++) {
      const type = Math.random();
      this.stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: type > 0.92 ? 1.8 : (type > 0.7 ? 1.2 : 0.7),
        color: type > 0.85 ? "#7dd3fc" : (type > 0.7 ? "#fef08a" : "#ffffff"),
        alpha: Math.random() * 0.65 + 0.25,
        twinkleSpeed: Math.random() * 0.05 + 0.015,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  bind() {
    const c = this.canvas;
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(() => { this.resize(); this.draw(); });
      this.ro.observe(c.parentElement);
    } else {
      window.addEventListener("resize", () => { this.resize(); this.draw(); }, { passive: true });
    }
    this.onScreen = true;
    if (window.IntersectionObserver) {
      this.io = new IntersectionObserver(es => {
        const any = es.some(e => e.isIntersecting);
        this.onScreen = any;
        if (any && this.running) this.draw();
      }, { threshold: 0 });
      this.io.observe(c);
    }

    c.addEventListener("pointerdown", e => {
      this.drag = { on: true, moved: false, x: e.clientX, y: e.clientY, id: e.pointerId };
      this.spin = 0;
      this.velocity = 0;
      this.focus = null;
      c.setPointerCapture(e.pointerId);
    });

    c.addEventListener("pointermove", e => {
      if (!this.drag.on) { this.hoverAt(e.clientX, e.clientY); return; }
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
      this.drag.moved = true;
      const k = 0.005 / Math.max(0.7, this.zoom);
      this.yaw += dx * k;
      this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch + dy * k));
      this.velocity = dx * k;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.setTip(null);
    });

    const end = e => {
      if (!this.drag.on) return;
      const wasDrag = this.drag.moved;
      this.drag.on = false;
      try { c.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (!wasDrag) this.clickAt(e.clientX, e.clientY);
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", () => { this.drag.on = false; });
    c.addEventListener("pointerleave", () => { this.hover = null; this.setTip(null); });

    c.addEventListener("wheel", e => {
      e.preventDefault();
      this.zoomBy(e.deltaY > 0 ? 0.9 : 1.1);
    }, { passive: false });

    // Double-click to focus and zoom in on any point
    c.addEventListener("dblclick", e => {
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const hit = this.sites.find(s => Math.hypot(mx - s.x, my - s.y) < s.hit);
      if (hit && hit.feature) {
        const [lon, lat] = hit.feature.geometry.coordinates;
        this.focusOnCoordinate(lon, lat);
        this.zoom = Math.min(GLOBE_MAX_ZOOM, Math.max(1.35, this.zoom * 1.3));
        if (this.options.onSelectSite) this.options.onSelectSite(hit.feature);
      } else {
        this.zoomBy(1.25);
      }
    });

    // Keyboard navigation (operable without mouse)
    c.addEventListener("keydown", e => {
      const step = 0.12;
      const keys = {
        ArrowLeft: () => this.yaw -= step, ArrowRight: () => this.yaw += step,
        ArrowUp: () => this.pitch = Math.min(1.25, this.pitch + step),
        ArrowDown: () => this.pitch = Math.max(-1.25, this.pitch - step),
        "+": () => this.zoomBy(1.15), "=": () => this.zoomBy(1.15), "-": () => this.zoomBy(1 / 1.15),
        Home: () => this.reset(),
      };
      if (!keys[e.key]) return;
      e.preventDefault();
      this.spin = 0;
      keys[e.key]();
      this.draw();
    });
  }

  zoomBy(f) {
    this.zoom = Math.max(GLOBE_MIN_ZOOM, Math.min(GLOBE_MAX_ZOOM, this.zoom * f));
    this.draw();
  }

  reset() {
    this.zoom = 1; this.yaw = -0.6; this.pitch = 0.35; this.velocity = 0; this.focus = null;
    this.spin = this.reduce && this.reduce.matches ? 0 : 0.0014;
    this.draw();
  }

  // Turn the globe smoothly until the given coordinate faces the user
  focusOnCoordinate(lonDeg, latDeg) {
    const target = { yaw: -lonDeg * Math.PI / 180, pitch: Math.max(-1.25, Math.min(1.25, latDeg * Math.PI / 180)) };
    while (target.yaw - this.yaw > Math.PI) target.yaw -= 2 * Math.PI;
    while (target.yaw - this.yaw < -Math.PI) target.yaw += 2 * Math.PI;
    this.spin = 0;
    this.velocity = 0;
    if (this.reduce && this.reduce.matches) { this.yaw = target.yaw; this.pitch = target.pitch; this.draw(); return; }
    this.focus = target;
  }

  hoverAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    const hit = this.sites.find(s => Math.hypot(mx - s.x, my - s.y) < s.hit);
    this.canvas.style.cursor = hit ? "pointer" : "grab";
    if ((hit && hit.id) !== (this.hover && this.hover.id)) {
      this.hover = hit || null;
      this.draw();
    }
    this.setTip(hit ? { clientX, clientY, site: hit } : null);
  }

  setTip(info) {
    const tip = document.getElementById("tip");
    if (!tip) return;
    if (!info) { tip.classList.remove("on"); return; }
    const s = info.site, yr = state.mapYear;
    tip.innerHTML = `
      <div class="tip-v" style="color:var(--text);font-size:14px;font-weight:800;letter-spacing:-0.01em">${esc(s.name)}</div>
      <div class="tip-k" style="color:var(--cyan);font-weight:700;margin-top:1px">${esc(s.country)}</div>
      <div style="margin-top:6px;font-size:12.5px;color:var(--text-2)">
        ${s.value == null ? `No observation in ${yr}` : `<b style="color:var(--green);font-size:13.5px">${fmtNum(s.value, 2)}</b> bcm/yr observed in ${yr}`}
      </div>
      <div style="margin-top:5px;font-size:11px;color:var(--muted);font-family:var(--mono)">● Click to inspect satellite evidence</div>
    `;
    tip.classList.add("on");
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - r.width - 14, info.clientX + 16) + "px";
    tip.style.top = Math.max(8, info.clientY - r.height - 14) + "px";
  }

  clickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    const hit = this.sites.find(s => Math.hypot(mx - s.x, my - s.y) < s.hit);
    if (hit && this.options.onSelectSite) this.options.onSelectSite(hit.feature);
  }

  /* ------------------------------------------------ rendering loop */

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (!this.canvas.clientWidth && !this.canvas.offsetParent) return;
      this.step();
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  step() {
    this.time += 0.024;
    if (this.focus) {
      const dy = this.focus.yaw - this.yaw, dp = this.focus.pitch - this.pitch;
      this.yaw += dy * 0.12; this.pitch += dp * 0.12;
      if (Math.abs(dy) < 0.002 && Math.abs(dp) < 0.002) {
        this.yaw = this.focus.yaw; this.pitch = this.focus.pitch; this.focus = null;
      }
      return;
    }
    if (this.drag.on) return;
    if (Math.abs(this.velocity) > 0.0004) {
      this.yaw += this.velocity;
      this.velocity *= 0.93;
    } else if (this.spin) {
      this.yaw += this.spin;
    }

    // Occasional shooting star across deep space
    if (Math.random() < 0.012 && this.shootingStars.length < 2) {
      this.shootingStars.push({
        x: Math.random() * this.width * 0.8,
        y: Math.random() * this.height * 0.4,
        vx: (Math.random() * 8 + 6),
        vy: (Math.random() * 4 + 3),
        len: Math.random() * 50 + 40,
        alpha: 0.9,
      });
    }
    for (let i = this.shootingStars.length - 1; i >= 0; i--) {
      const s = this.shootingStars[i];
      s.x += s.vx;
      s.y += s.vy;
      s.alpha -= 0.035;
      if (s.alpha <= 0) this.shootingStars.splice(i, 1);
    }
  }

  colors() {
    const s = getComputedStyle(document.documentElement);
    const v = (n, f) => (s.getPropertyValue(n) || "").trim() || f;
    return {
      land: v("--globe-land", "#15253b"),
      landBorder: "rgba(56, 189, 248, 0.45)",
      coastShelf: "rgba(14, 165, 233, 0.22)",
      grat: "rgba(56, 189, 248, 0.08)",
      sea1: "#0f1d33",
      sea2: "#040812",
      rimCorona: "rgba(56, 189, 248, 0.45)",
      rimLimb: "rgba(14, 165, 233, 0.85)",
      site: v("--c-observed", "#10b981"),
      siteAmber: "#f59e0b",
      sel: v("--green-ink", "#34d399"),
      text: v("--text", "#f1f5f9"),
      muted: v("--muted", "#64748b"),
      halo: v("--card", "#0b1322"),
    };
  }

  draw() {
    const ctx = this.ctx, w = this.width, h = this.height;
    const cx = w / 2, cy = h / 2, r = this.r(), C = this.colors();
    ctx.clearRect(0, 0, w, h);

    // 1. Deep Space Cosmic Environment (Nebula + Stars + Shooting Stars)
    this.drawCosmos(ctx, w, h);

    // 2. Far-side orbital satellite tracks (behind Earth)
    this.drawSatelliteOrbits(cx, cy, r, false);

    // 3. Multi-layer Atmospheric Rayleigh Scattering Corona & Limb Bloom
    this.drawAtmosphereCorona(ctx, cx, cy, r, C);

    // 4. Ocean Sphere with Realistic Depth & Sunlight Specular Glint
    this.drawOceanSphere(ctx, cx, cy, r, C);

    // 5. Landmasses with Topographical Graticule & Continental Shelves
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
    ctx.clip();

    this.drawGraticule(ctx, C);
    this.drawLand(ctx, cx, cy, r, C);
    this.drawTerminatorAndNightLights(ctx, cx, cy, r);
    ctx.restore();

    // 6. Glowing Electric Ozone Limb Ring
    this.drawLimbRing(ctx, cx, cy, r, C);

    // 7. Monitored Flaring Fields (3D Holographic Light Pillars & Beacons)
    this.drawSites(ctx, cx, cy, r, C);

    // 8. Near-side orbital satellites (in front of Earth with scanning cones)
    this.drawSatelliteOrbits(cx, cy, r, true);

    // 9. Aerospace Mission Telemetry HUD & True North Orbital Compass
    this.drawMissionHUD(ctx, w, h, cx, cy, r, C);
  }

  /* ------------------------------------------------ Cosmos & Atmosphere */

  drawCosmos(ctx, w, h) {
    const neb1 = ctx.createRadialGradient(w * 0.1, h * 0.15, 10, w * 0.1, h * 0.15, w * 0.45);
    neb1.addColorStop(0, "rgba(99, 102, 241, 0.08)");
    neb1.addColorStop(0.5, "rgba(14, 165, 233, 0.04)");
    neb1.addColorStop(1, "rgba(7, 11, 20, 0)");
    ctx.fillStyle = neb1;
    ctx.fillRect(0, 0, w, h);

    const neb2 = ctx.createRadialGradient(w * 0.9, h * 0.85, 10, w * 0.9, h * 0.85, w * 0.5);
    neb2.addColorStop(0, "rgba(16, 185, 129, 0.06)");
    neb2.addColorStop(0.6, "rgba(6, 182, 212, 0.03)");
    neb2.addColorStop(1, "rgba(7, 11, 20, 0)");
    ctx.fillStyle = neb2;
    ctx.fillRect(0, 0, w, h);

    // Multi-magnitude twinkling stars
    if (this.stars) {
      for (const st of this.stars) {
        const tw = 0.45 + 0.55 * Math.sin(this.time * 2.5 + st.phase);
        ctx.fillStyle = st.color;
        ctx.globalAlpha = st.alpha * tw;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Shooting stars
    for (const m of this.shootingStars) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = m.alpha;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * 3.5, m.y - m.vy * 3.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawAtmosphereCorona(ctx, cx, cy, r, C) {
    const corona = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.34);
    corona.addColorStop(0, "rgba(56, 189, 248, 0.32)");
    corona.addColorStop(0.25, "rgba(14, 165, 233, 0.18)");
    corona.addColorStop(0.65, "rgba(3, 105, 161, 0.07)");
    corona.addColorStop(1, "rgba(7, 11, 20, 0)");
    ctx.fillStyle = corona;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.34, 0, Math.PI * 2); ctx.fill();

    const ozone = ctx.createRadialGradient(cx - r * 0.15, cy - r * 0.2, r * 0.88, cx, cy, r * 1.12);
    ozone.addColorStop(0, "rgba(6, 182, 212, 0.25)");
    ozone.addColorStop(0.6, "rgba(56, 189, 248, 0.12)");
    ozone.addColorStop(1, "rgba(7, 11, 20, 0)");
    ctx.fillStyle = ozone;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2); ctx.fill();
  }

  drawOceanSphere(ctx, cx, cy, r, C) {
    const ocean = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.05, cx, cy, r);
    ocean.addColorStop(0, C.sea1);
    ocean.addColorStop(0.45, "#0a1526");
    ocean.addColorStop(0.85, "#050c18");
    ocean.addColorStop(1, C.sea2);

    ctx.fillStyle = ocean;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

    // Sunlight Specular Glint on Ocean Surface
    const glintX = cx - r * 0.34, glintY = cy - r * 0.38;
    const glint = ctx.createRadialGradient(glintX, glintY, 0, glintX, glintY, r * 0.48);
    glint.addColorStop(0, "rgba(255, 255, 255, 0.42)");
    glint.addColorStop(0.2, "rgba(56, 189, 248, 0.25)");
    glint.addColorStop(0.55, "rgba(14, 165, 233, 0.08)");
    glint.addColorStop(1, "rgba(4, 8, 18, 0)");

    ctx.fillStyle = glint;
    ctx.beginPath(); ctx.arc(glintX, glintY, r * 0.48, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.beginPath(); ctx.arc(glintX, glintY, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(glintX - 12, glintY); ctx.lineTo(glintX + 12, glintY);
    ctx.moveTo(glintX, glintY - 12); ctx.lineTo(glintX, glintY + 12);
    ctx.stroke();
  }

  drawGraticule(ctx, C) {
    ctx.strokeStyle = C.grat; ctx.lineWidth = 0.65;
    const line = pts => {
      ctx.beginPath();
      let on = false;
      for (const [lo, la] of pts) {
        const p = this.project(lo, la);
        if (!p.visible) { on = false; continue; }
        if (on) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); on = true; }
      }
      ctx.stroke();
    };
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts = []; for (let lon = -180; lon <= 180; lon += 4) pts.push([lon, lat]);
      line(pts);
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const pts = []; for (let lat = -85; lat <= 85; lat += 4) pts.push([lon, lat]);
      line(pts);
    }
  }

  drawLand(ctx, cx, cy, r, C) {
    if (!this.land) return;
    const cyaw = Math.cos(this.yaw), syaw = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const sx = new Float64Array(3);
    const rotate = (x, y, z) => {
      const x1 = x * cyaw - z * syaw, z1 = x * syaw + z * cyaw;
      sx[0] = x1; sx[1] = y * cp - z1 * sp; sx[2] = y * sp + z1 * cp;
      return sx;
    };
    const px = (x, y) => [cx + x * r, cy - y * r];
    const ang = (x, y) => Math.atan2(-y, x);

    // 1. Continental Shelf Fringe
    ctx.strokeStyle = C.coastShelf;
    ctx.lineWidth = 2.4;
    for (const ring of this.land) {
      const n = ring.length / 3;
      ctx.beginPath();
      let open = false;
      for (let i = 0; i <= n; i++) {
        const j = (i % n) * 3;
        const v = rotate(ring[j], ring[j + 1], ring[j + 2]);
        if (v[2] > 0) {
          const [x, y] = px(v[0], v[1]);
          if (!open) { ctx.moveTo(x, y); open = true; } else ctx.lineTo(x, y);
        } else {
          open = false;
        }
      }
      ctx.stroke();
    }

    // 2. Land polygon fill & crisp coastline stroke
    ctx.fillStyle = C.land;
    ctx.strokeStyle = C.landBorder;
    ctx.lineWidth = 0.9;

    for (const ring of this.land) {
      const n = ring.length / 3;
      ctx.beginPath();
      let open = false, exitAng = 0, prev = null, prevVis = false, firstAng = null;
      for (let i = 0; i <= n; i++) {
        const j = (i % n) * 3;
        const v = rotate(ring[j], ring[j + 1], ring[j + 2]);
        const cur = [v[0], v[1], v[2]], vis = cur[2] > 0;
        if (vis) {
          const [x, y] = px(cur[0], cur[1]);
          if (!open) {
            if (prev) {
              const e = Globe3D.horizon(prev, cur);
              const [ex, ey] = px(e[0], e[1]);
              const a = ang(e[0], e[1]);
              if (firstAng === null) { ctx.moveTo(ex, ey); firstAng = a; }
              else { ctx.arc(cx, cy, r, exitAng, a, Globe3D.ccw(exitAng, a)); }
            } else ctx.moveTo(x, y);
            open = true;
          }
          ctx.lineTo(x, y);
        } else if (prevVis) {
          const e = Globe3D.horizon(prev, cur);
          const [ex, ey] = px(e[0], e[1]);
          ctx.lineTo(ex, ey);
          exitAng = ang(e[0], e[1]);
          open = false;
        }
        prev = cur; prevVis = vis;
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  static horizon(a, b) {
    const t = a[2] / (a[2] - b[2]);
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    const m = Math.hypot(x, y) || 1;
    return [x / m, y / m, 0];
  }

  static ccw(from, to) {
    let d = to - from;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d < 0;
  }

  drawTerminatorAndNightLights(ctx, cx, cy, r) {
    // Day/Night Terminator shadow with warm sunset rim
    const shade = ctx.createRadialGradient(cx - r * 0.45, cy - r * 0.5, r * 0.15, cx, cy, r);
    shade.addColorStop(0, "rgba(255, 255, 255, 0.06)");
    shade.addColorStop(0.48, "rgba(255, 255, 255, 0)");
    shade.addColorStop(0.68, "rgba(245, 158, 11, 0.05)");
    shade.addColorStop(0.85, "rgba(0, 0, 0, 0.58)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.85)");
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

    // Night Hemisphere Industrial & City Lights
    if (state.geo && state.geo.features) {
      for (const f of state.geo.features) {
        const coords = f.geometry.coordinates;
        const p = this.project(coords[0], coords[1]);
        if (!p.visible) continue;
        const sunDot = (p.x - cx) * (-0.4) + (p.y - cy) * (-0.4);
        if (sunDot < -r * 0.1) {
          const intensity = Math.min(1, Math.abs(sunDot + r * 0.1) / (r * 0.5));
          const tw = 0.7 + 0.3 * Math.sin(this.time * 3 + p.x);
          const nGlow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
          nGlow.addColorStop(0, `rgba(251, 191, 36, ${0.45 * intensity * tw})`);
          nGlow.addColorStop(0.5, `rgba(245, 158, 11, ${0.2 * intensity * tw})`);
          nGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
          ctx.fillStyle = nGlow;
          ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  drawLimbRing(ctx, cx, cy, r, C) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.beginPath(); ctx.arc(cx, cy, r + 0.8, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(14, 165, 233, 0.35)";
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  /* ------------------------------------------------ 12 Monitored Flaring Basins */

  drawSites(ctx, cx, cy, r, C) {
    this.sites = [];
    if (!state.geo || !state.geo.features) return;
    const yr = state.mapYear;
    const val = p => { const i = p.years.indexOf(yr); return i === -1 ? null : p.values[i]; };
    const vmax = Math.max(0.001, ...state.geo.features.map(f => val(f.properties) || 0));
    const still = this.reduce && this.reduce.matches;

    // Order far-side to front so near pins render with clean occlusion
    const order = state.geo.features
      .map(f => {
        const coords = f.geometry.coordinates;
        const v = Globe3D.vec(coords[0], coords[1]);
        const rot = this.rot(v[0], v[1], v[2]);
        const p = { x: cx + rot[0] * r, y: cy - rot[1] * r, z: rot[2], visible: rot[2] > 0, rx: rot[0], ry: rot[1] };
        return { f, p };
      })
      .sort((a, b) => a.p.z - b.p.z);

    const labels = [];
    for (const { f, p } of order) {
      const pr = f.properties, v = val(pr), sel = state.mapSel === pr.id, hov = this.hover && this.hover.id === pr.id;
      if (!p.visible) continue;
      const size = v == null ? 4.5 : 4.5 + Math.sqrt(v / vmax) * 16 * Math.min(1.4, this.zoom);
      const fade = Math.min(1, 0.4 + p.z);

      this.sites.push({
        x: p.x, y: p.y, hit: Math.max(16, size + 10), feature: f, id: pr.id,
        name: pr.name, country: pr.country, value: v
      });

      ctx.globalAlpha = fade;

      if (v == null) {
        ctx.strokeStyle = C.muted; ctx.lineWidth = 1.4; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const pillarHeight = Math.max(16, Math.min(48, 16 + Math.sqrt(v / vmax) * 32 * this.zoom));
        const topX = cx + p.rx * (r + pillarHeight);
        const topY = cy - p.ry * (r + pillarHeight);

        const beamGrad = ctx.createLinearGradient(p.x, p.y, topX, topY);
        beamGrad.addColorStop(0, sel ? "rgba(52, 211, 153, 0.95)" : "rgba(16, 185, 129, 0.85)");
        beamGrad.addColorStop(1, sel ? "rgba(56, 189, 248, 0.1)" : "rgba(16, 185, 129, 0.05)");

        ctx.strokeStyle = beamGrad;
        ctx.lineWidth = sel ? 2.5 : 1.8;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(topX, topY);
        ctx.stroke();

        ctx.fillStyle = sel ? C.sel : C.site;
        ctx.beginPath(); ctx.arc(topX, topY, sel ? 4.5 : 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(topX, topY, sel ? 4.5 : 3.2, 0, Math.PI * 2); ctx.stroke();

        const pulse = still ? 0 : (this.time * 2 + p.x * 0.05) % 1;
        ctx.strokeStyle = sel ? C.sel : C.site;
        ctx.lineWidth = 1.4;
        ctx.globalAlpha = fade * (1 - pulse) * 0.7;
        ctx.beginPath(); ctx.arc(p.x, p.y, size + pulse * 18, 0, Math.PI * 2); ctx.stroke();

        ctx.fillStyle = sel ? C.sel : C.site;
        ctx.globalAlpha = fade * 0.28;
        ctx.beginPath(); ctx.arc(p.x, p.y, size * 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = fade;
        ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fill();
      }

      if (sel) {
        const ringR = size + 8;
        ctx.strokeStyle = C.sel; ctx.lineWidth = 1.8;
        ctx.globalAlpha = fade * 0.9;
        ctx.beginPath(); ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2); ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(p.x - ringR - 6, p.y); ctx.lineTo(p.x - ringR + 3, p.y);
        ctx.moveTo(p.x + ringR - 3, p.y); ctx.lineTo(p.x + ringR + 6, p.y);
        ctx.moveTo(p.x, p.y - ringR - 6); ctx.lineTo(p.x, p.y - ringR + 3);
        ctx.moveTo(p.x, p.y + ringR - 3); ctx.lineTo(p.x, p.y + ringR + 6);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (sel || hov || (v != null && v > vmax * 0.55)) labels.push({ p, pr, sel, size, fade });
    }

    ctx.font = "700 11.5px Inter, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const taken = [];
    for (const { p, pr, sel, size, fade } of labels) {
      const text = pr.name, wdt = ctx.measureText(text).width;
      const x = p.x + size + 9, y = p.y;
      const box = { x, y: y - 10, w: wdt + 12, h: 20 };
      if (taken.some(t => Math.abs(t.x - box.x) < Math.max(t.w, box.w) && Math.abs(t.y - box.y) < 20)) continue;
      taken.push(box);

      ctx.globalAlpha = fade;
      ctx.fillStyle = "rgba(7, 15, 26, 0.94)";
      ctx.strokeStyle = sel ? C.sel : "rgba(56, 189, 248, 0.45)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x - 5, y - 10, wdt + 12, 20, 4) : ctx.rect(x - 5, y - 10, wdt + 12, 20);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = sel ? C.sel : "#f8fafc";
      ctx.fillText(text, x + 1, y + 1);
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------ 3D Orbital Satellites */

  drawSatelliteOrbits(cx, cy, r, frontPass) {
    const ctx = this.ctx;
    const satellites = [
      {
        name: "VIIRS-N20 (824 km)",
        tag: "VIIRS-N20 // NIGHTFIRE",
        color: "#10b981",
        orbitR: r * 1.15,
        inc: 98.7 * Math.PI / 180,
        speed: 0.18,
        offset: 0,
        scanWidth: 46,
      },
      {
        name: "Sentinel-5P (824 km)",
        tag: "SENTINEL-5P // TROPOMI",
        color: "#06b6d4",
        orbitR: r * 1.21,
        inc: 82.4 * Math.PI / 180,
        speed: 0.15,
        offset: 2.35,
        scanWidth: 40,
      }
    ];

    for (const sat of satellites) {
      const numPts = 72;
      ctx.beginPath();
      let first = true;
      for (let i = 0; i <= numPts; i++) {
        const th = (i / numPts) * Math.PI * 2;
        const x0 = sat.orbitR * Math.cos(th);
        const y0 = sat.orbitR * Math.sin(th) * Math.cos(sat.inc);
        const z0 = sat.orbitR * Math.sin(th) * Math.sin(sat.inc);
        const [rx, ry, rz] = this.rot(x0, y0, z0);

        const isFront = rz > 0;
        if (isFront === frontPass) {
          const sx = cx + rx, sy = cy - ry;
          if (first) { ctx.moveTo(sx, sy); first = false; }
          else ctx.lineTo(sx, sy);
        } else {
          first = true;
        }
      }
      ctx.strokeStyle = sat.color;
      ctx.globalAlpha = frontPass ? 0.38 : 0.12;
      ctx.lineWidth = 1.3;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      const curTh = this.time * sat.speed + sat.offset;
      const x0 = sat.orbitR * Math.cos(curTh);
      const y0 = sat.orbitR * Math.sin(curTh) * Math.cos(sat.inc);
      const z0 = sat.orbitR * Math.sin(curTh) * Math.sin(sat.inc);
      const [rx, ry, rz] = this.rot(x0, y0, z0);

      const isFront = rz > 0;
      if (isFront === frontPass) {
        const sx = cx + rx, sy = cy - ry;

        const groundT = r / sat.orbitR;
        const gx = cx + rx * groundT, gy = cy - ry * groundT;

        const scanGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, sat.scanWidth);
        scanGrad.addColorStop(0, sat.color === "#10b981" ? "rgba(16, 185, 129, 0.32)" : "rgba(6, 182, 212, 0.32)");
        scanGrad.addColorStop(0.6, sat.color === "#10b981" ? "rgba(16, 185, 129, 0.12)" : "rgba(6, 182, 212, 0.12)");
        scanGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

        ctx.fillStyle = scanGrad;
        ctx.beginPath();
        ctx.ellipse(gx, gy, sat.scanWidth, sat.scanWidth * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();

        const scanOsc = Math.sin(this.time * 6) * sat.scanWidth * 0.7;
        ctx.strokeStyle = sat.color;
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(gx - sat.scanWidth * 0.8, gy + scanOsc * 0.4);
        ctx.lineTo(gx + sat.scanWidth * 0.8, gy - scanOsc * 0.4);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.strokeStyle = sat.color;
        ctx.lineWidth = 0.9;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(gx, gy);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.fillStyle = "#38bdf8";
        ctx.fillRect(sx - 13, sy - 3, 7, 6);
        ctx.fillRect(sx + 6, sy - 3, 7, 6);
        ctx.strokeStyle = "#0284c7";
        ctx.lineWidth = 0.8;
        ctx.strokeRect(sx - 13, sy - 3, 7, 6);
        ctx.strokeRect(sx + 6, sy - 3, 7, 6);

        ctx.fillStyle = sat.color;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        const ping = (this.time * 2.2) % 1;
        ctx.strokeStyle = sat.color;
        ctx.lineWidth = 1.3;
        ctx.globalAlpha = 1 - ping;
        ctx.beginPath();
        ctx.arc(sx, sy, 4 + ping * 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.font = "700 10.5px var(--mono, monospace)";
        ctx.fillStyle = sat.color;
        ctx.fillText(sat.tag, sx + 10, sy - 8);
      }
    }
  }

  /* ------------------------------------------------ Mission Telemetry HUD & Compass */

  drawMissionHUD(ctx, w, h, cx, cy, r, C) {
    const isMobile = w < 640;

    const northVec = this.rot(0, 1, 0);
    const compX = isMobile ? 26 : 40;
    const compY = isMobile ? 28 : 40;

    ctx.save();
    ctx.translate(compX, compY);

    ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, isMobile ? 14 : 18, 0, Math.PI * 2); ctx.stroke();

    const nAng = Math.atan2(-northVec[1], northVec[0]);
    ctx.rotate(nAng);

    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.moveTo(0, isMobile ? -11 : -14); ctx.lineTo(-3, 0); ctx.lineTo(3, 0); ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#94a3b8";
    ctx.beginPath();
    ctx.moveTo(0, isMobile ? 11 : 14); ctx.lineTo(-3, 0); ctx.lineTo(3, 0); ctx.closePath();
    ctx.fill();

    ctx.restore();

    ctx.font = "700 9px var(--mono, monospace)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.fillText("N", compX - 3.5, compY - (isMobile ? 17 : 22));

    const badgeText = isMobile ? "ORBITAL TELEMETRY" : "EARTH OBSERVATION TELEMETRY // REAL-TIME ORBITAL CONSOLE";
    ctx.font = "700 10px var(--mono, monospace)";
    ctx.fillStyle = "rgba(7, 15, 26, 0.85)";
    ctx.strokeStyle = "rgba(56, 189, 248, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const bx = isMobile ? 48 : 68;
    const by = isMobile ? 18 : 28;
    const bw = ctx.measureText(badgeText).width + (isMobile ? 20 : 24);
    ctx.roundRect ? ctx.roundRect(bx, by, bw, 22, 4) : ctx.rect(bx, by, bw, 22);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = "#10b981";
    ctx.beginPath(); ctx.arc(bx + 9, by + 11, 3, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "#38bdf8";
    ctx.fillText(badgeText, bx + 18, by + 14.5);

    const lon = ((-this.yaw * 180 / Math.PI) % 360 + 540) % 360 - 180;
    const lat = this.pitch * 180 / Math.PI;
    const lonTxt = `${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? "E" : "W"}`;
    const latTxt = `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? "N" : "S"}`;
    const zoomPct = Math.round(this.zoom * 100);

    const hudText = isMobile
      ? `${latTxt}, ${lonTxt} · ${zoomPct}%`
      : `VIEW: ${latTxt}, ${lonTxt}  |  ZOOM: ${zoomPct}%  |  LEO ORBIT: 824 KM  |  SENSORS: VIIRS-N20 · S5P ACTIVE`;

    ctx.font = "700 10px var(--mono, monospace)";
    const tw = ctx.measureText(hudText).width;

    ctx.fillStyle = "rgba(7, 15, 26, 0.9)";
    ctx.strokeStyle = "rgba(56, 189, 248, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const rx = isMobile ? 10 : 14;
    const ry = h - (isMobile ? 30 : 34);
    ctx.roundRect ? ctx.roundRect(rx, ry, tw + 20, 22, 4) : ctx.rect(rx, ry, tw + 20, 22);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = "#10b981";
    ctx.beginPath(); ctx.arc(rx + 9, ry + 11, 3, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(hudText, rx + 18, ry + 14.5);
  }
}

window.Globe3D = Globe3D;
