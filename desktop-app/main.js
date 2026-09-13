/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
 * https://github.com/Draxx143/arduinoarm_robot */
/* ============================================================
 * main.js — AXIS-5 Robot Control (Electron main process)
 * Handles: window, Web Serial permissions & port chooser bridge
 * ============================================================ */
"use strict";

const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const { execFile, spawn } = require("child_process");
const path = require("path");

/* OS-level serial driver (N-API — loads inside Electron without rebuild).
 * Used when Chromium's Web Serial enumeration comes back empty. */
let SerialPortC = null;
try { SerialPortC = require("serialport").SerialPort; } catch (e) { SerialPortC = null; }
/* نشست‌های درایورِ node-serialport (مسیرِ ویندوز). پلِ پایتونِ Linux/macOS
 * در main/pybridge.js است — جدا و بدون وابستگی به electron، تا بتوان با
 * Node خالی تستش کرد (tools/test_pybridge.js). */
const pybridge = require("./main/pybridge.js");

/* نام‌گذاریِ پورت‌ها: حذفِ ttyS*های شبحی + ترجیحِ نامِ ثابتِ /dev/axis5
   (منطقِ خالص در main/portnames.js است، پس با Nodeِ خالی تست می‌شود). */
const portnames = require("./main/portnames.js");
const pickRealPorts = portnames.pickRealPorts;

/* نسخه‌ی فریم‌وری که این اپ انتظار دارد — باید با FIRMWARE_VERSION در
 * firmware/RobotArm_Firmware/Config.h یکی باشد (تستِ مرحله‌ی ۵ چک می‌کند). */
const EXPECTED_FW = "1.0.41";
const openSerialPorts = new Map();
let serialSeq = 0;

let win = null;
let pendingPortCallback = null;
let expectedPortName = null; /* renderer picked a system port — auto-resolve the chooser */

/* Enumerate serial ports at OS level (bypasses Chromium's udev scan,
 * which can come back empty on some Linux setups while the OS sees
 * the device fine — e.g. Arduino IDE shows /dev/ttyUSB0). */
function listSystemPorts() {
  return new Promise((resolve) => {
    let cmd, args;
    if (process.platform === "win32") {
      cmd = "powershell.exe";
      args = ["-NoProfile", "-Command",
        "(Get-CimInstance Win32_SerialPort | Select-Object -ExpandProperty DeviceID) -join ','"];
    } else if (process.platform === "darwin") {
      cmd = "/bin/sh";
      args = ["-c", "ls -1 /dev/tty.usbmodem* /dev/tty.usbserial* 2>/dev/null || true"];
    } else {
      cmd = "/bin/sh";
      args = ["-c", "ls -1 /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true"];
    }
    execFile(cmd, args, { timeout: 4000 }, (err, stdout) => {
      const ports = String(stdout || "").split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
      /* قاعده‌ی udev پروژه (/etc/udev/rules.d/99-axis5-serial.rules) یک
       * symlinkِ ثابت به نامِ /dev/axis5 می‌سازد. با افتِ USB کرنل دستگاه را
       * دوباره enumerate می‌کند و ممکن است نامش از ttyUSB0 به ttyUSB1 عوض
       * شود؛ نامِ ثابت عوض نمی‌شود، پس اپ همیشه همان برد را باز می‌کند. */
      resolve(portnames.preferStableNode(ports, portnames.stableTarget()));
    });
  });
}

/* Show a visible dialog instead of dying silently when something
 * fails at startup (the app may be launched from the menu icon). */
process.on("uncaughtException", (err) => {
  try {
    const { dialog } = require("electron");
    dialog.showErrorBox("AXIS-5 Robot Control — startup error", String((err && err.stack) || err));
  } catch (e) { /* ignore */ }
});

/* NOTE: command-line flags that must exist at process start (like
 * --no-sandbox on Ubuntu 23.10+ with AppArmor user-namespace
 * restrictions) are passed by the deb wrapper launcher. These
 * app.commandLine switches are a second line of defense. */
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("disable-dev-shm-usage");
/* Safe video mode: AXIS5_SAFE=1 axis5-robot-control  (for VMs / broken GPU drivers) */
if (process.env.AXIS5_SAFE === "1") {
  app.commandLine.appendSwitch("disable-gpu");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0d1015",
    title: "AXIS-5 · Robot Arm Control",
    icon: path.join(__dirname, "renderer", "assets", "icon.png"),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  /* ---- Web Serial permission grants ---- */
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === "serial") return callback(true);
    callback(false);
  });
  ses.setPermissionCheckHandler((wc, permission, details) => {
    if (permission === "serial") return true;
    return false;
  });
  ses.setDevicePermissionHandler((details) => {
    /* Allow devices the user explicitly picked in the in-app chooser */
    return true;
  });

  /* ---- Serial port chooser bridge ----
   * Electron has no built-in chooser UI: when the renderer calls
   * navigator.serial.requestPort() we forward the system port list
   * to the renderer, which shows its own dialog, then resolves. */
  win.webContents.on("select-serial-port", (event, portList, webContents, callback) => {
    event.preventDefault();
    /* If the renderer picked an OS-level port name, resolve silently */
    const want = expectedPortName;
    expectedPortName = null;
    if (want) {
      const norm = (x) => String(x || "").replace(/^\/dev\//, "").toLowerCase();
      const hit = (portList || []).find((p) => p && (p.portName === want || norm(p.portName) === norm(want)));
      if (hit) { callback(hit.portId); return; }
    }
    pendingPortCallback = callback;
    win.webContents.send("serial:port-list", portList);
  });
  win.webContents.on("serial-port-added", (event, port) => {
    if (win && !win.isDestroyed()) win.webContents.send("serial:port-added", port);
  });
  win.webContents.on("serial-port-removed", (event, port) => {
    if (win && !win.isDestroyed()) win.webContents.send("serial:port-removed", port);
  });

  ipcMain.on("serial:choose-port", (e, portId) => {
    if (pendingPortCallback) {
      const cb = pendingPortCallback;
      pendingPortCallback = null;
      cb(portId);
    }
  });
  /* Renderer reads the packaged app version for the footer badge */
  ipcMain.on("app:get-version", (e) => { e.returnValue = app.getVersion(); });

  /* OS-level port enumeration for the Connection card */
  ipcMain.handle("serial:list-system-ports", () => listSystemPorts());

  /* How many bytes did the MAIN-process driver actually see? */
  ipcMain.handle("serialport:stats", () => {
    let rx = 0, kind = "none";
    openSerialPorts.forEach((r) => { rx += r.rx || 0; kind = r.kind || "?"; });
    const py = pybridge.stats();
    if (py.count) { rx += py.rx; kind = "py"; }
    return { mainRx: rx, kind };
  });

  /* Who else has the port open? (RX=0 usually means a 2nd reader is
   * stealing the bytes — name it so the user knows what to close) */
  ipcMain.handle("port:holders", (e, portPath) => new Promise((resolve) => {
    execFile("fuser", [String(portPath)], (err, stdout) => {
      /* خودِ اپ و پلِ پایتونی که اپ بالا آورده همیشه پورت را نگه می‌دارند —
       * آن‌ها «خواننده‌ی دوم» نیستند. بدونِ این فیلتر، عیب‌یاب به کاربر می‌گفت
       * «PID 24396 هم پورت را گرفته، ببندش» درحالی‌که آن خودِ اپ بود. */
      const ours = new Set([process.pid, ...pybridge.pids()]);
      const pids = String(stdout || "").trim().split(/\s+/).filter(Boolean)
        .map(Number).filter((pid) => pid && !ours.has(pid));
      if (!pids.length) return resolve({ pids: [], procs: [] });
      execFile("ps", ["-o", "comm=", "-p", pids.join(",")], (e2, so) => {
        const procs = String(so || "").split("\n").map((x) => x.trim()).filter(Boolean);
        resolve({ pids, procs });
      });
    });
  }));
  ipcMain.on("serial:expect-port", (e, name) => { expectedPortName = String(name || ""); });

  /* ---- Main-process serial backend (bypasses Chromium Web Serial) ---- */
  ipcMain.handle("serialport:available", () => !!SerialPortC);
  ipcMain.handle("serialport:list", async () => {
    if (!SerialPortC) {
      /* درایورِ native (serialport) بارگذاری نشد — مثلاً bindingِ N-API برای
       * این ABI در بسته نیست. کاربر نباید به‌خاطرِ آن پورت‌هایش را نبیند:
       * فهرستِ سطحِ سیستم دقیقاً همان چیزی است که ls و Arduino IDE می‌بینند.
       * بدون این، کارتِ اتصال خالی می‌ماند یا فقط پورت‌های Web Serial را
       * نشان می‌دهد و «اتصال» بی‌نتیجه می‌ماند. */
      try {
        const names = await listSystemPorts();
        return { ports: (names || []).map((n) => ({
          path: n,
          friendly: n === portnames.STABLE_NODE ? "AXIS-5 board (stable name)" : "OS serial device",
          vid: "", pid: "", stable: n === portnames.STABLE_NODE,
        })) };
      } catch (er) { return { err: "driver unavailable" }; }
    }
    try {
      const list = await SerialPortC.list();
      /* node-serialport در لینوکس همه‌ی /dev/ttyS0..ttyS31 را هم می‌دهد —
       * پورت‌های شبحیِ مادربرد. کاربرِ ما «۳۳ دستگاه» می‌دید درحالی‌که فقط
       * یکی واقعی بود. وقتی گره‌ی USB موجود است، آن‌ها را حذف کن. */
      let osNames = [];
      try { osNames = await listSystemPorts(); } catch (er) {}
      const keep = new Set(pickRealPorts(osNames, list.map((p) => p.path)));
      const stable = portnames.stableTarget();
      const kept = list.filter((p) => keep.has(p.path)).map((p) => ({
        path: p.path,
        friendly: p.friendlyName || p.manufacturer || "",
        vid: p.vendorId || "", pid: p.productId || "",
      }));
      /* اگر /dev/axis5 هست، همان را نشانش بده (نه ttyUSB0 که با هر افتِ USB
       * عوض می‌شود) — وگرنه کاربر دفعه‌ی بعد گره‌ی مرده را انتخاب می‌کند. */
      return { ports: portnames.applyStableName(kept, stable) };
    } catch (e) { return { err: String(e.message || e) }; }
  });
  ipcMain.handle("serialport:open", (e, portPath, baud) => new Promise((resolve) => {
    /* ⚠ قانونِ اصلی: این promise باید در **هر** شرایطی settles شود. قبلاً یک
     * حلقه‌ی بی‌پاسخ (pgrep) اینجا باعث می‌شد دکمه‌ی «اتصال» برای همیشه روی
     * «opening …» بماند بدونِ هیچ خطایی — بدترین گزارشِ ممکن برای کاربر. */
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(hardCap); resolve(v); } };
    const notice = (m) => { if (win && !win.isDestroyed()) win.webContents.send("serialport:notice", m); };
    const hardCap = setTimeout(() => done({
      err: "opening " + portPath + " took longer than 20 s and never answered — the port is stuck. Unplug the USB cable, run: sudo pkill -f serial_bridge.py, then replug and connect again.",
    }), 20000);
    /* ---- Linux/macOS: پلِ پایتون (ترموسِ خام + پالسِ DTR، بدون وابستگی) ----
       pybridge تضمین می‌کند این promise در **هر** شرایطی یک بار حل شود:
       پورت وجود ندارد / مجوز نیست / پورت دستِ برنامه‌ی دیگری است / python3
       نصب نیست / پل وسطِ کار مرد. قبلاً هیچ‌کدام resolve نمی‌شد و دکمه‌ی
       «اتصال» برای همیشه روی «opening …» می‌ماند بدون هیچ پیامِ خطایی. */
    if (process.platform !== "win32") {
      /* پیش از بازکردن: پل‌های یتیمِ نشست‌های قبلی را خلاص کن. tty در لینوکس
       * انحصاری نیست، پس یک serial_bridge.pyِ جامانده همه‌ی بایت‌های برد را
       * می‌بلعد: دستور می‌رود، جواب برنمی‌گردد، اپ «وصل‌نشده» به نظر می‌رسد. */
      const openNow = (orphansKilled) => {
        notice(`starting the serial bridge on ${portPath} @ ${Number(baud) || 115200}…`);
        return pybridge.openBridge({
          portPath: String(portPath),
          baud: Number(baud) || 115200,
          send: (channel, payload) => {
            if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
          },
        }).then((res) => done(res && !res.err && orphansKilled && orphansKilled.length
          ? Object.assign({ orphansKilled }, res) : res));
      };
      /* breadcrumb: اگر کنسول بعد از این پیام ساکت ماند، یعنی همین قدم گیر کرده */
      notice("checking for leftover bridge processes that would steal the port's bytes…");
      Promise.resolve()
        .then(() => pybridge.killOrphans({ log: notice, timeoutMs: 2500 }))
        .then((k) => openNow(k || []), () => openNow([]))
        .catch((er) => done({ err: "connect step failed: " + ((er && er.message) || er) }));
      return;
    }
    if (!SerialPortC) return resolve({ err: "driver unavailable" });
    let sp;
    try { sp = new SerialPortC({ path: String(portPath), baudRate: Number(baud) || 115200, autoOpen: false }); }
    catch (er) { return resolve({ err: String(er.message || er) }); }
    sp.open((err) => {
      if (err) return resolve({ err: String(err.message || err) });
      const id = ++serialSeq;
      /* FIX: رکورد **پیش از** سیم‌کشیِ رویدادها ثبت شود. قبلاً rec0 قبل از
       * openSerialPorts.set() خوانده می‌شد، پس undefined بود و اولین بایتِ
       * دریافتی داخلِ لیسنرِ 'data' استثنا می‌داد (TypeError) → در فرایندِ
       * main یک uncaughtException و در عمل RX هرگز به renderer نمی‌رسید:
       * «بورد شناسایی می‌شود ولی وصل نمی‌شود». */
      const rec0 = { sp, pump: null, rx: 0, path: String(portPath) };
      openSerialPorts.set(id, rec0);
      /* RX: BOTH mechanisms at once —
       *  1) 'data' event (works when the stream flows)
       *  2) 15 ms read() pump (works in paused mode)
       * whichever fires, the renderer gets the bytes. */
      sp.on("data", (buf) => {
        rec0.rx += buf.length;
        if (win && !win.isDestroyed()) win.webContents.send("serialport:data", buf.toString("base64"));
      });
      rec0.pump = setInterval(() => {
        try {
          let chunk;
          while ((chunk = sp.read()) !== null) {
            rec0.rx += chunk.length;
            if (win && !win.isDestroyed()) win.webContents.send("serialport:data", chunk.toString("base64"));
          }
        } catch (er2) {}
      }, 15);
      sp.on("close", () => {
        clearInterval(rec0.pump);
        openSerialPorts.delete(id);
        if (win && !win.isDestroyed()) win.webContents.send("serialport:closed", id);
      });
      sp.on("error", (er) => {
        if (win && !win.isDestroyed()) win.webContents.send("serialport:error", String(er.message || er));
      });
      resolve({ id });
    });
  }));
  ipcMain.handle("serialport:write", (e, id, text) => {
    if (pybridge.has(id)) return Promise.resolve(pybridge.writeTo(id, text));
    const rec = openSerialPorts.get(Number(id));
    if (!rec) return Promise.resolve({ err: "port not open" });
    return new Promise((resolve) => rec.sp.write(String(text), (err) => resolve(err ? { err: String(err.message || err) } : {})));
  });
  ipcMain.handle("serialport:close", (e, id) => {
    if (pybridge.has(id)) { pybridge.closeSession(id); return Promise.resolve({}); }
    const rec = openSerialPorts.get(Number(id));
    if (!rec) return Promise.resolve({});
    clearInterval(rec.pump);
    return new Promise((resolve) => rec.sp.close((err) => resolve(err ? { err: String(err.message || err) } : {})));
  });

  ipcMain.on("serial:cancel-choose", () => {
    if (pendingPortCallback) {
      const cb = pendingPortCallback;
      pendingPortCallback = null;
      cb(""); /* empty = cancel */
    }
  });

  /* Keep the title fixed */
  win.on("page-title-updated", (e) => e.preventDefault());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload", label: "Reload Panel" },
        { role: "forceReload" },
        { role: "toggleDevTools", label: "Developer Tools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About AXIS-5 Robot Control",
          click: () => {
            const { dialog } = require("electron");
            dialog.showMessageBox(win, {
              type: "info",
              title: "About",
              message: "AXIS-5 Robot Control v1.0.0",
              detail:
                "Industrial control panel for the 5-DOF Arduino Mega 2560 robot arm.\n" +
                "Companion app for RobotArm_Firmware.ino\n\n" +
                `Electron ${process.versions.electron} · Node ${process.versions.node} · Chromium ${process.versions.chrome}`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
