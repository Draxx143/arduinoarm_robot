/* ============================================================
 * app.js — AXIS-5 Robot Control, main UI logic
 * Transport: Web Serial (browser) / Electron bridge / Simulator
 * ============================================================ */
"use strict";

/* ---------- Safe storage ---------- */
const Store = {
  mem: {},
  get(k, d) {
    try { const v = localStorage.getItem("arm_" + k); return v === null ? d : v; }
    catch (e) { return (k in this.mem) ? this.mem[k] : d; }
  },
  set(k, v) {
    try { localStorage.setItem("arm_" + k, v); } catch (e) { this.mem[k] = v; }
  },
};

const $ = (id) => document.getElementById(id);

/* ---------- Global state ---------- */
const S = {
  mode: "off",                 // off | serial | sim
  serial: new SerialLink(),
  sim: null,
  state: "INIT",
  profileName: "—",
  sleeping: false,
  autoSleep: false,
  demo: { running: false, step: 0, total: FW.DEMO_MOVES.length },
  axes: FW.AXES.map(() => ({ steps: 0, deg: 0, homed: false, enabled: false, moving: false, endstop: "Open" })),
  targets: [0, 0, 0, 0, 0],
  teachLocal: [],
  teachCountFw: null,
  timersFw: null,
  timersLocal: [],
  slots: new Array(FW.MAX_POSITIONS).fill(null),
  history: [],
  histIdx: -1,
  pollTimer: null,
  degMode: true,
  lastWarnAt: 0,
  inStatus: false,
  tmpDemo: null,
  tmpSleep: false,
  pendingSlots: null,
  consoleLines: 0,
};

const AXC = ["#00c2d1", "#ffb020", "#ff7a1a", "#3fb950", "#9e86ff"];

/* keep slider/number inputs in sync with (possibly dragged) targets */
function syncJointInputs() {
  for (let i = 0; i < 5; i++) {
    const s = $("jSlider" + i), n = $("jNum" + i);
    if (!s || !n) continue;
    const v = S.degMode ? S.targets[i] : Kin.degToSteps(i, S.targets[i]);
    s.value = v; n.value = S.degMode ? v.toFixed(1) : Math.round(v);
    const pct = ((v - s.min) / (s.max - s.min)) * 100;
    s.style.setProperty("--val", pct + "%");
  }
}

/* ============================================================
 * Console / feed / toasts / modal
 * ============================================================ */
function addConsole(cls, text) {
  const box = $("consoleBox");
  const near = box.scrollTop + box.clientHeight >= box.scrollHeight - 50;
  const div = document.createElement("div");
  div.className = "ln " + cls;
  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = Fmt.time(Date.now());
  div.appendChild(ts);
  div.appendChild(document.createTextNode(text));
  box.appendChild(div);
  if (++S.consoleLines > 600) { box.removeChild(box.firstChild); S.consoleLines--; }
  if (near) box.scrollTop = box.scrollHeight;
}

const Feed = {
  paused: false,
  lastText: null,
  lastEl: null,
  count: 1,
  total: 0,
};
const FEED_ICONS = { tx: "▸", "rx-ok": "✓", "rx-err": "✗", warn: "⚠" };

function addFeed(cls, text) {
  Feed.total++;
  $("feedStat").textContent = Feed.total + " events";
  if (Feed.paused) return;
  const box = $("feedBox");

  /* aggregate repeats (e.g. polling spam) into one line with a ×N badge */
  if (text === Feed.lastText && Feed.lastEl && Feed.lastEl.isConnected) {
    Feed.count++;
    Feed.lastEl.querySelector(".fx").textContent = "×" + Feed.count;
    return;
  }
  Feed.lastText = text;
  Feed.count = 1;

  const div = document.createElement("div");
  div.className = "f-line " + cls;
  const icon = FEED_ICONS[cls] || "·";
  div.innerHTML = `<span class="f-i">${icon}</span><span class="f-x"></span><span class="f-t"></span><span class="fx"></span>`;
  div.querySelector(".f-x").textContent = text.replace(/^» /, "");
  div.querySelector(".f-t").textContent = Fmt.time(Date.now());
  box.prepend(div);
  Feed.lastEl = div;
  while (box.children.length > 80) box.removeChild(box.lastChild);
}

function toast(msg, type = "info", ms = 3200) {
  const box = $("toasts");
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.classList.add("hide"); setTimeout(() => t.remove(), 400); }, ms);
  while (box.children.length > 4) box.removeChild(box.firstChild);
}

function confirmModal(title, body) {
  return new Promise((res) => {
    $("modalTitle").textContent = title;
    $("modalBody").textContent = body;
    $("portList").innerHTML = "";
    $("portList").style.display = "none";
    $("modalBack").classList.add("show");
    const ok = $("modalOk"), cancel = $("modalCancel");
    ok.style.display = ""; cancel.style.display = "";
    const done = (v) => {
      $("modalBack").classList.remove("show");
      ok.onclick = cancel.onclick = null;
      res(v);
    };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
  });
}

/* ---------- Electron in-app serial port chooser ---------- */
let _portChooserDone = null;
window.addEventListener("arm-choose-serial-port", (e) => {
  const ports = e.detail || [];
  /* Connection-card scan mode: render into the card instead of the modal */
  if (S._scanActive) { renderScanRows(ports); return; }
  const list = $("portList");
  list.innerHTML = "";
  list.style.display = "flex";
  $("modalTitle").textContent = "Select Serial Port";
  $("modalOk").style.display = "none";
  $("modalCancel").style.display = "";

  if (!ports.length) {
    $("modalBody").textContent = "No serial ports found. Plug in the Arduino over USB and try again.";
    $("modalCancel").onclick = () => {
      $("modalBack").classList.remove("show");
      if (window.electronAPI) window.electronAPI.cancelChoose();
    };
    $("modalBack").classList.add("show");
    return;
  }

  $("modalBody").textContent = "Choose the port your Arduino Mega 2560 is connected to.";
  $("modalBack").classList.add("show");

  ports.forEach((p) => {
    const b = document.createElement("button");
    b.className = "port-item";
    const vid = p.usbVendorId ? (p.usbVendorId.toString(16).padStart(4, "0")) : null;
    const pid = p.usbProductId ? (p.usbProductId.toString(16).padStart(4, "0")) : null;
    b.innerHTML = `<span class="p-name">${p.portName || p.portId}</span>
      <span class="p-meta">${p.displayName || "Serial port"}${vid ? " · USB " + vid + ":" + pid : ""}</span>`;
    b.onclick = () => {
      $("modalBack").classList.remove("show");
      if (window.electronAPI) window.electronAPI.choosePort(p.portId);
      if (_portChooserDone) { _portChooserDone(); _portChooserDone = null; }
    };
    list.appendChild(b);
  });

  $("modalCancel").onclick = () => {
    $("modalBack").classList.remove("show");
    if (window.electronAPI) window.electronAPI.cancelChoose();
    if (_portChooserDone) { _portChooserDone(); _portChooserDone = null; }
  };
  _portChooserDone = () => { $("modalOk").style.display = ""; $("modalCancel").onclick = null; };
});

/* ============================================================
 * Connection card — pick / scan / auto-connect the serial port
 * ============================================================ */
const hex4 = (v) => (v || 0).toString(16).padStart(4, "0");
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
S._scanActive = false;
S._portNames = {};   /* vid:pid -> human-readable port name from the last scan */

function portKeyFromInfo(info) {
  if (!info) return "";
  return hex4(info.usbVendorId) + ":" + hex4(info.usbProductId);
}
function portLabelFor(info) {
  return S._portNames[portKeyFromInfo(info)] ||
    (info && info.usbVendorId ? "USB device " + hex4(info.usbVendorId) + ":" + hex4(info.usbProductId) : "Serial port");
}

/* rows shown while the chooser reports the system port list */
function renderScanRows(ports) {
  const rows = $("portRows");
  if (!rows) return;
  rows.innerHTML = "";
  if (!ports) {
    rows.innerHTML = `<div class="p-none">&#128269; Searching for serial devices&hellip;</div>`;
    return;
  }
  ports.forEach((p) => {
    S._portNames[portKeyFromInfo(p)] = p.portName || p.displayName || p.portId;
  });
  if (!ports.length) {
    rows.innerHTML = `<div class="p-none">No serial devices found &mdash; plug the Arduino in and scan again.</div>`;
  } else {
    ports.forEach((p) => {
      const vid = p.usbVendorId ? hex4(p.usbVendorId) : null;
      const pid = p.usbProductId ? hex4(p.usbProductId) : null;
      const row = document.createElement("div");
      row.className = "port-row";
      row.innerHTML = `<span class="p-dot"></span>
        <div class="p-info"><span class="p-name">${escH(p.portName || p.portId)}</span>
        <span class="p-meta">${escH(p.displayName || "Serial port")}${vid ? " &middot; USB " + vid + ":" + pid : ""}</span></div>`;
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = "Connect";
      b.onclick = () => { if (window.electronAPI) window.electronAPI.choosePort(p.portId); };
      row.appendChild(b);
      rows.appendChild(row);
    });
  }
  const cancel = document.createElement("button");
  cancel.className = "btn small";
  cancel.textContent = "Cancel scan";
  cancel.onclick = () => { if (window.electronAPI) window.electronAPI.cancelChoose(); };
  const wrap = document.createElement("div");
  wrap.className = "conn-tools";
  wrap.style.marginTop = "0";
  wrap.appendChild(cancel);
  rows.appendChild(wrap);
}

/* idle / connected view of the Connection card */
async function renderConnCard() {
  const rows = $("portRows");
  if (!rows) return;
  const scan = $("btnScanPorts"), disc = $("btnDiscPort"), chk = $("chkAutoPort");
  if (!scan) return;
  const supported = SerialLink.supported;
  chk.checked = Store.get("auto_port", "0") === "1";
  disc.style.display = S.mode === "serial" ? "" : "none";
  scan.style.display = S.mode === "serial" ? "none" : "";
  scan.disabled = !supported;

  if (!supported) {
    rows.innerHTML = `<div class="p-none">Web Serial is not available in this environment.</div>`;
    $("portHint").textContent = S.mode === "sim"
      ? "Simulator active — no real port needed."
      : "Use the simulator, or run in Chrome / Edge / Electron.";
    return;
  }

  if (S.mode === "serial") {
    const info = S.serial.activeInfo || {};
    const name = S.serial.activeLabel || portLabelFor(info);
    rows.innerHTML = `<div class="port-row on"><span class="p-dot"></span>
      <div class="p-info"><span class="p-name">${escH(name)}</span>
      <span class="p-meta">connected @ ${S.serial.baud} baud</span></div>
      <span class="p-badge">CONNECTED</span></div>`;
    $("portHint").textContent = "Board is linked — commands go to the real firmware.";
    return;
  }

  let granted = [];
  try { granted = await navigator.serial.getPorts(); } catch (e) {}
  rows.innerHTML = "";
  if (!granted.length) {
    rows.innerHTML = `<div class="p-none">No known ports yet &mdash; click <b>Scan Ports</b> with the Arduino plugged in.</div>`;
  } else {
    granted.forEach((port) => {
      const info = SerialLink._safeInfo(port);
      const label = portLabelFor(info);
      const last = Store.get("last_port", "") === portKeyFromInfo(info);
      const row = document.createElement("div");
      row.className = "port-row";
      row.innerHTML = `<span class="p-dot"></span>
        <div class="p-info"><span class="p-name">${escH(label)}</span>
        <span class="p-meta">ready${info.usbVendorId ? " &middot; USB " + hex4(info.usbVendorId) + ":" + hex4(info.usbProductId) : ""}${last ? " &middot; <b>last used</b>" : ""}</span></div>`;
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = "Connect";
      b.onclick = () => connectDirect(port, label);
      row.appendChild(b);
      rows.appendChild(row);
    });
  }
  $("portHint").textContent = S.mode === "sim"
    ? "Simulator active — scan to switch to the real board."
    : "Pick a port, or Scan to discover new devices.";
}

async function connectDirect(port, label) {
  if (S.mode === "serial" || !SerialLink.supported) return;
  stopSim();
  const baud = parseInt($("selBaud").value, 10);
  try {
    addConsole("sys", `[SYS] opening ${label || "port"} @ ${baud} baud…`);
    await S.serial.connectPort(port, baud, label || null);
  } catch (e) {
    const msg = "Connection failed: " + e.message;
    addConsole("err", "!! " + msg);
    toast(msg, "err");
    renderConnCard();
  }
}

/* scan from the Connection card: full system list rendered in the card */
async function scanPorts() {
  if (!SerialLink.supported) {
    toast("Web Serial is not available in this environment", "err", 5000);
    return;
  }
  if (S.mode === "serial") return;
  if (!(window.electronAPI && window.electronAPI.isElectron)) {
    /* plain browser: the native chooser does the picking */
    toggleSerial();
    return;
  }
  S._scanActive = true;
  renderScanRows(null);
  const baud = parseInt($("selBaud").value, 10);
  stopSim();
  try {
    addConsole("sys", `[SYS] scanning serial ports @ ${baud}…`);
    await S.serial.connect(baud);
    Store.set("prefer_hw", "1");
  } catch (e) {
    const msg = e.message === "PORT_CANCELLED"
      ? "Scan finished — no port picked"
      : "Scan failed: " + e.message;
    addConsole("sys", "[SYS] " + msg);
    $("portHint").textContent = msg + ".";
  } finally {
    S._scanActive = false;
    renderConnCard();
  }
}

/* ============================================================
 * Send / receive
 * ============================================================ */
function send(text) {
  if (!text) return false;
  if (S.mode === "off") {
    const now = Date.now();
    addConsole("warn", "✗ not sent ('" + text + "') — connect first or start the simulator");
    if (now - S.lastWarnAt > 3000) {
      toast("Connect to the Arduino or turn on the simulator first", "warn");
      S.lastWarnAt = now;
    }
    return false;
  }
  addConsole("tx", "» " + text);
  if (text !== "status") addFeed("tx", "» " + text);
  if (S.mode === "serial") {
    S.serial.write(text).catch((e) => {
      addConsole("err", "!! send error: " + e.message);
      toast("Send error: " + e.message, "err");
    });
  } else if (S.sim) {
    S.sim.handle(text);
  }
  return true;
}

function rxLine(line) {
  addConsole("rx", line);
  const ev = Parse.line(line);

  if (line.trim().startsWith("=== System Status")) {
    S.inStatus = true;
    S.tmpDemo = null;
    S.tmpSleep = false;
    S.pendingSlots = null;
    return;
  }
  if (line.trim() === "======================" && S.inStatus) {
    S.inStatus = false;
    S.demo = S.tmpDemo || { running: false, step: 0, total: FW.DEMO_MOVES.length };
    S.sleeping = S.tmpSleep;
    renderStats();
    renderEnergy();
    renderSlots();
    return;
  }
  if (/^>(?!>)/.test(line.trim())) return; /* firmware echo */
  if (!ev) return;

  switch (ev.type) {
    case "axis": {
      const a = S.axes[ev.axis];
      if (!a) break;
      /* live speed telemetry (deg/s, smoothed) */
      const now = Date.now();
      if (a._lt && ev.deg !== a._ld) {
        const dt = (now - a._lt) / 1000;
        if (dt > 0.05) {
          const inst = Math.abs(ev.deg - a._ld) / dt;
          a.vel = (a.vel || 0) * 0.45 + inst * 0.55;
        }
      }
      a._lt = now; a._ld = ev.deg;
      a.steps = ev.steps; a.deg = ev.deg; a.homed = ev.homed;
      a.enabled = ev.enabled; a.moving = ev.moving; a.endstop = ev.endstop;
      renderAxisCard(ev.axis);
      break;
    }
    case "state": setStateUI(ev.key); break;
    case "profile":
      S.profileName = ev.name;
      $("profileNow").textContent = ev.name;
      syncProfileRadios(ev.name);
      break;
    case "sleeping": S.tmpSleep = true; break;
    case "demoRun": S.tmpDemo = { running: true, step: ev.step, total: ev.total }; break;
    case "demoStep":
      S.demo = { running: true, step: ev.step, total: ev.total };
      renderStats(); highlightDemoPose(ev.step);
      addFeed("rx-ok", `Demo: move ${ev.step}/${ev.total}`);
      break;
    case "posSaved":
      S.slots[ev.slot] = { name: "Pos" + ev.slot };
      renderSlots();
      toast(`Pose saved to slot ${ev.slot}`, "ok");
      break;
    case "posLoaded":
      toast(`Slot ${ev.slot} loaded — arm is moving`, "info");
      setTimeout(() => send(Cmd.status()), 900);
      break;
    case "slotEmpty": toast(`Slot ${ev.slot} is empty`, "warn"); break;
    case "slotsListStart": S.pendingSlots = {}; break;
    case "slotItem":
      if (S.pendingSlots) S.pendingSlots[ev.slot] = { name: ev.name };
      break;
    case "teachCount":
      S.teachCountFw = ev.count;
      $("teachCountLabel").textContent = ev.count;
      $("statTeach").textContent = ev.count;
      break;
    case "teachStepSaved":
      S.teachLocal.push(currentDegs());
      renderTeachTimeline();
      break;
    case "teachStart":
      S.teachLocal = [];
      renderTeachTimeline();
      toast("Teach recording started — use “Teach Step” to capture poses", "info");
      break;
    case "teachStopped":
      S.teachCountFw = ev.count;
      $("teachCountLabel").textContent = ev.count;
      toast(`Recording finished — ${ev.count} steps captured`, "ok");
      break;
    case "playStart": toast(`Playing back ${ev.count} steps`, "info"); break;
    case "playDone": toast("Playback complete ✓", "ok"); break;
    case "timers":
      S.timersFw = ev.count;
      renderTimersLocal();
      break;
    case "ikResult":
      $("ikResult").textContent = "IK ⇒ " + ev.angles.map((a) => a.toFixed(1) + "°").join(" | ");
      toast("IK solved — arm is moving", "ok");
      break;
    case "fkResult":
      $("fkResult").textContent = `FK ⇒ X=${ev.x}  Y=${ev.y}  Z=${ev.z} (mm)`;
      break;
    case "ready":
      toast("✓ System ready!", "ok");
      setStateUI("READY");
      break;
    case "moveDone": addFeed("rx-ok", "✓ Move complete"); break;
    case "estop":
      toast("⛔ EMERGENCY STOP triggered!", "err", 5000);
      setStateUI("ESTOP");
      S.demo.running = false;
      break;
    case "rangeError":
      toast(`Axis ${ev.axis + 1} angle is out of range!`, "err");
      break;
    case "unknown": toast("Unknown command — see the Reference tab", "warn"); break;
    case "homingStart": toast("Smart homing started…", "info"); break;
    case "demoStart": S.demo.running = true; renderStats(); break;
    case "demoStop": S.demo.running = false; renderStats(); break;
    case "demoDone":
      S.demo.running = false; renderStats();
      toast("Demo finished", "ok");
      break;
    case "sleepNow": S.sleeping = true; renderEnergy(); break;
    case "wakeNow": S.sleeping = false; renderEnergy(); break;
    case "autoSleepOn": S.autoSleep = true; renderEnergy(); break;
    case "autoSleepOff": S.autoSleep = false; renderEnergy(); break;
    case "error": addFeed("rx-err", "!! " + ev.msg); break;
  }
}

function setStateUI(key) {
  S.state = key;
  const st = FW.STATES[key] || FW.STATES.INIT;
  const badge = $("stateBadge");
  $("stateLabel").textContent = st.label;
  badge.querySelector(".dot").style.background = st.color;
  badge.style.borderColor = st.color + "88";
  badge.style.color = st.color;
  badge.classList.toggle("estop", key === "ESTOP");
  $("lampRun").classList.toggle("on", key === "READY" || key === "MOVING");
  $("lampErr").classList.toggle("on", key === "ESTOP" || key === "ERROR");
  renderStats();
}

/* ============================================================
 * Connection modes
 * ============================================================ */
function setMode(mode) {
  S.mode = mode;
  renderConnCard();
  const led = $("led");
  led.className = "led" + (mode === "serial" ? " on" : mode === "sim" ? " sim" : "");
  $("connText").textContent = mode === "serial" ? "LINKED" : mode === "sim" ? "SIMULATING" : "OFFLINE";
  $("connMode").textContent = mode === "serial" ? "Web Serial @ " + S.serial.baud
    : mode === "sim" ? "Firmware simulator" : "—";
  $("lampCom").classList.toggle("on", mode === "serial" || mode === "sim");
  $("simBanner").classList.toggle("show", mode === "sim");
  $("btnConnect").textContent = mode === "serial" ? "✕ Disconnect" : "⚡ Connect Arduino";
  $("btnSim").textContent = mode === "sim" ? "■ Stop Simulator" : "▦ Simulator";
  restartPoll();
}

function startSim() {
  if (S.mode === "serial") { toast("Disconnect the serial link first", "warn"); return; }
  S.sim = new SimFirmware((l) => rxLine(l));
  setMode("sim");
  setStateUI("INIT");
  ["======================================",
   "5 DOF Robot Arm - TEST MODE (No ROS)",
   "[SIM] Firmware simulator running in-app",
   "System initialized.",
   "======================================"].forEach((l) => addConsole("sys", l));
  addFeed("warn", "Simulator started");
  toast("Simulator active — everything behaves like the real board", "info", 4200);
  Store.set("prefer_hw", "0");
}

function stopSim() {
  S.sim = null;
  if (S.mode === "sim") setMode("off");
}

async function toggleSerial() {
  if (S.mode === "serial") {
    await S.serial.disconnect();
    return;
  }
  if (!SerialLink.supported) {
    toast("Web Serial is not available in this environment", "err", 5000);
    return;
  }
  stopSim();
  const baud = parseInt($("selBaud").value, 10);
  try {
    addConsole("sys", `[SYS] connecting @ ${baud} baud…`);
    await S.serial.connect(baud);
    Store.set("prefer_hw", "1");
  } catch (e) {
    const msg = e.message === "PORT_CANCELLED"
      ? "Port selection cancelled"
      : "Connection failed: " + e.message;
    addConsole("err", "!! " + msg);
    if (e.message !== "PORT_CANCELLED") toast(msg, "err");
  }
}

S.serial.onConnect = (baud) => {
  setMode("serial");
  addConsole("sys", `[SYS] linked @ ${baud} — waiting for board…`);
  addFeed("rx-ok", "Linked @" + baud);
  toast("Connected to the Arduino ✓", "ok");
  setStateUI("INIT");
  try { Store.set("last_port", portKeyFromInfo(S.serial.activeInfo || {})); } catch (e) {}
  renderConnCard();
  setTimeout(() => send(Cmd.status()), 600);
};
S.serial.onDisconnect = () => {
  if (S.mode === "serial") setMode("off");
  addConsole("sys", "[SYS] link closed");
  renderConnCard();
};
S.serial.onLine = (l) => rxLine(l);
S.serial.onError = (m) => { addConsole("err", "!! " + m); toast(m, "err"); };

/* ============================================================
 * Polling
 * ============================================================ */
function restartPoll() {
  if (S.pollTimer) clearInterval(S.pollTimer);
  S.pollTimer = null;
  const v = parseInt($("selPoll").value, 10);
  if (v > 0 && S.mode !== "off") S.pollTimer = setInterval(() => send(Cmd.status()), v);
}

/* ============================================================
 * Dashboard
 * ============================================================ */
function buildAxisCards() {
  const row = $("axesRow");
  row.innerHTML = "";
  FW.AXES.forEach((ax, i) => {
    const c = document.createElement("div");
    c.className = "axis-card";
    c.id = "axisCard" + i;
    c.style.setProperty("--jc", AXC[i]);
    c.innerHTML = `
      <div class="head"><span class="jid">J${ax.joint}</span>
      <span class="jname">${ax.name}</span></div>
      <div class="deg" id="axDeg${i}">0.0°</div>
      <div class="steps" id="axSteps${i}">0 steps</div>
      <div class="bar"><i id="axBar${i}" style="width:0%"></i></div>
      <div class="flags" id="axFlags${i}"></div>`;
    row.appendChild(c);
  });
}

function renderAxisCard(i) {
  const ax = FW.AXES[i], a = S.axes[i];
  $("axDeg" + i).textContent = a.deg.toFixed(1) + "°";
  $("axSteps" + i).textContent = a.steps + " steps";
  const pct = Math.max(0, Math.min(100, ((a.deg - ax.min) / (ax.max - ax.min)) * 100));
  $("axBar" + i).style.width = pct + "%";
  const fl = (txt, ok) => `<span class="flag ${ok ? "y" : "n"}">${txt}</span>`;
  const spd = (a.moving && a.vel && a.vel > 1) ? `<span class="flag info">▲ ${a.vel.toFixed(0)}°/s</span>` : "";
  $("axFlags" + i).innerHTML =
    fl("HOME", a.homed) + fl("PWR", a.enabled) +
    (spd || (a.moving ? `<span class="flag info">MOVING</span>` : "")) +
    `<span class="flag ${a.endstop === "Open" ? "" : "n"}">ES:${a.endstop === "Open" ? "OK" : "TRIG"}</span>`;
  $("axisCard" + i).classList.toggle("moving", a.moving);
  renderStats();
}

function renderStats() {
  $("statHomed").textContent = S.axes.filter((a) => a.homed).length + "/5";
  $("statMoving").textContent = S.axes.filter((a) => a.moving).length;
  $("statEnabled").textContent = S.axes.filter((a) => a.enabled).length + "/5";
  $("statProfile").textContent = S.profileName;
  $("statDemo").textContent = S.demo.running ? `RUNNING (${S.demo.step}/${S.demo.total})` : "idle";
  $("statEnergy").textContent = S.sleeping ? "ASLEEP" : (S.autoSleep ? "auto-sleep armed" : "normal");
}

/* ============================================================
 * Motion tab
 * ============================================================ */
function buildJoints() {
  const list = $("jointsList");
  list.innerHTML = "";
  FW.AXES.forEach((ax, i) => {
    const deg = S.axes[i].deg;
    const lo = S.degMode ? ax.min : ax.soft.min;
    const hi = S.degMode ? ax.max : ax.soft.max;
    const row = document.createElement("div");
    row.className = "joint-row";
    row.innerHTML = `
      <div class="jl"><b style="color:${AXC[i]}">${ax.name} <span class="tiny">J${ax.joint} · ${ax.id}</span></b>
        <span>${lo}…${hi}${S.degMode ? "°" : " steps"}</span></div>
      <input type="range" id="jSlider${i}" min="${lo}" max="${hi}" step="${S.degMode ? 0.5 : 1}"
        value="${S.degMode ? deg.toFixed(1) : Kin.degToSteps(i, deg)}" style="--axc:${AXC[i]}">
      <input type="number" id="jNum${i}" step="${S.degMode ? 0.5 : 1}"
        min="${lo}" max="${hi}"
        value="${S.degMode ? deg.toFixed(1) : Kin.degToSteps(i, deg)}">
      <span class="jval" id="jCur${i}">${deg.toFixed(1)}°</span>
      <div style="display:flex;gap:4px">
        <button class="btn small teal" id="jGo${i}" title="Send move">GO ➤</button>
        <button class="btn small" id="jHome${i}" title="Home this axis">⌂</button>
      </div>`;
    list.appendChild(row);

    const slider = $("jSlider" + i), num = $("jNum" + i);
    /* FIX: نوار اسلایدر در بار اول با درصد درست رنگ شود
       (قبلاً پیش‌فرض CSS یعنی ۵۰٪ می‌ماند — برای J2/J3 که صفرشان
       ابتدای محدوده است، نیمه‌رنگ دیده می‌شد) */
    const initV = S.degMode ? deg : Kin.degToSteps(i, deg);
    slider.style.setProperty("--val", (((initV - lo) / (hi - lo)) * 100) + "%");
    const sync = (v, fromSlider) => {
      v = Math.max(+slider.min, Math.min(+slider.max, v));
      const pct = ((v - slider.min) / (slider.max - slider.min)) * 100;
      slider.style.setProperty("--val", pct + "%");
      if (fromSlider) num.value = S.degMode ? (+v).toFixed(1) : Math.round(v);
      else slider.value = v;
      S.targets[i] = S.degMode ? +v : Kin.stepsToDeg(i, v);
      return v;
    };
    slider.addEventListener("input", () => sync(+slider.value, true));
    slider.addEventListener("change", () => {
      const v = sync(+slider.value, true);
      if ($("swLive").checked) sendJoint(i, v);
    });
    num.addEventListener("change", () => {
      const v = sync(+num.value || 0, false);
      if ($("swLive").checked) sendJoint(i, v);
    });
    $("jGo" + i).addEventListener("click", () => sendJoint(i, +num.value || 0));
    $("jHome" + i).addEventListener("click", () => send(Cmd.homeAxis(i + 1)));
  });
}

function sendJoint(i, v) {
  if (S.degMode) {
    const ax = FW.AXES[i];
    if (v < ax.min || v > ax.max) {
      toast(`Axis ${i + 1} range: ${ax.min}° to ${ax.max}°`, "err");
      return;
    }
    send(Cmd.deg(i + 1, v));
  } else {
    send(Cmd.move(i + 1, Math.round(v)));
  }
}

/* ---------- moveall ---------- */
function buildMoveAll() {
  const box = $("moveAllInputs");
  box.innerHTML = "";
  FW.AXES.forEach((ax, i) => {
    const f = document.createElement("div");
    f.className = "field";
    f.innerHTML = `<label style="color:${AXC[i]}">J${ax.joint} ${ax.name}</label>
      <input type="number" id="ma${i}" value="0" min="${ax.min}" max="${ax.max}" step="1">`;
    box.appendChild(f);
  });
  const sel = $("selPreset");
  FW.DEMO_MOVES.forEach((p, i) => {
    const o = document.createElement("option");
    o.value = "demo" + i;
    o.textContent = `${p.label}  [${p.angles.join(", ")}]`;
    sel.appendChild(o);
  });
}

function readMoveAll() {
  const vals = [];
  for (let i = 0; i < 5; i++) {
    let v = parseFloat($("ma" + i).value);
    if (isNaN(v)) v = 0;
    const ax = FW.AXES[i];
    if (v < ax.min || v > ax.max) {
      toast(`J${i + 1} (${ax.name}) out of range ${ax.min}…${ax.max}`, "err");
      return null;
    }
    vals.push(v);
  }
  return vals;
}

function goMoveAll(vals, silent) {
  send(Cmd.moveAll(vals));
  S.targets = vals.slice();
  syncJointInputs();
  if (!silent) toast("moveall sent → " + vals.map((v) => v + "°").join(" "), "info");
}

/* ============================================================
 * Program Sequencer — run a list of poses step by step
 * ============================================================ */
S.seq = { items: [], playing: false, idx: 0 };

function addCurrentPoseToSeq() {
  if (S.seq.items.length >= 50) { toast("Program is full (50 steps)", "warn"); return; }
  const pose = currentDegs();
  S.seq.items.push({ label: "Step " + (S.seq.items.length + 1), pose, dwell: 800 });
  renderSeqList();
  toast("Pose added: [" + pose.join(", ") + "]", "ok");
}

function renderSeqList() {
  const box = $("seqList");
  if (!box) return;
  box.innerHTML = "";
  S.seq.items.forEach((it, i) => {
    const d = document.createElement("div");
    d.className = "seq-item" + (S.seq.playing && S.seq.idx === i ? " active" : "");
    d.innerHTML = `
      <span class="seq-n">${String(i + 1).padStart(2, "0")}</span>
      <input type="text" class="seq-label" value="${it.label.replace(/"/g, "&quot;")}">
      <code>[${it.pose.map((v) => v.toFixed(0)).join(", ")}]</code>
      <label class="seq-dwell"><input type="number" value="${it.dwell}" min="0" step="100">ms</label>
      <button class="btn small teal" title="Run this step now">▶</button>
      <button class="btn small" title="Move up">↑</button>
      <button class="btn small" title="Move down">↓</button>
      <button class="btn small red" title="Delete">✕</button>`;
    const [bRun, bUp, bDown, bDel] = d.querySelectorAll("button");
    bRun.onclick = () => { goMoveAll(it.pose.slice()); };
    bUp.onclick = () => { if (i > 0) { [S.seq.items[i - 1], S.seq.items[i]] = [S.seq.items[i], S.seq.items[i - 1]]; renderSeqList(); } };
    bDown.onclick = () => { if (i < S.seq.items.length - 1) { [S.seq.items[i + 1], S.seq.items[i]] = [S.seq.items[i], S.seq.items[i + 1]]; renderSeqList(); } };
    bDel.onclick = () => { S.seq.items.splice(i, 1); renderSeqList(); };
    d.querySelector(".seq-label").addEventListener("change", (e) => { it.label = e.target.value; });
    d.querySelector(".seq-dwell input").addEventListener("change", (e) => { it.dwell = Math.max(0, parseInt(e.target.value, 10) || 0); });
    box.appendChild(d);
  });
  if (!S.seq.items.length) {
    box.innerHTML = `<p class="tiny" style="text-align:center;padding:14px">Empty program — pose the arm (drag the joints!) then press "Add current pose".</p>`;
  }
}

function seqPlay() {
  if (!S.seq.items.length) { toast("Program is empty — add poses first", "warn"); return; }
  S.seq.playing = true;
  seqRunFrom(0);
}

function seqStop() {
  S.seq.playing = false;
  const p = $("seqProgress");
  if (p) p.textContent = "idle";
}

function seqRunFrom(i) {
  if (!S.seq.playing) return;
  if (i >= S.seq.items.length) {
    S.seq.playing = false;
    $("seqProgress").textContent = "✓ done";
    toast("Program finished ✓", "ok");
    renderSeqList();
    return;
  }
  S.seq.idx = i;
  const it = S.seq.items[i];
  $("seqProgress").textContent = `▶ ${i + 1}/${S.seq.items.length}`;
  renderSeqList();
  goMoveAll(it.pose.slice(), true);
  /* wait until the arm reports all axes stopped, then dwell, then next */
  setTimeout(() => {
    let waited = 0;
    const iv = setInterval(() => {
      if (!S.seq.playing) { clearInterval(iv); return; }
      send(Cmd.status());
      waited += 400;
      const still = S.axes.some((a) => a.moving);
      if ((!still && waited > 800) || waited > 30000) {
        clearInterval(iv);
        setTimeout(() => seqRunFrom(i + 1), Math.max(0, it.dwell || 800));
      }
    }, 400);
  }, 150);
}

function seqExport() {
  const blob = new Blob([JSON.stringify({ app: "AXIS-5", type: "program", items: S.seq.items }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "axis5-program.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function seqImport(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const data = JSON.parse(rd.result);
      if (!Array.isArray(data.items)) throw new Error("bad format");
      S.seq.items = data.items
        .filter((it) => Array.isArray(it.pose) && it.pose.length === 5)
        .map((it) => ({
          label: String(it.label || "Step"),
          pose: it.pose.map((v, i) => Kin.clampDeg(i, parseFloat(v) || 0)),
          dwell: Math.max(0, parseInt(it.dwell, 10) || 800),
        }));
      renderSeqList();
      toast(`Imported ${S.seq.items.length} steps`, "ok");
    } catch (e) { toast("Invalid program file", "err"); }
  };
  rd.readAsText(file);
}

/* ---------- profile ---------- */
function syncProfileRadios(name) {
  const key = FW.PROFILES.find((p) => name.includes(p.label))?.key
    || (name.includes("SLOW") ? "slow" : name.includes("FAST") ? "fast" : "normal");
  const r = document.querySelector(`#profileSeg input[value="${key}"]`);
  if (r) r.checked = true;
}

/* ============================================================
 * Kinematics tab
 * ============================================================ */
function buildFkInputs() {
  const box = $("fkInputs");
  box.innerHTML = "";
  FW.AXES.forEach((ax, i) => {
    const f = document.createElement("div");
    f.className = "field";
    f.innerHTML = `<label style="color:${AXC[i]}">J${ax.joint} ${ax.id} (°)</label>
      <input type="number" id="fkA${i}" value="0" min="${ax.min}" max="${ax.max}" step="1">`;
    box.appendChild(f);
  });
}

function calcIKLocal(move) {
  const x = parseFloat($("ikX").value) || 0;
  const y = parseFloat($("ikY").value) || 0;
  const z = parseFloat($("ikZ").value) || 0;
  const res = Kin.ik(x, y, z);
  const box = $("ikResult");
  if (!res) {
    box.textContent = `✗ Out of reach! Required distance = ${Math.round(Math.hypot(Math.hypot(x, y), z))} mm (max 250 mm)`;
    box.style.color = "#ff9b9e";
    return null;
  }
  box.style.color = "#7ce7ef";
  box.textContent = "IK ⇒ " + res.map((a) => a.toFixed(1) + "°").join(" | ");
  if (move) {
    S.targets = res.slice();
  }
  return res;
}

function calcFKLocal() {
  const angles = [];
  for (let i = 0; i < 5; i++) angles.push(parseFloat($("fkA" + i).value) || 0);
  const p = Kin.fk(angles);
  $("fkResult").style.color = "#ffcd69";
  $("fkResult").textContent = `FK ⇒ X=${p.x.toFixed(1)}  Y=${p.y.toFixed(1)}  Z=${p.z.toFixed(1)} (mm) — reach ${Math.round(p.reach)} mm`;
  S.targets = angles.slice();
  return p;
}

/* ============================================================
 * Memory tab
 * ============================================================ */
function buildSlots() {
  const g = $("slotsGrid");
  g.innerHTML = "";
  for (let i = 0; i < FW.MAX_POSITIONS; i++) {
    const d = document.createElement("div");
    d.className = "slot";
    d.id = "slot" + i;
    d.innerHTML = `
      <div class="s-num">SLOT ${i}</div>
      <div class="s-name" id="slotName${i}">—</div>
      <div class="s-btns">
        <button class="btn small green" title="savepos">SAVE</button>
        <button class="btn small teal" title="loadpos">LOAD</button>
        <button class="btn small red" title="clearpos">CLR</button>
      </div>`;
    const [bSave, bLoad, bClear] = d.querySelectorAll("button");
    bSave.onclick = () => send(Cmd.savePos(i));
    bLoad.onclick = () => send(Cmd.loadPos(i));
    bClear.onclick = async () => {
      if (await confirmModal("Clear slot", `Erase slot ${i}?`)) send(Cmd.clearPos(i));
    };
    g.appendChild(d);
  }
}

function renderSlots() {
  if (S.pendingSlots) {
    S.slots = new Array(FW.MAX_POSITIONS).fill(null);
    for (const k in S.pendingSlots) S.slots[+k] = S.pendingSlots[k];
    S.pendingSlots = null;
  }
  for (let i = 0; i < FW.MAX_POSITIONS; i++) {
    const s = S.slots[i];
    $("slot" + i).classList.toggle("saved", !!s);
    $("slotName" + i).textContent = s ? s.name : "—";
  }
}

function renderTeachTimeline() {
  const tl = $("teachTimeline");
  tl.innerHTML = "";
  S.teachLocal.forEach((d, i) => {
    const s = document.createElement("span");
    s.className = "t-step";
    s.textContent = `#${i + 1} [${d.map((v) => v.toFixed(0)).join(",")}]`;
    tl.appendChild(s);
  });
  $("statTeach").textContent = S.teachLocal.length;
}

function currentDegs() {
  return S.axes.map((a) => Math.round(a.deg * 10) / 10);
}

function buildDemoPoses() {
  const box = $("demoPosesList");
  box.innerHTML = "";
  FW.DEMO_MOVES.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "row";
    row.id = "demoPose" + (i + 1);
    row.style.cssText = "border:1px dashed #232c39;border-radius:4px;padding:6px 10px;transition:.3s";
    row.innerHTML = `
      <b style="font-size:12px">${p.label}</b>
      <span class="tiny" style="font-family:var(--mono)">[${p.angles.join(", ")}]°</span>
      <span style="margin-left:auto;display:flex;gap:5px">
        <button class="btn small teal">↧ Insert</button>
        <button class="btn small amber">▶ Run</button>
      </span>`;
    const [bIns, bGo] = row.querySelectorAll("button");
    bIns.onclick = () => {
      p.angles.forEach((v, j) => ($("ma" + j).value = v));
      toast("Inserted into moveall — press “Execute moveall” to apply", "info");
    };
    bGo.onclick = () => goMoveAll(p.angles.slice());
    box.appendChild(row);
  });
}

function highlightDemoPose(step) {
  FW.DEMO_MOVES.forEach((_, i) => {
    const el = $("demoPose" + (i + 1));
    if (el) el.style.borderColor = i + 1 === step ? "rgba(255,176,32,.8)" : "#232c39";
  });
}

/* ============================================================
 * Scheduler tab
 * ============================================================ */
function buildTimerAxis() {
  const sel = $("timAxis");
  FW.AXES.forEach((ax, i) => {
    const o = document.createElement("option");
    o.value = i + 1;
    o.textContent = `J${ax.joint} — ${ax.name} (${ax.id})`;
    sel.appendChild(o);
  });
}

function renderTimersLocal() {
  const box = $("timersList");
  box.innerHTML = "";
  const now = Date.now();
  S.timersLocal = S.timersLocal.filter((t) => t.fireAt > now);
  S.timersLocal.forEach((t) => {
    const s = document.createElement("span");
    s.className = "t-step";
    s.textContent = `◷ ${Math.ceil((t.fireAt - now) / 1000)}s → J${t.axis}`;
    box.appendChild(s);
  });
  $("timersLocalCount").textContent =
    S.timersLocal.length + (S.timersFw !== null && S.timersFw !== undefined ? ` (fw: ${S.timersFw})` : "");
}

/* ============================================================
 * Console tab
 * ============================================================ */
function buildChips() {
  const box = $("chipsBox");
  box.innerHTML = "";
  /* فقط دستورات پرکاربرد و «کامل» — هر رشته اینجا عیناً توسط پارسر
     فریم‌ور پذیرفته می‌شود (بدون آرگومان الزامی، بدون تکرار). */
  const QUICK_CMDS = [
    { cmd: "home", cls: "" },
    { cmd: "status", cls: "" },
    { cmd: "estop", cls: "danger" },
    { cmd: "reset", cls: "" },
    { cmd: "enable", cls: "" },
    { cmd: "disable", cls: "" },
    { cmd: "demo", cls: "" },
    { cmd: "stopdemo", cls: "" },
    { cmd: "stop", cls: "" },
    { cmd: "teach", cls: "" },
    { cmd: "teach step", cls: "" },
    { cmd: "teach stop", cls: "" },
    { cmd: "play", cls: "" },
    { cmd: "play stop", cls: "" },
    { cmd: "listpos", cls: "" },
    { cmd: "timers", cls: "" },
    { cmd: "cleartimers", cls: "" },
    { cmd: "profile slow", cls: "warn" },
    { cmd: "profile normal", cls: "warn" },
    { cmd: "profile fast", cls: "warn" },
    { cmd: "log on", cls: "" },
    { cmd: "log off", cls: "" },
    { cmd: "log show", cls: "" },
    { cmd: "log clear", cls: "" },
    { cmd: "sleep", cls: "" },
    { cmd: "wake", cls: "" },
    { cmd: "autosleep on", cls: "" },
    { cmd: "autosleep off", cls: "" },
  ];
  QUICK_CMDS.forEach((it) => {
    const b = document.createElement("button");
    b.className = "chip " + it.cls;
    b.textContent = it.cmd;
    b.onclick = () => send(it.cmd);
    box.appendChild(b);
  });
}

function sendFromInput() {
  const inp = $("cmdInput");
  const v = inp.value.trim();
  if (!v) return;
  S.history.push(v);
  if (S.history.length > 60) S.history.shift();
  S.histIdx = S.history.length;
  inp.value = "";
  send(v);
}

/* ============================================================
 * Reference tab
 * ============================================================ */
function buildHelp() {
  const tb = $("refTableBody");
  tb.innerHTML = "";
  COMMAND_REF.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><code>${c.cmd}${c.args ? " " + c.args : ""}</code></td><td>${c.desc}</td><td><span class="flag info">${c.cat}</span></td>`;
    tb.appendChild(tr);
  });
  const ab = $("axisCfgBody");
  ab.innerHTML = "";
  FW.AXES.forEach((ax) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b style="color:${AXC[ax.joint - 1]}">J${ax.joint} ${ax.id}</b> ${ax.name}</td>
      <td class="tiny">${ax.role}</td>
      <td><code>${ax.min}…${ax.max}°</code></td>
      <td><code>${ax.stepsPerDeg}</code></td>
      <td><code>${ax.gear}</code></td>
      <td><code>${ax.maxSpeed}</code></td>
      <td><code>${ax.accel}</code></td>
      <td><code>${ax.pins.step}/${ax.pins.dir}/${ax.pins.enable}/${ax.pins.endstop}</code></td>`;
    ab.appendChild(tr);
  });
}

/* ============================================================
 * Helpers
 * ============================================================ */
function updateLinkStats() {
  if (S.mode === "serial") {
    $("txCount").textContent = Fmt.bytes(S.serial.txCount);
    $("rxCount").textContent = Fmt.bytes(S.serial.rxCount);
    const led = $("led");
    if (S.serial.rxCount !== updateLinkStats._lastRx) {
      led.classList.remove("blink"); void led.offsetWidth; led.classList.add("blink");
      updateLinkStats._lastRx = S.serial.rxCount;
    }
  } else {
    $("txCount").textContent = "—";
    $("rxCount").textContent = "—";
  }
  renderTimersLocal();
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      $("tab-" + b.dataset.tab).classList.add("active");
      if (b.dataset.tab === "console") $("cmdInput").focus();
    });
  });
}

function buildMotors() {
  const g = $("motorsGrid");
  FW.AXES.forEach((ax, i) => {
    const d = document.createElement("div");
    d.className = "row";
    d.style.cssText = "border:1px dashed #232c39;border-radius:4px;padding:6px 10px";
    d.innerHTML = `
      <b style="color:${AXC[i]};font-size:12.5px">J${ax.joint} ${ax.name}</b>
      <button class="btn small green" id="mEn${i}">⚡ enable</button>
      <button class="btn small" id="mDis${i}">◌ disable</button>`;
    g.appendChild(d);
  });
}

function renderEnergy() {
  $("energyStatus").textContent = S.sleeping ? "ASLEEP" : (S.autoSleep ? "normal + auto-sleep armed" : "normal");
  $("swAutoSleep").checked = S.autoSleep;
}

/* ============================================================
 * Bindings
 * ============================================================ */
function bindActions() {
  $("btnConnect").onclick = toggleSerial;
  $("btnSim").onclick = () => (S.mode === "sim" ? (stopSim(), toast("Simulator stopped", "info")) : startSim());
  $("selPoll").onchange = restartPoll;

  $("btnEstop").onclick = () => {
    if (send(Cmd.estop())) { toast("⛔ E-STOP sent", "err"); addFeed("rx-err", "⛔ E-STOP"); }
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("modalBack").classList.contains("show")) $("btnEstop").click();
    if (e.ctrlKey && e.key.toLowerCase() === "k") { e.preventDefault(); $("cmdInput").focus(); }
    /* ---- keyboard jog (ignored while typing in a field) ---- */
    const tag = (e.target && e.target.tagName) || "";
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    if (["1", "2", "3", "4", "5"].includes(e.key)) {
      S.selJoint = parseInt(e.key, 10) - 1;
      document.querySelectorAll(".joint-row").forEach((r) => r.classList.remove("sel"));
      const sl = $("jSlider" + S.selJoint);
      if (sl) sl.closest(".joint-row").classList.add("sel");
      toast(`Jog target: J${S.selJoint + 1} ${FW.AXES[S.selJoint].name} — use ← / →`, "info", 1600);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (S.selJoint === null || S.selJoint === undefined) return;
      e.preventDefault();
      const j = S.selJoint, delta = (e.key === "ArrowRight" ? 2 : -2) * (e.shiftKey ? 3 : 1);
      const v = Math.max(FW.AXES[j].min, Math.min(FW.AXES[j].max, S.axes[j].deg + delta));
      send(Cmd.deg(j + 1, v));
      S.targets[j] = v; syncJointInputs();
    }
  });
  $("btnResetEstop").onclick = () => send(Cmd.reset());

  /* dashboard */
  $("qaHome").onclick = () => send(Cmd.homeAll());
  $("qaDemo").onclick = () => send(Cmd.demo());
  $("qaStopDemo").onclick = () => send(Cmd.stopDemo());
  $("qaStop").onclick = () => send(Cmd.stop());
  $("qaEnable").onclick = () => send(Cmd.enableAll());
  $("qaDisable").onclick = () => send(Cmd.disableAll());
  $("qaListPos").onclick = () => send(Cmd.listPos());

  /* motion */
  $("swDegMode").onchange = () => { S.degMode = $("swDegMode").checked; buildJoints(); };
  $("btnMoveAll").onclick = () => { const v = readMoveAll(); if (v) goMoveAll(v); };
  $("btnGoHomePose").onclick = () => { FW.DEMO_MOVES[0].angles.forEach((v, i) => ($("ma" + i).value = v)); goMoveAll([0, 0, 0, 0, 0]); };
  $("btnApplyPreset").onclick = () => {
    const v = $("selPreset").value;
    if (!v) return;
    const idx = parseInt(v.replace("demo", ""), 10);
    FW.DEMO_MOVES[idx].angles.forEach((a, i) => ($("ma" + i).value = a));
  };
  document.querySelectorAll('#profileSeg input[name="profile"]').forEach((r) => {
    r.addEventListener("change", () => send(Cmd.profile(r.value)));
  });
  $("btnTrajStop").onclick = () => send(Cmd.trajStop());

  /* kinematics */
  $("btnIKSend").onclick = () => {
    const x = parseFloat($("ikX").value) || 0, y = parseFloat($("ikY").value) || 0, z = parseFloat($("ikZ").value) || 0;
    if (calcIKLocal(true) !== null) send(Cmd.ik(x, y, z));
  };
  $("btnIKCalc").onclick = () => calcIKLocal(true);
  $("btnFKSend").onclick = () => {
    calcFKLocal();
    send(Cmd.fk([0, 1, 2, 3, 4].map((i) => parseFloat($("fkA" + i).value) || 0)));
  };
  $("btnFKFromCurrent").onclick = () => {
    currentDegs().forEach((d, i) => ($("fkA" + i).value = d));
    calcFKLocal();
  };

  /* event feed */
  $("btnFeedPause").onclick = () => {
    Feed.paused = !Feed.paused;
    $("btnFeedPause").textContent = Feed.paused ? "▶ Resume" : "⏸ Pause";
    $("btnFeedPause").classList.toggle("amber", Feed.paused);
    $("feedStat").textContent = Feed.paused ? "paused" : Feed.total + " events";
  };
  $("btnFeedClear").onclick = () => {
    $("feedBox").innerHTML = "";
    Feed.lastText = null; Feed.lastEl = null; Feed.count = 1; Feed.total = 0;
    $("feedStat").textContent = "0 events";
  };

  /* sequencer */
  $("btnSeqAdd").onclick = addCurrentPoseToSeq;
  $("btnSeqPlay").onclick = seqPlay;
  $("btnSeqStop").onclick = seqStop;
  $("btnSeqExport").onclick = seqExport;
  $("btnSeqImport").onclick = () => $("seqFile").click();
  $("seqFile").addEventListener("change", (e) => { if (e.target.files[0]) seqImport(e.target.files[0]); e.target.value = ""; });
  $("btnSeqClear").onclick = async () => {
    if (await confirmModal("Clear program", "Remove all steps from the program?")) { S.seq.items = []; renderSeqList(); }
  };

  /* memory */
  $("btnListPos").onclick = () => send(Cmd.listPos());
  $("btnTeachStart").onclick = () => send(Cmd.teachStart());
  $("btnTeachStep").onclick = () => send(Cmd.teachStep());
  $("btnTeachStop").onclick = () => send(Cmd.teachStop());
  $("btnTeachCount").onclick = () => send(Cmd.teachCount());
  $("btnPlay").onclick = () => send(Cmd.play());
  $("btnPlayStop").onclick = () => send(Cmd.playStop());

  /* scheduler */
  $("btnTimerSet").onclick = () => {
    const ms = parseInt($("timMs").value, 10) || 1000;
    const axis = parseInt($("timAxis").value, 10);
    S.timersLocal.push({ fireAt: Date.now() + ms, axis, ms });
    renderTimersLocal();
    send(Cmd.timer(ms, axis));
  };
  $("btnTimersCount").onclick = () => send(Cmd.timers());
  $("btnClearTimers").onclick = async () => {
    if (await confirmModal("Clear timers", "Clear all active timers?")) {
      S.timersLocal = [];
      renderTimersLocal();
      send(Cmd.clearTimers());
    }
  };

  /* power */
  $("btnSleep").onclick = () => send(Cmd.sleep());
  $("btnWake").onclick = () => send(Cmd.wake());
  $("swAutoSleep").onchange = () => {
    S.autoSleep = $("swAutoSleep").checked;
    send(Cmd.autoSleep(S.autoSleep));
    renderEnergy();
  };

  /* logger */
  $("btnLogOn").onclick = () => send(Cmd.logOn());
  $("btnLogOff").onclick = () => send(Cmd.logOff());
  $("btnLogShow").onclick = () => send(Cmd.logShow());
  $("btnLogClear").onclick = () => send(Cmd.logClear());

  /* console */
  $("btnSend").onclick = sendFromInput;
  $("cmdInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendFromInput();
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (S.histIdx > 0) { S.histIdx--; $("cmdInput").value = S.history[S.histIdx] || ""; }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (S.histIdx < S.history.length) { S.histIdx++; $("cmdInput").value = S.history[S.histIdx] || ""; }
    }
  });
  $("btnClearConsole").onclick = () => { $("consoleBox").innerHTML = ""; S.consoleLines = 0; };
  $("btnExportLog").onclick = () => {
    const text = Array.from($("consoleBox").children).map((d) => d.innerText).join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "axis5-log-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* motors */
  FW.AXES.forEach((ax, i) => {
    $("mEn" + i).onclick = () => send(Cmd.enableAxis(i + 1));
    $("mDis" + i).onclick = () => send(Cmd.disableAxis(i + 1));
  });
}

/* ============================================================
 * Main loop & init
 * ============================================================ */
let _lastT = performance.now();
function mainLoop(t) {
  const dt = Math.min(100, t - _lastT);
  _lastT = t;
  if (S.sim) S.sim.tick();
  requestAnimationFrame(mainLoop);
}

function init() {
  if (window.__armPanelInit) return;
  window.__armPanelInit = true;
  buildAxisCards();
  buildJoints();
  buildMoveAll();
  buildFkInputs();
  buildSlots();
  buildDemoPoses();
  buildTimerAxis();
  buildChips();
  buildMotors();
  buildHelp();
  initTabs();
  bindActions();
  renderStats();
  renderEnergy();
  renderSlots();
  renderTimersLocal();
  renderSeqList();
  FW.AXES.forEach((_, i) => renderAxisCard(i));

  const inElectron = !!(window.electronAPI && window.electronAPI.isElectron);
  if (!SerialLink.supported) {
    $("serialHint").textContent = inElectron
      ? "Serial support missing in this build."
      : "This browser has no Web Serial. Use the simulator, or Chrome/Edge.";
    $("btnConnect").disabled = !inElectron;
  } else {
    $("serialHint").textContent = inElectron
      ? "Pick the port in the Connection card (sidebar), or click “Connect Arduino”."
      : "Pick the port in the Connection card — the browser chooser opens.";
  }

  /* ---------- Connection card wiring ---------- */
  $("btnScanPorts").onclick = scanPorts;
  $("btnDiscPort").onclick = () => { if (S.mode === "serial") S.serial.disconnect(); };
  $("chkAutoPort").onchange = () => Store.set("auto_port", $("chkAutoPort").checked ? "1" : "0");
  if (window.electronAPI && window.electronAPI.onPortAdded) {
    window.electronAPI.onPortAdded(() => {
      if (S.mode === "off" && !S._scanActive) $("portHint").textContent = "New device detected — click Scan Ports.";
    });
  }
  renderConnCard();

  /* auto-connect the remembered granted port on start */
  if (Store.get("auto_port", "0") === "1" && Store.get("last_port", "")) {
    setTimeout(async () => {
      if (S.mode !== "off" || !SerialLink.supported) return;
      try {
        const ports = await navigator.serial.getPorts();
        const hit = ports.find((p) => portKeyFromInfo(SerialLink._safeInfo(p)) === Store.get("last_port", ""));
        if (hit) {
          const label = portLabelFor(SerialLink._safeInfo(hit));
          addConsole("sys", "[SYS] auto-connecting last port…");
          connectDirect(hit, label);
        }
      } catch (e) {}
    }, 900);
  }

  /* auto-start the simulator for an instant experience */
  if (Store.get("prefer_hw", "0") !== "1") {
    setTimeout(() => { if (S.mode === "off") startSim(); }, 600);
  } else {
    addConsole("sys", "[SYS] Ready. Connect to the Arduino or start the simulator.");
  }

  addConsole("sys", "[SYS] AXIS-5 Robot Control loaded — Esc = E-STOP, Ctrl+K = console");
  setInterval(updateLinkStats, 1000);
  requestAnimationFrame(mainLoop);
}

document.addEventListener("DOMContentLoaded", init);
