"use strict";
/* GreenTruth — Reactive 3D Physics & Orbital Telemetry Engine.
   Zero dependencies, pure vanilla HTML5 Canvas & CSS 3D Transforms.
   Features:
     1. Reactive 3D perspective card tilt with dynamic specular cursor glare
     2. 3D orbital telemetry & satellite constellation canvas on landing hero
     3. Reactive live metric roll-ups (smooth tick-up easing)
     4. High-frequency cybernetic micro-interactions                               */

(() => {
  /* ========================================================= 1. 3D CARD TILT */

  /* 3D card tilt is permanently disabled for rock-solid stability and zero hover movement */
  function init3DTilt() {
    // Disabled as requested: cards remain solid, flat, and professional with zero movement on hover.
  }

  /* ========================================= 2. 3D HERO ORBITAL TELEMETRY */

  class HeroOrbitalCanvas {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext("2d");
      this.nodes = [];
      this.satellites = [];
      this.mouse = { x: -9999, y: -9999, vx: 0, vy: 0, lastX: 0, lastY: 0 };
      this.running = false;
      this.raf = null;

      this.init();
    }

    init() {
      this.resize();
      window.addEventListener("resize", () => this.resize(), { passive: true });

      // Generate 3D satellite orbit nodes
      const count = window.innerWidth < 768 ? 24 : 48;
      for (let i = 0; i < count; i++) {
        this.nodes.push({
          x: (Math.random() - 0.5) * this.width * 1.4,
          y: (Math.random() - 0.5) * this.height * 1.4,
          z: Math.random() * 800 - 400, // 3D depth
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          vz: (Math.random() - 0.5) * 0.3,
          radius: Math.random() * 2 + 1,
          hue: Math.random() > 0.4 ? "16, 185, 129" : (Math.random() > 0.5 ? "6, 182, 212" : "56, 189, 248"),
          alpha: Math.random() * 0.6 + 0.2,
        });
      }

      // Simulated polar satellites in distinct orbits
      this.satellites = [
        { name: "VIIRS-N20", angle: 0, speed: 0.008, radiusX: 320, radiusY: 140, tilt: 0.35, color: "#10b981", blink: 0 },
        { name: "S5P-TROPOMI", angle: Math.PI, speed: 0.006, radiusX: 420, radiusY: 180, tilt: -0.45, color: "#38bdf8", blink: 0 },
      ];

      // Mouse tracking
      window.addEventListener("pointermove", e => {
        const rect = this.canvas.getBoundingClientRect();
        const curX = e.clientX - rect.left;
        const curY = e.clientY - rect.top;
        this.mouse.vx = curX - this.mouse.lastX;
        this.mouse.vy = curY - this.mouse.lastY;
        this.mouse.lastX = curX;
        this.mouse.lastY = curY;
        this.mouse.x = curX;
        this.mouse.y = curY;
      }, { passive: true });

      this.start();
    }

    resize() {
      this.width = this.canvas.clientWidth || window.innerWidth;
      this.height = this.canvas.clientHeight || window.innerHeight;
      this.canvas.width = this.width * window.devicePixelRatio || 1;
      this.canvas.height = this.height * window.devicePixelRatio || 1;
      this.ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    }

    start() {
      if (this.running) return;
      this.running = true;
      const loop = () => {
        if (!this.running) return;
        this.draw();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      this.running = false;
      if (this.raf) cancelAnimationFrame(this.raf);
    }

    draw() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      const cx = w / 2;
      const cy = h / 2;
      const fov = 450; // 3D camera focal length

      ctx.clearRect(0, 0, w, h);

      // 1. Draw connecting telemetry constellation links in 3D
      ctx.lineWidth = 0.75;
      for (let i = 0; i < this.nodes.length; i++) {
        const p1 = this.nodes[i];
        // 3D perspective projection
        const scale1 = fov / (fov + p1.z);
        const x1 = cx + p1.x * scale1;
        const y1 = cy + p1.y * scale1;

        for (let j = i + 1; j < this.nodes.length; j++) {
          const p2 = this.nodes[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dz = p1.z - p2.z;
          const dist3D = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist3D < 130) {
            const scale2 = fov / (fov + p2.z);
            const x2 = cx + p2.x * scale2;
            const y2 = cy + p2.y * scale2;

            const alpha = (1 - dist3D / 130) * 0.22 * Math.min(scale1, scale2);
            ctx.strokeStyle = `rgba(${p1.hue}, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        }
      }

      // 2. Draw nodes with depth sorting
      this.nodes.sort((a, b) => b.z - a.z);

      for (const p of this.nodes) {
        // Move in 3D
        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;

        // Wrap around bounds
        if (p.x < -w * 0.7) p.x = w * 0.7;
        if (p.x > w * 0.7) p.x = -w * 0.7;
        if (p.y < -h * 0.7) p.y = h * 0.7;
        if (p.y > h * 0.7) p.y = -h * 0.7;
        if (p.z < -300) p.z = 400;
        if (p.z > 400) p.z = -300;

        // Interactive mouse gentle repulsion in 3D
        const scale = fov / (fov + p.z);
        const projX = cx + p.x * scale;
        const projY = cy + p.y * scale;

        const mdx = projX - this.mouse.x;
        const mdy = projY - this.mouse.y;
        const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
        if (mDist < 120) {
          const force = (1 - mDist / 120) * 0.6;
          p.x += (mdx / mDist) * force * 10;
          p.y += (mdy / mDist) * force * 10;
        }

        const rad = Math.max(0.5, p.radius * scale);
        const alpha = Math.min(1, Math.max(0.1, p.alpha * scale));

        ctx.fillStyle = `rgba(${p.hue}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(projX, projY, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Draw Orbiting Earth Observation Satellites
      for (const sat of this.satellites) {
        sat.angle += sat.speed;
        sat.blink = (sat.blink + 0.05) % (Math.PI * 2);

        // 3D Elliptical Orbit
        const unrotatedX = Math.cos(sat.angle) * sat.radiusX;
        const unrotatedY = Math.sin(sat.angle) * sat.radiusY;

        // Apply orbit tilt matrix
        const cosT = Math.cos(sat.tilt);
        const sinT = Math.sin(sat.tilt);
        const satX = cx + unrotatedX * cosT - unrotatedY * sinT;
        const satY = cy + unrotatedX * sinT + unrotatedY * cosT;
        const depthZ = Math.sin(sat.angle) * 120;
        const satScale = Math.max(0.7, 1 + depthZ / 400);

        // Draw orbital trail
        ctx.strokeStyle = `${sat.color}22`;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.ellipse(cx, cy, sat.radiusX, sat.radiusY, sat.tilt, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Satellite body
        ctx.fillStyle = sat.color;
        ctx.shadowColor = sat.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(satX, satY, 3.5 * satScale, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Satellite ping beacon
        const pingAlpha = Math.max(0, Math.sin(sat.blink));
        ctx.strokeStyle = `${sat.color}${Math.floor(pingAlpha * 255).toString(16).padStart(2, "0")}`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(satX, satY, 10 + pingAlpha * 12, 0, Math.PI * 2);
        ctx.stroke();

        // Label
        ctx.font = "10px 'JetBrains Mono', monospace";
        ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
        ctx.fillText(sat.name, satX + 8, satY - 6);
      }
    }
  }

  /* ======================================== 3. REACTIVE NUMBER COUNT-UP */

  function animateMetricNumber(el, targetNumber, prefix = "", suffix = "", decimals = 0) {
    if (!el || isNaN(targetNumber)) return;
    const startNumber = parseFloat(el.getAttribute("data-val")) || 0;
    el.setAttribute("data-val", targetNumber);

    const duration = 750; // ms
    const startTime = performance.now();

    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = startNumber + (targetNumber - startNumber) * ease;

      el.textContent = `${prefix}${current.toFixed(decimals)}${suffix}`;

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        el.textContent = `${prefix}${targetNumber.toFixed(decimals)}${suffix}`;
      }
    }
    requestAnimationFrame(update);
  }

  function enhanceMetricsWithReactiveRollup(root = document) {
    // Look for fact cards with percentages or values
    root.querySelectorAll(".fact-c .v, .rates b, .fp-nums .v, .big-figure").forEach(el => {
      const text = el.textContent.trim();
      // Test for percentage e.g. -40% or +12.5%
      const pctMatch = /^([+−-])?([\d.]+)(%)?$/.exec(text);
      if (pctMatch) {
        const sign = pctMatch[1] === "−" || pctMatch[1] === "-" ? "-" : (pctMatch[1] === "+" ? "+" : "");
        const num = parseFloat(sign + pctMatch[2]);
        const dec = pctMatch[2].includes(".") ? pctMatch[2].split(".")[1].length : 0;
        if (!isNaN(num)) {
          animateMetricNumber(el, num, sign === "+" ? "+" : (num < 0 ? "−" : ""), "%", dec);
        }
      }
    });
  }

  /* ========================================================= BOOTSTRAP */

  let heroCanvasInstance = null;

  function initReactive3D() {
    init3DTilt();

    // Check prefers-reduced-motion
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!prefersReduced) {
      const canvasEl = document.getElementById("heroCanvas");
      if (canvasEl) {
        heroCanvasInstance = new HeroOrbitalCanvas("heroCanvas");
      }
    }

    // Auto-hook into result rendering
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.addedNodes.length) {
          m.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
              enhanceMetricsWithReactiveRollup(node);
            }
          });
        }
      }
    });

    const resultsHost = document.getElementById("wsResults");
    if (resultsHost) observer.observe(resultsHost, { childList: true, subtree: true });

    const demoHost = document.getElementById("demoRun");
    if (demoHost) observer.observe(demoHost, { childList: true, subtree: true });
  }

  // Listen for view navigation to pause/resume hero canvas
  window.addEventListener("hashchange", () => {
    const isHome = !location.hash || location.hash === "#home";
    if (heroCanvasInstance) {
      if (isHome) heroCanvasInstance.start();
      else heroCanvasInstance.stop();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initReactive3D);
  } else {
    initReactive3D();
  }

  // Expose global helpers
  window.Reactive3D = {
    animateMetricNumber,
    enhanceMetricsWithReactiveRollup,
  };
})();

