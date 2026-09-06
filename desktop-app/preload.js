/* ============================================================
 * preload.js — safe bridge between main and the renderer
 * ============================================================ */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  appVersion: ipcRenderer.sendSync("app:get-version") || "",
  onPortList: (cb) => ipcRenderer.on("serial:port-list", (e, ports) => cb(ports)),
  onPortAdded: (cb) => ipcRenderer.on("serial:port-added", (e, port) => cb(port)),
  onPortRemoved: (cb) => ipcRenderer.on("serial:port-removed", (e, port) => cb(port)),
  choosePort: (portId) => ipcRenderer.send("serial:choose-port", portId),
  cancelChoose: () => ipcRenderer.send("serial:cancel-choose"),
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
});
