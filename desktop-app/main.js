/* ============================================================
 * main.js — AXIS-5 Robot Control (Electron main process)
 * Handles: window, Web Serial permissions & port chooser bridge
 * ============================================================ */
"use strict";

const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const path = require("path");

let win = null;
let pendingPortCallback = null;

/* Show a visible dialog instead of dying silently when something
 * fails at startup (the app may be launched from the menu icon). */
process.on("uncaughtException", (err) => {
  try {
    const { dialog } = require("electron");
    dialog.showErrorBox("AXIS-5 Robot Control — startup error", String((err && err.stack) || err));
  } catch (e) { /* ignore */ }
});

/* Launch robustly on modern Ubuntu (23.10+/24.04 AppArmor user-namespace
 * restrictions break the Chrome SUID sandbox). This panel talks to local
 * hardware and never renders untrusted web content, so disabling the
 * browser sandbox is the pragmatic choice for an industrial kiosk app. */
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-dev-shm-usage");
app.commandLine.appendSwitch("disable-gpu-sandbox");
/* Safe video mode: AXIS5_SAFE=1 ./axis5-robot-control  (for VMs / broken GPU drivers) */
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
