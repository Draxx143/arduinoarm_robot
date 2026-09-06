/* ============================================================
 * preload.js — safe bridge between main and the renderer
 * ============================================================ */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  appVersion: ipcRenderer.sendSync("app:get-version") || "",
  serialDriverAvailable: () => ipcRenderer.invoke("serialport:available"),
  portHolders: (p) => ipcRenderer.invoke("port:holders", p),
  serialStats: () => ipcRenderer.invoke("serialport:stats"),
  portProbe: (p) => ipcRenderer.invoke("port:probe", p),
  ipcSerial: {
    list: () => ipcRenderer.invoke("serialport:list"),
    open: (portPath, baud) => ipcRenderer.invoke("serialport:open", portPath, baud),
    write: (id, text) => ipcRenderer.invoke("serialport:write", id, text),
    close: (id) => ipcRenderer.invoke("serialport:close", id),
    onData: (cb) => { ipcRenderer.removeAllListeners("serialport:data"); ipcRenderer.on("serialport:data", (e, b64) => cb(b64)); },
    onClosed: (cb) => { ipcRenderer.removeAllListeners("serialport:closed"); ipcRenderer.on("serialport:closed", (e, id) => cb(id)); },
    onError: (cb) => { ipcRenderer.removeAllListeners("serialport:error"); ipcRenderer.on("serialport:error", (e, m) => cb(m)); },
  },
  listSystemPorts: () => ipcRenderer.invoke("serial:list-system-ports"),
  expectPort: (name) => ipcRenderer.send("serial:expect-port", name),
  onPortList: (cb) => {
    ipcRenderer.removeAllListeners("serial:port-list"); /* avoid duplicate listeners on rescan */
    ipcRenderer.on("serial:port-list", (e, ports) => cb(ports));
  },
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
