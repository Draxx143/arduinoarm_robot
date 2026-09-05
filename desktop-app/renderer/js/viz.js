/* ============================================================
 * viz.js — Interactive 2D engineering visualizer
 * Side + top views, metallic links, angle arcs, shadows,
 * crosshair targets, motion trail and DRAG-TO-POSE joints.
 * ============================================================ */
"use strict";

class ArmViz {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.current = [0, 0, 0, 0, 0];
    this.target = [0, 0, 0, 0, 0];
    this.display = [0, 0, 0, 0, 0];
    this.state = "INIT";
    this.trail = [];
    this._lastTip = null;
    this._pulse = 0;
    this._drag = null;          // {joint, } while user drags a joint
    this._hover = null;         // joint index under cursor
    this._hintFade = 1;         // drag-hint opacity
    this.onTargetDrag = null;   // callback(targets5) while dragging
    this.onDragEnd = null;      // callback() on pointer release
    this._side = null;          // cached side-view screen geometry
    this._top = null;           // cached top-view screen geometry
    this._resize();
    window.addEventListener("resize", () => this._resize());
    canvas.addEventListener("pointerdown", (e) => this._pDown(e));
    canvas.addEventListener("pointermove", (e) => this._pMove(e));
    window.addEventListener("pointerup", (e) => this._pUp(e));
    canvas.addEventListener("pointerleave", () => { if (!this._drag) { this._hover = null; this.canvas.style.cursor = "default"; } });
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

  /* FK chain (mirrors Kin.fk) */
  geometry(angles) {
    const D = Math.PI / 180;
    const { L1, L2, L3 } = FW.LINKS;
    const a0 = angles[0] * D, a1 = angles[1] * D, a2 = angles[2] * D, a4 = angles[3] * D;
    const j2 = { x: 0, z: 0 };
    const j3 = { x: L1 * Math.cos(a1), z: L1 * Math.sin(a1) };
    const j4 = { x: j3.x + L2 * Math.cos(a1 - a2), z: j3.z + L2 * Math.sin(a1 - a2) };
    const dir = a1 - a2 - a4;
    const tip = { x: j4.x + L3 * Math.cos(dir), z: j4.z + L3 * Math.sin(dir) };
    return { j2, j3, j4, tip, r: Math.hypot(tip.x, tip.z), yaw: angles[0], roll: angles[4] };
  }

  frame(dtMs) {
    if (!this.w) this._resize();
    const k = 1 - Math.pow(0.0025, dtMs / 1000);
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

  /* ---------------- pointer interaction ---------------- */
  _pt(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  _pDown(e) {
    if (this.w < 10) return;
    const p = this._pt(e);
    const S = this._side, T = this._top;
    /* top view: base rotation ring */
    if (T) {
      const d = Math.hypot(p.x - T.cx, p.y - T.cy);
      if (d < T.rMax && d > 6) { this._drag = { joint: 0 }; this._pMove(e); return; }
    }
    if (S) {
      const cands = [[1, S.j2o], [2, S.j3], [3, S.j4]];
      let best = null, bd = 18;
      for (const [j, pt] of cands) {
        const d = Math.hypot(p.x - pt.x, p.y - pt.y);
        if (d < bd) { bd = d; best = j; }
      }
      if (best !== null) { this._drag = { joint: best }; this._pMove(e); return; }
    }
  }
  _pMove(e) {
    const p = this._pt(e);
    if (!this._drag) {
      /* hover affordance */
      const S = this._side, T = this._top;
      let hov = null;
      if (S) {
        for (const [j, pt] of [[1, S.j2o], [2, S.j3], [3, S.j4]]) {
          if (Math.hypot(p.x - pt.x, p.y - pt.y) < 16) { hov = j; break; }
        }
      }
      if (!hov && T && Math.hypot(p.x - T.cx, p.y - T.cy) < T.rMax) hov = 0;
      this._hover = hov;
      this.canvas.style.cursor = hov !== null ? "grab" : "default";
      return;
    }
    this.canvas.style.cursor = "grabbing";
    const j = this._drag.joint;
    const D = 180 / Math.PI;
    const t = this.target.slice();
    const A = FW.AXES;
    if (j === 0 && this._top) {
      const { cx, cy } = this._top;
      t[0] = Math.max(A[0].min, Math.min(A[0].max, Math.atan2(p.x - cx, -(p.y - cy)) * D));
    } else if (j === 1 && this._side) {
      const { j2o } = this._side;
      t[1] = Math.max(A[1].min, Math.min(A[1].max, Math.atan2(-(p.y - j2o.y), p.x - j2o.x) * D));
    } else if (j === 2 && this._side) {
      const { j3 } = this._side;
      const phi = Math.atan2(-(p.y - j3.y), p.x - j3.x) * D;
      t[2] = Math.max(A[2].min, Math.min(A[2].max, t[1] - phi));
    } else if (j === 3 && this._side) {
      const { j4 } = this._side;
      const phi = Math.atan2(-(p.y - j4.y), p.x - j4.x) * D;
      t[3] = Math.max(A[3].min, Math.min(A[3].max, (t[1] - t[2]) - phi));
    } else return;
    this.target = t;
    this._hintFade = Math.max(0, this._hintFade - 0.05);
    if (this.onTargetDrag) this.onTargetDrag(t);
  }
  _pUp() {
    if (this._drag) {
      this._drag = null;
      this.canvas.style.cursor = this._hover !== null ? "grab" : "default";
      if (this.onDragEnd) this.onDragEnd();
    }
  }

  /* ---------------- render ---------------- */
  _render() {
    const ctx = this.ctx, w = this.w, h = this.h;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "rgba(10,14,20,0.9)");
    bg.addColorStop(1, "rgba(6,9,14,0.95)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const half = w / 2;
    this._label(half / 2, 16, "SIDE VIEW — drag joints");
    this._label(half + half / 2, 16, "TOP VIEW — drag to rotate");
    this._drawSide(0, half);
    this._drawTop(half, half);
    ctx.strokeStyle = "rgba(148,163,184,0.15)";
    ctx.beginPath(); ctx.moveTo(half, 6); ctx.lineTo(half, h - 6); ctx.stroke();
  }

  _label(x, y, text) {
    const ctx = this.ctx;
    ctx.font = "700 10px " + "'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(154,167,181,0.75)";
    ctx.textAlign = "center";
    ctx.fillText(text, x, y);
  }

  /* capsule (thick round line) */
  _capsule(x1, y1, x2, y2, wd, fill, shadow) {
    const ctx = this.ctx;
    ctx.save();
    if (shadow) { ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 5; }
    ctx.strokeStyle = fill; ctx.lineWidth = wd; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  /* metallic link: gradient perpendicular to axis + edge highlight */
  _link(x1, y1, x2, y2, wd, hue) {
    const ctx = this.ctx;
    /* drop shadow */
    this._capsule(x1, y1 + 4, x2, y2 + 4, wd, "rgba(0,0,0,0.28)", false);
    const nx = -(y2 - y1), ny = x2 - x1;
    const nl = Math.hypot(nx, ny) || 1;
    const g = ctx.createLinearGradient(x1 - nx / nl * wd / 2, y1 - ny / nl * wd / 2, x1 + nx / nl * wd / 2, y1 + ny / nl * wd / 2);
    g.addColorStop(0, "#5b6675");
    g.addColorStop(0.28, hue);
    g.addColorStop(0.55, "#39424f");
    g.addColorStop(1, "#1c232e");
    this._capsule(x1, y1, x2, y2, wd, g, false);
    /* edge highlight */
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x1 - nx / nl * (wd * 0.28), y1 - ny / nl * (wd * 0.28));
    ctx.lineTo(x2 - nx / nl * (wd * 0.28), y2 - ny / nl * (wd * 0.28)); ctx.stroke();
    ctx.restore();
  }

  _joint(x, y, r, color, deg) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
    g.addColorStop(0, "#f2f5f9"); g.addColorStop(0.5, "#9aa7b5"); g.addColorStop(1, "#39424f");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.restore();
    /* colored hub */
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath(); ctx.arc(x - r * 0.12, y - r * 0.12, r * 0.12, 0, 7); ctx.fill();
    if (deg !== undefined) {
      ctx.font = "700 9.5px Consolas, monospace";
      ctx.fillStyle = color; ctx.textAlign = "center";
      ctx.fillText(deg.toFixed(0) + "°", x, y + r + 12);
    }
  }

  /* angle arc between parent direction and current link direction */
  _angleArc(x, y, parentDeg, curDeg, min, max, color) {
    const ctx = this.ctx;
    const D = Math.PI / 180;
    const a0 = -parentDeg * D, a1 = -curDeg * D; /* screen y inverted */
    /* limit sector */
    ctx.save();
    ctx.fillStyle = color + "14";
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.arc(x, y, 26, -max * D, -min * D);
    ctx.closePath(); ctx.fill();
    /* value arc */
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(x, y, 15, a0, a1, a1 > a0); ctx.stroke();
    ctx.restore();
  }

  /* ---------------- SIDE VIEW ---------------- */
  _drawSide(x0, pw) {
    const ctx = this.ctx, h = this.h;
    const margin = 30, groundY = h - 36;
    const worldH = 275;
    const s = (groundY - margin - 16) / worldH;
    const cx = x0 + pw / 2;

    ctx.save();
    ctx.beginPath(); ctx.rect(x0, 0, pw, h); ctx.clip();

    /* grid + reach arcs */
    ctx.strokeStyle = "rgba(148,163,184,0.07)"; ctx.lineWidth = 1;
    for (let mm = 50; mm <= 250; mm += 50) {
      const y = groundY - mm * s;
      ctx.beginPath(); ctx.moveTo(x0 + 8, y); ctx.lineTo(x0 + pw - 8, y); ctx.stroke();
      ctx.font = "8.5px Consolas, monospace"; ctx.fillStyle = "rgba(148,163,184,0.4)";
      ctx.textAlign = "right"; ctx.fillText(mm, x0 + pw - 12, y - 2);
    }
    const maxR = FW.LINKS.L1 + FW.LINKS.L2 + FW.LINKS.L3;
    ctx.strokeStyle = "rgba(0,194,209,0.12)"; ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.arc(cx, groundY, maxR * s, Math.PI, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]);

    /* hatched ground */
    ctx.save();
    ctx.strokeStyle = "rgba(154,167,181,0.35)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x0 + 6, groundY); ctx.lineTo(x0 + pw - 6, groundY); ctx.stroke();
    ctx.strokeStyle = "rgba(154,167,181,0.14)";
    for (let x = x0 + 10; x < x0 + pw - 6; x += 9) {
      ctx.beginPath(); ctx.moveTo(x, groundY + 1); ctx.lineTo(x - 6, groundY + 8); ctx.stroke();
    }
    ctx.restore();

    const g = this.geometry(this.display);
    const gt = this.geometry(this.target);
    const P = (pt) => ({ x: cx + pt.x * s, y: groundY - pt.z * s });

    /* trail */
    for (let i = 1; i < this.trail.length; i++) {
      const a = P(this.trail[i - 1]), b = P(this.trail[i]);
      ctx.strokeStyle = `rgba(158,134,255,${(i / this.trail.length) * 0.4})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    /* base machine */
    this._drawBaseSide(cx, groundY, s);

    const j2 = P(g.j2), j3 = P(g.j3), j4 = P(g.j4), tip = P(g.tip);
    const j2o = { x: j2.x, y: j2.y - 20 };
    const D = 180 / Math.PI;

    /* ghost target arm */
    const tg = this.geometry(this.target);
    const t2 = P(tg.j3), t3 = P(tg.j4), tt = P(tg.tip);
    const tj2 = { x: j2.x, y: j2.y - 20 };
    ctx.save(); ctx.setLineDash([5, 4]); ctx.globalAlpha = 0.5;
    this._capsule(tj2.x, tj2.y, t2.x, t2.y, 7, "rgba(154,167,181,0.8)", false);
    this._capsule(t2.x, t2.y, t3.x, t3.y, 6, "rgba(154,167,181,0.8)", false);
    this._capsule(t3.x, t3.y, tt.x, tt.y, 3.5, "rgba(154,167,181,0.8)", false);
    ctx.restore();
    /* target crosshair */
    ctx.save();
    ctx.strokeStyle = "rgba(255,176,32,0.85)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(tt.x, tt.y, 7, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tt.x - 11, tt.y); ctx.lineTo(tt.x - 3, tt.y);
    ctx.moveTo(tt.x + 3, tt.y); ctx.lineTo(tt.x + 11, tt.y);
    ctx.moveTo(tt.x, tt.y - 11); ctx.lineTo(tt.x, tt.y - 3);
    ctx.moveTo(tt.x, tt.y + 3); ctx.lineTo(tt.x, tt.y + 11); ctx.stroke();
    ctx.font = "9px Consolas, monospace"; ctx.fillStyle = "rgba(255,176,32,0.9)"; ctx.textAlign = "left";
    ctx.fillText("TGT", tt.x + 13, tt.y - 6);
    ctx.restore();

    /* links: shoulder, forearm, wrist */
    const hot = this.state === "ESTOP";
    const linkHue = hot ? "#7e3b3b" : "#4b5a70";
    this._link(j2o.x, j2o.y, j3.x, j3.y, 11, linkHue);
    this._link(j3.x, j3.y, j4.x, j4.y, 9, linkHue);
    this._link(j4.x, j4.y, tip.x, tip.y, 5.5, hot ? "#7e3b3b" : "#5b6b82");
    /* wrist roll indicator */
    const ang = Math.atan2(tip.y - j4.y, tip.x - j4.x);
    ctx.save(); ctx.translate(tip.x, tip.y); ctx.rotate(ang + g.roll * Math.PI / 180 * 0.5);
    ctx.strokeStyle = "#ff7a1a"; ctx.lineWidth = 2.2; ctx.lineCap = "round";
    for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(8, sg * 4.5); ctx.stroke(); }
    ctx.restore();

    /* angle arcs (relative to parent link direction) */
    this._angleArc(j2o.x, j2o.y, 0, this.target[1], FW.AXES[1].min, FW.AXES[1].max, "#00c2d1");
    this._angleArc(j3.x, j3.y, this.target[1], this.target[1] - this.target[2], FW.AXES[2].min, FW.AXES[2].max, "#ffb020");
    this._angleArc(j4.x, j4.y, this.target[1] - this.target[2], this.target[3], FW.AXES[3].min, FW.AXES[3].max, "#3fb950");

    /* joints */
    const hv = (i) => (this._hover === i || (this._drag && this._drag.joint === i));
    this._joint(j2o.x, j2o.y, hv(1) ? 8 : 6.5, "#00c2d1", hv(1) ? this.target[1] : undefined);
    this._joint(j3.x, j3.y, hv(2) ? 7.5 : 6, "#ffb020", hv(2) ? this.target[2] : undefined);
    this._joint(j4.x, j4.y, hv(3) ? 6.5 : 5, "#3fb950", hv(3) ? this.target[3] : undefined);

    /* gripper claws at tip */
    ctx.save();
    ctx.translate(tip.x, tip.y); ctx.rotate(ang);
    ctx.strokeStyle = "#ff7a1a"; ctx.lineWidth = 2; ctx.lineCap = "round";
    for (const sg of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(6, sg * 3);
      ctx.lineTo(11, sg * 6); ctx.stroke();
    }
    ctx.restore();

    /* status LED on base */
    const col = { READY: "#3fb950", MOVING: "#00c2d1", HOMING: "#ffb020", ESTOP: "#e5484d", ERROR: "#ff6b35", INIT: "#8b949e" }[this.state] || "#8b949e";
    const blink = this.state === "ESTOP" ? (Math.sin(this._pulse / 120) > 0 ? 1 : 0.25) : 1;
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 8 * blink; ctx.globalAlpha = blink;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx + 18, groundY - 24, 2.6, 0, 7); ctx.fill();
    ctx.restore();

    /* HUD */
    ctx.font = "700 10px Consolas, monospace"; ctx.fillStyle = "rgba(230,235,242,0.9)"; ctx.textAlign = "left";
    ctx.fillText(`R=${Math.round(g.r)}  Z=${Math.round(g.tip.z)}mm`, x0 + 10, h - 12);
    ctx.fillStyle = "rgba(154,167,181,0.6)";
    ctx.fillText(`TGT R=${Math.round(gt.r)}  Z=${Math.round(gt.tip.z)}`, x0 + 10, h - 24);

    /* drag hint */
    if (this._hintFade > 0) {
      ctx.fillStyle = `rgba(255,176,32,${0.75 * this._hintFade})`;
      ctx.font = "700 10px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
      ctx.fillText("← grab a joint and drag →", cx, groundY - maxR * s * 0.1);
    }

    /* cache geometry for hit-testing */
    this._side = { cx, groundY, s, j2o, j3, j4 };
    ctx.restore();
  }

  _drawBaseSide(cx, groundY, s) {
    const ctx = this.ctx;
    /* floor shadow */
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(cx, groundY + 3, 42, 6, 0, 0, 7); ctx.fill();
    /* plinth */
    const g = ctx.createLinearGradient(cx - 34, 0, cx + 34, 0);
    g.addColorStop(0, "#232b37"); g.addColorStop(0.5, "#3d4956"); g.addColorStop(1, "#1c232e");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(cx - 34, groundY - 9, 68, 9, 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx - 17, groundY - 20, 34, 11, 2); ctx.fill();
    /* bolts */
    ctx.fillStyle = "#141a22";
    for (const bx of [-27, -9, 9, 27]) { ctx.beginPath(); ctx.arc(cx + bx, groundY - 4.5, 1.6, 0, 7); ctx.fill(); }
    ctx.restore();
  }

  /* ---------------- TOP VIEW ---------------- */
  _drawTop(x0, pw) {
    const ctx = this.ctx, h = this.h;
    const cy = h / 2 + 8;
    const maxR = FW.LINKS.L1 + FW.LINKS.L2 + FW.LINKS.L3;
    const s = Math.min((pw / 2 - 24) / maxR, (h - 66) / (2 * maxR)) * 0.96;
    const cx = x0 + pw / 2;

    ctx.save();
    ctx.beginPath(); ctx.rect(x0, 0, pw, h); ctx.clip();
    const g = this.geometry(this.display);
    const gt = this.geometry(this.target);
    const D = Math.PI / 180;

    /* range ring */
    ctx.strokeStyle = "rgba(0,194,209,0.15)"; ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.arc(cx, cy, maxR * s, 0, 7); ctx.stroke();
    ctx.setLineDash([]);

    /* degree ticks every 30° */
    ctx.font = "8px Consolas, monospace"; ctx.textAlign = "center";
    for (let d = -90; d <= 90; d += 30) {
      const r1 = maxR * s + 4, r2 = maxR * s + 9;
      const tx = cx + Math.sin(d * D) * r1, ty = cy - Math.cos(d * D) * r1;
      const tx2 = cx + Math.sin(d * D) * r2, ty2 = cy - Math.cos(d * D) * r2;
      ctx.strokeStyle = "rgba(154,167,181,0.4)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx2, ty2); ctx.stroke();
      const tl = maxR * s + 18;
      ctx.fillStyle = "rgba(154,167,181,0.55)";
      ctx.fillText(d + "°", cx + Math.sin(d * D) * tl, cy - Math.cos(d * D) * tl + 3);
    }

    /* allowed sector -110..110 */
    ctx.fillStyle = "rgba(0,194,209,0.05)";
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxR * s, (-110 - 90) * D + Math.PI / 2, (110 - 90) * D + Math.PI / 2);
    ctx.closePath(); ctx.fill();

    /* cross hairs */
    ctx.strokeStyle = "rgba(154,167,181,0.2)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - maxR * s - 8, cy); ctx.lineTo(cx + maxR * s + 8, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - maxR * s - 8); ctx.lineTo(cx, cy + maxR * s + 8); ctx.stroke();

    /* ghost ray */
    const yawT = gt.yaw * D, lenT = Math.max(20, gt.r * s);
    const gx = cx + Math.sin(yawT) * lenT, gy = cy - Math.cos(yawT) * lenT;
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = "rgba(154,167,181,0.65)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(gx, gy); ctx.stroke();
    ctx.setLineDash([]);
    /* arc arrow current→target */
    if (Math.abs(gt.yaw - g.yaw) > 2) {
      ctx.strokeStyle = "rgba(255,176,32,0.8)"; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(lenT, maxR * s) * 0.45, -(g.yaw + 90) * D, -(gt.yaw + 90) * D, gt.yaw > g.yaw);
      ctx.stroke();
    }
    ctx.restore();

    /* arm wedge */
    const yaw = g.yaw * D, len = Math.max(20, g.r * s);
    const tx = cx + Math.sin(yaw) * len, ty = cy - Math.cos(yaw) * len;
    const hot = this.state === "ESTOP";
    const per = yaw + Math.PI / 2;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;
    const wg = ctx.createLinearGradient(cx, cy, tx, ty);
    wg.addColorStop(0, hot ? "#5a3033" : "#39424f");
    wg.addColorStop(1, hot ? "#7e3b3b" : "#4b5a70");
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(per) * 11, cy - Math.sin(per) * 11);
    ctx.lineTo(tx + Math.cos(per) * 3.5, ty - Math.sin(per) * 3.5);
    ctx.lineTo(tx - Math.cos(per) * 3.5, ty + Math.sin(per) * 3.5);
    ctx.lineTo(cx - Math.cos(per) * 11, cy + Math.sin(per) * 11);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    /* center spine */
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();

    /* tool + roll */
    ctx.save(); ctx.translate(tx, ty); ctx.rotate(g.roll * D);
    ctx.strokeStyle = "#ff7a1a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(7, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(3.5, -3); ctx.moveTo(7, 0); ctx.lineTo(3.5, 3); ctx.stroke();
    ctx.restore();

    /* base disc */
    const bg2 = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, 17);
    bg2.addColorStop(0, "#9aa7b5"); bg2.addColorStop(0.6, "#39424f"); bg2.addColorStop(1, "#1c232e");
    ctx.fillStyle = bg2;
    ctx.beginPath(); ctx.arc(cx, cy, 14, 0, 7); ctx.fill();
    ctx.fillStyle = "#00c2d1";
    ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(230,235,242,0.35)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, 18, 0, 7); ctx.stroke();
    ctx.fillStyle = "#141a22";
    for (let b = 0; b < 6; b++) {
      const ba = b * Math.PI / 3 + Math.PI / 6;
      ctx.beginPath(); ctx.arc(cx + Math.cos(ba) * 11, cy + Math.sin(ba) * 11, 1.4, 0, 7); ctx.fill();
    }

    /* base angle label */
    ctx.font = "700 10px Consolas, monospace"; ctx.textAlign = "center";
    ctx.fillStyle = "#00c2d1";
    ctx.fillText("J1 " + g.yaw.toFixed(1) + "°", cx, h - 12);
    ctx.fillStyle = "rgba(255,122,26,0.9)";
    ctx.textAlign = "left";
    ctx.fillText("J5 " + g.roll.toFixed(0) + "°", x0 + 10, h - 12);

    this._top = { cx, cy, s, rMax: maxR * s + 14 };
    ctx.restore();
  }
}
