#!/usr/bin/env node
/* ============================================================
 * تستِ «برد را پیدا کن» (desktop-app/main/scan.js)
 *
 * چرا لازم است: لاگِ واقعیِ کاربر همه‌چیز را سبز نشان می‌داد (python3،
 * dialout، گره‌ی دستگاه، مجوز، نبودِ خواننده‌ی دوم) ولی در **هیچ** سرعتی
 * یک بایت هم نمی‌آمد. در آن حالت تنها کارِ درست این است که هر گره‌ی واقعی
 * را در هر سرعتِ محتمل امتحان کنیم — برد ممکن است روی ttyUSB1 باشد نه
 * ttyUSB0، یا پشتِ یک مبدلِ دیگر.
 *
 * دو بخش:
 *  ۱) pickRealPorts — کاربرِ ما «۳۳ دستگاه» می‌دید چون node-serialport همه‌ی
 *     /dev/ttyS0..ttyS31 شبحی را هم فهرست می‌کند. باید فقط همان‌ها حذف
 *     شوند و هر دستگاهِ واقعیِ دیگری (cu.usbserial، ttyAMA0، rfcomm، COM)
 *     سرِ جایش بماند.
 *  ۲) findBoard — روی بردِ جعلی (tools/fake_board.py روی pty): بردِ سالم
 *     باید با گره و سرعتِ درست پیدا شود، بردِ آشغال‌ده نباید «پیدا شد»
 *     حساب شود، بردِ ساکت باید بدونِ یافتن برگردد، و لغو باید زودهنگام
 *     متوقفش کند.
 *
 * اجرا: node tools/test_scan.js     (نیاز: python3)
 * ============================================================ */
"use strict";

const path = require("path");
const { spawn } = require("child_process");

const { findBoard, pickRealPorts } = require(path.join(__dirname, "..", "desktop-app", "main", "scan.js"));
const pybridge = require(path.join(__dirname, "..", "desktop-app", "main", "pybridge.js"));

let PASS = 0, FAIL = 0;
const fails = [];
function ok(cond, msg, extra) {
  if (cond) { PASS++; console.log("  ✔ " + msg); }
  else { FAIL++; fails.push(msg); console.log("  ✘ " + msg + (extra ? " — " + extra : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startFakeBoard(version, opts = {}) {
  const args = [path.join(__dirname, "fake_board.py"), version || "1.0.41"];
  if (opts.onlyBaud) args.push("--only-baud", String(opts.onlyBaud));
  if (opts.garbage) args.push("--garbage");
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
  return { child, ready,
           quit: () => { try { child.stdin.write("QUIT\n"); } catch (e) {}
                         setTimeout(() => { try { child.kill(); } catch (e) {} }, 200); } };
}

const TTY_S = Array.from({ length: 32 }, (_, i) => "/dev/ttyS" + i);

async function main() {
  console.log("=== تستِ «برد را پیدا کن» (scan.js) ===");

  /* ---------- ۱) فهرستِ پورت‌ها: شبحی‌ها بیرون، واقعی‌ها داخل ---------- */
  console.log("\n-- pickRealPorts: ۳۳ «دستگاه» که فقط یکی واقعی است --");
  let list = pickRealPorts(["/dev/ttyUSB0"], TTY_S);
  ok(list.length === 1 && list[0] === "/dev/ttyUSB0",
     "وقتی گره‌ی USB هست، ۳۲ پورتِ شبحیِ ttyS حذف می‌شوند", JSON.stringify(list.slice(0, 4)));
  list = pickRealPorts([], TTY_S.slice(0, 3));
  ok(list.length === 3, "ولی اگر هیچ USB ای نباشد، ttyS نگه داشته می‌شود (UARTِ هدرِ رزبری‌پای)",
     JSON.stringify(list));
  list = pickRealPorts(["/dev/ttyACM0", "/dev/cu.usbserial-1420", "/dev/ttyAMA0"], TTY_S);
  ok(list.indexOf("/dev/cu.usbserial-1420") !== -1 && list.indexOf("/dev/ttyAMA0") !== -1,
     "دستگاه‌های واقعیِ غیرِ ttyUSB سرِ جایشان می‌مانند (macOS/رزبری‌پای)", JSON.stringify(list));
  list = pickRealPorts(["COM4"], ["COM1", "COM4", "COM3"]);
  ok(list.length === 3 && list.indexOf("COM4") !== -1, "پورت‌های ویندوز دست‌نخورده و بی‌تکرار",
     JSON.stringify(list));
  list = pickRealPorts(["/dev/ttyUSB1", "/dev/ttyUSB0", "/dev/rfcomm0"], TTY_S);
  ok(list.join(",") === "/dev/rfcomm0,/dev/ttyUSB0,/dev/ttyUSB1",
     "چند گره‌ی USB همه نگه داشته و مرتب می‌شوند (برد ممکن است روی ttyUSB1 باشد)",
     list.join(","));
  ok(pickRealPorts([], []).length === 0, "فهرستِ خالی → خالی");

  /* ---------- ۲) بردِ سالم روی pty، میانِ یک گره‌ی ناموجود ----------
     نکته: pty حافظه است نه سیم — سرعت روی آن هیچ اثری ندارد و داده در هر
     baud ای سالم می‌رسد. پس بردِ جعلی باید خودش تقلید کند: --only-baud یعنی
     «فقط با این سرعت حرف می‌زنم»، دقیقاً مثلِ بردِ واقعی که در سرعتِ اشتباه
     یا ساکت است یا آشغال می‌فرستد. بدونِ این، تست نمی‌توانست تشخیصِ سرعتِ
     درست را بسنجد. */
  console.log("\n-- findBoard: بردِ سالم باید با گره و سرعتِ درست پیدا شود --");
  let fb = startFakeBoard("1.0.41", { onlyBaud: 115200 });
  let slave = await fb.ready;
  ok(!!slave, "بردِ جعلی بالا آمد: " + slave);
  let lines = [];
  let out = await findBoard({
    pybridge,
    ports: ["/dev/definitely-not-a-port-xyz", slave],
    bauds: [19200, 9600, 115200],
    perTryMs: 260, settleMs: 60,
    log: (l) => lines.push(l),
  });
  ok(out.found && out.found.port === slave, "گرهِ درست را پیدا کرد",
     out.found ? out.found.port : JSON.stringify(out.tried.map((t) => t.port + "@" + t.baud)));
  ok(out.found && out.found.baud === 115200, "سرعتِ درست را پیدا کرد (۱۱۵۲۰۰، نه ۱۹۲۰۰/۹۶۰۰)",
     out.found ? String(out.found.baud) : "-");
  ok(out.found && out.found.firmware === "1.0.41", "نسخه‌ی فریم‌ور را از پاسخ خواند",
     out.found ? out.found.firmware : "-");
  ok(out.tried.some((t) => t.port === "/dev/definitely-not-a-port-xyz" && t.err),
     "گرهِ ناموجود با خطا ثبت شد و اسکن را متوقف نکرد");
  ok(out.tried.filter((t) => t.port === slave).length === 3,
     "روی بردِ سالم هر سه سرعت امتحان شد تا درستش پیدا شود",
     String(out.tried.filter((t) => t.port === slave).length));
  ok(lines.some((l) => /FOUND the board/.test(l)), "گزارشِ زنده «پیدا شد» داشت");
  fb.quit();
  await sleep(500);

  /* ---------- ۳) بردِ آشغال‌ده: هرگز «پیدا شد» حساب نشود ---------- */
  console.log("\n-- بردی که بایت می‌فرستد ولی بی‌معنی (سرعتِ اشتباه) --");
  fb = startFakeBoard("1.0.41", { garbage: true });
  slave = await fb.ready;
  lines = [];
  out = await findBoard({ pybridge, ports: [slave], bauds: [19200, 115200],
                          perTryMs: 240, settleMs: 60, log: (l) => lines.push(l) });
  ok(!out.found, "پیدا نشد — بایتِ آشغال دلیلِ درست بودنِ سرعت نیست",
     out.found ? JSON.stringify(out.found) : "");
  ok(out.tried.every((t) => t.bytes > 0 && t.known === false),
     "هر دو تلاش بایت گرفت ولی «ناشناخته» ثبت شد",
     JSON.stringify(out.tried.map((t) => `${t.baud}:${t.bytes}b known=${t.known}`)));
  ok(lines.some((l) => /unreadable/.test(l)), "در گزارشِ زنده گفت خوانا نیست");
  fb.quit();
  await sleep(500);

  /* ---------- ۴) بردِ کاملاً ساکت ---------- */
  console.log("\n-- بردی که در هیچ سرعتی حرف نمی‌زند --");
  fb = startFakeBoard("1.0.41", { onlyBaud: 1234567 });
  slave = await fb.ready;
  out = await findBoard({ pybridge, ports: [slave], bauds: [115200, 9600],
                          perTryMs: 200, settleMs: 50 });
  ok(!out.found && out.tried.length === 2 && out.tried.every((t) => t.bytes === 0),
     "بدونِ یافتن برگشت و ثبت کرد که هیچ بایتی نیامد",
     JSON.stringify(out.tried.map((t) => `${t.baud}:${t.bytes}b`)));
  fb.quit();
  await sleep(400);

  /* ---------- ۵) لغو ---------- */
  console.log("\n-- لغوِ اسکن از طرفِ کاربر --");
  fb = startFakeBoard("1.0.41", { onlyBaud: 1234567 });
  slave = await fb.ready;
  let n = 0;
  out = await findBoard({ pybridge, ports: [slave, slave, slave], bauds: [115200, 9600],
                          perTryMs: 120, settleMs: 40, shouldStop: () => ++n > 2 });
  ok(out.stopped === true, "اسکن با پرچمِ لغو متوقف شد");
  ok(out.tried.length < 6, "همه‌ی ترکیب‌ها را نرفت", out.tried.length + " تلاش");
  fb.quit();
  await sleep(300);
  pybridge.closeAll();

  console.log(`\n#  نتیجه: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) { console.log("#  مواردِ ناموفق:\n  - " + fails.join("\n  - ")); process.exit(1); }
  console.log("########## اسکنر: برد را با گره و سرعتِ درست پیدا می‌کند ##########");
  process.exit(0);
}

main().catch((e) => { console.log("FATAL " + ((e && e.stack) || e)); pybridge.closeAll(); process.exit(1); });
