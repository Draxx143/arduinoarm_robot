/* ============================================================
 * viz.js — Compact industrial telemetry panel (DOM-based)
 * Replaces the old 2D canvas drawing: per-joint digital readouts,
 * position scales with target markers, live speeds and the
 * FK tool position. Crisp at any DPI, zero canvas.
 * ============================================================ */
"use strict";

class ArmViz {
  constructor(containerId) {
    this.root = document.getElementById(containerId);
    this.current = [0, 0, 0, 0, 0];
    this.target = [0, 0, 0, 0, 0];
    this.vel = [0, 0, 0, 0, 0];
    this.state = "INIT";
    this._lastA = null;
    this._lastEv = Date.now();
    this._dirty = true;
    this._els = [];
    this._tcp = {};
    this._build();
  }

  /* ---------- public API (same surface as before) ---------- */
  setAngles(deg5) {
    const now = Date.now();
    const dt = (now - this._lastEv) / 1000;
    if (this._lastA && dt > 0.15) {
      for (let i = 0; i < 5; i++) {
        const inst = Math.abs(deg5[i] - this._lastA[i]) / dt;
        if (Math.abs(deg5[i] - this._lastA[i]) > 0.05) {
          this.vel[i] = this.vel[i] * 0.45 + inst * 0.55;
        } else {
          this.vel[i] *= 0.6;
        }
      }
    }
    this._lastA = deg5.slice();
    this._lastEv = now;
    this.current = deg5.slice();
    this._dirty = true;
  }
  setTargets(deg5) { this.target = deg5.slice(); this._dirty = true; }
  setState(s) { this.state = s; this._dirty = true; }
  frame() { if (this._dirty) { this._render(); this._dirty = false; } }

  /* ---------- build ---------- */
  _build() {
    this.root.innerHTML = "";
    this.root.classList.add("tele");
    const cols = ["#00c2d1", "#ffb020", "#ff7a1a", "#3fb950", "#9e86ff"];

    for (let i = 0; i < 5; i++) {
      const ax = FW.AXES[i];
      const row = document.createElement("div");
      row.className = "tele-row";
      row.innerHTML = `
        <div class="tele-j"><b style="color:${cols[i]}">J${ax.joint}</b><span>${ax.name}</span></div>
        <div class="tele-dro"><b>0.0°</b><i>→ 0.0°</i></div>
        <div class="tele-scale">
          <i class="fill" style="background:${cols[i]}"></i>
          <i class="mark"></i>
          <em class="lo">${ax.min}°</em><em class="hi">${ax.max}°</em>
        </div>
        <div class="tele-spd">—</div>`;
      this.root.appendChild(row);
      this._els.push({
        dro: row.querySelector(".tele-dro b"),
        tgt: row.querySelector(".tele-dro i"),
        fill: row.querySelector(".fill"),
        mark: row.querySelector(".mark"),
        spd: row.querySelector(".tele-spd"),
        row,
      });
    }

    /* FK tool position block */
    const tcp = document.createElement("div");
    tcp.className = "tele-tcp";
    tcp.innerHTML = `
      <div class="tele-tcp-h">TOOL POSITION <span>FK · mm</span></div>
      <div class="tele-chips">
        <span class="chip-hud" id="hudX">X —</span>
        <span class="chip-hud" id="hudY">Y —</span>
        <span class="chip-hud" id="hudZ">Z —</span>
        <span class="chip-hud" id="hudReach">R —</span>
      </div>
      <div class="tele-chips dim">
        <span class="chip-hud" id="hudTX">tX —</span>
        <span class="chip-hud" id="hudTY">tY —</span>
        <span class="chip-hud" id="hudTZ">tZ —</span>
        <span class="chip-hud" id="hudTR">tR —</span>
      </div>`;
    this.root.appendChild(tcp);
    ["hudX", "hudY", "hudZ", "hudReach", "hudTX", "hudTY", "hudTZ", "hudTR"]
      .forEach((id) => (this._tcp[id] = document.getElementById(id)));
  }

  /* ---------- render (throttled by frame()) ---------- */
  _render() {
    for (let i = 0; i < 5; i++) {
      const ax = FW.AXES[i], e = this._els[i];
      const cur = this.current[i], tgt = this.target[i];
      const span = ax.max - ax.min || 1;
      const pct = Math.max(0, Math.min(100, ((cur - ax.min) / span) * 100));
      const pctT = Math.max(0, Math.min(100, ((tgt - ax.min) / span) * 100));
      e.dro.textContent = cur.toFixed(1) + "°";
      e.tgt.textContent = "→ " + tgt.toFixed(1) + "°";
      e.fill.style.width = pct + "%";
      e.mark.style.left = pctT + "%";
      const moving = Math.abs(cur - tgt) > 0.3;
      e.row.classList.toggle("moving", moving);
      const v = this.vel[i];
      e.spd.textContent = moving && v > 1 ? v.toFixed(0) + "°/s" : (moving ? "…" : "0");
      e.spd.classList.toggle("on", moving);
    }

    /* FK tool position */
    if (typeof Kin !== "undefined") {
      const p = Kin.fk(this.current);
      const t = Kin.fk(this.target);
      const f = (v) => Math.round(v);
      if (this._tcp.hudX) {
        this._tcp.hudX.textContent = "X " + f(p.x);
        this._tcp.hudY.textContent = "Y " + f(p.y);
        this._tcp.hudZ.textContent = "Z " + f(p.z);
        this._tcp.hudReach.textContent = "R " + f(p.reach);
        this._tcp.hudTX.textContent = "tX " + f(t.x);
        this._tcp.hudTY.textContent = "tY " + f(t.y);
        this._tcp.hudTZ.textContent = "tZ " + f(t.z);
        this._tcp.hudTR.textContent = "tR " + f(t.reach);
      }
    }

    /* state accent */
    const col = (FW.STATES[this.state] || FW.STATES.INIT).color;
    this.root.style.setProperty("--tele-accent", col);
  }
}
