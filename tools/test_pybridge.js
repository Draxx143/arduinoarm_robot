#!/usr/bin/env node
/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
 * https://github.com/Draxx143/arduinoarm_robot */
/* ============================================================
 * تستِ پلِ سریال (desktop-app/main/pybridge.js + bridge/serial_bridge.py)
 *
 * باگِ گزارش‌شده: «بورد شناسایی می‌شود ولی برنامه به برد وصل نمی‌شود،
 * با اینکه پورت اشغال نیست». ریشه‌اش این بود که اگر پل پیش از فرستادنِ
 * «R:» می‌مرد (پورت نبود / مجوز نبود / پورت مشغول بود / python3 نبود /
 * پورت tty نبود) **هیچ شاخه‌ای promise را حل نمی‌کرد** → دکمه‌ی اتصال
 * برای همیشه روی «opening …» می‌ماند و هیچ خطایی هم نشان داده نمی‌شد.
 *
 * این تست همان حالت‌ها را واقعاً اجرا می‌کند:
 *   ۱) پورتِ ناموجود        → باید سریع {err} بدهد، نه hang
 *   ۲) فایلِ غیرِ tty        → termios شکست می‌خورد → {err}
 *   ۳) python3 نبود         → {err} با پیامِ روشن
 *   ۴) pty واقعی            → باز شدن، RX به renderer، TX به پورت، بستن
 *
 * اجرا: node tools/test_pybridge.js     (نیاز: python3 — همان که اپ لازم دارد)
 * ============================================================ */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const pybridge = require(path.join(__dirname, "..", "desktop-app", "main", "pybridge.js"));

let PASS = 0, FAIL = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { PASS++; console.log("  ✔ " + msg); }
  else { FAIL++; fails.push(msg); console.log("  ✘ " + msg); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- هلدرِ pty: نقشِ «برد» را بازی می‌کند ---------- */
function startHolder() {
  const child = spawn("python3", [path.join(__dirname, "pty_holder.py")],
                      { stdio: ["pipe", "pipe", "pipe"] });
  const q = [], waiters = [];
  let buf = "";
  child.stdout.on("data", (c) => {
    buf += c.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (waiters.length) waiters.shift()(line); else q.push(line);
    }
  });
  child.on("exit", () => { while (waiters.length) waiters.shift()(null); });
  const nextLine = (ms = 6000) => new Promise((resolve) => {
    if (q.length) return resolve(q.shift());
    const t = setTimeout(() => resolve(null), ms);
    waiters.push((l) => { clearTimeout(t); resolve(l); });
  });
  return {
    child, nextLine,
    send: (s) => { try { child.stdin.write(s + "\n"); } catch (e) {} },
    kill: () => { try { child.kill(); } catch (e) {} },
  };
}

async function main() {
  console.log("=== تستِ پلِ سریال: openBridge باید در هر شرایطی یک بار حل شود ===");
  ok(fs.existsSync(pybridge.bridgeScriptPath()),
     "اسکریپتِ پل پیدا شد: " + path.relative(path.join(__dirname, ".."), pybridge.bridgeScriptPath()));

  /* ---- ۱) پورتِ ناموجود: همان حالتی که کاربر دید ---- */
  let t0 = Date.now();
  const r1 = await pybridge.openBridge({
    portPath: "/dev/definitely-not-a-port-xyz", baud: 115200, send: () => {}, timeoutMs: 4000 });
  const dt1 = Date.now() - t0;
  ok(!!r1.err && !r1.id, "پورتِ ناموجود → {err} برمی‌گردد (قبلاً: hangِ ابدی)");
  ok(/port not found/i.test(r1.err || ""), "علت در پیام هست: «" + r1.err + "»");
  ok(dt1 < 3500, `سریع شکست خورد (${dt1}ms) — معطلِ مهلتِ ۵ ثانیه نماند`);
  ok(pybridge.stats().count === 0, "نشستِ مرده در رجیستری نمانده (پورت دوباره آزاد است)");

  /* ---- ۲) مسیرِ موجود ولی tty نیست → termios شکست می‌خورد ---- */
  const tmp = path.join(os.tmpdir(), "axis5-not-a-tty.txt");
  fs.writeFileSync(tmp, "x");
  const r2 = await pybridge.openBridge({ portPath: tmp, baud: 115200, send: () => {}, timeoutMs: 4000 });
  ok(!!r2.err && !r2.id, "فایلِ غیرِ tty → {err} (termios failed)");
  try { fs.unlinkSync(tmp); } catch (e) {}

  /* ---- ۳) python3 نصب نباشد ---- */
  const r3 = await pybridge.openBridge({
    portPath: "/dev/null", baud: 115200, python: "python3-does-not-exist",
    send: () => {}, timeoutMs: 4000 });
  ok(!!r3.err && /python/i.test(r3.err), "نبودِ python3 → پیامِ روشن: «" + String(r3.err).slice(0, 70) + "…»");

  /* ---- ۴) pty واقعی: باز شدن + RX + TX + بستن ---- */
  const holder = startHolder();
  let slave = null;
  try {
    slave = await holder.nextLine(6000);
    ok(!!slave && slave.startsWith("/dev/"), "pty ساخته شد: " + slave);
    if (!slave) throw new Error("no pty");

    const events = [];
    const res = await pybridge.openBridge({
      portPath: slave, baud: 115200, timeoutMs: 8000,
      send: (ch, payload) => events.push([ch, payload]),
    });
    ok(!!res.id && !res.err, "پل روی tty واقعی باز شد (id=" + res.id + ")" + (res.err ? " → " + res.err : ""));
    ok(pybridge.has(res.id), "نشست در رجیستری است");

    /* RX: «برد» یک خط می‌فرستد → باید به renderer برود */
    holder.send("SEND:>> POS 1.0,2.0,3.0,4.0,5.0");
    await sleep(900);
    const rx = events.filter((e) => e[0] === "serialport:data")
      .map((e) => Buffer.from(e[1], "base64").toString("utf8")).join("");
    ok(/>> POS 1\.0,2\.0,3\.0,4\.0,5\.0/.test(rx),
       "RX از پل به renderer می‌رسد: " + JSON.stringify(rx.slice(0, 46)));
    ok(pybridge.stats().rx > 0, "شمارنده‌ی بایتِ RX کار می‌کند (" + pybridge.stats().rx + " B)");

    /* TX: نوشتنِ renderer باید به پورت برسد */
    const w = pybridge.writeTo(res.id, "status\n");
    ok(!w.err, "writeTo خطا نداد" + (w.err ? ": " + w.err : ""));
    let got = "";
    const t1 = Date.now();
    while (Date.now() - t1 < 5000) {
      const l = await holder.nextLine(1500);
      if (l === null) break;
      if (l.startsWith("GOT:")) { got += l.slice(4).replace(/\\n/g, "\n"); if (/status/.test(got)) break; }
    }
    ok(/status/.test(got), "TX پل واقعاً به پورت رسید: " + JSON.stringify(got.slice(0, 30)));

    /* بستن */
    pybridge.closeSession(res.id);
    await sleep(1000);
    ok(!pybridge.has(res.id), "بعد از closeSession نشست پاک شد (پورت آزاد)");
    ok(pybridge.writeTo(res.id, "x").err === "port not open", "نوشتن روی نشستِ بسته → «port not open»");
  } catch (e) {
    ok(false, "خطای اجرای تستِ pty: " + e.message);
  } finally {
    holder.send("QUIT");
    await sleep(200);
    holder.kill();
    pybridge.closeAll();
  }

  console.log(`\n#  نتیجه: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) { console.log("#  مواردِ ناموفق:\n  - " + fails.join("\n  - ")); process.exit(1); }
  console.log("########## پلِ سریال: هیچ حالتی hang نمی‌کند و RX/TX روی tty واقعی کار می‌کند ##########");
  process.exit(0);
}

main().catch((e) => { console.log("FATAL " + (e.stack || e.message)); process.exit(1); });
