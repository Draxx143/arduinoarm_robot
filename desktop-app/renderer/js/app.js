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
  /* Event Feed card removed by design — no-op */
  return;
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

/* common boards & USB-serial chips — shown instead of raw VID:PID */
const USB_NAMES = {
  "2341:0042": "Arduino Mega 2560",
  "2341:0010": "Arduino Mega (ADK)",
  "2341:0043": "Arduino UNO",
  "2341:0044": "Arduino Micro",
  "1a86:7523": "CH340 USB-Serial (clone board)",
  "1a86:5523": "CH341 USB-Serial",
  "10c4:ea60": "CP210x USB-Serial",
  "0403:6001": "FTDI FT232 USB-Serial",
};
function friendlyUsb(info) {
  const key = portKeyFromInfo(info);
  return USB_NAMES[key] || (info && info.usbVendorId ? "USB device " + hex4(info.usbVendorId) + ":" + hex4(info.usbProductId) : null);
}
const PORT_TROUBLE_HTML =
  `<div class="p-none" style="line-height:1.8">&bull; use a <b>data</b> USB cable (not charge-only), try another socket
   <br>&bull; terminal check: <code>lsusb | grep -i 2341</code> and <code>ls /dev/ttyACM* /dev/ttyUSB*</code>
   <br>&bull; permission fix: <code>sudo usermod -aG dialout $USER</code> then <b>log out &amp; back in</b>
   <br>&bull; if dmesg mentions <i>brltty</i>: <code>sudo apt purge brltty</code> and replug</div>`;
const BUSY_TROUBLE_HTML =
  `<div style="line-height:1.8">&bull; <b>close the Arduino IDE</b> (especially its Serial Monitor) and any other serial monitor
   <br>&bull; close a second copy of this app: <code>pkill -f axis5</code> then reopen
   <br>&bull; see who holds the port: <code>sudo fuser -v /dev/ttyUSB0</code> (use your port path)
   <br>&bull; if nothing shows: <code>sudo systemctl stop ModemManager</code> and connect again</div>`;
function connErrorHint(e, portPath) {
  const m = e && e.message ? e.message : String(e);
  const pp = portPath ? " (" + portPath + ")" : "";
  if (/busy|lock|EBUSY|resource temporarily|device is/i.test(m))
    return { html: `<b>The port is BUSY</b>${pp} &mdash; another program is holding it:<div>${BUSY_TROUBLE_HTML}</div>`,
             plain: "Port busy" + pp + " — close the Arduino IDE / Serial Monitor (or a 2nd copy of this app), then retry." };
  if (/Permission|Access denie|Unauthorized/i.test(m))
    return { html: `<b>Permission denied</b>${pp} &mdash; run <code>sudo usermod -aG dialout $USER</code>, then <b>log out &amp; back in</b> (a reboot counts) and connect again.`,
             plain: "Permission denied" + pp + " — dialout group + logout/login required." };
  if (/No such file|No such device|disconnected|not configured|unplugged|break/i.test(m))
    return { html: `<b>The board dropped out</b>${pp} &mdash; replug the USB cable and scan again.`,
             plain: "Board disappeared" + pp + " — replug the USB cable." };
  return null;
}
S._scanActive = false;
S._portNames = {};   /* vid:pid -> human-readable port name from the last scan */

function portKeyFromInfo(info) {
  if (!info) return "";
  return hex4(info.usbVendorId) + ":" + hex4(info.usbProductId);
}
function portLabelFor(info) {
  return S._portNames[portKeyFromInfo(info)] || friendlyUsb(info) || "Serial port";
}

let _scanWatchdog = null;
const isBestMatch = (name) => /Mega|Arduino|CH340|CH341|CP210|FTDI/i.test(name || "");

/* rows shown while the chooser reports the system port list */
function renderScanRows(ports) {
  const rows = $("portRows");
  if (!rows) return;
  if (_scanWatchdog) { clearTimeout(_scanWatchdog); _scanWatchdog = null; }
  rows.innerHTML = "";
  if (!ports) {
    rows.innerHTML = `<div class="p-none">&#128269; Searching for serial devices&hellip;</div>`;
    /* if the system list never arrives, fall back to the checklist */
    _scanWatchdog = setTimeout(() => {
      if (!S._scanActive) return;
      rows.innerHTML = `<div class="p-none">No serial device appeared within 12 s &mdash; run through this checklist:</div>` + PORT_TROUBLE_HTML;
    }, 12000);
    return;
  }
  S._lastChooserCount = ports.length;
  ports.forEach((p) => {
    S._portNames[portKeyFromInfo(p)] = p.portName || p.displayName || p.portId;
  });
  if (!ports.length) {
    rows.innerHTML = `<div class="p-none">No serial devices found &mdash; run through this checklist:</div>` + PORT_TROUBLE_HTML;
  } else {
    ports.forEach((p) => {
      const vid = p.usbVendorId ? hex4(p.usbVendorId) : null;
      const pid = p.usbProductId ? hex4(p.usbProductId) : null;
      const row = document.createElement("div");
      row.className = "port-row";
      const best = isBestMatch(friendlyUsb(p) || p.displayName);
      row.innerHTML = `<span class="p-dot"></span>
        <div class="p-info"><span class="p-name">${escH(p.portName || p.portId)}</span>
        <span class="p-meta">${escH(friendlyUsb(p) || p.displayName || "Serial port")}${vid ? " &middot; USB " + vid + ":" + pid : ""}</span></div>
        ${best ? '<span class="p-badge">BEST MATCH</span>' : ""}`;
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
  const sel = $("hdrPort");
  if (!sel) return;
  const scan = $("hdrScan"), chk = $("chkAutoPort");
  if (!scan) return;
  const supported = SerialLink.supported || IpcSerialLink.supported;
  chk.checked = Store.get("auto_port", "0") === "1";
  scan.style.display = S.mode === "serial" ? "none" : "";
  scan.disabled = !supported;
  const connected = S.mode === "serial";

  if (!supported) {
    sel.innerHTML = `<option value="">no serial transport</option>`;
    sel.disabled = true;
    $("portHint").textContent = S.mode === "sim"
      ? "Simulator active — no real port needed."
      : "Use the simulator, or run in Chrome / Edge / Electron.";
    return;
  }

  if (connected) {
    const info = S.serial.activeInfo || {};
    const name = S.serial.activeLabel || portLabelFor(info);
    sel.innerHTML = `<option value="">${escH(name)} @ ${S.serial.baud}</option>`;
    sel.disabled = true;
    $("portHint").textContent = "Board is linked — commands go to the real firmware.";
    return;
  }

  sel.disabled = false;
  const prev = sel.value || Store.get("last_port", "");
  const opts = new Map();
  let granted = [];
  try { granted = await navigator.serial.getPorts(); } catch (e) {}
  granted.forEach((port) => {
    const info = SerialLink._safeInfo(port);
    const label = portLabelFor(info);
    opts.set(label, { label,
      best: isBestMatch(label),
      meta: info.usbVendorId ? "USB " + hex4(info.usbVendorId) + ":" + hex4(info.usbProductId) : "saved" });
  });
  /* OS-level devices (Electron): mirror exactly what the OS sees */
  try {
    if (IpcSerialLink.supported) {
      const res = await window.electronAPI.ipcSerial.list();
      (res && res.ports ? res.ports : []).forEach((p) => {
        if (!opts.has(p.path)) opts.set(p.path, { label: p.path,
          best: /ttyUSB|ttyACM|COM\d|CH340|CH341|CP210|FTDI|arduino|mega/i.test(p.path + " " + (p.friendly || "")),
          meta: p.friendly || "OS serial device" });
      });
    } else if (window.electronAPI && window.electronAPI.listSystemPorts) {
      (await window.electronAPI.listSystemPorts()).forEach((n) => {
        if (!opts.has(n)) opts.set(n, { label: n, best: /ttyUSB|ttyACM/i.test(n), meta: "OS serial device" });
      });
    }
  } catch (e) { /* scan failed — keep whatever we already have */ }
  S._sysPorts = { t: Date.now(), ports: [...opts.keys()] };

  let html = `<option value="">pick port…</option>`;
  [...opts.values()].sort((a, b) => (b.best - a.best) || a.label.localeCompare(b.label)).forEach((o) => {
    html += `<option value="${escH(o.label)}">${escH(o.label)}${o.best ? "  \u2605" : ""}</option>`;
  });
  sel.innerHTML = html;
  if (prev && opts.has(prev)) sel.value = prev;
  else {
    const best = [...opts.values()].find((o) => o.best);
    if (best) sel.value = best.label;
  }
  $("portHint").textContent = opts.size
    ? "Port picked — press \u26a1 Connect Arduino."
    : "No serial device found — plug the Arduino in and press \u21bb.";
}

async function connectDirect(port, label) {
  if (S.mode === "serial" || !SerialLink.supported) return;
  stopSim();
  const baud = parseInt($("selBaud").value, 10);
  try {
    addConsole("sys", `[SYS] opening ${label || "port"} @ ${baud} baud…`);
    await S.serial.connectPort(port, baud, label || null);
  } catch (e) {
    const hint = connErrorHint(e, label);
    const msg = hint ? hint.plain : "Connection failed: " + (e && e.message);
    addConsole("err", "!! " + msg);
    await renderConnCard();
    $("portHint").innerHTML = hint ? hint.html : "Connection failed: " + escH(e && e.message);
    toast(msg, "err", 6000);
  }
}

/* scan from the Connection card.
 * Electron: enumerate at OS level (ls /dev/ttyUSB* /dev/ttyACM*) — this
 * always matches what the OS/Arduino IDE sees, unlike Chromium's scan.
 * Browser: open the native chooser. */
async function scanPorts() {
  if (!SerialLink.supported && !IpcSerialLink.supported) {
    toast("No serial transport available in this environment", "err", 5000);
    return;
  }
  if (S.mode === "serial") return;
  if (!(window.electronAPI && window.electronAPI.isElectron)) {
    toggleSerial(); /* plain browser: the native chooser does the picking */
    return;
  }
  addConsole("sys", "[SYS] scanning serial ports (system)…");
  S._sysPorts = null; /* force a fresh OS-level scan */
  await renderConnCard();
}

/* connect to an OS-level device path (e.g. /dev/ttyUSB0, COM3).
 * Preferred: node-serialport driver in the main process (always works).
 * Fallback: Web Serial chooser auto-resolved by port name in main.js. */
async function connectSystemPort(name) {
  if (S.mode === "serial") return;
  stopSim();
  const baud = parseInt($("selBaud").value, 10);

  if (IpcSerialLink.supported) {
    const link = new IpcSerialLink();
    bindLinkEvents(link);
    S.serial = link;
    addConsole("sys", `[SYS] opening ${name} @ ${baud} (system driver)…`);
    try {
      await link.connectVia(name, baud);
      Store.set("prefer_hw", "1");
    } catch (e) {
      const hint = connErrorHint(e, name);
      addConsole("err", "!! " + (hint ? hint.plain : "Connection failed: " + e.message));
      await renderConnCard();          /* repaint first… */
      $("portHint").innerHTML = hint   /* …then the error, so it sticks */
        ? hint.html + `<span class="tiny">raw: ${escH(e.message)}</span>`
        : "Connection failed: " + escH(e.message);
      toast(hint ? hint.plain : "Connection failed: " + e.message, "err", 7000);
    }
    return;
  }

  if (!SerialLink.supported) {
    toast("No serial transport available in this environment", "err", 5000);
    return;
  }
  window.electronAPI.expectPort(name);
  addConsole("sys", `[SYS] opening ${name} @ ${baud}…`);
  let tmr = null;
  try {
    await Promise.race([
      S.serial.connect(baud),
      new Promise((_, rej) => { tmr = setTimeout(() => rej(new Error("chooser-timeout")), 10000); }),
    ]);
    Store.set("prefer_hw", "1");
  } catch (e) {
    const hint = e.message === "chooser-timeout" ? null : connErrorHint(e, name);
    const msg = e.message === "chooser-timeout"
      ? "The port chooser did not respond — try the ⚡ Connect Arduino button once, then report this."
      : (hint ? hint.plain : "Connection failed: " + e.message);
    addConsole("err", "!! " + msg);
    await renderConnCard();
    $("portHint").innerHTML = hint ? hint.html : msg;
    toast(msg, "err", 6000);
  } finally {
    if (tmr) clearTimeout(tmr);
  }
}

/* ============================================================
 * Send / receive
 * ============================================================ */
function send(text, opts = {}) {
  if (!text) return false;
  const auto = !!opts.auto; /* automatic poll — keep it out of the console */
  if (!auto && S.mode === "off") {
    const now = Date.now();
    addConsole("warn", "✗ not sent ('" + text + "') — connect first or start the simulator");
    if (now - S.lastWarnAt > 3000) {
      toast("Connect to the Arduino or turn on the simulator first", "warn");
      S.lastWarnAt = now;
    }
    return false;
  }
  if (!auto) addConsole("tx", "» " + text);
  if (text === "status") S._statusFromPoll = auto; /* suppress the reply block only for polls */
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
  const t = line.trim();
  /* firmware complaints ("!! ...") must be impossible to miss */
  if (/^!!/.test(t)) {
    const now = Date.now();
    if (now - (S._lastFwErrAt || 0) > 2500) {
      S._lastFwErrAt = now;
      toast(t, "err", 6000);
    }
  }

  if (t.startsWith(">> Ack mode ON")) setAckUI(true);
  else if (t.startsWith(">> Ack mode OFF")) setAckUI(false);

  /* ---- status block: loose matching + hard caps (suppression can never stick) ---- */
  const RE_STATUS_HEADER = /^=*\s*System Status/;
  const RE_STATUS_FOOTER = /^={6,}$/;   /* any long '=' run closes the block */
  const RE_BLOCK_BREAKER = /^(Moving |>> |!!|Format:|Invalid|Unknown|Saved |Loaded |Slot )/;

  if (RE_STATUS_HEADER.test(t)) {
    S.inStatus = true;
    /* a poll-triggered block is parsed but not printed */
    S._pollBlock = S._statusFromPoll === true;
    S._statusFromPoll = false;
    S._blockLines = 0;
    if (!S._pollBlock) addConsole("rx", line);
    S.tmpDemo = null;
    S.tmpSleep = false;
    S.pendingSlots = null;
    return;
  }
  if (S.inStatus && RE_STATUS_FOOTER.test(t)) {
    S.inStatus = false;
    const show = !S._pollBlock;
    S._pollBlock = false;
    if (show) addConsole("rx", line);
    S.demo = S.tmpDemo || { running: false, step: 0, total: FW.DEMO_MOVES.length };
    S.sleeping = S.tmpSleep;
    renderStats();
    renderEnergy();
    renderSlots();
    return;
  }
  if (S.inStatus && S._pollBlock) {
    S._blockLines = (S._blockLines || 0) + 1;
    if (S._blockLines > 30 || RE_BLOCK_BREAKER.test(t)) {
      /* safety valve: a real reply line or an over-long block ends suppression */
      S.inStatus = false;
      S._pollBlock = false;
      addConsole("rx", line);
      return;
    }
    /* parsing only — no console spam */
  } else {
    addConsole("rx", line);
  }
  if (/^>(?!>)/.test(t)) return; /* firmware echo */
  const ev = Parse.line(line);
  if (!ev) return;

  /* after the periodic status block lands, nudge if the board cannot move */
  if (line.trim() === "======================" ) {
    setTimeout(() => {
      if (S.mode !== "serial") return;
      const noneHomed = S.axes.every((a) => !a.homed);
      const noneEnabled = S.axes.every((a) => a.enabled === false);
      const hint = $("portHint");
      if (!hint) return;
      if (noneHomed) {
        hint.innerHTML = "<b>Board rebooted on connect</b> (normal for Mega/CH340) — axes are disabled &amp; not homed, so moves are ignored. Press <b>⌂ Home All</b> on the Motion tab, then move.";
      } else if (noneEnabled) {
        hint.innerHTML = "Axes are <b>disabled</b> — press <b>Enable</b> (chip or Motion tab) before moving.";
      }
    }, 60);
  }

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
      setTimeout(() => send(Cmd.status(), { auto: true }), 900);
      break;
    case "slotEmpty": toast(`Slot ${ev.slot} is empty`, "warn"); break;
    case "slotsListStart": S.pendingSlots = {}; break;
    case "slotItem":
      if (S.pendingSlots) S.pendingSlots[ev.slot] = { name: ev.name };
      break;
    case "teachCount":
      S.teachCountFw = ev.count;
      $("teachCountLabel").textContent = ev.count;
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
  /* state badge pill removed — the header lamps carry the state now */
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
  /* Link Status card removed */
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
  /* a port picked in the header? dial it directly (Electron driver path) */
  const picked = ($("hdrPort") && $("hdrPort").value) || "";
  if (picked && IpcSerialLink.supported) {
    stopSim();
    await connectSystemPort(picked);
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

/* ACK toggle — state is synced from the board's own reply */
function setAckUI(on) {
  const b = $("btnAck");
  if (!b) return;
  b.textContent = on ? "\u2713 ACK: ON" : "\u2713 ACK: OFF";
  b.classList.toggle("on", on);
}

function bindLinkEvents(link) {
  link.onConnect = (baud) => {
    setMode("serial");
    addConsole("sys", `[SYS] linked @ ${baud} — waiting for board…`);
    addFeed("rx-ok", "Linked @" + baud);
    toast("Connected to the Arduino ✓", "ok");
    setStateUI("INIT");
    try { Store.set("last_port", link.transport === "system" ? link.activeLabel : portKeyFromInfo(link.activeInfo || {})); } catch (e) {}
    setAckUI(false); /* the board rebooted on connect — ack mode is back to its default (off) */
    S.inStatus = false; S._pollBlock = false; S._blockLines = 0; S._statusFromPoll = false;
    S._connAt = Date.now(); S._rxWarned = false;
    renderConnCard();
    setTimeout(() => send(Cmd.status(), { auto: true }), 600);
    /* second hello after the bootloader window: boards that reboot on open
     * (DTR pulse) answer this one and the UI syncs right after boot */
    setTimeout(() => send(Cmd.status(), { auto: true }), 3000);
  };
  link.onDisconnect = () => {
    if (S.mode === "serial") setMode("off");
    addConsole("sys", "[SYS] link closed");
    renderConnCard();
  };
  link.onLine = (l) => rxLine(l);
  link.onError = (m) => { addConsole("err", "!! " + m); toast(m, "err"); };
}
bindLinkEvents(S.serial);

/* ============================================================
 * Polling
 * ============================================================ */
function restartPoll() {
  if (S.pollTimer) clearInterval(S.pollTimer);
  S.pollTimer = null;
  const v = parseInt($("selPoll").value, 10);
  if (v > 0 && S.mode !== "off") S.pollTimer = setInterval(() => send(Cmd.status(), { auto: true }), v);
}

/* ============================================================
 * Dashboard
 * ============================================================ */
function buildAxisCards() {
  /* Dashboard removed — the per-axis live cards lived there */
  return;
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
  /* Dashboard removed — per-axis live cards lived there */
  return;
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
  renderStats();
}

function renderStats() {
  /* Dashboard removed — kept as no-op (still called from renderAxis) */
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
      if ($("swLive").checked) sendJointLive(i, v);
    });
    num.addEventListener("change", () => {
      const v = sync(+num.value || 0, false);
      if ($("swLive").checked) sendJointLive(i, v);
    });
    $("jGo" + i).addEventListener("click", () => sendJoint(i, +num.value || 0));
    $("jHome" + i).addEventListener("click", () => send(Cmd.homeAxis(i + 1)));
  });
}

/* Coalesce rapid slider/spinner changes into at most 2 commands
 * (leading + trailing). A flood of `deg` lines overruns the AVR's 64-byte
 * UART ring while it is busy -> dropped middle bytes -> garbled lines the
 * board reports as "Unknown command" / bogus angles. */
const _jtPending = {};
function sendJointLive(i, v) {
  const p = _jtPending[i] || (_jtPending[i] = { t: null, last: 0, fired: false, sent: null });
  p.last = v;
  if (p.fired) return;            /* a leading send already went out for this burst */
  p.fired = true;
  p.sent = v;
  sendJoint(i, v);                /* leading: first change is sent immediately */
  p.t = setTimeout(() => {
    const val = p.last;
    const sent = p.sent;
    p.t = null; p.fired = false; p.last = 0; p.sent = null;
    _jtPending[i] = null;
    /* FIX: a single slider release must send exactly ONCE — the trailing
     * send only fires when the value moved on after the leading one */
    if (val !== sent) sendJoint(i, val);
  }, 160);
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
      send(Cmd.status(), { auto: true });
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
  /* FIX: همان چیزی که نمایش داده می‌شود = همان چیزی که اجرا می‌شود */
  const clamped = res.map((a, i) => Math.max(FW.AXES[i].min, Math.min(FW.AXES[i].max, a)));
  const wasClamped = clamped.some((a, i) => a !== res[i]);
  box.style.color = "#7ce7ef";
  box.textContent = "IK ⇒ " + clamped.map((a) => a.toFixed(1) + "°").join(" | ") + (wasClamped ? "  (clamped)" : "");
  if (move) {
    S.targets = clamped.slice();
  }
  return clamped;
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
  const rm = $("ioMeter");
  if (rm) rm.textContent = S.mode === "serial"
    ? "TX " + Fmt.bytes(S.serial.txCount) + " · RX " + Fmt.bytes(S.serial.rxCount)
    : "TX — · RX —";
  if (S.mode === "serial") {
    const led = $("led");
    if (S.serial.rxCount !== updateLinkStats._lastRx) {
      led.classList.remove("blink"); void led.offsetWidth; led.classList.add("blink");
      updateLinkStats._lastRx = S.serial.rxCount;
    }
    /* zero data from the board? say it loudly, once */
    if (S.serial.rxCount === 0 && S._connAt && Date.now() - S._connAt > 6000 && !S._rxWarned) {
      S._rxWarned = true;
      const hint = $("portHint");
      if (hint) hint.innerHTML = "<b>The board sends nothing back</b> (RX 0 B after 6 s) &mdash; checking who else holds the port…";
      addConsole("warn", "!! no RX data 6 s after connect — checking port holders…");
      const label = S.serial.activeLabel || "";
      if (window.electronAPI && window.electronAPI.portHolders) {
        window.electronAPI.portHolders(label).then((h) => {
          if (!hint) return;
          if (h && h.procs && h.procs.length) {
            hint.innerHTML = "<b>RX 0 B — another program is reading the port:</b> " +
              h.procs.map(escH).join(", ") +
              " &mdash; <b>close it</b> (two readers steal each other's bytes!), then Disconnect &amp; Connect.";
            addConsole("warn", "!! port ALSO held by: " + h.procs.join(", ") + " (PIDs " + h.pids.join(", ") + ") — close it and reconnect");
          } else {
            hint.innerHTML = "<b>RX 0 B</b> &mdash; no other reader. Run <b>Port Test</b>: if the board transmits to a raw OS reader, the driver path is at fault; if not, the board itself is silent (baud/firmware/another DTR app).";
            addConsole("sys", "[SYS] no other program holds the port — press 🔬 Port Test to check the board itself");
          }
        }).catch(() => {});
      }
    }
    if (S.serial.rxCount > 0) S._rxWarned = false;
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

  function doEstop() {
    if (send(Cmd.estop())) { toast("⛔ E-STOP sent", "err"); addFeed("rx-err", "⛔ E-STOP"); }
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("modalBack").classList.contains("show")) doEstop();
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
    } else if (e.key === "F2") {
      e.preventDefault();
      send(Cmd.homeAll());
      toast("⌂ Home All sent (F2)", "info", 1600);
    } else if (e.key === "F4") {
      e.preventDefault();
      send(Cmd.reset());
      toast("↺ RESET sent (F4)", "info", 1600);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (S.selJoint === null || S.selJoint === undefined) return;
      e.preventDefault();
      const j = S.selJoint, delta = (e.key === "ArrowRight" ? 2 : -2) * (e.shiftKey ? 3 : 1);
      const v = Math.max(FW.AXES[j].min, Math.min(FW.AXES[j].max, S.axes[j].deg + delta));
      send(Cmd.deg(j + 1, v));
      S.targets[j] = v; syncJointInputs();
    }
  });


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
    $("serialHint").textContent = IpcSerialLink.supported
      ? "Web Serial missing — the Connection card uses the system serial driver instead."
      : (inElectron ? "Serial support missing in this build."
                    : "This browser has no Web Serial. Use the simulator, or Chrome/Edge.");
    /* btnConnect stays enabled — it dials the port picked in hdrPort */
  } else {
    $("serialHint").textContent = inElectron
      ? "Pick the port in the Connection card (sidebar), or click “Connect Arduino”."
      : "Pick the port in the Connection card — the browser chooser opens.";
  }

  $("appVersion").textContent = (window.electronAPI && window.electronAPI.appVersion) || "web";

  /* ---------- Connection card wiring ---------- */
  $("btnPortTest").onclick = async () => {
    const hint = $("portHint");
    let path = "";
    try {
      const res = await window.electronAPI.ipcSerial.list();
      path = (res && res.ports && res.ports[0] && res.ports[0].path) || "";
    } catch (e) {}
    if (!path) { toast("No serial device found to test", "err"); return; }
    if (S.mode === "serial") { await S.serial.disconnect(); await new Promise((r) => setTimeout(r, 400)); }
    if (hint) hint.innerHTML = `&mdash; probing <code>${escH(path)}</code> for 2 s with a raw OS reader&hellip;`;
    toast("Probing the port for 2 s (the board may reboot)", "info", 3000);
    let res2 = { bytes: -1, sample: "" };
    try { res2 = await window.electronAPI.portProbe(path); } catch (e) { res2 = { bytes: -1, sample: String(e.message || e) }; }
    if (res2.bytes > 0) {
      const sample = String(res2.sample || "").replace(/[\u0000-\u001f]+/g, " ").slice(0, 80);
      if (hint) hint.innerHTML = `<b style="color:#3fb950">Board IS transmitting</b> (${res2.bytes} bytes on raw read) &mdash; sample: <code>${escH(sample)}</code>. The OS path works; reconnect and watch the RX meter.`;
      addConsole("sys", `[SYS] port probe: ${res2.bytes} bytes received raw — board transmits ✓`);
    } else if (res2.bytes === 0) {
      if (hint) hint.innerHTML = `<b style="color:#fca5a5">Board sent NOTHING</b> even to a raw OS reader (2 s) &mdash; the board itself is silent: check it runs the latest firmware, baud 115200, no other DTR app, then power-cycle it.`;
      addConsole("warn", "!! port probe: 0 bytes in 2 s — the board itself is not transmitting");
    } else {
      if (hint) hint.innerHTML = `probe failed: ${escH(res2.sample || "unknown error")}`;
    }
    renderConnCard();
  };

  $("btnAck").onclick = () => {
    if (S.mode === "off") { toast("Connect to the Arduino (or start the simulator) first", "warn"); return; }
    const on = !$("btnAck").classList.contains("on");
    setAckUI(on); /* instant feedback — the board's reply re-syncs it */
    if (on) toast("Board goes SILENT — no serial output at all (telemetry pauses too)", "warn", 5000);
    else toast("Confirmations ON — board replies >> ACK: <cmd> after each command", "ok", 5000);
    send(on ? "ack on" : "ack off");
  };
  $("hdrScan").onclick = async () => { S._sysPorts = null; await renderConnCard();
    addConsole("sys", "[SYS] port scan: " + Math.max(0, ($("hdrPort") ? $("hdrPort").length : 1) - 1) + " device(s)"); };
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
