/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
 * https://github.com/Draxx143/arduinoarm_robot */
/* ============================================================
 * serial.js — اتصال مستقیم به آردوینو از طریق Web Serial API
 * پشتیبانی: Chrome / Edge / Opera (دسکتاپ)
 *
 * ⚠ این فایل باید **دقیقاً** مثلِ desktop-app/renderer/js/serial.js و
 *   desktop-app/bridge/serial_bridge.py رفتار کند. هر سه یک کار را
 *   می‌کنند: بازکردنِ پورت + پالسِ خطوطِ مودم (DTR/RTS). اگر یکی‌شان
 *   پالس نزند، همان برد با یک GUI وصل می‌شود و با دیگری نه — دقیقاً
 *   همان «ناهماهنگیِ آردوینو و GUI».
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
    this._label = null;
  }

  get activeLabel() { return this._label; }

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
    const port = await navigator.serial.requestPort();
    await this._openPort(port, this.baud);
  }

  /** اتصال مستقیم به یک پورتِ مجازشده (کارت انتخاب پورت) */
  async connectPort(port, baud, label) {
    if (!SerialLink.supported) throw new Error("Web Serial در دسترس نیست");
    if (this.connected) throw new Error("هم‌اکنون متصل است");
    this.baud = baud || FW.BAUD;
    this._label = label || null;
    await this._openPort(port, this.baud);
  }

  /** اتصال به پورت قبلاً-مجوزداده‌شده بدون دیالوگ انتخاب */
  async reconnect(baud) {
    if (!SerialLink.supported) throw new Error("Web Serial در دسترس نیست");
    const ports = await this.previouslyGranted();
    if (!ports.length) throw new Error("پورت قبلی‌ای مجاز نشده است");
    this.baud = baud || FW.BAUD;
    await this._openPort(ports[ports.length - 1], this.baud);
  }

  /* ---- تنها مسیرِ بازکردنِ پورت --------------------------------------
   * ترتیبِ چهار قدم اینجا **بار معنایی دارد** و قبلاً غلط بود:
   *   ۱. open            ۲. پالسِ خطوطِ مودم
   *   ۳. حلقه‌ی خواندن   ۴. خبرِ «وصل شد» به UI
   * حلقه‌ی خواندن **پیش از** onConnect شروع می‌شود: اگر هر هندلری در
   * onConnect استثنا بدهد (یک المانِ DOM که نیست، یک تابعِ خراب)، قبلاً
   * پورت باز می‌ماند ولی هیچ خواننده‌ای نداشت → RX برای همیشه صفر و
   * «وصل شد 🎉» روی صفحه. یعنی بدترین حالتِ ممکن: اتصالِ مرده‌ی بی‌صدا. */
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
    await this._assertLines(port);
    this._readLoop();
    if (this.onConnect) this.onConnect(this.baud);
  }

  /* Web Serial خطوطِ مودم را در وضعیتِ پیش‌فرضِ درایور رها می‌کند و این دو
   * پیامدِ جدی دارد:
   *   · بردهای USB بومی (32u4/ESP32) تا وقتی DTR asserted نباشد «میزبان وصل
   *     نیست» فرض می‌کنند و هر Serial.print را **بی‌صدا دور می‌ریزند** → RX=0؛
   *   · بردهای Rev3 (Uno/Mega) لبه‌ی ریست را نمی‌گیرند، پس بنرِ بوت و نسخه‌ی
   *     فریم‌ور هرگز نمی‌آید و GUI نمی‌داند آن سوی سیم چه چیزی هست.
   * پس همان پالسِ avrdude را می‌زنیم که پلِ دسکتاپ می‌زند، با همان قانونِ
   * حیاتی: پایان با **هر دو خط در یک سطح**. در Rev3 خطِ RESET با جفت
   * ترانزیستور از DTR/RTS هدایت می‌شود و تا وقتی این دو متفاوت باشند AVR در
   * ریست **نگه داشته می‌شود** — یعنی پورت باز است، TX می‌رود، RX صفر می‌ماند. */
  async _assertLines(port) {
    if (!port || typeof port.setSignals !== "function") return;
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const both = { dataTerminalReady: true, requestToSend: true };
    try {
      await port.setSignals(both);                                             /* میزبان وصل است */
      await nap(50);
      await port.setSignals({ dataTerminalReady: true, requestToSend: false }); /* تفاوت → RESET پایین */
      await nap(120);
      await port.setSignals(both);                                             /* یکسان → برد آزاد و در حالِ بوت */
      await nap(50);
    } catch (e) {
      /* برخی مبدل‌ها setSignals را پس می‌زنند — نباید اتصال را بشکند */
    }
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
