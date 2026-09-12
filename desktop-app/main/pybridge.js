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
 *   stdout:  R: آماده | D:<b64> داده | E:<b64> خطا | X: خروج
 *   stdin :  W:<b64> نوشتن | C: بستن
 * ============================================================ */
"use strict";

const { spawn } = require("child_process");
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
  const timeoutMs = Number(o.timeoutMs) || 5000;

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
    const rec = { kind: "py", child, rx: 0, tx: 0, path: portPath, baud,
                  ready: false, done: false };
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
function stats() {
  let rx = 0;
  sessions.forEach((r) => { rx += r.rx || 0; });
  return { count: sessions.size, rx, kind: sessions.size ? "py" : "?" };
}

module.exports = { openBridge, writeTo, closeSession, closeAll, has, stats,
                   bridgeScriptPath, ID_BASE };
