/* ============================================================
 * main.js — AXIS-5 Robot Control (Electron main process)
 * Handles: window, Web Serial permissions & port chooser bridge
 * ============================================================ */
"use strict";

const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const { execFile } = require("child_process");
const path = require("path");

/* OS-level serial driver (N-API — loads inside Electron without rebuild).
 * Used when Chromium's Web Serial enumeration comes back empty. */
let SerialPortC = null;
try { SerialPortC = require("serialport").SerialPort; } catch (e) { SerialPortC = null; }
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
      resolve(ports);
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
  ipcMain.on("serial:expect-port", (e, name) => { expectedPortName = String(name || ""); });

  /* ---- Main-process serial backend (bypasses Chromium Web Serial) ---- */
  ipcMain.handle("serialport:available", () => !!SerialPortC);
  ipcMain.handle("serialport:list", async () => {
    if (!SerialPortC) return { err: "driver unavailable" };
    try {
      const list = await SerialPortC.list();
      return { ports: list.map((p) => ({
        path: p.path,
        friendly: p.friendlyName || p.manufacturer || "",
        vid: p.vendorId || "", pid: p.productId || "",
      })) };
    } catch (e) { return { err: String(e.message || e) }; }
  });
  ipcMain.handle("serialport:open", (e, portPath, baud) => new Promise((resolve) => {
    if (!SerialPortC) return resolve({ err: "driver unavailable" });
    let sp;
    try { sp = new SerialPortC({ path: String(portPath), baudRate: Number(baud) || 115200, autoOpen: false }); }
    catch (er) { return resolve({ err: String(er.message || er) }); }
    sp.open((err) => {
      if (err) return resolve({ err: String(err.message || err) });
      const id = ++serialSeq;
      /* RX: BOTH mechanisms at once —
       *  1) 'data' event (works when the stream flows)
       *  2) 15 ms read() pump (works in paused mode)
       * whichever fires, the renderer gets the bytes. */
      sp.on("data", (buf) => {
        if (win && !win.isDestroyed()) win.webContents.send("serialport:data", buf.toString("base64"));
      });
      const pump = setInterval(() => {
        try {
          let chunk;
          while ((chunk = sp.read()) !== null) {
            if (win && !win.isDestroyed()) win.webContents.send("serialport:data", chunk.toString("base64"));
          }
        } catch (er2) {}
      }, 15);
      openSerialPorts.set(id, { sp, pump });
      sp.on("close", () => {
        clearInterval(pump);
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
    const rec = openSerialPorts.get(Number(id));
    if (!rec) return Promise.resolve({ err: "port not open" });
    return new Promise((resolve) => rec.sp.write(String(text), (err) => resolve(err ? { err: String(err.message || err) } : {})));
  });
  ipcMain.handle("serialport:close", (e, id) => {
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
