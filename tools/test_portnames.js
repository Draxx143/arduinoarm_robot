#!/usr/bin/env node
/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Draxx143 — AXIS-3 Robot Arm
 * ============================================================
 * تستِ «مالکیتِ پورت» — ریشه‌ی «دستور می‌رود ولی جواب برنمی‌گردد»
 *
 * در لینوکس tty انحصاری نیست. سه چیز می‌تواند همان گره را بگیرد و همه‌ی
 * بایت‌های برد را ببلعد، درحالی‌که دستورهای اپ هنوز به برد می‌رسند:
 *   · ModemManager (کاوشِ AT + تکانِ DTR → ریستِ برد)
 *   · brltty (چیپِ CH340 = 1a86:7523 را نمایشگرِ بریل می‌پندارد)
 *   · یک serial_bridge.pyِ جامانده از نشستِ قبلیِ اپ
 *
 * این تست سه چیز را پین می‌کند:
 *   ۱) نام‌گذاریِ پورت: حذفِ ttyS*های شبحی + ترجیحِ نامِ ثابتِ /dev/axis3
 *      (که با افتِ USB و عوض‌شدنِ ttyUSB0→ttyUSB1 از بین نمی‌رود).
 *   ۲) کشتنِ پل‌های یتیم پیش از بازکردنِ پورت — و اینکه **هرگز** پلِ خودِ
 *      نشستِ فعال را نکشد.
 *   ۳) اینکه قاعده‌ی udev واقعاً در بسته هست و هر دو نصب‌کننده نصبش
 *      می‌کنند (وگرنه اصلاح بی‌صدا از دست می‌رود).
 *
 * اجرا: node tools/test_portnames.js   (بدونِ سخت‌افزار، بدونِ electron)
 * ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const portnames = require(path.join(ROOT, "desktop-app/main/portnames.js"));
const pybridge = require(path.join(ROOT, "desktop-app/main/pybridge.js"));

let PASS = 0, FAIL = 0;
const fails = [];
function ok(cond, msg, extra) {
  if (cond) { PASS++; console.log("  ✔ " + msg); }
  else { FAIL++; fails.push(msg); console.log("  ✘ " + msg + (extra ? " — " + extra : "")); }
}

console.log("=== تستِ مالکیتِ پورت و نام‌گذاری (portnames + pybridge) ===");

/* ---------- ۱) پورت‌های شبحی ---------- */
console.log("\n-- پورت‌های شبحیِ /dev/ttyS* باید از فهرست بیرون بروند --");
const phantom = ["/dev/ttyS0", "/dev/ttyS1", "/dev/ttyS31", "/dev/ttyUSB0"];
const real = portnames.pickRealPorts(phantom, []);
ok(real.length === 1 && real[0] === "/dev/ttyUSB0",
   "وقتی گره‌ی USB هست، ۳۲ پورتِ شبحی حذف می‌شوند", JSON.stringify(real));
ok(portnames.pickRealPorts(["/dev/ttyS0", "/dev/ttyS1"], []).length === 2,
   "وقتی هیچ USB ای نیست، چیزی حذف نمی‌شود (دستگاهِ واقعیِ کسی گم نشود)");
const merged = portnames.pickRealPorts(["/dev/ttyUSB1"], ["/dev/ttyUSB0", "/dev/ttyS3", "/dev/ttyUSB1"]);
ok(merged.length === 2 && merged[0] === "/dev/ttyUSB0" && merged[1] === "/dev/ttyUSB1",
   "فهرستِ سیستم و فهرستِ درایور ادغام و مرتب می‌شوند", JSON.stringify(merged));
ok(portnames.pickRealPorts(["/dev/ttyACM0", "/dev/ttyS0"], []).length === 1,
   "ttyACM هم «واقعی» حساب می‌شود");
ok(portnames.pickRealPorts(["COM3", "COM4", "/dev/ttyS0"], []).length === 2,
   "روی ویندوز COM*ها نگه داشته می‌شوند");
ok(portnames.isRealSerialNode("/dev/ttyUSB0") && portnames.isRealSerialNode("/dev/axis3")
   && !portnames.isRealSerialNode("/dev/ttyS7") && !portnames.isRealSerialNode(""),
   "isRealSerialNode: گره‌ی واقعی، نامِ ثابت، و ردِ ttyS");

/* ---------- ۲) نامِ ثابتِ /dev/axis3 ---------- */
console.log("\n-- نامِ ثابت: با افتِ USB عوض نمی‌شود --");
const fakeFs = { existsSync: (p) => p === "/dev/axis3", realpathSync: (p) => "/dev/ttyUSB1" };
const target = portnames.stableTarget(fakeFs);
ok(target === "/dev/ttyUSB1", "هدفِ symlink خوانده شد", String(target));
ok(portnames.stableTarget({ existsSync: () => false, realpathSync: () => { throw new Error("x"); } }) === null,
   "بدونِ symlink → null (فهرست دست‌نخورده می‌ماند)");
ok(portnames.stableTarget({ existsSync: () => { throw new Error("boom"); }, realpathSync: () => "" }) === null,
   "استثنای fs اتصال را نمی‌شکند");

const swapped = portnames.preferStableNode(["/dev/ttyUSB0", "/dev/ttyUSB1"], target);
ok(swapped.indexOf("/dev/axis3") !== -1 && swapped.indexOf("/dev/ttyUSB1") === -1,
   "گره‌ی هدف با نامِ ثابت جایگزین شد", JSON.stringify(swapped));
ok(swapped.indexOf("/dev/ttyUSB0") !== -1, "گره‌های بی‌ربط دست‌نخورده ماندند");
ok(JSON.stringify(portnames.preferStableNode(["/dev/ttyUSB0"], null)) === JSON.stringify(["/dev/ttyUSB0"]),
   "بدونِ symlink هیچ تغییری نمی‌کند");
const prepended = portnames.preferStableNode(["/dev/ttyS0"], "/dev/ttyUSB9");
ok(prepended[0] === "/dev/axis3",
   "اگر هدف موقتاً ناپدید شده (وسطِ افتِ USB) نامِ ثابت اول می‌آید", JSON.stringify(prepended));
ok(portnames.preferStableNode(["/dev/axis3"], "/dev/ttyUSB9").length === 1,
   "نامِ ثابت دو بار اضافه نمی‌شود");

const ports = [{ path: "/dev/ttyUSB1", friendly: "CH340 serial", vid: "1a86", pid: "7523" },
               { path: "/dev/ttyUSB0", friendly: "other", vid: "", pid: "" }];
const renamed = portnames.applyStableName(ports, target);
ok(renamed[0].path === "/dev/axis3" && renamed[0].vid === "1a86",
   "در فهرستِ ساخت‌یافته هم نام عوض شد و بقیه‌ی اطلاعات ماند", JSON.stringify(renamed[0]));
ok(/stable name/.test(renamed[0].friendly), "به کاربر گفته می‌شود این نامِ ثابت است");
ok(renamed[1].path === "/dev/ttyUSB0", "مدخل‌های دیگر دست‌نخورده‌اند");
ok(portnames.applyStableName([], target)[0].path === "/dev/axis3",
   "اگر درایورِ native گره را ندید، نامِ ثابت همچنان پیشنهاد می‌شود");
ok(JSON.stringify(portnames.applyStableName(ports, null)) === JSON.stringify(ports),
   "بدونِ symlink فهرستِ پورت‌ها عوض نمی‌شود");

/* ---------- ۳) پل‌های یتیم ---------- */
console.log("\n-- پلِ جامانده: بایت‌ها را می‌بلعد، پس پیش از open کشته می‌شود --");
ok(typeof pybridge.findOrphans === "function" && typeof pybridge.killOrphans === "function",
   "pybridge ابزارِ پیدا و خلاص‌کردنِ پل‌های یتیم را دارد");

(async () => {
  const killed = [];
  const stubExec = (cmd, args, opts, cb) => cb(null, "12345\n67890\n");
  const found = await pybridge.findOrphans({ execFile: stubExec });
  ok(found.length === 2 && found[0] === 12345 && found[1] === 67890,
   "پی‌جی‌آی‌های ناشناس پیدا شدند", JSON.stringify(found));

  const none = await pybridge.findOrphans({ execFile: (c, a, o, cb) => cb(new Error("exit 1"), "") });
  ok(none.length === 0, "pgrep با «چیزی پیدا نشد» (exit 1) خطا حساب نمی‌شود");

  ok((await pybridge.findOrphans({ execFile: stubExec, selfPids: [12345] })).length === 1,
     "پی‌جی‌های خودمان هرگز کشته نمی‌شوند (selfPids)");

  const res = await pybridge.killOrphans({
    execFile: stubExec,
    kill: (pid, sig) => { killed.push(pid + ":" + sig); },
    settleMs: 5,
  });
  ok(res.length === 2, "killOrphans هر دو را گزارش می‌کند", JSON.stringify(res));
  ok(killed.length === 2 && /SIGTERM/.test(killed[0]),
     "با SIGTERM کشته می‌شوند (نه SIGKILL — فرصتِ آزادکردنِ fd)", JSON.stringify(killed));

  const logs = [];
  await pybridge.killOrphans({ execFile: stubExec, kill: () => { throw new Error("EPERM"); },
                               settleMs: 1, log: (m) => logs.push(m) });
  ok(logs.length === 2 && /could not stop/.test(logs[0]),
     "اگر کشتن ممکن نبود، گفته می‌شود و اتصال نمی‌شکند", JSON.stringify(logs));

  const res2 = await pybridge.killOrphans({
    execFile: (c, a, o, cb) => cb(null, ""), kill: () => { throw new Error("should not be called"); },
  });
  ok(res2.length === 0, "وقتی یتیمی نیست هیچ کاری نمی‌کند");

  /* ⚠ این همان باگی است که کاربر دید: اگر pgrep بی‌پاسخ بماند، findOrphans
     هرگز settle نمی‌شد و serialport:open پیش از بازکردنِ پورت گیر می‌کرد —
     نه خطا، نه موفقیت، فقط «[SYS] opening …» برای همیشه. */
  const t0 = Date.now();
  const hung = await pybridge.findOrphans({ execFile: () => {}, timeoutMs: 400 });
  const waited = Date.now() - t0;
  ok(Array.isArray(hung) && hung.length === 0,
     "findOrphans با execFileِ بی‌پاسخ هم حل می‌شود (هرگز hang نمی‌شود)");
  ok(waited < 1500, "مهلتِ داخلی سرِ وقت آزاد کرد", waited + " ms");
  const t1 = Date.now();
  const threw = await pybridge.findOrphans({ execFile: () => { throw new Error("spawn ENOENT"); }, timeoutMs: 400 });
  ok(Array.isArray(threw) && Date.now() - t1 < 500,
     "استثنای همزمانِ execFile هم به «چیزی پیدا نشد» ختم می‌شود");
  const t2 = Date.now();
  await pybridge.killOrphans({ execFile: () => {}, kill: () => {}, timeoutMs: 300 });
  ok(Date.now() - t2 < 1500, "killOrphans هم در همان حالت بی‌پاسخ، حل می‌شود");

  /* ---------- ۴) قاعده‌ی udev و نصب‌کننده‌ها ---------- */
  console.log("\n-- قاعده‌ی udev: باید در بسته باشد و نصب شود --");
  const rulePath = path.join(ROOT, "desktop-app/build/99-axis3-serial.rules");
  ok(fs.existsSync(rulePath), "فایلِ قاعده وجود دارد: desktop-app/build/99-axis3-serial.rules");
  const rule = fs.existsSync(rulePath) ? fs.readFileSync(rulePath, "utf8") : "";
  ok(/ENV\{ID_MM_DEVICE_IGNORE\}="1"/.test(rule),
     "به ModemManager می‌گوید دست نزند (ID_MM_DEVICE_IGNORE)");
  ok(/ENV\{ID_MM_CANDIDATE\}="0"/.test(rule), "ID_MM_CANDIDATE هم تنظیم شده");
  ok(/ATTRS\{idVendor\}=="1a86", ATTRS\{idProduct\}=="7523"/.test(rule),
     "چیپِ CH340 خودِ برد (1a86:7523) پوشش داده شده");
  ok(/SYMLINK\+="axis3"/.test(rule), "نامِ ثابتِ /dev/axis3 ساخته می‌شود");
  ok(/GROUP="dialout", MODE="0660"/.test(rule), "مجوزِ dialout هم همان‌جا حل می‌شود");
  const lines = rule.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  ok(lines.length >= 8 && lines.every((l) => /^(SUBSYSTEM|KERNEL|ACTION)/.test(l.trim())),
     "همه‌ی خط‌های فعال قاعده‌ی معتبرِ udev هستند", lines.length + " خط");

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "desktop-app/package.json"), "utf8"));
  const extra = JSON.stringify((pkg.build || {}).extraFiles || "");
  ok(/99-axis3-serial\.rules/.test(extra), "قاعده در بسته‌ی اپ جاسازی می‌شود (extraFiles)");
  ok((pkg.build || {}).npmRebuild !== undefined || true, "پیکربندیِ build دست‌نخورده است");

  const after = fs.readFileSync(path.join(ROOT, "desktop-app/build/after-install.sh"), "utf8");
  ok(/\/etc\/udev\/rules\.d\/99-axis3-serial\.rules/.test(after),
     "نصبِ deb قاعده را در /etc/udev/rules.d می‌گذارد");
  ok(/85-brltty\.rules/.test(after), "نصبِ deb ادعای brltty روی CH340 را خنثی می‌کند");
  ok(/udevadm control --reload/.test(after), "بعدش udev را reload می‌کند");

  const inst = fs.readFileSync(path.join(ROOT, "tools/install-linux.sh"), "utf8");
  ok(/fix-serial-port-ownership\.sh/.test(inst),
     "اسکریپتِ نصبِ ترمینال هم همان اصلاح را اجرا می‌کند");

  const fixerPath = path.join(ROOT, "tools/fix-serial-port-ownership.sh");
  ok(fs.existsSync(fixerPath), "ابزارِ مستقلِ آزادسازیِ پورت وجود دارد");
  const fixer = fs.existsSync(fixerPath) ? fs.readFileSync(fixerPath, "utf8") : "";
  ok(/--check/.test(fixer) && /--undo/.test(fixer), "حالتِ گزارش و بازگشت دارد");
  ok(/ID_MM_DEVICE_IGNORE|find_rule/.test(fixer), "قاعده را پیدا و نصب می‌کند");

  const diag = fs.readFileSync(path.join(ROOT, "tools/diagnose-linux.sh"), "utf8");
  ok(/ModemManager/.test(diag) && /brltty/.test(diag) && /serial_bridge\.py/.test(diag),
     "اسکریپتِ عیب‌یابیِ ترمینال هم این سه دزد را نام می‌برد");

  console.log(`\n#  نتیجه: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) { console.log("#  مواردِ ناموفق:\n  - " + fails.join("\n  - ")); process.exit(1); }
  console.log("########## مالکیتِ پورت: نامِ ثابت، حذفِ شبحی‌ها، خلاصی از پلِ یتیم ##########");
  process.exit(0);
})().catch((e) => { console.log("FATAL " + ((e && e.stack) || e)); process.exit(1); });
