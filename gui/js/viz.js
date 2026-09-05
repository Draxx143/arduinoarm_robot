/* ============================================================
 * viz.js — بصری‌سازی زنده‌ی بازو روی Canvas
 * دو نما: بغل (Side) و بالا (Top) + رد حرکت + بازوی هدف شبح‌وار
 * ============================================================ */
"use strict";

class ArmViz {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.current = [0, 0, 0, 0, 0];  // زوایای فعلی (درجه) — با lerp نرم می‌رسد
    this.target = [0, 0, 0, 0, 0];   // زوایای هدف (شبح)
    this.display = [0, 0, 0, 0, 0];
    this.state = "INIT";
    this.trail = [];                  // رد نوک بازو (مختصات mm در نمای بغل)
    this._lastTip = null;
    this._pulse = 0;
    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 10) return;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width; this.h = r.height;
  }

  setAngles(deg5) { this.current = deg5.slice(); }
  setTargets(deg5) { this.target = deg5.slice(); }
  setState(s) { this.state = s; }

  /* هندسه‌ی بازو از زوایا (مطابق Kin.fk) */
  geometry(angles) {
    const D = Math.PI / 180;
    const { L1, L2, L3 } = FW.LINKS;
    const a0 = angles[0] * D, a1 = angles[1] * D, a2 = angles[2] * D, a4 = angles[3] * D;
    const j2 = { x: 0, z: 0 };                                     // شانه (مبدا)
    const j3 = { x: L1 * Math.cos(a1), z: L1 * Math.sin(a1) };      // آرنج
    const j4 = { x: j3.x + L2 * Math.cos(a1 - a2), z: j3.z + L2 * Math.sin(a1 - a2) }; // مچ
    const dir = a1 - a2 - a4;
    const tip = { x: j4.x + L3 * Math.cos(dir), z: j4.z + L3 * Math.sin(dir) };  // نوک
    return { j2, j3, j4, tip, r: Math.hypot(tip.x, tip.z), yaw: angles[0], roll: angles[4] };
  }

  frame(dtMs) {
    if (!this.w) this._resize();
    const k = 1 - Math.pow(0.0025, dtMs / 1000); // lerp نرم مستقل از فریم‌ریت
    for (let i = 0; i < 5; i++) {
      this.display[i] += (this.current[i] - this.display[i]) * k;
      if (Math.abs(this.current[i] - this.display[i]) < 0.02) this.display[i] = this.current[i];
    }
    this._pulse += dtMs;
    this._sampleTrail();
    this._render();
  }

  _sampleTrail() {
    const g = this.geometry(this.display);
    if (this._lastTip) {
      const d = Math.hypot(g.tip.x - this._lastTip.x, g.tip.z - this._lastTip.z);
      if (d > 1.5) {
        this.trail.push({ x: g.tip.x, z: g.tip.z });
        this._lastTip = g.tip;
        if (this.trail.length > 160) this.trail.shift();
      }
    } else this._lastTip = { ...g.tip };
  }

  _render() {
    const ctx = this.ctx, w = this.w, h = this.h;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);

    /* پس‌زمینه */
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "rgba(13,20,40,0.65)");
    bg.addColorStop(1, "rgba(8,12,26,0.9)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const half = w / 2;
    this._drawPanelChrome(half, 0, half, h, "نمای بغل — Side");
    this._drawPanelChrome(half, 0, half, h, null, half);

    this._drawSide(0, half);
    this._drawTop(half, half);

    /* خط جداکننده */
    ctx.strokeStyle = "rgba(148,163,184,0.15)";
    ctx.beginPath(); ctx.moveTo(half, 8); ctx.lineTo(half, h - 8); ctx.stroke();
  }

  _drawPanelChrome(x, y, pw, ph, label, off = 0) {
    const ctx = this.ctx;
    if (label) {
      ctx.font = "600 11px Vazirmatn, Tahoma, sans-serif";
      ctx.fillStyle = "rgba(148,163,184,0.8)";
      ctx.textAlign = "center";
      ctx.fillText(label, x + pw / 2, y + 18);
    }
  }

  /* ---------- نمای بغل ---------- */
  _drawSide(x0, pw) {
    const ctx = this.ctx, h = this.h;
    const margin = 26, groundY = h - 34;
    const worldH = 275;                       // mm قابل نمایش
    const s = (groundY - margin - 14) / worldH; // px per mm
    const cx = x0 + pw / 2;

    /* کلیپ به محدوده پنل */
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, pw, h);
    ctx.clip();

    /* زمین و شبکه */
    this._grid(x0, pw, groundY, s, cx);

    const g = this.geometry(this.display);
    const gt = this.geometry(this.target);

    const P = (pt) => ({ x: cx + pt.x * s, y: groundY - pt.z * s });

    /* محدوده‌ی دسترس‌پذیری */
    const maxR = FW.LINKS.L1 + FW.LINKS.L2 + FW.LINKS.L3;
    ctx.save();
    ctx.strokeStyle = "rgba(34,211,238,0.10)";
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(cx, groundY, maxR * s, Math.PI, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "10px Vazirmatn, Tahoma";
    ctx.fillStyle = "rgba(34,211,238,0.35)";
    ctx.textAlign = "left";
    ctx.fillText("R max " + maxR + "mm", cx + maxR * s * 0.62, groundY - maxR * s * 0.72);
    ctx.restore();

    /* رد حرکت */
    if (this.trail.length > 1) {
      ctx.save();
      ctx.lineWidth = 2;
      for (let i = 1; i < this.trail.length; i++) {
        const a = P(this.trail[i - 1]), b = P(this.trail[i]);
        ctx.strokeStyle = `rgba(167,139,250,${(i / this.trail.length) * 0.45})`;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
    }

    /* بازوی هدف (شبح) */
    this._drawArm(gt, P, s, { ghost: true });

    /* بازوی اصلی */
    this._drawArm(g, P, s, { ghost: false });

    /* پایه */
    this._drawBase(cx, groundY, s);

    /* HUD نوک */
    const tp = P(g.tip);
    ctx.font = "600 11px Vazirmatn, Tahoma";
    ctx.fillStyle = "rgba(226,232,240,0.95)";
    ctx.textAlign = "left";
    ctx.fillText(`R=${Math.round(g.r)}mm  Z=${Math.round(g.tip.z)}mm`, x0 + 10, h - 12);
    ctx.fillStyle = "#a78bfa";
    ctx.beginPath(); ctx.arc(tp.x, tp.y, 3.2, 0, 7); ctx.fill();
    ctx.restore(); /* پایان کلیپ پنل */
  }

  _grid(x0, pw, groundY, s, cx) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(148,163,184,0.08)";
    ctx.lineWidth = 1;
    for (let mm = 0; mm <= 275; mm += 50) {
      const y = groundY - mm * s;
      ctx.beginPath(); ctx.moveTo(x0 + 8, y); ctx.lineTo(x0 + pw - 8, y); ctx.stroke();
      ctx.font = "9px Vazirmatn, Tahoma";
      ctx.fillStyle = "rgba(148,163,184,0.45)";
      ctx.textAlign = "left";
      ctx.fillText(mm + "", x0 + pw - 26, y - 3);
    }
    /* خط زمین */
    ctx.strokeStyle = "rgba(148,163,184,0.4)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0 + 8, groundY); ctx.lineTo(x0 + pw - 8, groundY); ctx.stroke();
    ctx.restore();
  }

  _drawBase(cx, groundY, s) {
    const ctx = this.ctx;
    const bw = 30;
    /* شاسی */
    const grad = ctx.createLinearGradient(cx - bw, 0, cx + bw, 0);
    grad.addColorStop(0, "#1e293b"); grad.addColorStop(0.5, "#334155"); grad.addColorStop(1, "#1e293b");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(cx - bw, groundY - 10, bw * 2, 10, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(cx - 14, groundY - 22, 28, 12, 3);
    ctx.fill();
    /* چراغ وضعیت */
    const col = { READY: "#34d399", MOVING: "#22d3ee", HOMING: "#fbbf24", ESTOP: "#ef4444", ERROR: "#f87171", INIT: "#94a3b8" }[this.state] || "#94a3b8";
    const blink = this.state === "ESTOP" ? (Math.sin(this._pulse / 120) > 0 ? 1 : 0.25) : 1;
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 8 * blink;
    ctx.globalAlpha = blink;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(cx, groundY - 16, 2.6, 0, 7); ctx.fill();
    ctx.restore();
  }

  _drawArm(g, P, s, opts) {
    const ctx = this.ctx;
    const j2 = P(g.j2), j3 = P(g.j3), j4 = P(g.j4), tip = P(g.tip);
    const j2o = { x: j2.x, y: j2.y - 22 }; // بالای شاسی

    ctx.save();
    if (opts.ghost) {
      ctx.setLineDash([5, 5]);
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "rgba(148,163,184,0.7)";
      ctx.fillStyle = "rgba(148,163,184,0.35)";
      ctx.shadowBlur = 0;
    } else {
      const hot = this.state === "ESTOP";
      ctx.strokeStyle = hot ? "#f87171" : "#22d3ee";
      ctx.shadowColor = hot ? "#ef4444" : "#22d3ee";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#0ea5e9";
    }
    ctx.lineCap = "round";

    /* لینک‌ها */
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(j2o.x, j2o.y); ctx.lineTo(j3.x, j3.y); ctx.lineTo(j4.x, j4.y);
    ctx.stroke();

    /* مچ تا نوک */
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(j4.x, j4.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();

    if (!opts.ghost) {
      /* مفصل‌ها */
      for (const [j, r] of [[j2o, 6.5], [j3, 5.5], [j4, 4.5]]) {
        ctx.save();
        ctx.shadowColor = "#a78bfa"; ctx.shadowBlur = 10;
        const jg = ctx.createRadialGradient(j.x - 1.5, j.y - 1.5, 1, j.x, j.y, r);
        jg.addColorStop(0, "#e0e7ff"); jg.addColorStop(1, "#6366f1");
        ctx.fillStyle = jg;
        ctx.beginPath(); ctx.arc(j.x, j.y, r, 0, 7); ctx.fill();
        ctx.restore();
      }
      /* گیره */
      this._drawGripper(j4, tip, g.roll, opts);
    }
    ctx.restore();

    /* برچسب زوایا */
    if (!opts.ghost) {
      ctx.font = "600 10px Vazirmatn, Tahoma";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(34,211,238,0.95)";
      ctx.fillText(this.display[1].toFixed(0) + "°", j3.x, j3.y + 16);
      ctx.fillStyle = "rgba(167,139,250,0.95)";
      ctx.fillText(this.display[2].toFixed(0) + "°", j4.x + 2, j4.y + 14);
    }
  }

  _drawGripper(j4, tip, rollDeg, opts) {
    const ctx = this.ctx;
    const ang = Math.atan2(tip.y - j4.y, tip.x - j4.x);
    const roll = rollDeg * Math.PI / 180 * 0.35;
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(ang);
    ctx.strokeStyle = opts.ghost ? "rgba(148,163,184,0.7)" : "#fb923c";
    if (!opts.ghost) { ctx.shadowColor = "#fb923c"; ctx.shadowBlur = 8; }
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(9, sgn * (4 + roll * sgn * 4));
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- نمای بالا ---------- */
  _drawTop(x0, pw) {
    const ctx = this.ctx, h = this.h;
    const cy = h / 2 + 6;
    const maxR = (FW.LINKS.L1 + FW.LINKS.L2 + FW.LINKS.L3);
    const s = Math.min((pw / 2 - 22) / maxR, (h - 64) / (2 * maxR)) * 0.96;
    const cx = x0 + pw / 2;

    /* کلیپ به محدوده پنل */
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, pw, h);
    ctx.clip();

    const g = this.geometry(this.display);

    /* حلقه‌های فاصله */
    ctx.save();
    ctx.font = "9px Vazirmatn, Tahoma";
    for (const r of [100, 200, 250]) {
      if (r > maxR) continue;
      ctx.strokeStyle = "rgba(148,163,184,0.10)";
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.arc(cx, cy, r * s, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(148,163,184,0.4)";
      ctx.textAlign = "center";
      ctx.fillText(r + "", cx + r * s, cy - 3);
    }
    /* قطب‌نما */
    ctx.strokeStyle = "rgba(148,163,184,0.25)";
    ctx.beginPath(); ctx.moveTo(cx - maxR * s - 6, cy); ctx.lineTo(cx + maxR * s + 6, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - maxR * s - 6); ctx.lineTo(cx, cy + maxR * s + 6); ctx.stroke();

    /* قطاع محدوده‌ی پایه −110..+110 */
    const D = Math.PI / 180;
    const a0 = -110 * D - Math.PI / 2, a1 = 110 * D - Math.PI / 2;
    ctx.fillStyle = "rgba(34,211,238,0.06)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxR * s, a0, a1);
    ctx.closePath();
    ctx.fill();

    /* بازو (نمای بالا) — قرارداد: 0° به سمت بالا، مثبت ساعتگرد */
    const yaw = g.yaw * D;
    const len = Math.max(18, g.r * s);
    const tx = cx + Math.sin(yaw) * len;
    const ty = cy - Math.cos(yaw) * len;
    const hot = this.state === "ESTOP";
    ctx.save();
    ctx.strokeStyle = hot ? "#f87171" : "#22d3ee";
    ctx.shadowColor = hot ? "#ef4444" : "#22d3ee";
    ctx.shadowBlur = 12;
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.restore();

    /* هدف شبح */
    const gt = this.geometry(this.target);
    const yawT = gt.yaw * D, lenT = Math.max(18, gt.r * s);
    const t2x = cx + Math.sin(yawT) * lenT;
    const t2y = cy - Math.cos(yawT) * lenT;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(148,163,184,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(t2x, t2y); ctx.stroke();
    ctx.restore();

    /* چرخش رول ابزار J5 */
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(g.roll * D);
    ctx.strokeStyle = "#fb923c";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(3.5, -3); ctx.moveTo(7, 0); ctx.lineTo(3.5, 3); ctx.stroke();
    ctx.restore();

    /* برچسب زاویه پایه */
    ctx.font = "600 11px Vazirmatn, Tahoma";
    ctx.fillStyle = "rgba(34,211,238,0.95)";
    ctx.textAlign = "center";
    ctx.fillText("J1: " + g.yaw.toFixed(1) + "°", cx, h - 12);
    ctx.fillStyle = "rgba(251,146,60,0.95)";
    ctx.fillText("J5: " + g.roll.toFixed(0) + "°", x0 + 24, h - 12);

    /* پایه */
    const bg2 = ctx.createRadialGradient(cx, cy, 2, cx, cy, 16);
    bg2.addColorStop(0, "#6366f1"); bg2.addColorStop(1, "#1e293b");
    ctx.fillStyle = bg2;
    ctx.beginPath(); ctx.arc(cx, cy, 13, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(226,232,240,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 17, 0, 7); ctx.stroke();
    ctx.restore();
    ctx.restore(); /* پایان کلیپ پنل */
  }
}
