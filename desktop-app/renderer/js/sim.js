/* ============================================================
 * sim.js — In-app firmware simulator for RobotArm_Firmware.ino
 * Behaviour and message formats are identical to the Arduino code so
 * the whole UI can be tested without hardware.
 * ============================================================ */
"use strict";

class SimFirmware {
  constructor(onLine) {
    this.onLine = onLine;
    this.bootAt = Date.now();
    this.resetAll();
  }

  resetAll() {
    this.ackMode = false;
    this.pos = [0, 0, 0, 0, 0];        // استپ
    this.target = [0, 0, 0, 0, 0];
    this.vel = [0, 0, 0, 0, 0];
    this.enabled = [true, true, true, true, true];
    this.homed = [false, false, false, false, false];
    this.state = "INIT";
    this.profile = 1; // NORMAL
    this.sleeping = false;
    this.autoSleep = false;
    this.lastActivity = Date.now();

    this.slots = new Array(FW.MAX_POSITIONS).fill(null);
    this.timers = [];
    this.teachSteps = [];
    this.recording = false;
    this.playing = false;
    this.playIdx = 0;
    this.playNextAt = 0;

    this.demoRunning = false;
    this.demoStep = 0;
    this.demoRepeat = 0;
    this.lastDemoAt = 0;

    this.logEnabled = false;
    this.logRing = [];

    this.homingQueue = [];
    this.homingPhase = null; // {phase:'seek'|'back', axis, until}
    this.estopped = false;   /* v1.0.36: latch like Axis::_emergencyStop */
    this.nudge = null;       /* v1.0.36: {stage:'out'|'hold'|'back'} J2/J3 choreography */
    this._lastTick = Date.now();
  }

  /* ---------- ابزار ---------- */
  emit(line) { if (this.onLine) this.onLine(line); }
  emitMany(lines) { lines.forEach((l) => this.emit(l)); }
  millis() { return Date.now() - this.bootAt; }
  mult() { return FW.PROFILES[this.profile].mult; }
  isMoving() { return this.pos.some((p, i) => p !== this.target[i]); }
  allHomed() { return this.homed.every((h) => h); }
  setState(s) { this.state = s; }

  moveToAxis(i, steps) {
    if (this.state === "ESTOP") { this.emit("!! E-STOP active - send 'reset' or 'home' first."); return; }
    if (this.sleeping) { this.emit("!! Sleeping - send 'wake' before moving"); return; }
    const a = FW.AXES[i];
    steps = Math.max(a.soft.min, Math.min(a.soft.max, Math.round(steps)));
    this.target[i] = steps;
    this.lastActivity = Date.now();
  }
  moveAll(steps5) { for (let i = 0; i < 5; i++) this.moveToAxis(i, steps5[i]); }

  degToSteps(i, deg) { return Math.round(deg * FW.AXES[i].stepsPerDeg); }

  /* v1.0.36: UI-sync channel - identical to the firmware */
  emitPosFromSteps(steps5) {
    const d = steps5.map((st, i) => (st / FW.AXES[i].stepsPerDeg).toFixed(1));
    this.emit(">> POS " + d.join(","));
  }
  emitPosCurrent() { this.emitPosFromSteps(this.pos.map(Math.round)); }
  emitPosTargetSingle(axis, steps) {
    const cur = [...this.pos].map(Math.round);
    cur[axis] = Math.round(steps);
    this.emitPosFromSteps(cur);
  }

  /* ---------- حلقه‌ی زمانی (هر ~۵۰ms صدا زده می‌شود) ---------- */
  tick() {
    const now = Date.now();
    const dt = Math.min(0.2, (now - this._lastTick) / 1000);
    this._lastTick = now;

    /* حرکت فیزیکی محورها با شیب شتاب */
    for (let i = 0; i < 5; i++) {
      const a = FW.AXES[i];
      if (!this.enabled[i]) { this.vel[i] = 0; continue; }
      /* محورِ در حال هوم را حلقه‌ی عادی جابه‌جا نمی‌کند */
      if (this.homingPhase && this.homingPhase.axis === i) continue;
      const diff = this.target[i] - this.pos[i];
      if (diff === 0) { this.vel[i] = 0; continue; }
      const maxV = a.maxSpeed * this.mult();
      const acc = a.accel * this.mult();
      let v = this.vel[i];
      const dir = Math.sign(diff);
      v += dir * acc * dt;
      v = Math.max(-maxV, Math.min(maxV, v));
      /* اگر در فاصله‌ی ترمز هستیم کمتر کنیم (شبه‌ذوزنجه) */
      const stopDist = (v * v) / (2 * acc);
      if (Math.abs(diff) <= stopDist) v = dir * Math.max(0, Math.sqrt(2 * acc * Math.abs(diff)));
      const step = v * dt;
      if (Math.abs(step) >= Math.abs(diff)) {
        this.pos[i] = this.target[i];
        this.vel[i] = 0;
      } else {
        this.pos[i] += step;
        this.vel[i] = v;
      }
    }

    /* هومینگ ترتیبی */
    if (this.homingPhase) this._tickHoming(now);
    else if (this.nudge) this._tickNudge(now);
    else if (this.state === "HOMING" && !this.homingPhase && this.homingQueue.length === 0) {
      /* شروع صف هومینگ */
      this._startHoming();
    }

    /* گذار وضعیت حرکت */
    if ((this.state === "READY" || this.state === "INIT") && this.isMoving()) {
      this.setState("MOVING");
    }
    if (this.state === "MOVING" && !this.isMoving()) {
      this.setState("READY");
      this.emit(">> Move complete.");
      this.emitPosCurrent();
    }

    /* دمو */
    if (this.demoRunning) this._tickDemo(now);

    /* پخش آموزش */
    if (this.playing) this._tickPlay(now);

    /* تایمرها */
    for (const t of this.timers) {
      if (!t.fired && now >= t.fireAt) {
        t.fired = true;
        this.moveToAxis(t.axis, t.target);
        this.emit(`>> Timer fired: axis ${t.axis + 1}`);
        this.emitPosTargetSingle(t.axis, t.target);
      }
    }
    this.timers = this.timers.filter((t) => !t.fired);

    /* خواب خودکار */
    if (this.autoSleep && !this.sleeping && !this.isMoving() &&
        now - this.lastActivity > 600000) {
      this.sleeping = true;
      this.enabled = this.enabled.map(() => false);
      this.emit(">> Going to SLEEP");
    }
  }

  /* ---------- هومینگ ---------- */
  _startHoming() {
    this.homingQueue = [...FW.HOMING_ORDER];
    this.nudge = null;
    this._nudgeDone = false;
    this._nextHomingAxis();
  }
  _nextHomingAxis() {
    const axis = this.homingQueue.shift();
    if (axis === undefined) {
      this.homingPhase = null;
      this.setState("READY");
      this.emit(">> System ready!");
      this.emitPosCurrent();   /* v1.0.36: sliders land on zero after homing */
      return;
    }
    const a = FW.AXES[axis];
    if (!this.enabled[axis]) this.enabled[axis] = true;  /* v1.0.37: startHoming enables (fw parity) */
    this.emit(`>> Homing axis ${axis + 1} (${a.id}) ...`);
    this.homingPhase = { phase: "seek", axis, until: Date.now() + 700 };
    this.setState("HOMING");
  }
  _tickHoming(now) {
    const hp = this.homingPhase;
    const a = FW.AXES[hp.axis];
    if (hp.phase === "seek") {
      if (now >= hp.until) {
        this.pos[hp.axis] = -a.backoff;   /* v1.0.36: switch = -backoff */
        this.homed[hp.axis] = true;
        hp.phase = "back";
        hp.until = now + 200; /* لحظه‌ای مکث روی اند‌استاپ */
      }
    } else if (hp.phase === "back") {
      /* برگشت دقیقاً به اندازه‌ی backoff — مرجع صفر = جایگاه پارک */
      const diff = 0 - this.pos[hp.axis];
      const v = a.maxSpeed * this.mult();
      const step = v * 0.05 * Math.sign(diff);
      if (Math.abs(step) >= Math.abs(diff)) {
        this.pos[hp.axis] = 0;
        this.target[hp.axis] = 0;
        this.emit(`>> Axis ${hp.axis + 1} (${a.id}) homed, backed off ${a.backoff} steps (park position = 0 deg)`);
        /* v1.0.36: J2/J3 choreography — J2 forward 250, J3 homes, J2 returns */
        if (hp.axis === 1 && !this._nudgeDone) {
          this._nudgeDone = true;
          this.nudge = { stage: "out" };
          this.target[1] = 250;
          this.emit(">> J2 nudged forward for J3 homing");
          this.homingPhase = null;   /* hand control to _tickNudge */
          return;
        }
        if (hp.axis === 2 && this.nudge && this.nudge.stage === "hold") {
          this.nudge = { stage: "back" };
          this.target[1] = 0;
          this.emit(">> J2 returned to its back-off position");
          this.homingPhase = null;   /* hand control to _tickNudge */
          return;
        }
        this._nextHomingAxis();
      } else {
        this.pos[hp.axis] += step;
      }
    }
  }
  _tickNudge() {
    /* J2 moves itself here: state stays HOMING so the normal move loop is idle */
    const v = FW.AXES[1].maxSpeed * this.mult();
    const diff = this.target[1] - this.pos[1];
    if (Math.abs(diff) > 0.5) {
      const step = v * 0.05 * Math.sign(diff);
      this.pos[1] += Math.abs(step) >= Math.abs(diff) ? diff : step;
      return;
    }
    this.pos[1] = this.target[1];
    if (this.nudge.stage === "out") {
      this.nudge = { stage: "hold" };
      this._nextHomingAxis();           /* J3 starts from the queue */
    } else if (this.nudge.stage === "back") {
      this.nudge = null;
      this._nextHomingAxis();
    }
  }

  /* ---------- دمو ---------- */
  _tickDemo(now) {
    if (this.isMoving()) return;
    if (now - this.lastDemoAt < FW.DEMO_DELAY_MS) return;
    const pose = FW.DEMO_MOVES[this.demoStep].angles;
    for (let i = 0; i < 5; i++) {
      if (pose[i] < FW.AXES[i].min || pose[i] > FW.AXES[i].max) { this._advanceDemo(now); return; }
    }
    this.emit(`>> Demo step ${this.demoStep + 1}/${FW.DEMO_MOVES.length}`);
    const stepsAll = pose.map((d, i) => this.degToSteps(i, d));
    this.moveAll(stepsAll);
    this.emitPosFromSteps(stepsAll);
    this.lastDemoAt = now;
    this._advanceDemo(now);
  }
  _advanceDemo(now) {
    this.demoStep++;
    if (this.demoStep >= FW.DEMO_MOVES.length) {
      this.demoStep = 0;
      this.demoRepeat++;
      if (this.demoRepeat >= FW.DEMO_MAX_REPEATS) {
        this.demoRunning = false;
        this.demoRepeat = 0;
        this.emit(">> Demo complete!");
      }
    }
    this.lastDemoAt = now;
  }

  /* ---------- پخش آموزش ---------- */
  _tickPlay(now) {
    if (now < this.playNextAt) return;
    if (this.playIdx >= this.teachSteps.length) {
      this.playing = false;
      this.emit(">> Playback complete");
      return;
    }
    const st = this.teachSteps[this.playIdx];
    this.moveAll([...st.positions]);
    this.emit(`>> Step ${this.playIdx + 1}/${this.teachSteps.length}`);
    this.emitPosFromSteps([...st.positions]);
    this.playIdx++;
    this.playNextAt = now + (st.delayAfter || 1000);
  }

  /* ---------- پردازش دستور ---------- */
  handle(raw) {
    /* ACK wrapper — mirrors the NEW firmware semantics:
       ackMode ON  = board SILENT (no ACK lines)
       ackMode OFF = confirmations enabled (default), except for polled "status" */
    const silent = !!this.ackMode;
    let known = true;
    const origEmit = this.emit;
    this.emit = (m) => { if (String(m) === "Unknown command") known = false; origEmit.call(this, m); };
    try { this._dispatch(raw); } finally { this.emit = origEmit; }
    if (!silent && known && raw.trim().toLowerCase() !== "status") {
      this.emit(">> ACK: " + raw.trim() + " - executed");
    }
  }

  _dispatch(raw) {
    const cmd = raw.trim();
    if (!cmd) return;
    this.lastActivity = Date.now();
    this.emit("> " + cmd);
    if (this.logEnabled) {
      this.logRing.push({ time: this.millis(), msg: cmd.slice(0, 63) });
      if (this.logRing.length > FW.MAX_LOGS) this.logRing.shift();
    }

    const lower = cmd.toLowerCase();

    /* --- هومینگ --- */
    if (lower === "home") {
      this.emit("Starting smart homing...");
      if (this.estopped) this.emit(">> E-STOP cleared by homing request");
      this.estopped = false;
      this.demoRunning = false;
      this.playing = false;
      this.emit(">> Checking endstops (non-blocking pre-backoff)...");
      this.emit("  All endstops free");
      this.homingQueue = [];
      this.homingPhase = null;
      this.nudge = null;
      this.setState("HOMING");
      return;
    }
    if (lower.startsWith("home ")) {
      const n = parseInt(cmd.slice(5), 10);
      if (n >= 1 && n <= 5) {
        this.emit("Starting smart homing...");
        this.homingQueue = [n - 1];
        this.homingPhase = null;
        this.setState("HOMING");
      } else this.emit("Invalid axis");
      return;
    }

    /* --- وضعیت --- */
    if (lower === "status") { this._printStatus(); return; }

    /* --- موتورها --- */
    if (lower === "enable") { this.enabled = this.enabled.map(() => true); this.emit("All motors enabled"); return; }
    if (lower === "disable") { this.enabled = this.enabled.map(() => false); this.emit("All motors disabled"); return; }
    if (lower.startsWith("enable ")) {
      const n = parseInt(cmd.slice(7), 10);
      if (n >= 1 && n <= 5) { this.enabled[n - 1] = true; this.emit(`Axis ${n} enabled`); }
      else this.emit("Invalid axis");
      return;
    }
    if (lower.startsWith("disable ")) {
      const n = parseInt(cmd.slice(8), 10);
      if (n >= 1 && n <= 5) { this.enabled[n - 1] = false; this.emit(`Axis ${n} disabled`); }
      else this.emit("Invalid axis");
      return;
    }

    /* --- ایمنی --- */
    if (lower === "estop") {
      this.emergencyStop();
      return;
    }
    if (lower === "reset") {
      this.estopped = false;
      this.setState("READY");
      this.emit("Emergency stop cleared (send 'home' to re-reference, then move)");
      this.emitPosCurrent();
      return;
    }

    /* --- دمو / توقف --- */
    if (lower === "demo") { this._startDemo(); return; }
    if (lower === "stopdemo") { this.demoRunning = false; this.emit(">> Demo stopped"); return; }
    if (lower === "stop") {
      /* v1.0.37: همگام با فریم‌ور — توقف نرم واقعی + POS (بدون لچ E-STOP) */
      this.demoRunning = false;
      this.playing = false;
      this.target = [...this.pos];
      this.enabled = this.enabled.map(() => false);
      this.emit(">> Stopped (send 'home' to re-reference before moving)");
      this.emitPosCurrent();
      return;
    }

    /* --- حرکت --- */
    if (lower.startsWith("moveall ")) {
      this.demoRunning = false;
      const parts = cmd.slice(8).trim().split(/\s+/);
      const deg = [];
      for (let i = 0; i < 5; i++) {
        if (!parts[i]) { this.emit(`!! Missing degree for axis ${i + 1}`); return; }
        const d = parseFloat(parts[i]);
        if (isNaN(d) || d < FW.AXES[i].min || d > FW.AXES[i].max) {
          this.emit(`!! Axis ${i + 1} out of range`); return;
        }
        deg.push(d);
      }
      for (let i = 0; i < 5; i++) {
        if (!this.homed[i]) { this.emit(`!! Axis ${i + 1} is NOT homed - run 'home' first`); return; }
      }
      const stepsAll = deg.map((d, i) => this.degToSteps(i, d));
      this.moveAll(stepsAll);
      this.emit("Moving all: " + this.target.join(", ") + " steps");
      this.emitPosFromSteps(stepsAll);
      return;
    }
    if (lower === "moveall") { this.emit("Format: moveall <d1> <d2> <d3> <d4> <d5>"); return; }
    if (lower.startsWith("deg ")) {
      this.demoRunning = false;
      const parts = cmd.slice(4).trim().split(/\s+/);
      if (parts.length < 2) { this.emit("Format: deg <axis> <degrees>"); return; }
      const n = parseInt(parts[0], 10), d = parseFloat(parts[1]);
      if (!(n >= 1 && n <= 5)) { this.emit("Invalid axis"); return; }
      if (isNaN(d) || d < FW.AXES[n - 1].min || d > FW.AXES[n - 1].max) {
        this.emit(`!! Axis ${n} out of range (${FW.AXES[n - 1].min}° to ${FW.AXES[n - 1].max}°)`);
        return;
      }
      /* v1.0.36: honest refusals - never print "Moving..." and then do nothing */
      if (!this.homed[n - 1]) { this.emit(`!! Axis ${n} is NOT homed - run 'home' first (position reference unknown)`); return; }
      if (!this.enabled[n - 1]) { this.emit(`!! Axis ${n} is DISABLED - send 'enable' or run 'home' first`); return; }
      const steps = this.degToSteps(n - 1, d);
      this.moveToAxis(n - 1, steps);
      this.emit(`Moving axis ${n} to ${d}° (${steps} steps)`);
      this.emitPosTargetSingle(n - 1, steps);
      return;
    }
    if (lower.startsWith("move ")) {
      this.demoRunning = false;
      const parts = cmd.slice(5).trim().split(/\s+/);
      if (parts.length < 2) { this.emit("Format: move <axis> <steps>"); return; }
      const n = parseInt(parts[0], 10), s = parseInt(parts[1], 10);
      if (n >= 1 && n <= 5) {
        if (!this.homed[n - 1]) { this.emit(`!! Axis ${n} is NOT homed - run 'home' first (position reference unknown)`); return; }
        if (!this.enabled[n - 1]) { this.emit(`!! Axis ${n} is DISABLED - send 'enable' or run 'home' first`); return; }
        this.moveToAxis(n - 1, s);
        this.emit(`Moving axis ${n} to ${s} steps`);
        this.emitPosTargetSingle(n - 1, s);
      } else this.emit("Invalid axis");
      return;
    }

    /* --- حافظه موقعیت --- */
    if (lower.startsWith("savepos ")) {
      const slot = parseInt(cmd.slice(8), 10);
      if (slot >= 0 && slot < FW.MAX_POSITIONS) {
        this.slots[slot] = { name: `Pos${slot}`, positions: [...this.pos] };
        this.emit(`>> Position saved in slot ${slot} as 'Pos${slot}'`);
      } else this.emit(`!! Slot ${slot} is invalid (0-${FW.MAX_POSITIONS - 1})`);
      return;
    }
    if (lower.startsWith("loadpos ")) {
      const slot = parseInt(cmd.slice(8), 10);
      const s = this.slots[slot];
      if (!s) { this.emit(`!! Slot ${slot} is empty`); return; }
      for (let i = 0; i < 5; i++) {
        if (!this.homed[i]) { this.emit(`!! Axis ${i + 1} is NOT homed - run 'home' first`); return; }
      }
      this.moveAll([...s.positions]);
      this.emit(`>> Loaded position from slot ${slot} ('${s.name}')`);
      this.emitPosFromSteps([...s.positions]);
      return;
    }
    if (lower === "listpos") {
      this.emit(">> Saved positions:");
      let count = 0;
      this.slots.forEach((s, i) => {
        if (s) { this.emit(`  Slot ${i}: ${s.name}`); count++; }
      });
      if (count === 0) this.emit("  (no saved positions)");
      return;
    }
    if (lower.startsWith("clearpos ")) {
      const slot = parseInt(cmd.slice(9), 10);
      if (slot >= 0 && slot < FW.MAX_POSITIONS) {
        this.slots[slot] = null;
        this.emit(`>> Position slot ${slot} cleared`);
      }
      return;
    }

    /* --- تایمر --- */
    if (lower.startsWith("timer ")) {
      const parts = cmd.slice(6).trim().split(/\s+/);
      if (parts.length >= 2) {
        const ms = parseInt(parts[0], 10), axis = parseInt(parts[1], 10) - 1;
        /* v1.0.36: optional 3rd arg = target (steps), like the firmware */
        const target = parts.length >= 3 ? parseInt(parts[2], 10) : this.pos[axis];
        if (axis >= 0 && axis < 5) {
          if (!this.homed[axis]) { this.emit(`!! Axis ${axis + 1} is NOT homed - run 'home' first`); return; }
          this.timers.push({ fireAt: Date.now() + ms, axis, target, fired: false });
          this.emit(`>> Timer set: axis ${axis + 1} in ${ms} ms -> target ${target}`);
        } else this.emit("Invalid axis");
      } else this.emit("Format: timer <ms> <axis> [<target-steps>]");
      return;
    }
    if (lower === "timers") { this.emit(`>> Active timers: ${this.timers.length}`); return; }
    if (lower === "cleartimers") { this.timers = []; this.emit(">> All timers cleared"); return; }

    /* --- آموزش --- */
    if (lower === "teach") {
      this.recording = true;
      this.emit(">> Teach mode: RECORDING started");
      return;
    }
    if (lower === "teach stop") {
      this.recording = false;
      this.emit(`>> Teach mode: RECORDING stopped. ${this.teachSteps.length} steps recorded.`);
      return;
    }
    if (lower === "teach step") {
      if (this.teachSteps.length >= FW.MAX_TEACH_STEPS) {
        this.emit("!! Max teach steps reached");
        return;
      }
      this.teachSteps.push({ positions: [...this.pos], delayAfter: 1000 });
      this.emit(`>> Step ${this.teachSteps.length} recorded`);
      return;
    }
    if (lower === "teach count") {
      this.emit(`>> Recorded steps: ${this.teachSteps.length}`);
      return;
    }
    if (lower === "play") {
      if (!this.teachSteps.length) { this.emit("!! No recorded steps"); return; }
      if (!this.allHomed()) { this.emit("!! Axis is NOT homed - run 'home' first"); return; }
      this.playing = true;
      this.playIdx = 0;
      this.playNextAt = 0;
      this.emit(`>> Playing back ${this.teachSteps.length} steps`);
      return;
    }
    if (lower === "play stop") {
      this.playing = false;
      this.emit(">> Playback stopped");
      return;
    }

    /* --- لاگر --- */
    if (lower === "log on") { this.logEnabled = true; this.emit(">> Logging ENABLED"); return; }
    if (lower === "log off") { this.logEnabled = false; this.emit(">> Logging DISABLED"); return; }
    if (lower === "log show") {
      this.emit(">> Log entries:");
      if (!this.logRing.length) { this.emit("  (no entries)"); return; }
      for (const e of this.logRing) this.emit(`  [${e.time}ms] ${e.msg}`);
      return;
    }
    if (lower === "log clear") { this.logRing = []; this.emit(">> Log cleared"); return; }

    /* --- پروفایل سرعت --- */
    if (lower.startsWith("profile ")) {
      const p = cmd.slice(8).trim().toLowerCase();
      const idx = FW.PROFILES.findIndex((x) => x.key === p);
      if (idx !== -1) {
        this.profile = idx;
        /* v1.0.36: exact firmware text (was "Speed profile: ..." - diverged) */
        const m = FW.PROFILES[idx].mult;
        this.emit(`>> Applied: speed x${m.toFixed(2)}, accel x${m.toFixed(2)}`);
      }
      else this.emit("Use: profile slow/normal/fast");
      return;
    }
    if (lower === "profile") {
      this.emit(`>> Current profile: ${FW.PROFILES[this.profile].name}`);
      return;
    }

    /* --- مسیر --- */
    if (lower.startsWith("traj line")) {
      this.emit(">> Trajectory line set (not fully implemented)");
      return;
    }
    if (lower === "traj stop") { this.emit(">> Trajectory stopped"); return; }

    /* --- کینماتیک --- */
    if (lower.startsWith("ik ")) {
      const parts = cmd.slice(3).trim().split(/\s+/);
      if (parts.length >= 3) {
        const x = parseFloat(parts[0]), y = parseFloat(parts[1]), z = parseFloat(parts[2]);
        const angles = Kin.ik(x, y, z);
        if (angles) {
          /* FIX: clamp به محدوده مفصلی — عین رفتار جدید فریم‌ور */
          let clamped = false;
          for (let i = 0; i < 5; i++) {
            const c = Math.max(FW.AXES[i].min, Math.min(FW.AXES[i].max, angles[i]));
            if (c !== angles[i]) { angles[i] = c; clamped = true; }
          }
          if (clamped) this.emit(">> Angles clamped to joint limits");
          this.emit(">> IK solution: " + angles.map((a) => a.toFixed(1) + "°").join(", "));
          this.moveAll(angles.map((a, i) => this.degToSteps(i, a)));
        } else this.emit("!! Position out of reach");
      } else this.emit("Format: ik <x> <y> <z>");
      return;
    }
    if (lower.startsWith("fk ")) {
      const parts = cmd.slice(3).trim().split(/\s+/);
      const angles = [0, 0, 0, 0, 0];
      for (let i = 0; i < 5; i++) angles[i] = parseFloat(parts[i]) || 0;
      const p = Kin.fk(angles);
      this.emit(`>> FK result: X=${p.x.toFixed(1)}, Y=${p.y.toFixed(1)}, Z=${p.z.toFixed(1)}`);
      return;
    }

    /* --- انرژی --- */
    if (lower === "sleep") {
      this.sleeping = true;
      this.enabled = this.enabled.map(() => false);
      this.emit(">> Going to SLEEP");
      return;
    }
    if (lower === "wake") {
      this.sleeping = false;
      this.enabled = this.enabled.map(() => true);
      this.emit(">> Waking up");
      return;
    }
    if (lower === "autosleep on") { this.autoSleep = true; this.emit(">> Auto-sleep ENABLED"); return; }
    if (lower === "autosleep off") { this.autoSleep = false; this.emit(">> Auto-sleep DISABLED"); return; }

    if (lower === "ack on") { this.ackMode = true; this.emit(">> Ack mode ON — every command will be confirmed"); return; }
    if (lower === "ack off") { this.ackMode = false; this.emit(">> Ack mode OFF — commands run silently"); return; }
    if (lower === "ack") { this.emit(this.ackMode ? ">> Ack mode is ON" : ">> Ack mode is OFF"); return; }
    this.emit("Unknown command");
  }

  emergencyStop() {
    this.demoRunning = false;
    this.playing = false;
    this.target = [...this.pos];
    this.estopped = true;
    this.nudge = null;
    this.setState("ESTOP");
    this.emit("EMERGENCY STOP!");
  }

  _startDemo() {
    if (this.demoRunning) { this.emit("!! Demo already running"); return; }
    if (!this.allHomed()) { this.emit("!! Not all axes are homed"); return; }
    this.demoRunning = true;
    this.demoStep = 0;
    this.demoRepeat = 0;
    this.lastDemoAt = 0;
    this.emit(">> Starting demo");
  }

  _printStatus() {
    const L = [];
    L.push("=== System Status ===");
    L.push("State: " + this._stateEn());
    if (this.demoRunning) L.push(`Demo: RUNNING (${this.demoStep + 1}/${FW.DEMO_MOVES.length})`);
    L.push("Profile: " + FW.PROFILES[this.profile].name);
    L.push("FW: v" + FW.EXPECTED_FW);   /* v1.0.38: اپ از این خط، قدیمی‌بودن برد را می‌فهمد */
    if (this.sleeping) L.push("Status: SLEEPING");
    for (let i = 0; i < 5; i++) {
      const deg = this.pos[i] / FW.AXES[i].stepsPerDeg;
      const es = (this.homingPhase && this.homingPhase.axis === i && this.homingPhase.phase === "back" && this.homingPhase.until > Date.now()) ? "Trig" : "Open";
      L.push(
        `Axis ${i + 1}: ${Math.round(this.pos[i])} (${deg.toFixed(1)}°), ` +
        `Homed=${this.homed[i] ? "Y" : "N"}, En=${this.enabled[i] ? "Y" : "N"}, ` +
        `Mov=${this.pos[i] !== this.target[i] ? "Y" : "N"}, ES=${es}`
      );
    }
    L.push("======================");
    this.emitMany(L);
  }

  _stateEn() {
    return {
      INIT: "Initializing", HOMING: "Homing", READY: "Ready",
      MOVING: "Moving", ERROR: "Error", ESTOP: "Emergency Stop",
    }[this.state] || "Ready";
  }
}
