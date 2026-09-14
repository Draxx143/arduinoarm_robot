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
    /* دست‌دادنِ بوت: onConnect فقط وقتی می‌آید که بنرِ بوتِ برد دیده شده
     * باشد (یا readyWaitMs گذشته باشد) — مثلِ «R:» در پلِ پایتون. */
    this._sawBanner = false;
    this.readyWaitMs = 5000;
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
    this._sawBanner = false;
    await this._assertLines(port);
    this._readLoop();
    /* پالسِ بالا برد را ری‌بوت می‌کند (بوت‌لودر ~۱ ثانیه + ‎delay(500)‎ و
     * چاپِ بنر در ‎setup()‎). اگر onConnect بی‌درنگ می‌آمد، اولین status
     * ممکن بود داخلِ پنجره‌ی بوت‌لودر بیفتد و بوت‌لودر آن را بخورد — یعنی
     * «اتصال» به شانس وابسته می‌شد. پس تا دیدنِ بنرِ واقعیِ بوت صبر می‌کنیم
     * (حداکثر readyWaitMs)؛ اگر برد ساکت ماند، با همان مهلت ادامه می‌دهیم تا
     * اتصال hang نشود. تا onConnect نیامده، GUI هیچ فرمانی نمی‌فرستد. */
    await this._waitForBanner();
    if (!this.connected) return;   /* وسطِ انتظار disconnect شد — خبرِ اتصال نه */
    if (this.onConnect) this.onConnect(this.baud);
  }

  /* انتظارِ بنرِ بوت — همان BANNER_MARKERS در bridge/serial_bridge.py
   * (رشته‌های واقعیِ بنرِ setup() در فریم‌ور، نه پروتکلِ تازه). حلقه‌ی
   * خواندن هیچ بایتی را نگه نمی‌دارد؛ فقط _sawBanner را ست می‌کند. */
  async _waitForBanner() {
    const t0 = Date.now();
    const limit = Math.max(0, Number(this.readyWaitMs) || 0);
    while (!this._sawBanner && this.connected && Date.now() - t0 < limit) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /* Web Serial خطوطِ مودم را در وضعیتِ پیش‌فرضِ درایور رها می‌کند، و دو مکانیزمِ
   * ریستِ متفاوت روی این بردها هست که یک پالس باید **هر دو** را بزند:
   *   · بردهای Rev3 (Uno/Mega) تا وقتی DTR و RTS در سطحِ **متفاوت** باشند RESET
   *     را پایین نگه می‌دارند (جفتِ ترانزیستور)، پس پایانِ پالس باید هم‌سطح باشد
   *     وگرنه AVR تا آخرِ نشست در ریست می‌ماند؛
   *   · چیپ‌های USBِ 16U2/32U4 روی Mega 2560 / Leonardo / Micro AVR را **فقط با
   *     لبه‌ی RISINGِ DTR (۰→۱)** ریست می‌کنند — فریم‌ورِ CDCشان
   *     «if (!prevDTR && curDTR) ResetTimer=…» است. پالسی که DTR را هرگز پایین
   *     نبرد لبه‌ی rising نمی‌سازد، پس برد اصلاً ری‌بوت نمی‌شود: پورت بی‌خطا باز
   *     می‌شود، هیچ بایتی نمی‌آید، و Arduino IDE (که اول DTR را می‌اندازد و بعد
   *     بالا می‌برد) سالم وصل می‌شود. همان «IDE کار می‌کند، اپ ساکت است».
   *   · بردهای USB بومی تا DTR asserted نباشد «میزبان وصل نیست» فرض می‌کنند و هر
   *     Serial.print را بی‌صدا دور می‌ریزند → RX=0.
   * پس: (۰,۰) → (۰,۱) → (۱,۱). لبه‌ی falling دارد، **دقیقاً یک** لبه‌ی risingِ
   * DTR دارد (مستقل از سطحی که کرنل موقعِ open جا گذاشته)، و با هر دو خطِ
   * asserted تمام می‌شود. شروع از (۱,۱) دو بار غلط است: لبه‌ی falling ندارد، و
   * اگر کرنل DTR را پایین جا گذاشته باشد همان قدمِ اول خودش یک rising می‌سازد و
   * ریستِ دوم وسطِ بنرِ بوت می‌افتد و متن نصفه cut می‌شود. */
  async _assertLines(port) {
    if (!port || typeof port.setSignals !== "function") return;
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const sig = (dtr, rts) => ({ dataTerminalReady: dtr, requestToSend: rts });
    try {
      await port.setSignals(sig(false, false));  /* DTR پایین → لبه‌ی falling */
      await nap(50);
      await port.setSignals(sig(false, true));   /* متفاوت → RESET پایین (Rev3) */
      await nap(120);                            /* نگه‌داشتنِ ریست (بوت‌لودر ≥ ۵۰ms) */
      await port.setSignals(sig(true, true));    /* لبه‌ی RISINGِ DTR → ریستِ 16U2/32U4 */
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
              /* دست‌دادنِ بوت (غیرفعال/منفعل): همه‌ی بایت‌ها مثلِ قبل به
               * onLine می‌رسند؛ این فقط برای _waitForBanner علامت می‌گذارد. */
              if (line.indexOf("AXIS-5 Firmware") !== -1 ||
                  line.indexOf("System initialized.") !== -1) this._sawBanner = true;
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
