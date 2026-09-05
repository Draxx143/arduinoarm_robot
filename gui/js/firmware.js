/* ============================================================
 * firmware.js — آینه‌ی ثابت‌ها و پروتکل فریم‌ور RobotArm_Firmware.ino
 * تمام مقادیر از Config.h و فایل‌های فریم‌ور استخراج شده‌اند.
 * ============================================================ */
"use strict";

const FW = {
  NUM_AXES: 5,
  BAUD: 115200,

  /* ترتیب هومینگ از Config.h → {2,1,0,3,4} یعنی Z,Y,X,A,B */
  HOMING_ORDER: [2, 1, 0, 3, 4],
  HOMING_ORDER_LABEL: "Z → Y → X → A → B",

  /* ابعاد لینک‌ها از IK.cpp (میلی‌متر) */
  LINKS: { L1: 100, L2: 100, L3: 50 },

  /* حرکت‌های دمو از RobotArm_Firmware.ino (درجه) */
  DEMO_MOVES: [
    { label: "Pose 1 — خنثی",   angles: [0, 0, 0, 0, 0] },
    { label: "Pose 2",          angles: [45, 30, 20, 15, 10] },
    { label: "Pose 3",          angles: [-45, 50, 40, -15, -10] },
    { label: "Pose 4",          angles: [30, 80, 50, 30, 20] },
    { label: "Pose 5",          angles: [-30, 20, 10, -30, -20] },
    { label: "Pose 6 — بازگشت", angles: [0, 0, 0, 0, 0] },
  ],
  DEMO_MAX_REPEATS: 3,
  DEMO_DELAY_MS: 1500,

  MAX_POSITIONS: 10,   // PositionStore.h
  MAX_TEACH_STEPS: 30, // TeachMode.h
  MAX_LOGS: 10,        // Logger.h

  /* پیکربندی کامل محورها از Config.h */
  AXES: [
    {
      id: "X", joint: 1, name: "پایه", nameEn: "Base", role: "Yaw (چرخش افقی)",
      min: -110, max: 110,
      stepsPerDeg: 44.44, stepsPerRev: 200, microstep: 16, gear: "1:5",
      maxSpeed: 2000, accel: 700, backoff: 5200,
      soft: { min: -4888, max: 4888 },
      pins: { step: "A0", dir: "A1", enable: "38", endstop: "3" },
    },
    {
      id: "Y", joint: 2, name: "شانه", nameEn: "Shoulder", role: "Pitch (بالا/پایین بازو)",
      min: 0, max: 100,
      stepsPerDeg: 53.33, stepsPerRev: 200, microstep: 16, gear: "1:6",
      maxSpeed: 2000, accel: 1000, backoff: 300,
      soft: { min: 0, max: 8889 },
      pins: { step: "A6", dir: "A7", enable: "A2", endstop: "14" },
    },
    {
      id: "Z", joint: 3, name: "آرنج", nameEn: "Elbow", role: "Pitch (خم ساعد)",
      min: 0, max: 55,
      stepsPerDeg: 71.11, stepsPerRev: 200, microstep: 16, gear: "1:8",
      maxSpeed: 1000, accel: 500, backoff: 200,
      soft: { min: 0, max: 3911 },
      pins: { step: "46", dir: "48", enable: "A8", endstop: "18" },
    },
    {
      id: "A", joint: 4, name: "مچ", nameEn: "Wrist", role: "Pitch (خم مچ)",
      min: -90, max: 90,
      stepsPerDeg: 26.67, stepsPerRev: 200, microstep: 16, gear: "1:3",
      maxSpeed: 1000, accel: 500, backoff: 3000,
      soft: { min: -2400, max: 2400 },
      pins: { step: "26", dir: "28", enable: "24", endstop: "2" },
    },
    {
      id: "B", joint: 5, name: "چرخش مچ", nameEn: "Wrist Roll", role: "Roll (چرخش ابزار)",
      min: -90, max: 90,
      stepsPerDeg: 22.22, stepsPerRev: 200, microstep: 16, gear: "1:2.5",
      maxSpeed: 1000, accel: 500, backoff: 200,
      soft: { min: -2000, max: 2000 },
      pins: { step: "36", dir: "34", enable: "30", endstop: "15" },
    },
  ],

  /* پروفایل‌های سرعت از SpeedProfile.cpp */
  PROFILES: [
    { key: "slow",   label: "آهسته",   name: "SLOW (50%)",   mult: 0.5 },
    { key: "normal", label: "معمولی",  name: "NORMAL (100%)", mult: 1.0 },
    { key: "fast",   label: "سریع",    name: "FAST (150%)",   mult: 1.5 },
  ],

  /* وضعیت‌های سیستم از enum SystemState */
  STATES: {
    INIT:  { label: "راه‌اندازی",   en: "Initializing",  color: "#94a3b8", dot: "#94a3b8" },
    HOMING:{ label: "هومینگ",      en: "Homing",        color: "#fbbf24", dot: "#fbbf24" },
    READY: { label: "آماده",        en: "Ready",         color: "#34d399", dot: "#34d399" },
    MOVING:{ label: "در حال حرکت",  en: "Moving",        color: "#22d3ee", dot: "#22d3ee" },
    ERROR: { label: "خطا",          en: "Error",         color: "#f87171", dot: "#f87171" },
    ESTOP: { label: "توقف اضطراری", en: "Emergency Stop",color: "#ef4444", dot: "#ef4444" },
  },
  STATE_FROM_EN: {
    "initializing": "INIT", "homing": "HOMING", "ready": "READY",
    "moving": "MOVING", "error": "ERROR", "emergency stop": "ESTOP",
  },
};

/* ---------- ریاضیات کینماتیک (آینه‌ی IK.cpp) ---------- */
const Kin = {
  D2R: Math.PI / 180,

  /** FK دقیقاً مطابق solveFK فریم‌ور: زوایای [پایه، شانه، آرنج، مچ، رول] → xyz (mm) */
  fk(angles) {
    const a0 = angles[0] * this.D2R; // پایه
    const a1 = angles[1] * this.D2R; // شانه
    const a2 = angles[2] * this.D2R; // آرنج
    const { L1, L2, L3 } = FW.LINKS;
    const r = L1 * Math.cos(a1) + L2 * Math.cos(a1 - a2);
    const z = L1 * Math.sin(a1) + L2 * Math.sin(a1 - a2);
    /* امتداد مچ + ابزار برای نمایش نوک بازو */
    const wristR = L1 * Math.cos(a1) + L2 * Math.cos(a1 - a2);
    const wristZ = L1 * Math.sin(a1) + L2 * Math.sin(a1 - a2);
    const dir = a1 - a2 - (angles[3] || 0) * this.D2R;
    const tipR = wristR + L3 * Math.cos(dir);
    const tipZ = wristZ + L3 * Math.sin(dir);
    return {
      x: tipR * Math.cos(a0),
      y: tipR * Math.sin(a0),
      z: tipZ,
      reach: Math.hypot(tipR, tipZ),
      maxReach: L1 + L2 + L3,
    };
  },

  /** IK مطابق solveIK فریم‌ور: xyz → زوایا (فقط ۳ محور اول، مچ صفر) */
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

  degToSteps(axisIdx, deg) {
    return Math.round(deg * FW.AXES[axisIdx].stepsPerDeg);
  },
  stepsToDeg(axisIdx, steps) {
    return steps / FW.AXES[axisIdx].stepsPerDeg;
  },
  clampDeg(axisIdx, deg) {
    const a = FW.AXES[axisIdx];
    return Math.max(a.min, Math.min(a.max, deg));
  },
};

/* ---------- سازنده‌ی دستورات سریال ---------- */
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
  moveAll: (deg5) => `moveall ${deg5.map((d) =>Fmt.num(d)).join(" ")}`,
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

/* ---------- قالب‌بندی اعداد ---------- */
const Fmt = {
  num(v) {
    if (Number.isInteger(v)) return String(v);
    const r = Math.round(v * 10) / 10;
    return String(r);
  },
  deg(v) { return (Math.round(v * 10) / 10).toFixed(1) + "°"; },
  pad(n) { return String(n).padStart(2, "0"); },
  time(ts) {
    const d = new Date(ts);
    return Fmt.pad(d.getHours()) + ":" + Fmt.pad(d.getMinutes()) + ":" + Fmt.pad(d.getSeconds());
  },
};

/* ---------- پارسر خروجی فریم‌ور ----------
 * هر خط دریافتی از پورت/شبیه‌ساز اینجا تحلیل و به رویداد تبدیل می‌شود. */
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

  /** خط را تحلیل می‌کند و شیء رویداد برمی‌گرداند (یا null) */
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

/* ---------- مرجع کامل دستورات (برای تب راهنما و چیپ‌های کنسول) ---------- */
const COMMAND_REF = [
  { cmd: "home", args: "", desc: "هوم هوشمند همه محورها (به ترتیب Z,Y,X,A,B)", cat: "پایه", chip: true },
  { cmd: "home", args: "<1-5>", desc: "هوم هوشمند فقط یک محور", cat: "پایه", chip: false },
  { cmd: "status", args: "", desc: "نمایش کامل وضعیت سیستم و ۵ محور", cat: "پایه", chip: true },
  { cmd: "enable", args: "", desc: "فعال‌سازی برق همه موتورها", cat: "پایه", chip: true },
  { cmd: "enable", args: "<1-5>", desc: "فعال‌سازی یک محور", cat: "پایه", chip: false },
  { cmd: "disable", args: "", desc: "قطع برق همه موتورها", cat: "پایه", chip: true },
  { cmd: "disable", args: "<1-5>", desc: "قطع برق یک محور", cat: "پایه", chip: false },
  { cmd: "estop", args: "", desc: "⛔ توقف اضطراری فوری همه محورها", cat: "ایمنی", chip: true },
  { cmd: "reset", args: "", desc: "خروج از حالت توقف اضطراری", cat: "ایمنی", chip: true },
  { cmd: "demo", args: "", desc: "اجرای حرکت نمایشی (۶ حالت × ۳ تکرار) — نیاز به هوم دارد", cat: "حرکت", chip: true },
  { cmd: "stopdemo", args: "", desc: "توقف دمو", cat: "حرکت", chip: true },
  { cmd: "stop", args: "", desc: "توقف کامل + قطع برق موتورها", cat: "حرکت", chip: true },
  { cmd: "moveall", args: "<d1>..<d5>", desc: "حرکت همزمان هر ۵ محور با زاویه (درجه)", cat: "حرکت", chip: false },
  { cmd: "deg", args: "<axis> <deg>", desc: "حرکت یک محور با زاویه درجه", cat: "حرکت", chip: false },
  { cmd: "move", args: "<axis> <steps>", desc: "حرکت یک محور با تعداد استپ", cat: "حرکت", chip: false },
  { cmd: "savepos", args: "<slot>", desc: "ذخیره موقعیت فعلی در اسلات (0-9)", cat: "حافظه", chip: false },
  { cmd: "loadpos", args: "<slot>", desc: "فراخوانی و حرکت به موقعیت ذخیره‌شده", cat: "حافظه", chip: false },
  { cmd: "listpos", args: "", desc: "لیست همه موقعیت‌های ذخیره‌شده", cat: "حافظه", chip: true },
  { cmd: "clearpos", args: "<slot>", desc: "پاک کردن یک اسلات", cat: "حافظه", chip: false },
  { cmd: "timer", args: "<ms> <axis>", desc: "با تأخیر مشخص، دستور حرکت محور را ثبت می‌کند", cat: "زمان‌بند", chip: false },
  { cmd: "timers", args: "", desc: "تعداد تایمرهای فعال", cat: "زمان‌بند", chip: true },
  { cmd: "cleartimers", args: "", desc: "پاک کردن همه تایمرها", cat: "زمان‌بند", chip: true },
  { cmd: "teach", args: "", desc: "شروع ضبط حالت آموزش", cat: "آموزش", chip: true },
  { cmd: "teach step", args: "", desc: "ثبت یک استپ از موقعیت فعلی", cat: "آموزش", chip: true },
  { cmd: "teach stop", args: "", desc: "پایان ضبط", cat: "آموزش", chip: true },
  { cmd: "teach count", args: "", desc: "تعداد استپ‌های ضبط‌شده", cat: "آموزش", chip: true },
  { cmd: "play", args: "", desc: "پخش حرکت‌های آموزش‌دیده", cat: "آموزش", chip: true },
  { cmd: "play stop", args: "", desc: "توقف پخش", cat: "آموزش", chip: true },
  { cmd: "log on/off", args: "", desc: "فعال/غیرفعال کردن لاگ دستورات", cat: "لاگ", chip: true },
  { cmd: "log show", args: "", desc: "نمایش لاگ (حداکثر ۱۰ رکورد)", cat: "لاگ", chip: true },
  { cmd: "log clear", args: "", desc: "پاک کردن لاگ", cat: "لاگ", chip: true },
  { cmd: "profile", args: "", desc: "نمایش پروفایل سرعت فعلی", cat: "سرعت", chip: true },
  { cmd: "profile slow|normal|fast", args: "", desc: "تغییر پروفایل سرعت (۵۰٪ / ۱۰۰٪ / ۱۵۰٪)", cat: "سرعت", chip: false },
  { cmd: "traj stop", args: "", desc: "توقف مسیردهی Trajectory", cat: "مسیر", chip: true },
  { cmd: "ik", args: "<x> <y> <z>", desc: "کینماتیک معکوس: موقعیت mm → زاویه و حرکت", cat: "کینماتیک", chip: false },
  { cmd: "fk", args: "<a1>..<a5>", desc: "کینماتیک مستقیم: زوایا → موقعیت XYZ", cat: "کینماتیک", chip: false },
  { cmd: "sleep", args: "", desc: "حالت خواب (صرفه‌جویی انرژی)", cat: "انرژی", chip: true },
  { cmd: "wake", args: "", desc: "بیدار شدن از خواب", cat: "انرژی", chip: true },
  { cmd: "autosleep on/off", args: "", desc: "خواب خودکار پس از بی‌کاری", cat: "انرژی", chip: true },
];
