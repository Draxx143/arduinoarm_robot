/* ============================================================
 * app.js — منطق اصلی کنترل‌پنل
 * اتصال (Web Serial / شبیه‌ساز) + همه‌ی اجزای UI + پارس پاسخ‌ها
 * ============================================================ */
"use strict";

/* ---------- ذخیره‌سازی امن ---------- */
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

/* ---------- وضعیت کلی ---------- */
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
  lastJointInputAt: 0,
  inStatus: false,
  tmpDemo: null,
  tmpSleep: false,
  pendingSlots: null,
  consoleLines: 0,
};

const AXCOLORS = ["#22d3ee", "#a78bfa", "#fb923c", "#34d399", "#f472b6"];
const viz = new ArmViz($("vizCanvas"));
viz.setTargets(S.targets);

/* ============================================================
 * کنسول و رویدادها
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
  if (++S.consoleLines > 600) {
    box.removeChild(box.firstChild);
    S.consoleLines--;
  }
  if (near) box.scrollTop = box.scrollHeight;
}

function addFeed(cls, text) {
  const box = $("feedBox");
  const div = document.createElement("div");
  div.className = "f-line " + cls;
  div.textContent = text;
  box.prepend(div);
  while (box.children.length > 26) box.removeChild(box.lastChild);
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
    $("modalBack").classList.add("show");
    const ok = $("modalOk"), cancel = $("modalCancel");
    const done = (v) => {
      $("modalBack").classList.remove("show");
      ok.onclick = cancel.onclick = null;
      res(v);
    };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
  });
}

/* ============================================================
 * کارت انتخاب پورت — اسکن/انتخاب/اتصال خودکار
 * ============================================================ */
const hex4 = (v) => (v || 0).toString(16).padStart(4, "0");
const escH = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* بردها و مبدل‌های رایج — به‌جای VID:PID خام نمایش داده می‌شوند */
const USB_NAMES = {
  "2341:0042": "آردوینو مگا 2560",
  "2341:0010": "آردوینو مگا (ADK)",
  "2341:0043": "آردوینو UNO",
  "2341:0044": "آردوینو میکرو",
  "1a86:7523": "مبدل CH340 (برد کپی)",
  "1a86:5523": "مبدل CH341",
  "10c4:ea60": "مبدل CP210x",
  "0403:6001": "مبدل FTDI FT232",
};
function portLabelFor(info) {
  const key = hex4(info && info.usbVendorId) + ":" + hex4(info && info.usbProductId);
  return USB_NAMES[key] ||
    (info && info.usbVendorId ? "دستگاه USB " + hex4(info.usbVendorId) + ":" + hex4(info.usbProductId) : "پورت سریال");
}
const isBestMatch = (name) => /مگا|آردوینو|CH340|CH341|CP210|FTDI/i.test(name || "");
const PORT_TROUBLE_HTML =
  `<div class="p-none" style="line-height:1.9">&bull; کابل <b>داده</b> استفاده کن نه کابل فقط‌شارژ — یک سوکت دیگر هم امتحان کن
   <br>&bull; در ترمینال: <code dir="ltr">lsusb | grep -i 2341</code> و <code dir="ltr">ls /dev/ttyACM* /dev/ttyUSB*</code>
   <br>&bull; رفع دسترسی: <code dir="ltr">sudo usermod -aG dialout $USER</code> و بعد <b>خروج و ورود دوباره</b>
   <br>&bull; اگر dmesg گفت <i>brltty</i>: <code dir="ltr">sudo apt purge brltty</code> و دوباره وصل کن</div>`;
function connErrorHint(e) {
  const m = e && e.message ? e.message : String(e);
  if (/Permission|Access denie|Unauthorized|cannot open/i.test(m))
    return "لینوکس اجازه نداد — دستور `sudo usermod -aG dialout $USER` را بزن، «خروج و ورود» کن و دوباره وصل شو.";
  if (/No such device|disconnected|not configured|unplugged|break/i.test(m))
    return "برد قطع شد — کابل USB را جدا و دوباره وصل کن و اسکن بزن.";
  return null;
}

async function renderConnCard() {
  const rows = $("portRows");
  if (!rows) return;
  const scan = $("btnScanPorts"), disc = $("btnDiscPort"), chk = $("chkAutoPort");
  const supported = SerialLink.supported;
  if (chk) chk.checked = Store.get("auto_port", "0") === "1";
  if (disc) disc.style.display = S.mode === "serial" ? "" : "none";
  if (scan) {
    scan.style.display = S.mode === "serial" ? "none" : "";
    scan.disabled = !supported;
  }

  if (!supported) {
    rows.innerHTML = `<div class="p-none">این مرورگر از Web Serial پشتیبانی نمی‌کند — از Chrome یا Edge استفاده کن.</div>`;
    const hint = $("portHint");
    if (hint) hint.textContent = S.mode === "sim" ? "شبیه‌ساز فعال است — پورت واقعی لازم نیست." : "برای اتصال واقعی Chrome/Edge دسکتاپ را باز کن.";
    return;
  }

  if (S.mode === "serial") {
    let info = {};
    try { info = S.serial.port && S.serial.port.getInfo ? S.serial.port.getInfo() : {}; } catch (e) {}
    const name = S.serial._label || portLabelFor(info);
    rows.innerHTML = `<div class="port-row on"><span class="p-dot"></span>
      <div class="p-info"><span class="p-name">${escH(name)}</span>
      <span class="p-meta">متصل @ ${S.serial.baud} باود</span></div>
      <span class="p-badge">متصل</span></div>`;
    $("portHint").textContent = "برد متصل است — دستورات به فریم‌ور واقعی می‌روند.";
    return;
  }

  let granted = [];
  try { granted = await S.serial.previouslyGranted(); } catch (e) {}
  rows.innerHTML = "";
  if (!granted.length) {
    rows.innerHTML = `<div class="p-none">هنوز پورتی شناخته نشده — آردوینو را وصل کن و «اسکن پورت‌ها» را بزن.</div>` + PORT_TROUBLE_HTML;
  } else {
    granted.forEach((port) => {
      let info = {};
      try { info = port.getInfo ? port.getInfo() : {}; } catch (e) {}
      const label = portLabelFor(info);
      const last = Store.get("last_port", "") === hex4(info.usbVendorId) + ":" + hex4(info.usbProductId);
      const row = document.createElement("div");
      row.className = "port-row";
      row.innerHTML = `<span class="p-dot"></span>
        <div class="p-info"><span class="p-name">${escH(label)}</span>
        <span class="p-meta">آماده${info.usbVendorId ? " · USB " + hex4(info.usbVendorId) + ":" + hex4(info.usbProductId) : ""}${last ? " · <b>آخرین پورت</b>" : ""}</span></div>
        ${isBestMatch(label) ? '<span class="p-badge">پیشنهادی</span>' : ""}`;
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = "اتصال";
      b.onclick = () => connectDirect(port, label);
      row.appendChild(b);
      rows.appendChild(row);
    });
  }
  $("portHint").textContent = S.mode === "sim"
    ? "شبیه‌ساز فعال است — برای برد واقعی اسکن کن."
    : "پورت را انتخاب کن یا «اسکن پورت‌ها» را بزن.";
}

async function connectDirect(port, label) {
  if (S.mode === "serial" || !SerialLink.supported) return;
  stopSim();
  const baud = parseInt($("selBaud").value, 10);
  try {
    addConsole("sys", `[SYS] باز کردن ${label || "پورت"} @ ${baud} …`);
    await S.serial.connectPort(port, baud, label || null);
  } catch (e) {
    const hint = connErrorHint(e);
    const msg = hint || "اتصال ناموفق: " + (e && e.message);
    addConsole("err", "!! " + msg);
    $("portHint").textContent = msg;
    toast(msg, "err", 6000);
    renderConnCard();
  }
}

/* ============================================================
 * ارسال و دریافت
 * ============================================================ */
function send(text) {
  if (!text) return false;
  if (S.mode === "off") {
    const now = Date.now();
    addConsole("warn", "⛔ ارسال نشد («" + text + "») — ابتدا متصل شو یا شبیه‌ساز را روشن کن");
    if (now - S.lastWarnAt > 3000) {
      toast("ابتدا به آردوینو وصل شو یا شبیه‌ساز را روشن کن", "warn");
      S.lastWarnAt = now;
    }
    return false;
  }
  addConsole("tx", "» " + text);
  addFeed("tx", "» " + text);
  if (S.mode === "serial") {
    S.serial.write(text).catch((e) => {
      addConsole("err", "!! خطای ارسال: " + e.message);
      toast("خطای ارسال: " + e.message, "err");
    });
  } else if (S.sim) {
    S.sim.handle(text);
  }
  return true;
}

function rxLine(line, fromSim = false) {
  addConsole("rx", line);
  const ev = Parse.line(line);

  /* بلوک status */
  if (line.trim().startsWith(">> Ack mode ON")) setAckUI(true);
  else if (line.trim().startsWith(">> Ack mode OFF")) setAckUI(false);

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
  if (/^>(?!>)/.test(line.trim())) return; /* اکوی خود فریم‌ور (تک >) */
  if (!ev) return;

  switch (ev.type) {
    case "axis": {
      const a = S.axes[ev.axis];
      if (!a) break;
      a.steps = ev.steps; a.deg = ev.deg; a.homed = ev.homed;
      a.enabled = ev.enabled; a.moving = ev.moving; a.endstop = ev.endstop;
      renderAxisCard(ev.axis);
      viz.setAngles(S.axes.map((x) => x.deg));
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
      addFeed("rx-ok", `🎬 دمو: حرکت ${ev.step}/${ev.total}`);
      break;
    case "posSaved":
      S.slots[ev.slot] = { name: "Pos" + ev.slot };
      renderSlots();
      toast(`موقعیت در اسلات ${ev.slot} ذخیره شد`, "ok");
      break;
    case "posLoaded":
      toast(`اسلات ${ev.slot} فراخوانی شد — بازو در حرکت`, "info");
      setTimeout(() => send(Cmd.status()), 900);
      break;
    case "slotEmpty": toast(`اسلات ${ev.slot} خالی است`, "warn"); break;
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
      toast("ضبط آموزش شروع شد — با «ثبت استپ» نقاط را ثبت کن", "info");
      break;
    case "teachStopped":
      S.teachCountFw = ev.count;
      $("teachCountLabel").textContent = ev.count;
      toast(`ضبط پایان یافت — ${ev.count} استپ ثبت شد`, "ok");
      break;
    case "playStart": toast(`پخش ${ev.count} استپ شروع شد`, "info"); break;
    case "playDone": toast("پخش آموزش کامل شد ✓", "ok"); break;
    case "sleepNow": S.sleeping = true; renderEnergy(); break;
    case "wakeNow": S.sleeping = false; renderEnergy(); break;
    case "autoSleepOn": S.autoSleep = true; renderEnergy(); break;
    case "autoSleepOff": S.autoSleep = false; renderEnergy(); break;
    case "timers":
      S.timersFw = ev.count;
      renderTimersLocal();
      break;
    case "ikResult":
      $("ikResult").textContent = "IK ⇒ " + ev.angles.map((a) => a.toFixed(1) + "°").join(" | ");
      toast("کینماتیک معکوس حل شد — بازو حرکت می‌کند", "ok");
      break;
    case "fkResult":
      $("fkResult").textContent = `FK ⇒ X=${ev.x}  Y=${ev.y}  Z=${ev.z} (mm)`;
      break;
    case "ready":
      toast("✅ سیستم آماده است!", "ok");
      setStateUI("READY");
      break;
    case "moveDone": addFeed("rx-ok", "✔ حرکت کامل شد"); break;
    case "estop":
      toast("⛔ توقف اضطراری فعال شد!", "err", 5000);
      setStateUI("ESTOP");
      S.demo.running = false;
      break;
    case "rangeError":
      toast(`زاویه‌ی محور ${ev.axis + 1} خارج از محدوده مجاز است!`, "err");
      break;
    case "unknown": toast("دستور ناشناخته — راهنما را ببین", "warn"); break;
    case "homingStart": toast("هومینگ هوشمند شروع شد…", "info"); break;
    case "demoStart": S.demo.running = true; renderStats(); break;
    case "demoStop": S.demo.running = false; renderStats(); break;
    case "demoDone":
      S.demo.running = false; renderStats();
      toast("🎬 دمو کامل شد", "ok");
      break;
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
  viz.setState(key);
  renderStats();
}

/* ============================================================
 * حالت اتصال: سریال / شبیه‌ساز / خاموش
 * ============================================================ */
/* دکمه تاییدیه (ACK) — وضعیت از جواب خود برد همگام می‌شود */
function setAckUI(on) {
  const b = $("btnAck");
  if (!b) return;
  b.textContent = on ? "\u2713 تاییدیه: روشن" : "\u2713 تاییدیه: خاموش";
  b.classList.toggle("on", on);
}

function setMode(mode) {
  S.mode = mode;
  renderConnCard();
  const led = $("led");
  led.className = "led" + (mode === "serial" ? " on" : mode === "sim" ? " sim" : "");
  $("connText").textContent = mode === "serial" ? "متصل (سریال)" : mode === "sim" ? "شبیه‌ساز" : "قطع";
  $("connMode").textContent = mode === "serial" ? ("Web Serial @ " + S.serial.baud) : mode === "sim" ? "شبیه‌سازی فریم‌ور" : "—";
  $("simBanner").classList.toggle("show", mode === "sim");
  $("btnConnect").textContent = mode === "serial" ? "⛔ قطع اتصال" : "🔗 اتصال به آردوینو";
  $("btnSim").textContent = mode === "sim" ? "⏹ خاموش کردن شبیه‌ساز" : "🎛 شبیه‌ساز";
  restartPoll();
}

function startSim() {
  if (S.mode === "serial") { toast("اول اتصال سریال را قطع کن", "warn"); return; }
  S.sim = new SimFirmware((l) => rxLine(l, true));
  setMode("sim");
  setStateUI("INIT");
  /* بنر راه‌اندازی مثل خود آردوینو */
  ["======================================",
   "5 DOF Robot Arm - TEST MODE (No ROS)",
   "======================================",
   "[SIM] شبیه‌ساز فریم‌ور در مرورگر اجرا شد",
   "System initialized.",
   "======================================"].forEach((l) => addConsole("sys", l));
  addFeed("warn", "🎛 شبیه‌ساز فعال شد");
  toast("شبیه‌ساز فعال شد — همه‌چیز مثل آردوینو واقعی جواب می‌دهد", "info", 4200);
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
    toast("مرورگرت Web Serial ندارد — از Chrome/Edge استفاده کن یا شبیه‌ساز را روشن کن", "err", 5000);
    return;
  }
  stopSim();
  const baud = parseInt($("selBaud").value, 10);
  try {
    addConsole("sys", `[SYS] در حال اتصال با باودریت ${baud} …`);
    await S.serial.connect(baud);
    Store.set("prefer_hw", "1");
  } catch (e) {
    if (/No port selected|select/i.test(e.message)) {
      addConsole("sys", "[SYS] انتخاب پورت لغو شد");
      const hint = $("portHint");
      if (hint) hint.textContent = "چوزر بسته شد. اگر پورتت در لیست نبود، چک‌لیست پایین را اجرا کن: " ;
      toast("اگر پورت در چوزر نبود: کابل داده، دسترسی dialout، و حذف brltty را چک کن", "warn", 7000);
    } else {
      const hint = connErrorHint(e);
      const msg = hint || "اتصال ناموفق: " + e.message;
      addConsole("err", "!! " + msg);
      const hint2 = $("portHint");
      if (hint2) hint2.textContent = msg;
      toast(msg, "err", 6000);
    }
  }
}

S.serial.onConnect = (baud) => {
  setMode("serial");
  addConsole("sys", `[SYS] متصل شد @ ${baud} — در انتظار پاسخ آردوینو…`);
  addFeed("rx-ok", "🔗 متصل شد @" + baud);
  toast("به آردوینو وصل شدی 🎉", "ok");
  setStateUI("INIT");
  try {
    const info = S.serial.port && S.serial.port.getInfo ? S.serial.port.getInfo() : {};
    Store.set("last_port", hex4(info.usbVendorId) + ":" + hex4(info.usbProductId));
  } catch (e) {}
  setAckUI(false); /* برد موقع اتصال ریست شده — ack به پیش‌فرض (خاموش) برگشته */
  renderConnCard();
  setTimeout(() => send(Cmd.status(), { auto: true }), 600);
};
S.serial.onDisconnect = () => {
  if (S.mode === "serial") setMode("off");
  addConsole("sys", "[SYS] اتصال قطع شد");

  renderConnCard();
};
S.serial.onLine = (l) => rxLine(l);
S.serial.onError = (m) => { addConsole("err", "!! " + m); toast(m, "err"); };

/* ============================================================
 * استعلام وضعیت (Polling)
 * ============================================================ */
function restartPoll() {
  if (S.pollTimer) clearInterval(S.pollTimer);
  S.pollTimer = null;
  const v = parseInt($("selPoll").value, 10);
  if (v > 0 && S.mode !== "off") S.pollTimer = setInterval(() => send(Cmd.status()), v);
}

/* ============================================================
 * داشبورد — کارت محورها
 * ============================================================ */
function buildAxisCards() {
  const row = $("axesRow");
  row.innerHTML = "";
  FW.AXES.forEach((ax, i) => {
    const c = document.createElement("div");
    c.className = "axis-card";
    c.id = "axisCard" + i;
    c.innerHTML = `
      <div class="head"><span class="jid" style="color:${AXCOLORS[i]}">J${ax.joint}</span>
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
  $("axFlags" + i).innerHTML =
    fl("هوم", a.homed) + fl("برق", a.enabled) +
    (a.moving ? `<span class="flag info">حرکت</span>` : "") +
    `<span class="flag ${a.endstop === "Open" ? "" : "n"}">ES:${a.endstop === "Open" ? "OK" : "Trig"}</span>`;
  $("axisCard" + i).classList.toggle("moving", a.moving);
  renderStats();
}

function renderStats() {
  $("statHomed").textContent = S.axes.filter((a) => a.homed).length + "/5";
  $("statMoving").textContent = S.axes.filter((a) => a.moving).length;
  $("statEnabled").textContent = S.axes.filter((a) => a.enabled).length + "/5";
  $("statProfile").textContent = S.profileName;
  $("statDemo").textContent = S.demo.running ? `در حال اجرا (${S.demo.step}/${S.demo.total})` : "غیرفعال";
  $("statEnergy").textContent = S.sleeping ? "😴 خواب" : (S.autoSleep ? "خواب خودکار ✓" : "عادی");
}

/* ============================================================
 * تب حرکت — اسلایدرها
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
      <div class="jl"><b style="color:${AXCOLORS[i]}">${ax.name} <span class="tiny">J${ax.joint}</span></b>
        <span>${ax.id} · ${lo}..${hi}${S.degMode ? "°" : " st"}</span></div>
      <input type="range" id="jSlider${i}" min="${lo}" max="${hi}" step="${S.degMode ? 0.5 : 1}"
        value="${S.degMode ? deg.toFixed(1) : Kin.degToSteps(i, deg)}" style="--axc:${AXCOLORS[i]}">
      <input type="number" id="jNum${i}" step="${S.degMode ? 0.5 : 1}"
        min="${lo}" max="${hi}"
        value="${S.degMode ? deg.toFixed(1) : Kin.degToSteps(i, deg)}">
      <span class="jval" id="jCur${i}">${deg.toFixed(1)}°</span>
      <div style="display:flex;gap:4px">
        <button class="btn small cyan" id="jGo${i}" title="ارسال حرکت">GO ➤</button>
        <button class="btn small" id="jHome${i}" title="هوم این محور">🏠</button>
      </div>`;
    list.appendChild(row);

    const slider = $("jSlider" + i), num = $("jNum" + i);
    /* FIX: نوار اسلایدر در بار اول با درصد درست رنگ شود */
    const initV = S.degMode ? deg : Kin.degToSteps(i, deg);
    slider.style.setProperty("--val", (((initV - lo) / (hi - lo)) * 100) + "%");
    const sync = (v, fromSlider) => {
      v = Math.max(+slider.min, Math.min(+slider.max, v));
      const pct = ((v - slider.min) / (slider.max - slider.min)) * 100;
      slider.style.setProperty("--val", pct + "%");
      if (fromSlider) num.value = S.degMode ? (+v).toFixed(1) : Math.round(v);
      else slider.value = v;
      if (S.degMode) {
        S.targets[i] = +v;
      } else {
        S.targets[i] = Kin.stepsToDeg(i, v);
      }
      viz.setTargets(S.targets);
      S.lastJointInputAt = Date.now();
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
      toast(`محدوده محور ${i + 1}: ${ax.min}° تا ${ax.max}°`, "err");
      return;
    }
    send(Cmd.deg(i + 1, v));
  } else {
    send(Cmd.move(i + 1, Math.round(v)));
  }
  viz.setTargets(S.targets);
}

function rebuildJointsMode() {
  buildJoints();
}

/* ---------- moveall ---------- */
function buildMoveAll() {
  const box = $("moveAllInputs");
  box.innerHTML = "";
  FW.AXES.forEach((ax, i) => {
    const f = document.createElement("div");
    f.className = "field";
    f.innerHTML = `<label style="color:${AXCOLORS[i]}">J${ax.joint} ${ax.name}</label>
      <input type="number" id="ma${i}" value="0" min="${ax.min}" max="${ax.max}" step="1">`;
    box.appendChild(f);
  });
  const sel = $("selPreset");
  FW.DEMO_MOVES.forEach((p, i) => {
    const o = document.createElement("option");
    o.value = "demo" + i;
    o.textContent = `🎬 ${p.label} [${p.angles.join(", ")}]`;
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
      toast(`J${i + 1} (${ax.name}) خارج از محدوده ${ax.min}..${ax.max} است`, "err");
      return null;
    }
    vals.push(v);
  }
  return vals;
}

function goMoveAll(vals) {
  send(Cmd.moveAll(vals));
  S.targets = vals.slice();
  viz.setTargets(S.targets);
  toast("moveall ارسال شد → " + vals.map((v) => v + "°").join(" "), "info");
}

/* ---------- پروفایل ---------- */
function syncProfileRadios(name) {
  const key = FW.PROFILES.find((p) => name.includes(p.name.split(" ")[0]))?.key
    || (name.includes("SLOW") ? "slow" : name.includes("FAST") ? "fast" : "normal");
  const r = document.querySelector(`#profileSeg input[value="${key}"]`);
  if (r) r.checked = true;
}

/* ============================================================
 * تب کینماتیک
 * ============================================================ */
function buildFkInputs() {
  const box = $("fkInputs");
  box.innerHTML = "";
  FW.AXES.forEach((ax, i) => {
    const f = document.createElement("div");
    f.className = "field";
    f.innerHTML = `<label style="color:${AXCOLORS[i]}">J${ax.joint} ${ax.id} (°)</label>
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
    box.textContent = `⛔ خارج از دسترس! برد لازم = ${Math.round(Math.hypot(Math.hypot(x, y), z))}mm (حداکثر 250mm)`;
    box.style.color = "#fca5a5";
    return null;
  }
  /* FIX: همان چیزی که نمایش داده می‌شود = همان چیزی که اجرا می‌شود */
  const clamped = res.map((a, i) => Math.max(FW.AXES[i].min, Math.min(FW.AXES[i].max, a)));
  const wasClamped = clamped.some((a, i) => a !== res[i]);
  box.style.color = "#a5f3fc";
  box.textContent = "IK ⇒ " + clamped.map((a) => a.toFixed(1) + "°").join(" | ") + (wasClamped ? "  (محدود شد)" : "");
  if (move) {
    S.targets = clamped.slice();
    viz.setTargets(S.targets);
  }
  return clamped;
}

function calcFKLocal() {
  const angles = [];
  for (let i = 0; i < 5; i++) angles.push(parseFloat($("fkA" + i).value) || 0);
  const p = Kin.fk(angles);
  $("fkResult").style.color = "#ddd6fe";
  $("fkResult").textContent = `FK ⇒ X=${p.x.toFixed(1)}  Y=${p.y.toFixed(1)}  Z=${p.z.toFixed(1)} (mm) — برد ${Math.round(p.reach)}mm`;
  S.targets = angles.slice();
  viz.setTargets(S.targets);
  return p;
}

/* ============================================================
 * تب حافظه — اسلات‌ها، آموزش، دمو
 * ============================================================ */
function buildSlots() {
  const g = $("slotsGrid");
  g.innerHTML = "";
  for (let i = 0; i < FW.MAX_POSITIONS; i++) {
    const d = document.createElement("div");
    d.className = "slot";
    d.id = "slot" + i;
    d.innerHTML = `
      <div class="s-num">اسلات ${i}</div>
      <div class="s-name" id="slotName${i}">—</div>
      <div class="s-btns">
        <button class="btn small green" title="savepos">💾</button>
        <button class="btn small cyan" title="loadpos">↥</button>
        <button class="btn small red" title="clearpos">🗑</button>
      </div>`;
    const [bSave, bLoad, bClear] = d.querySelectorAll("button");
    bSave.onclick = () => send(Cmd.savePos(i));
    bLoad.onclick = () => send(Cmd.loadPos(i));
    bClear.onclick = async () => {
      if (await confirmModal("پاک کردن اسلات", `اسلات ${i} پاک شود؟`)) send(Cmd.clearPos(i));
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
    row.style.cssText = "border:1px dashed rgba(148,163,184,.2);border-radius:10px;padding:6px 10px;transition:.3s";
    row.innerHTML = `
      <b style="font-size:12px">${p.label}</b>
      <span class="tiny" style="direction:ltr;font-family:var(--mono)">[${p.angles.join(", ")}]°</span>
      <span style="margin-inline-start:auto;display:flex;gap:5px">
        <button class="btn small cyan">↧ درج</button>
        <button class="btn small orange">▶ اجرا</button>
      </span>`;
    const [bIns, bGo] = row.querySelectorAll("button");
    bIns.onclick = () => {
      p.angles.forEach((v, j) => ($("ma" + j).value = v));
      toast("درج شد در moveall — برای اعمال، «اجرای moveall» را بزن", "info");
    };
    bGo.onclick = () => goMoveAll(p.angles.slice());
    box.appendChild(row);
  });
}

function highlightDemoPose(step) {
  FW.DEMO_MOVES.forEach((_, i) => {
    const el = $("demoPose" + (i + 1));
    if (el) el.style.borderColor = i + 1 === step ? "rgba(251,146,60,.8)" : "rgba(148,163,184,.2)";
  });
}

/* ============================================================
 * تب زمان‌بند
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
    s.textContent = `⏱ ${Math.ceil((t.fireAt - now) / 1000)}s → J${t.axis}`;
    box.appendChild(s);
  });
  $("timersLocalCount").textContent =
    S.timersLocal.length + (S.timersFw !== null && S.timersFw !== undefined ? ` (فریم‌ور: ${S.timersFw})` : "");
}

/* ============================================================
 * تب کنسول
 * ============================================================ */
function buildChips() {
  const box = $("chipsBox");
  box.innerHTML = "";
  /* فقط دستورات پرکاربرد و «کامل» — هر رشته عیناً توسط پارسر فریم‌ور پذیرفته می‌شود */
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
 * تب راهنما
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
      <td><b style="color:${AXCOLORS[ax.joint - 1]}">J${ax.joint} ${ax.id}</b> ${ax.name}</td>
      <td class="tiny">${ax.role}</td>
      <td><code>${ax.min}..${ax.max}°</code></td>
      <td><code>${ax.stepsPerDeg}</code></td>
      <td><code>${ax.gear}</code></td>
      <td><code>${ax.maxSpeed}</code></td>
      <td><code>${ax.accel}</code></td>
      <td><code>${ax.pins.step}/${ax.pins.dir}/${ax.pins.enable}/${ax.pins.endstop}</code></td>`;
    ab.appendChild(tr);
  });
}

/* ============================================================
 * سینی کمکی
 * ============================================================ */
function fmtBytes(n) {
  return n < 1024 ? n + " B" : (n / 1024).toFixed(1) + " KB";
}

function updateLinkStats() {
  if (S.mode === "serial") {
    $("txCount").textContent = fmtBytes(S.serial.txCount);
    $("rxCount").textContent = fmtBytes(S.serial.rxCount);
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

/* ---------- تب‌ها ---------- */
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

/* ---------- اتصال دکمه‌ها ---------- */
function bindActions() {
  $("btnConnect").onclick = toggleSerial;
  $("btnSim").onclick = () => (S.mode === "sim" ? stopSim() || toast("شبیه‌ساز خاموش شد", "info") : startSim());
  $("selBaud").onchange = () => {};
  $("selPoll").onchange = restartPoll;

  $("btnEstop").onclick = () => {
    if (send(Cmd.estop())) { toast("⛔ ESTOP ارسال شد", "err"); addFeed("rx-err", "⛔ ESTOP"); }
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("modalBack").classList.contains("show")) $("btnEstop").click();
    if (e.ctrlKey && e.key.toLowerCase() === "k") { e.preventDefault(); $("cmdInput").focus(); }
  });
  $("btnResetEstop").onclick = () => send(Cmd.reset());

  /* داشبورد */
  $("qaHome").onclick = () => send(Cmd.homeAll());
  $("qaDemo").onclick = () => send(Cmd.demo());
  $("qaStopDemo").onclick = () => send(Cmd.stopDemo());
  $("qaStop").onclick = () => send(Cmd.stop());
  $("qaEnable").onclick = () => send(Cmd.enableAll());
  $("qaDisable").onclick = () => send(Cmd.disableAll());
  $("qaListPos").onclick = () => send(Cmd.listPos());

  /* حرکت */
  $("swDegMode").onchange = () => { S.degMode = $("swDegMode").checked; rebuildJointsMode(); };
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

  /* کینماتیک */
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

  /* حافظه */
  $("btnListPos").onclick = () => send(Cmd.listPos());
  $("btnTeachStart").onclick = () => { S.teachLocal = []; renderTeachTimeline(); send(Cmd.teachStart()); toast("ضبط شروع شد — با اسلایدرها حرکت بده و «ثبت استپ» بزن", "info"); };
  $("btnTeachStep").onclick = () => send(Cmd.teachStep());
  $("btnTeachStop").onclick = () => send(Cmd.teachStop());
  $("btnTeachCount").onclick = () => send(Cmd.teachCount());
  $("btnPlay").onclick = () => send(Cmd.play());
  $("btnPlayStop").onclick = () => send(Cmd.playStop());

  /* زمان‌بند */
  $("btnTimerSet").onclick = () => {
    const ms = parseInt($("timMs").value, 10) || 1000;
    const axis = parseInt($("timAxis").value, 10);
    S.timersLocal.push({ fireAt: Date.now() + ms, axis, ms });
    renderTimersLocal();
    send(Cmd.timer(ms, axis));
  };
  $("btnTimersCount").onclick = () => send(Cmd.timers());
  $("btnClearTimers").onclick = async () => {
    if (await confirmModal("پاک کردن تایمرها", "همه‌ی تایمرهای فعال پاک شوند؟")) {
      S.timersLocal = [];
      renderTimersLocal();
      send(Cmd.clearTimers());
    }
  };

  /* انرژی */
  $("btnSleep").onclick = () => send(Cmd.sleep());
  $("btnWake").onclick = () => send(Cmd.wake());
  $("swAutoSleep").onchange = () => {
    S.autoSleep = $("swAutoSleep").checked;
    send(Cmd.autoSleep(S.autoSleep));
    renderEnergy();
  };

  /* لاگر */
  $("btnLogOn").onclick = () => send(Cmd.logOn());
  $("btnLogOff").onclick = () => send(Cmd.logOff());
  $("btnLogShow").onclick = () => send(Cmd.logShow());
  $("btnLogClear").onclick = () => send(Cmd.logClear());

  /* کنسول */
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
    a.download = "robotarm-log-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* موتورها */
  FW.AXES.forEach((ax, i) => {
    $("mEn" + i).onclick = () => send(Cmd.enableAxis(i + 1));
    $("mDis" + i).onclick = () => send(Cmd.disableAxis(i + 1));
  });
}

function buildMotors() {
  const g = $("motorsGrid");
  FW.AXES.forEach((ax, i) => {
    const d = document.createElement("div");
    d.className = "row";
    d.style.cssText = "border:1px dashed rgba(148,163,184,.2);border-radius:10px;padding:6px 10px";
    d.innerHTML = `
      <b style="color:${AXCOLORS[i]};font-size:12.5px">J${ax.joint} ${ax.name}</b>
      <button class="btn small green" id="mEn${i}">🔌 enable</button>
      <button class="btn small" id="mDis${i}">🔲 disable</button>`;
    g.appendChild(d);
  });
}

function renderEnergy() {
  $("energyStatus").textContent = S.sleeping ? "😴 خواب" : (S.autoSleep ? "عادی + خواب خودکار" : "عادی");
  $("swAutoSleep").checked = S.autoSleep;
}

/* ============================================================
 * حلقه‌ی اصلی
 * ============================================================ */
let _lastT = performance.now();
function mainLoop(t) {
  const dt = Math.min(100, t - _lastT);
  _lastT = t;
  if (S.sim) S.sim.tick();
  viz.frame(dt);
  requestAnimationFrame(mainLoop);
}

/* ---------- راه‌اندازی ---------- */
function init() {
  if (window.__armPanelInit) return; /* گارد اجرای دوباره */
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
  FW.AXES.forEach((_, i) => renderAxisCard(i));

  /* راهنمای سریال */
  if (!SerialLink.supported) {
    $("serialHint").textContent = "⚠️ این مرورگر از Web Serial پشتیبانی نمی‌کند. Chrome یا Edge (دسکتاپ) را استفاده کن — فعلاً شبیه‌ساز در دسترس است.";
    $("btnConnect").disabled = true;
  } else {
    $("serialHint").textContent = "از کارت «انتخاب پورت» در سایدبار استفاده کن — یا دکمه‌ی اتصال بالای صفحه.";
  }

  /* ---------- اتصال کارت انتخاب پورت ---------- */
  $("btnAck").onclick = () => {
    if (S.mode === "off") { toast("اول به آردوینو وصل شو یا شبیه‌ساز را روشن کن", "warn"); return; }
    send($("btnAck").classList.contains("on") ? "ack off" : "ack on");
  };
  $("btnScanPorts").onclick = toggleSerial;   /* در مرورگر، اسکن همان چوزر native است */
  $("btnDiscPort").onclick = () => { if (S.mode === "serial") S.serial.disconnect(); };
  $("chkAutoPort").onchange = () => Store.set("auto_port", $("chkAutoPort").checked ? "1" : "0");
  renderConnCard();

  /* اتصال خودکار آخرین پورت مجازشده در شروع */
  if (Store.get("auto_port", "0") === "1") {
    setTimeout(async () => {
      if (S.mode !== "off" || !SerialLink.supported) return;
      try {
        const ports = await S.serial.previouslyGranted();
        if (ports.length) {
          const hit = ports[ports.length - 1];
          let info = {};
          try { info = hit.getInfo ? hit.getInfo() : {}; } catch (e) {}
          addConsole("sys", "[SYS] اتصال خودکار پورت…");
          connectDirect(hit, portLabelFor(info));
        }
      } catch (e) {}
    }, 900);
  }

  /* شروع خودکار شبیه‌ساز برای تجربه‌ی فوری */
  if (Store.get("prefer_hw", "0") !== "1") {
    setTimeout(() => {
      if (S.mode === "off") startSim();
    }, 600);
  } else {
    addConsole("sys", "[SYS] آماده. برای شروع، به آردوینو وصل شو یا شبیه‌ساز را روشن کن.");
  }

  addConsole("sys", "[SYS] کنترل‌پنل بازوی رباتیک ۵ محوره بارگذاری شد — Esc = ESTOP");
  setInterval(updateLinkStats, 1000);
  requestAnimationFrame(mainLoop);
}

document.addEventListener("DOMContentLoaded", init);
