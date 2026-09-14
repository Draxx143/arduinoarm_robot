/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
 * https://github.com/Draxx143/arduinoarm_robot */
/* ============================================================
 * pybridge.js — نشستِ پلِ سریالِ پایتون (Linux/macOS)
 *
 * چرا جدا از main.js؟ چون این ماژول به electron وابسته نیست و
 * برای همین می‌شود با Node خالی تستش کرد (tools/test_pybridge.js
 * روی یک pty واقعی باز/خوان/نوشته/بسته را امتحان می‌کند).
 *
 * ⚠ قانون اصلی: promise‌ی openBridge باید **دقیقاً یک بار** و در
 * هر شرایطی حل شود. قبلاً اگر پل پیش از فرستادن «R:» می‌مرد
 * (پورت وجود نداشت، مجوز نبود، پورت دستِ برنامه‌ی دیگری بود،
 * python3 نصب نبود) هیچ شاخه‌ای resolve نمی‌کرد و دکمه‌ی «اتصال»
 * برای همیشه روی «opening …» می‌ماند — بدون هیچ پیامِ خطایی.
 * این دقیقاً همان «بورد شناسایی می‌شود ولی وصل نمی‌شود» است.
 *
 * پروتکلِ پل (bridge/serial_bridge.py):
 *   stdout:  R: آماده | D:<b64> داده | N:<b64> اطلاع‌رسانی | E:<b64> خطا | X: خروج
 *   stdin :  W:<b64> نوشتن | C: بستن
 *
 * «R:» یعنی «بنرِ بوتِ برد دیده شد (یا مهلتِ ۵ ثانیه گذشت)» — نه «پورت باز
 * شد». پس promise‌ی openBridge عملاً کلِ زنجیره‌ی زیر را پوشش می‌دهد، نه فقط
 * بالا آمدنِ پروسس:
 *   spawn bridge → open serial → reset → boot banner (≤ ‎5 s) → R:
 * ============================================================ */
"use strict";

const { spawn, execFile } = require("child_process");
const path = require("path");

/* شناسه‌های این ماژول از یک میلیون شروع می‌شوند تا با شناسه‌های
 * درایورِ serialport در main.js (که از ۱ شروع می‌شود) قاطی نشوند. */
const ID_BASE = 1000000;
let seq = ID_BASE;
const sessions = new Map();

/* مسیرِ اسکریپتِ پل — در بسته‌ی نصبی از asar بیرون آورده می‌شود
 * (asarUnpack: bridge/**) چون python3 نمی‌تواند از داخل asar اجرا شود. */
function bridgeScriptPath() {
  const p = path.join(__dirname, "..", "bridge", "serial_bridge.py");
  return p.includes("app.asar") ? p.replace("app.asar", "app.asar.unpacked") : p;
}

/**
 * باز کردنِ پورت با پلِ پایتون.
 * @param {object} o
 * @param {string} o.portPath   مثلاً /dev/ttyUSB0
 * @param {number} o.baud
 * @param {(channel:string,payload:any)=>void} o.send  خروجی به renderer
 * @param {string} [o.python]   دستورِ پایتون (پیش‌فرض python3)
 * @param {number} [o.timeoutMs]
 * @returns {Promise<{id:number}|{err:string}>}  همیشه حل می‌شود
 */
function openBridge(o) {
  const portPath = String(o.portPath);
  const baud = Number(o.baud) || 115200;
  const send = typeof o.send === "function" ? o.send : () => {};
  const python = o.python || "python3";
  /* مهلتِ کلِ اتصال: بالا آمدنِ python + بازکردنِ پورت + پالسِ ریست +
   * انتظارِ بنرِ بوت (تا ۵ ثانیه) + حاشیه برای سیستم‌های کند. باید
   * **بزرگ‌تر** از مهلتِ بنرِ پل باشد، وگرنه اتصالِ سالم timeout می‌خورد؛ و
   * **کوچک‌تر** از سقفِ ۲۰ ثانیه‌ی main.js (که خودش زیرِ سقفِ ۲۵ ثانیه‌ی
   * رندرر است):  5s بنر < 9s پل < 20s پروسه‌ی اصلی < 25s رندرر. */
  const timeoutMs = Number(o.timeoutMs) || 9000;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };

    let child;
    try {
      child = spawn(python, [bridgeScriptPath(), portPath, String(baud)],
                    { stdio: ["pipe", "pipe", "pipe"] });
    } catch (er) {
      return finish({ err: "bridge spawn failed: " + (er && er.message) });
    }

    const id = ++seq;
    const rec = { kind: "py", child, pid: child.pid || 0, rx: 0, tx: 0,
                  path: portPath, baud, ready: false, done: false };
    sessions.set(id, rec);

    /* هر شکستی پیش از آماده‌شدن = خطا به کاربر (نه سکوت، نه hang) */
    const fail = (msg) => {
      if (rec.done && settled) return;
      rec.done = true;
      sessions.delete(id);
      try { child.kill(); } catch (e) {}
      finish({ err: String(msg || "bridge failed") });
    };

    /* spawn ناموفق (مثلاً python3 نصب نیست) */
    child.on("error", (er) => {
      if (!rec.ready) fail(`cannot run ${python}: ${er && er.message} — on Linux/macOS the app needs python3 (sudo apt install python3)`);
    });

    let buf = "";
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;

        if (line.startsWith("R:")) {
          rec.ready = true;
          finish({ id });                       /* ← تنها مسیرِ موفق */
        } else if (line.startsWith("D:")) {
          try { rec.rx += Buffer.from(line.slice(2), "base64").length; } catch (e) {}
          send("serialport:data", line.slice(2));
        } else if (line.startsWith("N:")) {
          /* اطلاع‌رسانیِ پل («پورت باز شد»، «منتظر بنرِ بوت…»، «بنر دیده
           * شد») — در هر زمانی (حتی پیش از R:) فقط به کنسول می‌رود و هرگز
           * باعثِ شکستِ open نمی‌شود. */
          let note = line.slice(2);
          try { note = Buffer.from(note, "base64").toString("utf8"); } catch (e) {}
          send("serialport:notice", note);
        } else if (line.startsWith("E:")) {
          let msg = line.slice(2);
          try { msg = Buffer.from(msg, "base64").toString("utf8"); } catch (e) {}
          /* پیش از ready: همین علتِ وصل‌نشدن است → به کاربر بگو */
          if (!rec.ready) fail(msg);
          else send("serialport:error", msg);
        } else if (line.startsWith("X:")) {
          if (!rec.ready) fail("bridge exited before the port opened (" + portPath + ")");
          else { rec.done = true; sessions.delete(id); send("serialport:closed", id); }
        }
      }
    });

    /* stderr فقط تا پیش از ready معنی دارد (بعد از آن، هشدارِ بی‌ضرر است) */
    child.stderr.on("data", (c) => {
      const m = String(c || "").trim();
      if (!rec.ready) fail(m ? "bridge: " + m.slice(0, 200) : "bridge failed before ready");
    });

    child.on("exit", (code, sig) => {
      if (!rec.ready) {
        fail(`bridge exited (code ${code}${sig ? " " + sig : ""}) before the port opened: ${portPath}`);
      } else if (!rec.done) {
        rec.done = true;
        sessions.delete(id);
        send("serialport:closed", id);
      }
    });

    /* مهلت: حتی اگر شاخه‌های بالا rec.done را ست کرده باشند، promise
     * نباید بی‌پاسخ بماند. */
    setTimeout(() => {
      if (!rec.ready) fail(`bridge timeout after ${timeoutMs} ms — is ${python} installed and is ${portPath} free?`);
    }, timeoutMs);
  });
}

/* نوشتن روی پورتِ باز */
function writeTo(id, text) {
  const rec = sessions.get(Number(id));
  if (!rec || rec.done) return { err: "port not open" };
  try {
    const payload = Buffer.from(String(text), "utf8").toString("base64");
    rec.child.stdin.write("W:" + payload + "\n");
    rec.tx += Buffer.byteLength(String(text), "utf8");
    return {};
  } catch (er) { return { err: String((er && er.message) || er) }; }
}

/* بستنِ مؤدبانه (C:) و در صورتِ نیاز کشتنِ فرایند */
function closeSession(id) {
  const rec = sessions.get(Number(id));
  if (!rec) return;
  try { rec.child.stdin.write("C:\n"); } catch (e) {}
  const n = Number(id);
  setTimeout(() => {
    const r = sessions.get(n);
    if (!r) return;
    r.done = true;
    try { r.child.kill(); } catch (e) {}
    sessions.delete(n);
  }, 500);
}

/* بستنِ همه — موقعِ خروجِ برنامه */
function closeAll() {
  for (const id of [...sessions.keys()]) {
    const rec = sessions.get(id);
    if (!rec) continue;
    rec.done = true;
    try { rec.child.kill(); } catch (e) {}
    sessions.delete(id);
  }
}

function has(id) { return sessions.has(Number(id)); }

/* شناسه‌ی فرایندِ پلِ پایتونِ خودمان. بدونِ این، fuser خودِ اپ را به‌عنوانِ
 * «خواننده‌ی دومِ پورت» گزارش می‌کرد و کاربر را به بستنِ برنامه‌ای که باز
 * نیست می‌فرستاد — یک تشخیصِ کاذبِ تمام‌عیار. */
function pids() {
  const out = [];
  sessions.forEach((r) => { if (r.pid) out.push(r.pid); });
  return out;
}
function stats() {
  let rx = 0;
  sessions.forEach((r) => { rx += r.rx || 0; });
  return { count: sessions.size, rx, kind: sessions.size ? "py" : "?" };
}

/* ---- پل‌های یتیم: ریشه‌ی «دستور می‌رود ولی جواب برنمی‌گردد» -----------
   در لینوکس tty **انحصاری نیست**: هر فرایندی می‌تواند همان /dev/ttyUSB0 را
   باز نگه دارد و بایت‌ها را بخواند. اگر نسخه‌ی قبلیِ اپ کرش کرده باشد یا
   کاربر آن را بسته باشد ولی فرایندِ serial_bridge.py زنده مانده باشد، آن
   فرایند **همه‌ی** بایت‌های برد را می‌بلعد: دستورهای اپ به برد می‌رسند
   (موتور تکان می‌خورد/سفت می‌شود) ولی هیچ پاسخی به اپ برنمی‌گردد و اپ
   «وصل‌نشده» به نظر می‌رسد.
   پس پیش از هر open، پل‌هایی که فرزندِ ما نیستند را پیدا و خلاص می‌کنیم.
   این کار فقط فرایندهای خودِ این پروژه را می‌کشد، نه برنامه‌ی کسی دیگر. */
function findOrphans(o) {
  const opt = o || {};
  const run = opt.execFile || execFile;
  const mine = new Set([...pids(), process.pid, ...(opt.selfPids || [])]);
  /* ⚠ این تابع **هرگز** نباید hang شود: در main.js پیش‌درآمدِ بازکردنِ پورت
   * است و اگر settles نکند، serialport:open نه خطا می‌دهد نه موفقیت — کاربر
   * فقط «[SYS] opening …» را می‌بیند و بعد هیچ. پس یک مهلتِ داخلیِ مستقل از
   * timeoutِ خودِ execFile دارد و هر استثنا هم به «چیزی پیدا نشد» ختم می‌شود. */
  const capMs = Number(opt.timeoutMs) || 2500;
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; clearTimeout(cap); resolve(v); } };
    const cap = setTimeout(() => fin([]), capMs);
    if (process.platform === "win32") return fin([]);
    try {
      run("pgrep", ["-f", "serial_bridge.py"], { timeout: Math.max(500, capMs - 500) }, (err, stdout) => {
        /* pgrep با خروجیِ ۱ برمی‌گردد وقتی هیچ‌چیز پیدا نکند — خطا نیست */
        const found = String(stdout || "").split(/\s+/).map((x) => parseInt(x, 10))
          .filter((pid) => pid && !mine.has(pid));
        fin([...new Set(found)]);
      });
    } catch (e) { fin([]); }
  });
}

function killOrphans(o) {
  const opt = o || {};
  const killer = opt.kill || ((pid, sig) => process.kill(pid, sig));
  const log = typeof opt.log === "function" ? opt.log : () => {};
  return findOrphans(opt).then(async (found) => {
    /* هیچ‌کدام از این قدم‌ها نباید promise را بی‌پاسخ بگذارند */
    const killed = [];
    for (const pid of found) {
      try { killer(pid, "SIGTERM"); killed.push(pid); }
      catch (e) { log(`could not stop leftover bridge pid ${pid}: ${e.message}`); }
    }
    if (killed.length) {
      /* کمی صبر کن تا fd واقعاً رها شود، وگرنه openِ بعدی هم همان پورت را
         شلوغ می‌بیند */
      await new Promise((r) => setTimeout(r, opt.settleMs || 250));
      log(`stopped ${killed.length} leftover serial bridge process(es): ${killed.join(", ")}`);
    }
    return killed;
  });
}

module.exports = { openBridge, writeTo, closeSession, closeAll, has, stats, pids,
                   findOrphans, killOrphans, bridgeScriptPath, ID_BASE };
