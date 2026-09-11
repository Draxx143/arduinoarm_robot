/* ============================================================
 * serial.js — Web Serial transport with an Electron bridge.
 * In the browser (Chrome/Edge) the native chooser is used.
 * Inside the Electron app, main.js forwards the system port
 * list and the renderer shows its own picker dialog.
 * ============================================================ */
"use strict";

class SerialLink {
  constructor() {
    this.port = null;
    this.reader = null;
    this.connected = false;
    this.baud = FW.BAUD;
    this.onLine = null;
    this.onConnect = null;
    this.onDisconnect = null;
    this.onError = null;
    this.txCount = 0;
    this.rxCount = 0;
    this._buff = "";
    this._electronPortHandler = null;
    this._activeLabel = null;
    this._activeInfo = {};
  }

  get activeLabel() { return this._activeLabel; }
  get activeInfo() { return this._activeInfo; }

  static get supported() {
    return typeof navigator !== "undefined" && !!navigator.serial;
  }

  async connect(baud) {
    if (!SerialLink.supported) {
      throw new Error("This environment has no Web Serial support");
    }
    if (this.connected) throw new Error("Already connected");
    this.baud = baud || FW.BAUD;

    /* Electron: register the custom chooser before requesting a port */
    if (window.electronAPI && window.electronAPI.onPortList) {
      this._electronPortHandler = (ports) => this._showElectronChooser(ports);
      window.electronAPI.onPortList(this._electronPortHandler);
    }

    let port;
    try {
      port = await navigator.serial.requestPort();
    } catch (e) {
      this._removeElectronHandler();
      if (/No port selected|cancelled|Canceled/i.test(e.message || "")) {
        throw new Error("PORT_CANCELLED");
      }
      throw e;
    }
    this._removeElectronHandler();
    this._activeLabel = null;
    this._activeInfo = SerialLink._safeInfo(port);
    await this._openPort(port, this.baud);
  }

  /* Directly open an already-granted port (Connection card / auto-connect) */
  async connectPort(port, baud, label) {
    if (!SerialLink.supported) {
      throw new Error("This environment has no Web Serial support");
    }
    if (this.connected) throw new Error("Already connected");
    this.baud = baud || FW.BAUD;
    this._activeLabel = label || null;
    this._activeInfo = SerialLink._safeInfo(port);
    await this._openPort(port, this.baud);
  }

  static _safeInfo(port) {
    try { return (port && port.getInfo()) || {}; } catch (e) { return {}; }
  }

  async _openPort(port, baud) {
    await port.open({
      baudRate: baud,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      bufferSize: 4096,
      flowControl: "none",
    });

    this.port = port;
    this.connected = true;
    this._buff = "";
    if (this.onConnect) this.onConnect(this.baud);
    this._readLoop();
  }

  _removeElectronHandler() {
    this._electronPortHandler = null; /* listener is one-shot per request */
  }

  /* In-app port picker used inside Electron (renderer shows the dialog) */
  _showElectronChooser(ports) {
    const ev = new CustomEvent("arm-choose-serial-port", { detail: ports || [] });
    window.dispatchEvent(ev);
  }

  async _readLoop() {
    const dec = new TextDecoder();
    try {
      while (this.port && this.port.readable && this.connected) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            this.rxCount += value.length;
            this._buff += dec.decode(value, { stream: true });
            let idx;
            while ((idx = this._buff.search(/[\r\n]/)) !== -1) {
              const line = this._buff.slice(0, idx).replace(/\r/g, "");
              this._buff = this._buff.slice(idx + 1);
              if (line.trim() && this.onLine) this.onLine(line);
            }
          }
        } catch (e) {
          if (this.connected && this.onError) this.onError("Read error: " + e.message);
          break;
        } finally {
          try { this.reader.releaseLock(); } catch (e) {}
        }
      }
    } finally { /* noop */ }
  }

  async write(text) {
    if (!this.connected || !this.port || !this.port.writable) {
      throw new Error("Port is not open");
    }
    const enc = new TextEncoder();
    const data = enc.encode(text + "\n");
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(data);
      this.txCount += data.length;
    } finally {
      try { writer.releaseLock(); } catch (e) {}
    }
  }

  async disconnect() {
    this.connected = false;
    try {
      if (this.reader) { try { await this.reader.cancel(); } catch (e) {} }
      if (this.port) { try { await this.port.close(); } catch (e) {} }
    } finally {
      this.port = null;
      this.reader = null;
      if (this.onDisconnect) this.onDisconnect();
    }
  }
}

/* ============================================================
 * IpcSerialLink — main-process serial transport.
 * Opens the port via node-serialport in the Electron main
 * process, completely bypassing Chromium's Web Serial stack
 * (which can fail to enumerate devices on some Linux setups).
 * Same surface as SerialLink: connectVia/write/disconnect +
 * onConnect/onLine/onDisconnect/onError/txCount/rxCount/baud.
 * ============================================================ */
class IpcSerialLink {
  constructor() {
    this.bridge = (typeof window !== "undefined" && window.electronAPI && window.electronAPI.ipcSerial) || null;
    this.id = null;
    this.connected = false;
    this.baud = FW.BAUD;
    this.onLine = null;
    this.onConnect = null;
    this.onDisconnect = null;
    this.onError = null;
    this.txCount = 0;
    this.rxCount = 0;
    this._pend = new Uint8Array(0);
    this._bound = false;
    this._activeLabel = null;
    this.transport = "system";
  }

  static get supported() {
    return typeof window !== "undefined" && !!(window.electronAPI && window.electronAPI.ipcSerial);
  }

  get activeLabel() { return this._activeLabel; }
  get activeInfo() { return {}; }

  async list() {
    if (!this.bridge) throw new Error("system serial bridge unavailable");
    const res = await this.bridge.list();
    if (res && res.err) throw new Error(res.err);
    return (res && res.ports) || [];
  }

  async connectVia(portPath, baud) {
    if (!IpcSerialLink.supported) throw new Error("system serial bridge unavailable");
    if (this.connected) throw new Error("Already connected");
    this.baud = baud || FW.BAUD;
    const res = await this.bridge.open(String(portPath), this.baud);
    if (res && res.err) throw new Error(res.err);
    this.id = res.id;
    this.connected = true;
    this._activeLabel = String(portPath);
    this._pend = new Uint8Array(0);
    this._bind();
    if (this.onConnect) this.onConnect(this.baud);
  }

  _bind() {
    if (this._bound) return;
    this._bound = true;
    this.bridge.onData((b64) => { if (this.connected) this._feed(b64); });
    this.bridge.onClosed(() => {
      if (this.connected) {
        this.connected = false;
        this.id = null;
        if (this.onDisconnect) this.onDisconnect();
      }
    });
    this.bridge.onError((m) => { if (this.connected && this.onError) this.onError(m); });
  }

  _feed(b64) {
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this.rxCount += bytes.length;
      const buf = new Uint8Array(this._pend.length + bytes.length);
      buf.set(this._pend);
      buf.set(bytes, this._pend.length);
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 10 || buf[i] === 13) {
          if (i > start) {
            const line = new TextDecoder("utf-8").decode(buf.subarray(start, i));
            if (line.trim() && this.onLine) this.onLine(line);
          }
          start = i + 1;
        }
      }
      this._pend = buf.slice(start);
    } catch (e) {
      if (this.onError) this.onError("decode: " + e.message);
    }
  }

  async write(text) {
    if (!this.connected || this.id == null) throw new Error("Port is not open");
    const data = text + "\n";
    this.txCount += data.length;
    const res = await this.bridge.write(this.id, data);
    if (res && res.err) throw new Error(res.err);
  }

  async disconnect() {
    const was = this.connected;
    this.connected = false;   /* guard first: the closed-event must not double-fire */
    if (this.id != null) {
      try { await this.bridge.close(this.id); } catch (e) {}
    }
    this.id = null;
    if (was && this.onDisconnect) this.onDisconnect();
  }
}
