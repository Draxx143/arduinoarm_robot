/* ============================================================
 * core.js — Firmware mirror: constants, command builder,
 * output parser and kinematics (mirrors RobotArm_Firmware.ino)
 * ============================================================ */
"use strict";

const FW = {
  NUM_AXES: 5,
  BAUD: 115200,

  /* Homing order from Config.h -> {2,1,0,3,4} = Z,Y,X,A,B */
  HOMING_ORDER: [2, 1, 0, 3, 4],
  HOMING_ORDER_LABEL: "Z → Y → X → A → B",

  /* Link lengths from IK.cpp (mm) */
  LINKS: { L1: 100, L2: 100, L3: 50 },

  /* Demo poses from RobotArm_Firmware.ino (degrees) */
  DEMO_MOVES: [
    { label: "Pose 1 — Neutral", angles: [0, 0, 0, 0, 0] },
    { label: "Pose 2",           angles: [45, 30, 20, 15, 10] },
    { label: "Pose 3",           angles: [-45, 50, 40, -15, -10] },
    { label: "Pose 4",           angles: [30, 80, 50, 30, 20] },
    { label: "Pose 5",           angles: [-30, 20, 10, -30, -20] },
    { label: "Pose 6 — Return",  angles: [0, 0, 0, 0, 0] },
  ],
  DEMO_MAX_REPEATS: 3,
  DEMO_DELAY_MS: 1500,

  MAX_POSITIONS: 10,   // PositionStore.h
  MAX_TEACH_STEPS: 30, // TeachMode.h
  MAX_LOGS: 10,        // Logger.h

  /* Full axis configuration from Config.h */
  AXES: [
    {
      id: "X", joint: 1, name: "Base", role: "Yaw — horizontal rotation",
      min: -110, max: 110,
      stepsPerDeg: 44.44, stepsPerRev: 200, microstep: 16, gear: "1:5",
      maxSpeed: 2000, accel: 700, backoff: 5200,
      soft: { min: -4888, max: 4888 },
      pins: { step: "A0", dir: "A1", enable: "38", endstop: "3" },
    },
    {
      id: "Y", joint: 2, name: "Shoulder", role: "Pitch — lifts the arm",
      min: 0, max: 100,
      stepsPerDeg: 53.33, stepsPerRev: 200, microstep: 16, gear: "1:6",
      maxSpeed: 2000, accel: 1000, backoff: 300,
      soft: { min: 0, max: 8889 },
      pins: { step: "A6", dir: "A7", enable: "A2", endstop: "14" },
    },
    {
      id: "Z", joint: 3, name: "Elbow", role: "Pitch — bends the forearm",
      min: 0, max: 55,
      stepsPerDeg: 71.11, stepsPerRev: 200, microstep: 16, gear: "1:8",
      maxSpeed: 1000, accel: 500, backoff: 200,
      soft: { min: 0, max: 3911 },
      pins: { step: "46", dir: "48", enable: "A8", endstop: "18" },
    },
    {
      id: "A", joint: 4, name: "Wrist", role: "Pitch — wrist flex",
      min: -90, max: 90,
      stepsPerDeg: 26.67, stepsPerRev: 200, microstep: 16, gear: "1:3",
      maxSpeed: 1000, accel: 500, backoff: 3000,
      soft: { min: -2400, max: 2400 },
      pins: { step: "26", dir: "28", enable: "24", endstop: "2" },
    },
    {
      id: "B", joint: 5, name: "Wrist Roll", role: "Roll — tool rotation",
      min: -90, max: 90,
      stepsPerDeg: 22.22, stepsPerRev: 200, microstep: 16, gear: "1:2.5",
      maxSpeed: 1000, accel: 500, backoff: 200,
      soft: { min: -2000, max: 2000 },
      pins: { step: "36", dir: "34", enable: "30", endstop: "15" },
    },
  ],

  /* Speed profiles from SpeedProfile.cpp */
  PROFILES: [
    { key: "slow",   label: "SLOW",   name: "SLOW (50%)",   mult: 0.5 },
    { key: "normal", label: "NORMAL", name: "NORMAL (100%)", mult: 1.0 },
    { key: "fast",   label: "FAST",   name: "FAST (150%)",   mult: 1.5 },
  ],

  /* System states from enum SystemState */
  STATES: {
    INIT:   { label: "INITIALIZING", color: "#8b949e" },
    HOMING: { label: "HOMING",       color: "#ffb020" },
    READY:  { label: "READY",        color: "#3fb950" },
    MOVING: { label: "MOVING",       color: "#00c2d1" },
    ERROR:  { label: "FAULT",        color: "#ff6b35" },
    ESTOP:  { label: "E-STOP",       color: "#e5484d" },
  },
  STATE_FROM_EN: {
    "initializing": "INIT", "homing": "HOMING", "ready": "READY",
    "moving": "MOVING", "error": "ERROR", "emergency stop": "ESTOP",
  },
};

/* ---------- Kinematics (mirror of IK.cpp) ---------- */
const Kin = {
  D2R: Math.PI / 180,

  /** Forward kinematics, identical to the firmware solveFK(): [base,shoulder,elbow,wrist,roll] -> xyz (mm) */
  fk(angles) {
    const a0 = angles[0] * this.D2R;
    const a1 = angles[1] * this.D2R;
    const a2 = angles[2] * this.D2R;
    const { L1, L2, L3 } = FW.LINKS;
    const r = L1 * Math.cos(a1) + L2 * Math.cos(a1 - a2);
    const z = L1 * Math.sin(a1) + L2 * Math.sin(a1 - a2);
    const dir = a1 - a2 - (angles[3] || 0) * this.D2R;
    const tipR = r + L3 * Math.cos(dir);
    const tipZ = z + L3 * Math.sin(dir);
    return {
      x: tipR * Math.cos(a0),
      y: tipR * Math.sin(a0),
      z: tipZ,
      reach: Math.hypot(tipR, tipZ),
      maxReach: L1 + L2 + L3,
    };
  },

  /** Inverse kinematics, identical to the firmware solveIK(): xyz -> angles (wrist zeroed) */
  ik(x, y, z) {
    const { L1, L2, L3 } = FW.LINKS;
    const angles = [0, 0, 0, 0, 0];
    angles[0] = Math.atan2(y, x) / this.D2R;
    const r = Math.hypot(x, y);
    const L = Math.hypot(r, z);
    if (L > L1 + L2 + L3 || L < Math.abs(L1 - L2 - L3)) return null;
    let cosElbow = (L1 * L1 + L2 * L2 - L * L) / (2 * L1 * L2);
    cosElbow = Math.max(-1, Math.min(1, cosElbow));
    const elbow = Math.acos(cosElbow);
    angles[2] = 180 - elbow / this.D2R;
    const alpha = Math.atan2(z, r);
    const cosBeta = (L1 * L1 + L * L - L2 * L2) / (2 * L1 * L);
    const beta = Math.acos(Math.max(-1, Math.min(1, cosBeta)));
    angles[1] = (alpha + beta) / this.D2R;
    angles[3] = 0;
    angles[4] = 0;
    return angles;
  },

  degToSteps(i, deg) { return Math.round(deg * FW.AXES[i].stepsPerDeg); },
  stepsToDeg(i, steps) { return steps / FW.AXES[i].stepsPerDeg; },
  clampDeg(i, deg) {
    const a = FW.AXES[i];
    return Math.max(a.min, Math.min(a.max, deg));
  },
};

/* ---------- Serial command builder ---------- */
const Cmd = {
  homeAll: () => "home",
  homeAxis: (n) => `home ${n}`,
  status: () => "status",
  enableAll: () => "enable",
  disableAll: () => "disable",
  enableAxis: (n) => `enable ${n}`,
  disableAxis: (n) => `disable ${n}`,
  estop: () => "estop",
  reset: () => "reset",
  demo: () => "demo",
  stopDemo: () => "stopdemo",
  stop: () => "stop",
  moveAll: (deg5) => `moveall ${deg5.map((d) => Fmt.num(d)).join(" ")}`,
  deg: (n, deg) => `deg ${n} ${Fmt.num(deg)}`,
  move: (n, steps) => `move ${n} ${steps}`,
  savePos: (slot) => `savepos ${slot}`,
  loadPos: (slot) => `loadpos ${slot}`,
  listPos: () => "listpos",
  clearPos: (slot) => `clearpos ${slot}`,
  timer: (ms, axis) => `timer ${ms} ${axis}`,
  timers: () => "timers",
  clearTimers: () => "cleartimers",
  teachStart: () => "teach",
  teachStop: () => "teach stop",
  teachStep: () => "teach step",
  teachCount: () => "teach count",
  play: () => "play",
  playStop: () => "play stop",
  logOn: () => "log on",
  logOff: () => "log off",
  logShow: () => "log show",
  logClear: () => "log clear",
  profile: (k) => (k ? `profile ${k}` : "profile"),
  trajStop: () => "traj stop",
  ik: (x, y, z) => `ik ${Fmt.num(x)} ${Fmt.num(y)} ${Fmt.num(z)}`,
  fk: (a5) => `fk ${a5.map((d) => Fmt.num(d)).join(" ")}`,
  sleep: () => "sleep",
  wake: () => "wake",
  autoSleep: (on) => `autosleep ${on ? "on" : "off"}`,
};

/* ---------- Formatting ---------- */
const Fmt = {
  num(v) {
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 10) / 10);
  },
  deg(v) { return (Math.round(v * 10) / 10).toFixed(1) + "°"; },
  pad(n) { return String(n).padStart(2, "0"); },
  time(ts) {
    const d = new Date(ts);
    return Fmt.pad(d.getHours()) + ":" + Fmt.pad(d.getMinutes()) + ":" + Fmt.pad(d.getSeconds());
  },
  bytes(n) { return n < 1024 ? n + " B" : (n / 1024).toFixed(1) + " KB"; },
};

/* ---------- Firmware output parser ----------
 * Analyses every received line and emits UI events. */
const Parse = {
  RX_AXIS: /^Axis\s+(\d):\s*(-?\d+)\s*\(\s*(-?[\d.]+)°\)\s*,\s*Homed=(\w)\s*,\s*En=(\w)\s*,\s*Mov=(\w)\s*,\s*ES=(\w+)/,
  RX_DEMO_STEP: /^>>\s*Demo step (\d+)\/(\d+)/,
  RX_STATE_EN: /^State:\s*(.+)$/,
  RX_PROFILE: /^Profile:\s*(.+)$/,
  RX_SLEEP: /^Status:\s*SLEEPING/,
  RX_DEMO_RUN: /^Demo:\s*RUNNING\s*\((\d+)\/(\d+)\)/,
  RX_SAVED: /^>>\s*Position saved in slot (\d+)/,
  RX_LOADED: /^>>\s*Loaded position from slot (\d+)/,
  RX_SLOT_EMPTY: /^!!\s*Slot (\d+) is empty/,
  RX_SLOTS_LIST: /^>>\s*Saved positions:/,
  RX_SLOT_ITEM: /^\s*Slot (\d+):\s*(.+)$/,
  RX_TEACH_COUNT: /^>>\s*Recorded steps:\s*(\d+)/,
  RX_TIMERS: /^>>\s*Active timers:\s*(\d+)/,
  RX_PROFILE_CUR: /^>>\s*(?:Current profile|Speed profile):\s*(.+)$/,
  RX_IK: /^>>\s*IK solution:\s*(.+)$/,
  RX_FK: /^>>\s*FK result:\s*X=(-?[\d.]+)\s*,\s*Y=(-?[\d.]+)\s*,\s*Z=(-?[\d.]+)/,
  RX_READY: /^>>\s*System ready!/,
  RX_MOVE_DONE: /^>>\s*Move complete\./,
  RX_ESTOP: /^EMERGENCY STOP!/,
  RX_ERR: /^!!\s*(.+)$/,
  RX_RANGE: /^!!\s*Axis (\d+) out of range/,
  RX_UNKNOWN: /^Unknown command/,
  RX_HOMING: /^Starting smart homing/,
  RX_DEMO_START: /^>>\s*Starting demo/,
  RX_DEMO_STOP: /^>>\s*Demo stopped/,
  RX_DEMO_DONE: /^>>\s*Demo complete!/,
  RX_STEP_SAVED: /^>>\s*Step (\d+) recorded/,
  RX_TEACH_START: /^>>\s*Teach mode: RECORDING started/,
  RX_TEACH_STOP: /^>>\s*Teach mode: RECORDING stopped\.\s*(\d+) steps/,
  RX_PLAY_START: /^>>\s*Playing back (\d+) steps/,
  RX_PLAY_DONE: /^>>\s*Playback complete/,
  RX_PLAY_STEP: /^>>\s*Step (\d+)\/(\d+)$/,
  RX_SLEEP_NOW: /^>>\s*Going to SLEEP/,
  RX_WAKE_UP: /^>>\s*Waking up/,
  RX_AS_ON: /^>>\s*Auto-sleep ENABLED/,
  RX_AS_OFF: /^>>\s*Auto-sleep DISABLED/,
  RX_LOGGED: /^\s*\[(\d+)ms\]\s*(.+)$/,

  line(text) {
    const t = text.trim();
    if (!t) return null;
    let m;
    if ((m = t.match(this.RX_AXIS))) {
      return {
        type: "axis", axis: +m[1] - 1, steps: +m[2], deg: +m[3],
        homed: m[4] === "Y", enabled: m[5] === "Y",
        moving: m[6] === "Y", endstop: m[7],
      };
    }
    if ((m = t.match(this.RX_STATE_EN))) {
      const key = FW.STATE_FROM_EN[m[1].trim().toLowerCase()];
      return { type: "state", key: key || "INIT", en: m[1].trim() };
    }
    if ((m = t.match(this.RX_PROFILE))) return { type: "profile", name: m[1].trim() };
    if (this.RX_SLEEP.test(t)) return { type: "sleeping" };
    if ((m = t.match(this.RX_DEMO_RUN))) return { type: "demoRun", step: +m[1], total: +m[2] };
    if ((m = t.match(this.RX_DEMO_STEP))) return { type: "demoStep", step: +m[1], total: +m[2] };
    if ((m = t.match(this.RX_SAVED))) return { type: "posSaved", slot: +m[1] };
    if ((m = t.match(this.RX_LOADED))) return { type: "posLoaded", slot: +m[1] };
    if ((m = t.match(this.RX_SLOT_EMPTY))) return { type: "slotEmpty", slot: +m[1] };
    if (this.RX_SLOTS_LIST.test(t)) return { type: "slotsListStart" };
    if ((m = t.match(this.RX_SLOT_ITEM))) return { type: "slotItem", slot: +m[1], name: m[2].trim() };
    if ((m = t.match(this.RX_TEACH_COUNT))) return { type: "teachCount", count: +m[1] };
    if ((m = t.match(this.RX_TIMERS))) return { type: "timers", count: +m[1] };
    if ((m = t.match(this.RX_PROFILE_CUR))) return { type: "profile", name: m[1].trim() };
    if ((m = t.match(this.RX_IK))) {
      const angles = m[1].split(",").map((s) => parseFloat(s));
      return { type: "ikResult", angles };
    }
    if ((m = t.match(this.RX_FK)))
      return { type: "fkResult", x: +m[1], y: +m[2], z: +m[3] };
    if (this.RX_READY.test(t)) return { type: "ready" };
    if (this.RX_MOVE_DONE.test(t)) return { type: "moveDone" };
    if (this.RX_ESTOP.test(t)) return { type: "estop" };
    if ((m = t.match(this.RX_RANGE))) return { type: "rangeError", axis: +m[1] - 1 };
    if (this.RX_UNKNOWN.test(t)) return { type: "unknown" };
    if (this.RX_HOMING.test(t)) return { type: "homingStart" };
    if (this.RX_DEMO_START.test(t)) return { type: "demoStart" };
    if (this.RX_DEMO_STOP.test(t)) return { type: "demoStop" };
    if (this.RX_DEMO_DONE.test(t)) return { type: "demoDone" };
    if ((m = t.match(this.RX_STEP_SAVED))) return { type: "teachStepSaved", index: +m[1] };
    if (this.RX_TEACH_START.test(t)) return { type: "teachStart" };
    if ((m = t.match(this.RX_TEACH_STOP))) return { type: "teachStopped", count: +m[1] };
    if ((m = t.match(this.RX_PLAY_START))) return { type: "playStart", count: +m[1] };
    if (this.RX_PLAY_DONE.test(t)) return { type: "playDone" };
    if ((m = t.match(this.RX_PLAY_STEP))) return { type: "playStep", step: +m[1], total: +m[2] };
    if (this.RX_SLEEP_NOW.test(t)) return { type: "sleepNow" };
    if (this.RX_WAKE_UP.test(t)) return { type: "wakeNow" };
    if (this.RX_AS_ON.test(t)) return { type: "autoSleepOn" };
    if (this.RX_AS_OFF.test(t)) return { type: "autoSleepOff" };
    if ((m = t.match(this.RX_ERR))) return { type: "error", msg: m[1] };
    if ((m = t.match(this.RX_LOGGED))) return { type: "logEntry", time: +m[1], msg: m[2] };
    return { type: "info", text: t };
  },
};

/* ---------- Command reference (Help tab + console chips) ---------- */
const COMMAND_REF = [
  { cmd: "home", args: "", desc: "Smart homing of all axes (order Z,Y,X,A,B)", cat: "Basic" },
  { cmd: "home", args: "<1-5>", desc: "Smart homing of a single axis", cat: "Basic" },
  { cmd: "status", args: "", desc: "Full system + axes status report", cat: "Basic" },
  { cmd: "enable", args: "", desc: "Energize all stepper motors", cat: "Basic" },
  { cmd: "enable", args: "<1-5>", desc: "Energize one axis", cat: "Basic" },
  { cmd: "disable", args: "", desc: "De-energize all motors", cat: "Basic" },
  { cmd: "disable", args: "<1-5>", desc: "De-energize one axis", cat: "Basic" },
  { cmd: "estop", args: "", desc: "Immediate emergency stop of all axes", cat: "Safety" },
  { cmd: "reset", args: "", desc: "Clear emergency stop state", cat: "Safety" },
  { cmd: "demo", args: "", desc: "Run demo loop (6 poses x 3 repeats) — homing required", cat: "Motion" },
  { cmd: "stopdemo", args: "", desc: "Stop the demo loop", cat: "Motion" },
  { cmd: "stop", args: "", desc: "Full stop + motors off", cat: "Motion" },
  { cmd: "moveall", args: "<d1>..<d5>", desc: "Move all 5 axes simultaneously (degrees)", cat: "Motion" },
  { cmd: "deg", args: "<axis> <deg>", desc: "Move one axis to an angle", cat: "Motion" },
  { cmd: "move", args: "<axis> <steps>", desc: "Move one axis by step count", cat: "Motion" },
  { cmd: "savepos", args: "<slot>", desc: "Save current pose to slot 0-9", cat: "Memory" },
  { cmd: "loadpos", args: "<slot>", desc: "Recall and move to a saved pose", cat: "Memory" },
  { cmd: "listpos", args: "", desc: "List all saved positions", cat: "Memory" },
  { cmd: "clearpos", args: "<slot>", desc: "Erase one slot", cat: "Memory" },
  { cmd: "timer", args: "<ms> <axis>", desc: "Schedule a move for an axis", cat: "Scheduler" },
  { cmd: "timers", args: "", desc: "Count of active timers", cat: "Scheduler" },
  { cmd: "cleartimers", args: "", desc: "Clear all timers", cat: "Scheduler" },
  { cmd: "teach", args: "", desc: "Start teach recording", cat: "Teach" },
  { cmd: "teach step", args: "", desc: "Record current pose as one step", cat: "Teach" },
  { cmd: "teach stop", args: "", desc: "Finish recording", cat: "Teach" },
  { cmd: "teach count", args: "", desc: "Number of recorded steps", cat: "Teach" },
  { cmd: "play", args: "", desc: "Play back recorded steps", cat: "Teach" },
  { cmd: "play stop", args: "", desc: "Stop playback", cat: "Teach" },
  { cmd: "log on/off", args: "", desc: "Enable / disable the command logger", cat: "Logger" },
  { cmd: "log show", args: "", desc: "Show log (last 10 entries)", cat: "Logger" },
  { cmd: "log clear", args: "", desc: "Clear the log", cat: "Logger" },
  { cmd: "profile", args: "", desc: "Show current speed profile", cat: "Speed" },
  { cmd: "profile slow|normal|fast", args: "", desc: "Set speed profile (50% / 100% / 150%)", cat: "Speed" },
  { cmd: "traj stop", args: "", desc: "Stop trajectory execution", cat: "Trajectory" },
  { cmd: "ik", args: "<x> <y> <z>", desc: "Inverse kinematics: mm position -> move", cat: "Kinematics" },
  { cmd: "fk", args: "<a1>..<a5>", desc: "Forward kinematics: angles -> XYZ", cat: "Kinematics" },
  { cmd: "sleep", args: "", desc: "Enter sleep mode (energy saving)", cat: "Power" },
  { cmd: "wake", args: "", desc: "Wake up from sleep", cat: "Power" },
  { cmd: "autosleep on/off", args: "", desc: "Auto-sleep after idle timeout", cat: "Power" },
];
