// Canvas renderer: cute hamster balls, cage, particles, HUD effects.
import { LEVELS, W, H, DEAD_Y, DROP_Y, MAX_LEVEL } from "./engine.js";

export const PALETTE = [
  { body: "#F5C542", belly: "#FFF1B8", ear: "#E0A100" }, // 0 seed (gold)
  { body: "#F6DDB4", belly: "#FFF7EA", ear: "#F2B5A0" }, // 1 pip
  { body: "#F5B98A", belly: "#FFEBDC", ear: "#EE9C88" }, // 2 puff
  { body: "#E9966A", belly: "#FCE3D2", ear: "#D9786A" }, // 3 fuzz
  { body: "#F4B6BE", belly: "#FFECEF", ear: "#E88894" }, // 4 cheeks
  { body: "#C69C72", belly: "#F4E5D3", ear: "#B07B5C" }, // 5 jogger
  { body: "#9CC3E6", belly: "#E9F3FC", ear: "#7DA7D3" }, // 6 wheelie
  { body: "#A9D18E", belly: "#EEF7E6", ear: "#86B56A" }, // 7 hoarder
  { body: "#A08BD0", belly: "#EFEAFA", ear: "#8670BF" }, // 8 miner
  { body: "#5DB7B0", belly: "#E2F5F3", ear: "#3F9C95" }, // 9 validator
  { body: "#E8707A", belly: "#FDE6E8", ear: "#CF5561" }, // 10 mega
  { body: "#F2BE3A", belly: "#FFF4CF", ear: "#D99A12" }, // 11 squeektoshi
];

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.particles = [];
    this.texts = [];
    this.shakeT = 0;
    this.flash = 0;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resize();
  }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.c.getBoundingClientRect();
    this.scale = rect.width / W;
    this.c.width = Math.round(rect.width * dpr);
    this.c.height = Math.round(rect.width * (H / W) * dpr);
    this.dpr = dpr;
  }
  toWorldX(clientX) {
    const rect = this.c.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  }

  onEvents(events) {
    for (const e of events) {
      if (e.t === "merge" || e.t === "delivery") {
        const col = PALETTE[e.lv].body;
        const n = this.reduced ? 4 : 10 + e.lv * 2;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
          const sp = 80 + Math.random() * 120 + e.lv * 10;
          this.particles.push({
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 0.6,
            max: 0.6,
            col,
            r: 2 + Math.random() * 3,
          });
        }
        this.texts.push({
          x: e.x,
          y: e.y,
          txt:
            (e.t === "delivery" ? "DELIVERED +" : "+") +
            e.pts +
            (e.combo > 1 ? `  x${e.combo}` : ""),
          life: 0.9,
          max: 0.9,
          big: e.lv >= 8,
        });
        if (e.lv >= 7 && !this.reduced)
          this.shakeT = Math.min(0.35, 0.08 + e.lv * 0.02);
      } else if (e.t === "block") {
        this.flash = 1;
        this.texts.push({
          x: W / 2,
          y: H * 0.36,
          txt: "ENERGY BOOST!",
          life: 1.6,
          max: 1.6,
          big: true,
          gold: true,
        });
      } else if (e.t === "toshi") {
        this.flash = 1;
        this.texts.push({
          x: W / 2,
          y: H * 0.42,
          txt: "DOUBLE SQUEEKTOSHI!",
          life: 2,
          max: 2,
          big: true,
          gold: true,
        });
      } else if (e.t === "shake" && !this.reduced) {
        this.shakeT = 0.3;
      }
    }
  }

  draw(sim, aimX, dt, showAim) {
    const ctx = this.ctx;
    const s = this.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.c.width, this.c.height);
    let ox = 0,
      oy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      ox = (Math.random() - 0.5) * 6;
      oy = (Math.random() - 0.5) * 6;
    }
    ctx.setTransform(s, 0, 0, s, ox * s, oy * s);
    this._bg(ctx, sim);
    // aim guide + preview
    if (showAim && sim && !sim.over) {
      const lv = sim.current;
      const r = LEVELS[lv].r;
      const x = Math.max(r + 2, Math.min(W - r - 2, aimX));
      ctx.save();
      ctx.strokeStyle = "rgba(59,42,30,0.18)";
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, DROP_Y + r);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = sim.canDrop() ? 1 : 0.45;
      drawBall(ctx, lv, x, DROP_Y, r, 0, performance.now() / 1000);
      ctx.globalAlpha = 1;
    }
    if (sim) {
      const t = this.reduced ? 0 : performance.now() / 1000;
      for (const b of sim.balls)
        drawBall(ctx, b.lv, b.x, b.y, LEVELS[b.lv].r, b.vx * 0.0015, t + b.id);
      const candidate = sim.deliveryCandidate;
      if (candidate) {
        ctx.strokeStyle = "#22816a";
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(
          candidate.x,
          candidate.y,
          LEVELS[candidate.lv].r + 5,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += 300 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = p.life / p.max;
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const f = this.texts[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      const k = f.life / f.max;
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.font = `800 ${f.big ? 24 : 16}px ui-rounded, "Nunito", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      const yy = f.y - (1 - k) * 40;
      ctx.strokeText(f.txt, f.x, yy);
      ctx.fillStyle = f.gold ? "#C98A00" : "#3B2A1E";
      ctx.fillText(f.txt, f.x, yy);
    }
    ctx.globalAlpha = 1;
    if (this.flash > 0) {
      this.flash -= dt * 1.6;
      ctx.fillStyle = `rgba(255,214,90,${Math.max(0, this.flash) * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  _bg(ctx, sim) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#FFFBF4");
    g.addColorStop(1, "#FBEBD3");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // cage bars
    ctx.strokeStyle = "rgba(160,120,80,0.08)";
    ctx.lineWidth = 2;
    for (let x = 20; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    // big faint wheel
    ctx.save();
    ctx.translate(W / 2, H * 0.62);
    const rot = this.reduced
      ? 0
      : (performance.now() / 1000) *
        (sim && sim.cfg.weather === "ZOOMIES"
          ? 1.6
          : sim && sim.cfg.weather === "JOG"
            ? 0.7
            : 0.12);
    ctx.rotate(rot);
    ctx.strokeStyle = "rgba(200,150,90,0.12)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 150, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 150, Math.sin(a) * 150);
      ctx.stroke();
    }
    ctx.restore();
    // bedding
    const bg = ctx.createLinearGradient(0, H - 26, 0, H);
    bg.addColorStop(0, "rgba(232,196,140,0)");
    bg.addColorStop(1, "rgba(222,180,120,0.55)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, H - 26, W, 26);
    // dead line
    const danger = sim && sim.overTimer > 0;
    ctx.save();
    ctx.strokeStyle = danger
      ? `rgba(229,100,88,${0.55 + 0.45 * Math.sin(performance.now() / 80)})`
      : "rgba(229,100,88,0.35)";
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, DEAD_Y);
    ctx.lineTo(W, DEAD_Y);
    ctx.stroke();
    ctx.restore();
    if (sim && sim.fever > 0) {
      const a = 0.18 + 0.1 * Math.sin(performance.now() / 120);
      const fg = ctx.createRadialGradient(
        W / 2,
        H / 2,
        H * 0.25,
        W / 2,
        H / 2,
        H * 0.75,
      );
      fg.addColorStop(0, "rgba(255,200,60,0)");
      fg.addColorStop(1, `rgba(255,170,40,${a})`);
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, W, H);
    }
  }
}

/** Draw a hamster ball (or the golden seed for lv 0). Exported for UI icons. */
export function drawBall(ctx, lv, x, y, r, tilt = 0, t = 0) {
  const p = PALETTE[lv];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.max(-0.35, Math.min(0.35, tilt)));
  if (lv === 0) {
    drawSeed(ctx, r, t);
    ctx.restore();
    return;
  }
  // ears
  const er = r * 0.32;
  for (const sx of [-1, 1]) {
    ctx.fillStyle = p.body;
    ctx.beginPath();
    ctx.arc(sx * r * 0.58, -r * 0.74, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.ear;
    ctx.beginPath();
    ctx.arc(sx * r * 0.58, -r * 0.74, er * 0.58, 0, Math.PI * 2);
    ctx.fill();
  }
  // body
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, lighten(p.body, 0.25));
  g.addColorStop(1, p.body);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(59,42,30,0.18)";
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.stroke();
  // belly
  ctx.fillStyle = p.belly;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.38, r * 0.62, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // face
  const blink = Math.floor(t * 0.7) % 7 === 0 && (t * 0.7) % 1 < 0.12;
  const ey = -r * 0.08,
    ex = r * 0.34,
    es = Math.max(1.6, r * 0.12);
  ctx.fillStyle = "#2B1D14";
  for (const sx of [-1, 1]) {
    if (blink) {
      ctx.fillRect(sx * ex - es, ey, es * 2, Math.max(1, es * 0.35));
    } else {
      ctx.beginPath();
      ctx.arc(sx * ex, ey, es, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(sx * ex + es * 0.35, ey - es * 0.4, es * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2B1D14";
    }
  }
  // cheeks
  ctx.fillStyle = "rgba(240,120,130,0.45)";
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sx * r * 0.56, r * 0.16, r * 0.17, r * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // nose + mouth
  ctx.fillStyle = "#E06C7A";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.1, r * 0.08, r * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#6B4A36";
  ctx.lineWidth = Math.max(1, r * 0.04);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(-r * 0.07, r * 0.18, r * 0.07, 0.2, Math.PI - 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(r * 0.07, r * 0.18, r * 0.07, 0.2, Math.PI - 0.2);
  ctx.stroke();
  // accessories by level
  accessory(ctx, lv, r, t);
  ctx.restore();
}

function accessory(ctx, lv, r, t) {
  if (lv === 4) {
    // stuffed cheeks: seeds
    ctx.fillStyle = "#C9A35A";
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        sx * r * 0.66,
        r * 0.3,
        r * 0.1,
        r * 0.06,
        sx * 0.6,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  } else if (lv === 5) {
    // sweatband
    ctx.fillStyle = "#E56458";
    ctx.fillRect(-r * 0.7, -r * 0.5, r * 1.4, r * 0.14);
  } else if (lv === 6) {
    // tiny wheel badge
    ctx.strokeStyle = "#3F6FA8";
    ctx.lineWidth = r * 0.05;
    ctx.beginPath();
    ctx.arc(r * 0.55, r * 0.55, r * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r * 0.35, r * 0.55);
    ctx.lineTo(r * 0.75, r * 0.55);
    ctx.moveTo(r * 0.55, r * 0.35);
    ctx.lineTo(r * 0.55, r * 0.75);
    ctx.stroke();
  } else if (lv === 7) {
    // acorn hoard
    ctx.fillStyle = "#8A5A2B";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.62, r * 0.16, r * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5E3B1A";
    ctx.fillRect(-r * 0.17, r * 0.46, r * 0.34, r * 0.07);
  } else if (lv === 8) {
    // miner helmet + lamp
    ctx.fillStyle = "#F2C14E";
    ctx.beginPath();
    ctx.arc(0, -r * 0.42, r * 0.62, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-r * 0.75, -r * 0.46, r * 1.5, r * 0.1);
    ctx.fillStyle = "#FFF7C2";
    ctx.beginPath();
    ctx.arc(0, -r * 0.72, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  } else if (lv === 9) {
    // validator check badge
    ctx.fillStyle = "#2E7D6F";
    ctx.beginPath();
    ctx.arc(r * 0.55, r * 0.5, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = r * 0.05;
    ctx.beginPath();
    ctx.moveTo(r * 0.45, r * 0.5);
    ctx.lineTo(r * 0.53, r * 0.58);
    ctx.lineTo(r * 0.66, r * 0.42);
    ctx.stroke();
  } else if (lv === 10) {
    // shades
    ctx.fillStyle = "#2B1D14";
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        sx * r * 0.34,
        -r * 0.08,
        r * 0.2,
        r * 0.13,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillRect(-r * 0.16, -r * 0.12, r * 0.32, r * 0.04);
  } else if (lv === 11) {
    // crown + glow
    ctx.fillStyle = "#FFD54A";
    ctx.strokeStyle = "#B7860B";
    ctx.lineWidth = r * 0.03;
    ctx.beginPath();
    const y0 = -r * 0.88,
      w = r * 0.62;
    ctx.moveTo(-w, y0);
    ctx.lineTo(-w, y0 - r * 0.3);
    ctx.lineTo(-w / 2, y0 - r * 0.12);
    ctx.lineTo(0, y0 - r * 0.38);
    ctx.lineTo(w / 2, y0 - r * 0.12);
    ctx.lineTo(w, y0 - r * 0.3);
    ctx.lineTo(w, y0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.25 + 0.15 * Math.sin(t * 3);
    ctx.strokeStyle = "#FFD54A";
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.06, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawSeed(ctx, r, t) {
  ctx.globalAlpha = 0.35 + 0.2 * Math.sin(t * 5);
  ctx.fillStyle = "#FFE07A";
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.rotate(Math.sin(t * 2) * 0.3);
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, "#FFE58A");
  g.addColorStop(1, "#D9A000");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.15);
  ctx.bezierCurveTo(r * 0.95, -r * 0.5, r * 0.8, r * 0.9, 0, r * 1.0);
  ctx.bezierCurveTo(-r * 0.8, r * 0.9, -r * 0.95, -r * 0.5, 0, -r * 1.15);
  ctx.fill();
  ctx.strokeStyle = "rgba(140,90,0,0.6)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.8);
  ctx.lineTo(0, r * 0.7);
  ctx.stroke();
  ctx.fillStyle = "#7A4E00";
  ctx.font = `900 ${r * 0.8}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("S", 0, r * 0.05);
}

function lighten(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const f = (c) => Math.round(c + (255 - c) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Render a ball onto a small standalone canvas (for HUD icons). */
export function ballIcon(canvas, lv, size) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + "px";
  canvas.style.height = size + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const r = size * (lv === 0 ? 0.3 : 0.36);
  drawBall(ctx, lv, size / 2, size / 2 + size * 0.06, r, 0, 0.3);
}
export { MAX_LEVEL };
