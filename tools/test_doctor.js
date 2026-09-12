#!/usr/bin/env node
/* ============================================================
 * تستِ عیب‌یابِ اتصال (desktop-app/main/doctor.js)
 *
 * عیب‌یاب روی یک **بردِ جعلی** (tools/fake_board.py روی pty) آزمایش
 * می‌شود تا مطمئن باشیم همان چیزی را می‌گوید که واقعیت است:
 *   · بردِ سالم           → همه‌چیز ✓ و نسخه‌ی فریم‌ور درست تشخیص داده شود
 *   · فریم‌ورِ قدیمی       → باید بگوید «فلش کن» و نسخه را رد کند
 *   · پورتِ ناموجود       → باید بگوید دستگاه وجود ندارد + راه‌حل
 *   · اپ از قبل متصل است  → دست‌دادن باید **رد** شود (نه اینکه پورت را بدزدد)
 *   · کاربر در dialout نیست → باید راه‌حلِ usermod را بدهد
 *   · برد فقط با ۹۶۰۰ جواب می‌دهد → عیب‌یاب باید خودش baud درست را پیدا کند
 *   · بردِ کاملاً ساکت → باید بگوید فریم‌ور اجرا نمی‌شود (نه اینکه حدس بزند)
 *
 * اجرا: node tools/test_doctor.js     (نیاز: python3)
 * ============================================================ */
"use strict";

const path = require("path");
const { spawn } = require("child_process");

const { runDoctor } = require(path.join(__dirname, "..", "desktop-app", "main", "doctor.js"));
const pybridge = require(path.join(__dirname, "..", "desktop-app", "main", "pybridge.js"));

let PASS = 0, FAIL = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { PASS++; console.log("  ✔ " + msg); }
  else { FAIL++; fails.push(msg); console.log("  ✘ " + msg); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* بردِ جعلی را بالا بیاور و مسیرِ pty را بگیر */
function startFakeBoard(version, onlyBaud) {
  const args = [path.join(__dirname, "fake_board.py"), version || "1.0.41"];
  if (onlyBaud) args.push("--only-baud", String(onlyBaud));
  const child = spawn("python3", args, { stdio: ["pipe", "pipe", "pipe"] });
  let buf = "", first = null;
  const ready = new Promise((res) => {
    child.stdout.on("data", (c) => {
      buf += c.toString("utf8");
      const i = buf.indexOf("\n");
      if (i !== -1 && !first) { first = buf.slice(0, i).trim(); res(first); }
    });
    child.on("exit", () => { if (!first) res(null); });
    setTimeout(() => res(first), 6000);
  });
  return { child, ready, quit: () => { try { child.stdin.write("QUIT\n"); } catch (e) {} 
                                      setTimeout(() => { try { child.kill(); } catch (e) {} }, 200); } };
}

/* بدلِ execFile: تا تست به وضعیتِ سیستمِ میزبان وابسته نباشد */
function makeSh(opts = {}) {
  return async (cmd, args) => {
    if (cmd === "python3") return opts.noPython
      ? { err: "spawn python3 ENOENT", out: "", errOut: "" }
      : { err: "", out: "Python 3.11.2\n", errOut: "" };
    if (cmd === "id") return { err: "", out: opts.noDialout ? "user cdrom plugdev\n" : "user dialout\n", errOut: "" };
    if (cmd === "fuser") return { err: "", out: opts.holderPid ? String(opts.holderPid) + "\n" : "", errOut: "" };
    if (cmd === "sh") return { err: "", out: "[  120.4] usb 1-2: ch341-uart converter now attached to ttyUSB0\n", errOut: "" };
    return { err: "", out: "", errOut: "" };
  };
}
const find = (rep, name) => (rep.checks || []).find((c) => c.name === name) || {};

async function main() {
  console.log("=== تستِ عیب‌یابِ اتصال (doctor.js) روی بردِ جعلی ===");

  /* ---------- ۱) بردِ سالم ---------- */
  console.log("\n-- بردِ سالم روی pty (فریم‌ور v1.0.41) --");
  let fb = startFakeBoard("1.0.41");
  let slave = await fb.ready;
  ok(!!slave, "بردِ جعلی بالا آمد: " + slave);
  let rep = await runDoctor({ portPath: slave, baud: 115200, pybridge, sh: makeSh(),
                              platform: "linux", expectedFw: "1.0.41", handshakeMs: 500 });
  ok(find(rep, "device").ok === true, "device ✓ (گره‌ی pty پیدا شد)");
  ok(find(rep, "permission").ok === true, "permission ✓");
  ok(find(rep, "group").ok === true, "group ✓ (dialout)");
  ok(find(rep, "python3").ok === true, "python3 ✓");
  ok(find(rep, "rx").ok === true, "rx ✓ — " + find(rep, "rx").detail);
  ok(find(rep, "firmware").ok === true, "firmware ✓ — " + find(rep, "firmware").detail);
  ok(/System Status/.test(find(rep, "sample").detail || ""), "نمونه‌ی پاسخ شاملِ بلوکِ status است");
  fb.quit();
  await sleep(600);

  /* ---------- ۲) فریم‌ورِ قدیمی روی برد ---------- */
  console.log("\n-- همان برد ولی با فریم‌ورِ قدیمی v1.0.38 --");
  fb = startFakeBoard("1.0.38");
  slave = await fb.ready;
  rep = await runDoctor({ portPath: slave, baud: 115200, pybridge, sh: makeSh(),
                          platform: "linux", expectedFw: "1.0.41", handshakeMs: 500 });
  ok(find(rep, "rx").ok === true, "rx ✓ (برد حرف می‌زند)");
  ok(find(rep, "firmware").ok === false, "firmware ✗ — نسخه‌ی قدیمی رد شد");
  ok(/flash|1\.0\.41/i.test(find(rep, "firmware").fix || ""), "راه‌حلش فلش‌کردنِ فریم‌ور را می‌گوید: " + find(rep, "firmware").fix);
  fb.quit();
  await sleep(600);

  /* ---------- ۳) پورتِ ناموجود ---------- */
  console.log("\n-- پورتی که اصلاً وجود ندارد --");
  rep = await runDoctor({ portPath: "/dev/definitely-not-here-xyz", baud: 115200, pybridge,
                          sh: makeSh(), platform: "linux", expectedFw: "1.0.41", handshakeMs: 300 });
  ok(find(rep, "device").ok === false, "device ✗ — «does not exist»");
  ok(/replug|rescan/i.test(find(rep, "device").fix || ""), "راه‌حل: کابل را بکش و دوباره اسکن کن");
  ok(find(rep, "handshake").ok === false, "handshake ✗ — بی‌دستگاه دست‌دادن معنا ندارد");

  /* ---------- ۴) اپ از قبل متصل است ---------- */
  console.log("\n-- وقتی اپ خودش متصل است --");
  fb = startFakeBoard("1.0.41");
  slave = await fb.ready;
  rep = await runDoctor({ portPath: slave, baud: 115200, pybridge, sh: makeSh(), busy: true,
                          platform: "linux", expectedFw: "1.0.41", handshakeMs: 300 });
  ok(find(rep, "handshake").ok === null && find(rep, "handshake").skip === true,
     "handshake رد شد (پورتِ کاربر را نمی‌دزدد) — " + find(rep, "handshake").detail);
  fb.quit();
  await sleep(600);

  /* ---------- ۵) مشکل‌های رایجِ محیطی ---------- */
  console.log("\n-- محیطِ ناقص: بدونِ dialout و بدونِ python3 --");
  fb = startFakeBoard("1.0.41");
  slave = await fb.ready;
  rep = await runDoctor({ portPath: slave, baud: 115200, pybridge,
                          sh: makeSh({ noDialout: true, noPython: true }),
                          platform: "linux", expectedFw: "1.0.41", handshakeMs: 400 });
  ok(find(rep, "group").ok === false, "group ✗ — نبودِ dialout گرفته شد");
  ok(/usermod -aG dialout/.test(find(rep, "group").fix || ""), "راه‌حلِ دقیقِ گروه داده شد");
  ok(find(rep, "python3").ok === false, "python3 ✗ — نبودِ python3 گرفته شد");
  ok(/apt install python3/.test(find(rep, "python3").fix || ""), "راه‌حلِ نصبِ python3 داده شد");
  fb.quit();
  await sleep(400);

  /* ---------- ۶) پورت دستِ دیگری است ---------- */
  console.log("\n-- پورتی که فرایندِ دیگری هم نگهش داشته --");
  fb = startFakeBoard("1.0.41");
  slave = await fb.ready;
  rep = await runDoctor({ portPath: slave, baud: 115200, pybridge,
                          sh: makeSh({ holderPid: 4242 }),
                          platform: "linux", expectedFw: "1.0.41", handshakeMs: 400 });
  ok(find(rep, "free").ok === false, "free ✗ — خواننده‌ی دوم شناسایی شد");
  ok(/4242/.test(find(rep, "free").detail || "") && /Arduino IDE|Serial Monitor/i.test(find(rep, "free").fix || ""),
     "PID و راه‌حلش (بستنِ IDE/مانیتور) گفته شد");
  fb.quit();
  await sleep(300);

  /* ---------- ۷) برد فقط با ۹۶۰۰ حرف می‌زند (رایج‌ترین علتِ RX=0) ---------- */
  console.log("\n-- بردی که روی ۱۱۵۲۰۰ ساکت است و فقط با ۹۶۰۰ جواب می‌دهد --");
  fb = startFakeBoard("1.0.41", 9600);
  slave = await fb.ready;
  rep = await runDoctor({ portPath: slave, baud: 115200, pybridge, sh: makeSh(),
                          platform: "linux", expectedFw: "1.0.41", handshakeMs: 400 });
  const bd = find(rep, "bauds");
  ok(bd.ok === false && /FOUND IT/.test(bd.detail || ""),
     "bauds ✗ با پیامِ «پیدا شد» — عیب‌یاب خودش baud درست را پیدا کرد: " + (bd.detail || ""));
  ok(/9600/.test(bd.detail || ""), "در گزارش، عددِ ۹۶۰۰ آمده");
  ok(/9600/.test(bd.fix || ""), "راه‌حلش تنظیمِ baud روی ۹۶۰۰ است: " + (bd.fix || ""));
  ok(find(rep, "firmware").ok === true, "firmware ✓ — نسخه از پاسخِ همان ۹۶۰۰ خوانده شد");
  fb.quit();
  await sleep(400);

  /* ---------- ۸) بردِ کاملاً ساکت (فریم‌ور اجرا نمی‌شود) ---------- */
  console.log("\n-- بردی که در هیچ baud ای حرف نمی‌زند --");
  fb = startFakeBoard("1.0.41", 1234567);   /* baud ای که اپ هرگز امتحانش نمی‌کند */
  slave = await fb.ready;
  rep = await runDoctor({ portPath: slave, baud: 115200, pybridge, sh: makeSh(),
                          platform: "linux", expectedFw: "1.0.41", handshakeMs: 300 });
  ok(find(rep, "rx").ok === false, "rx ✗ — سکوتِ برد گزارش شد");
  ok(find(rep, "bauds").ok === false, "bauds ✗ — هیچ baud ای جواب نداد");
  ok(/heartbeat LED|reflash|data cable/i.test(find(rep, "bauds").fix || ""),
     "راه‌حلِ واقعی داده شد (LED/کابلِ دیتا/فلش): " + (find(rep, "bauds").fix || "").slice(0, 70));
  fb.quit();
  await sleep(300);
  pybridge.closeAll();

  console.log(`\n#  نتیجه: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) { console.log("#  مواردِ ناموفق:\n  - " + fails.join("\n  - ")); process.exit(1); }
  console.log("########## عیب‌یاب: علت‌های واقعیِ وصل‌نشدن را درست تشخیص می‌دهد ##########");
  process.exit(0);
}

main().catch((e) => { console.log("FATAL " + (e.stack || e.message)); pybridge.closeAll(); process.exit(1); });
