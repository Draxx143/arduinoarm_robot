/* ============================================================
 * serial.js — اتصال مستقیم به آردوینو از طریق Web Serial API
 * پشتیبانی: Chrome / Edge / Opera (دسکتاپ)
 * ============================================================ */
"use strict";

class SerialLink {
  constructor() {
    this.port = null;
    this.reader = null;
    this.connected = false;
    this.baud = FW.BAUD;
    this.onLine = null;      // callback(line)
    this.onConnect = null;
    this.onDisconnect = null;
    this.onError = null;     // callback(errMsg)
    this.txCount = 0;
    this.rxCount = 0;
    this._buff = "";
    this._readLoopActive = false;
  }

  static get supported() {
    return typeof navigator !== "undefined" && !!navigator.serial;
  }

  /** پورت‌هایی که قبلاً مجوز گرفته‌اند (برای اتصال مجدد سریع) */
  async previouslyGranted() {
    if (!SerialLink.supported) return [];
    try { return await navigator.serial.getPorts(); } catch (e) { return []; }
  }

  async connect(baud) {
    if (!SerialLink.supported) {
      throw new Error("مرورگر شما از Web Serial پشتیبانی نمی‌کند — از Chrome یا Edge استفاده کن");
    }
    if (this.connected) throw new Error("هم‌اکنون متصل است");
    this.baud = baud || FW.BAUD;

    this.port = await navigator.serial.requestPort();
    await this.port.open({
      baudRate: this.baud,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      bufferSize: 4096,
      flowControl: "none",
    });

    this.connected = true;
    this._buff = "";
    if (this.onConnect) this.onConnect(this.baud);
    this._readLoop();
  }

  /** اتصال به پورت قبلاً-مجوزداده‌شده بدون دیالوگ انتخاب */
  async reconnect(baud) {
    if (!SerialLink.supported) throw new Error("Web Serial در دسترس نیست");
    const ports = await this.previouslyGranted();
    if (!ports.length) throw new Error("پورت قبلی‌ای مجاز نشده است");
    this.port = ports[ports.length - 1];
    this.baud = baud || FW.BAUD;
    await this.port.open({
      baudRate: this.baud, dataBits: 8, stopBits: 1,
      parity: "none", bufferSize: 4096, flowControl: "none",
    });
    this.connected = true;
    this._buff = "";
    if (this.onConnect) this.onConnect(this.baud);
    this._readLoop();
  }

  async _readLoop() {
    this._readLoopActive = true;
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
          if (this.connected && this.onError) this.onError("خطای خواندن: " + e.message);
          break;
        } finally {
          try { this.reader.releaseLock(); } catch (e) {}
        }
      }
    } finally {
      this._readLoopActive = false;
    }
  }

  async write(text) {
    if (!this.connected || !this.port || !this.port.writable) {
      throw new Error("پورت متصل نیست");
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
      if (this.port) {
        try { await this.port.close(); } catch (e) {}
      }
    } finally {
      this.port = null;
      this.reader = null;
      if (this.onDisconnect) this.onDisconnect();
    }
  }
}
