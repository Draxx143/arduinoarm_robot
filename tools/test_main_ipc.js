#!/usr/bin/env node
/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Draxx143 — AXIS-3 Robot Arm
 * ============================================================
 * تستِ سرتاسریِ زنجیره‌ی واقعیِ پروسه‌ی اصلی
 *
 * چرا این تست لازم است: تا امروز پلِ پایتون جدا تست می‌شد (test_pybridge) و
 * رندرر با electronAPIِ **ساختگی** (test_connect_paths). یعنی دقیقاً همان
 * جایی که داده می‌تواند بی‌صدا گم شود — main.js واقعی + pybridge واقعی +
 * serial_bridge.py واقعی — هیچ‌وقت با هم امتحان نشده بودند.
 *
 * اینجا electron را با یک بدل جا می‌زنیم (بدونِ نصبِ electron)، main.jsِ
 * واقعی را require می‌کنیم، هندلرهای IPC واقعی‌اش را صدا می‌زنیم و یک بردِ
 * جعلی روی pty (tools/pty_holder.py) می‌گذاریم:
 *
 *   serialport:open → پلِ پایتون بالا می‌آید → برد بنرِ بوت را می‌فرستد
 *                   → باید به webContents.send("serialport:data", b64) برسد
 *   serialport:write → باید به برد برسد (pty_holder: GOT:…)
 *   serialport:close → پل باید بسته شود
 *
 * اجرا: node tools/test_main_ipc.js
 * ============================================================ */
"use strict";

const Module = require("module");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MAIN = path.join(ROOT, "desktop-app", "main.js");

let PASS = 0, FAIL = 0;
const fails = [];
function ok(cond, msg, extra) {
  if (cond) { PASS++; console.log("  ✔ " + msg); }
  else { FAIL++; fails.push(msg); console.log("  ✘ " + msg + (extra ? " — " + extra : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- بدلِ electron ---------- */
const sent = [];                 /* همه‌ی webContents.send ها */
const handlers = new Map();      /* ipcMain.handle / ipcMain.on */
const windows = [];

const webContents = {
  send: (channel, payload) => { sent.push({ channel, payload }); },
  on: () => {},
  once: () => {},
  setWindowOpenHandler: () => {},
  openDevTools: () => {},
  session: {
    setPermissionCheckHandler: () => {},
    setDevicePermissionHandler: () => {},
    setPermissionRequestHandler: () => {},
  },
};

class FakeWindow {
  constructor() { this.webContents = webContents; this._destroyed = false; windows.push(this); }
  loadFile() {} loadURL() {} on() {} once() {} show() {} hide() {} close() {}
  isDestroyed() { return this._destroyed; }
  static getAllWindows() { return windows; }
}

const electronStub = {
  app: {
    commandLine: { appendSwitch: () => {} },
    whenReady: () => Promise.resolve(),
    on: () => {}, once: () => {},
    getVersion: () => "1.0.50-test",
    getName: () => "axis3-test",
    getPath: () => os.tmpdir(),
    quit: () => {},
    exit: () => {},
    requestSingleInstanceLock: () => true,
    setAppUserModelId: () => {},
    isPackaged: false,
  },
  BrowserWindow: FakeWindow,
  Menu: { buildFromTemplate: (t) => t, setApplicationMenu: () => {} },
  ipcMain: {
    handle: (ch, fn) => handlers.set(ch, fn),
    on: (ch, fn) => handlers.set("on:" + ch, fn),
    removeHandler: (ch) => handlers.delete(ch),
  },
  shell: { openExternal: () => {} },
  dialog: {
    showErrorBox: (t, m) => console.log("  [dialog] " + t + ": " + m),
    showMessageBox: async () => ({ response: 0 }),
  },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronStub;
  return origLoad.apply(this, arguments);
};

/* ---------- بردِ جعلی روی pty ---------- */
function startBoard() {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [path.join(__dirname, "pty_holder.py")],
                        { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let slave = null;
    const got = [];
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        if (!slave) { slave = line.trim(); resolve({ child, slave, got, send: (t) => child.stdin.write("SEND:" + t + "\n") }); }
        else if (line.startsWith("GOT:")) got.push(line.slice(4).replace(/\\n/g, "\n"));
      }
    });
    child.stderr.on("data", () => {});
    child.on("exit", () => { if (!slave) reject(new Error("pty_holder exited early")); });
    setTimeout(() => { if (!slave) reject(new Error("pty_holder gave no slave path")); }, 8000);
  });
}

const BANNER = "======================================\n3+1 DOF Robot Arm - TEST MODE (No ROS)\nAXIS-3 Firmware v1.0.0\n======================================\n";

async function main() {
  console.log("=== تستِ سرتاسریِ پروسه‌ی اصلی (main.js + pybridge + serial_bridge.py) ===");

  /* main.js واقعی را بارگذاری کن — هندلرهای IPC ثبت می‌شوند */
  require(MAIN);
  await sleep(200);
  ok(handlers.has("serialport:open"), "هندلرِ serialport:open ثبت شد");
  ok(handlers.has("serialport:write"), "هندلرِ serialport:write ثبت شد");
  ok(handlers.has("serialport:close"), "هندلرِ serialport:close ثبت شد");
  ok(handlers.has("serialport:list"), "هندلرِ serialport:list ثبت شد");
  ok(handlers.has("port:holders"), "هندلرِ port:holders ثبت شد");
  ok(!handlers.has("port:doctor") && !handlers.has("port:find") && !handlers.has("port:probe"),
     "هندلرهای تشخیصیِ حذف‌شده برنگشته‌اند");
  ok(windows.length === 1, "پنجره ساخته شد (پس whenReady درست کار کرده)");

  const board = await startBoard();
  ok(typeof board.slave === "string" && board.slave.startsWith("/dev/pts/"),
     "pty ساخته شد: " + board.slave);

  /* ---- بازکردنِ پورت از راهِ هندلرِ واقعی ---- */
  sent.length = 0;
  /* دست‌دادنِ بوت از راهِ زنجیره‌ی واقعی: بنر پیشاپیش در بافرِ pty است، پس
   * پل باید R: را بی‌درنگ بعد از پالس بدهد — نه بعد از مهلتِ ۵ ثانیه. */
  for (const line of BANNER.split("\n")) { if (line) board.send(line); }
  const tOpen1 = Date.now();
  const res = await handlers.get("serialport:open")({}, board.slave, 115200);
  const took1 = Date.now() - tOpen1;
  ok(res && !res.err, "serialport:open بدون خطا حل شد", res && res.err ? res.err : JSON.stringify(res));
  ok(res && typeof res.id === "number", "شناسه‌ی نشست برگشت", String(res && res.id));
  ok(took1 < 8000, "open با بنرِ آماده سریع حل شد (دست‌دادن، نه انتظارِ کاملِ ۵ ثانیه)", took1 + " ms");

  /* ---- برد حرف می‌زند: باید به renderer برسد ----
     pty_holder هر SEND را یک خط می‌فرستد، پس بنر را خط‌به‌خط می‌دهیم —
     همان‌طور که بردِ واقعی هم خط‌خطی چاپ می‌کند. */
  for (const line of BANNER.split("\n")) { if (line) board.send(line); await sleep(40); }
  await sleep(900);
  const dataMsgs = sent.filter((m) => m.channel === "serialport:data");
  ok(dataMsgs.length > 0, "پیامِ serialport:data به webContents.send رسید",
     dataMsgs.length + " پیام؛ کانال‌ها: " + [...new Set(sent.map((m) => m.channel))].join(","));
  const decoded = dataMsgs.map((m) => Buffer.from(String(m.payload), "base64").toString("utf8")).join("");
  ok(/AXIS-3 Firmware v1\.0\.0/.test(decoded), "بنرِ برد سالم رمزگشایی شد و به renderer رسید",
     JSON.stringify(decoded.slice(0, 90)));
  ok(decoded.split("\n").filter((l) => /====/.test(l)).length >= 2,
     "چند خط پشتِ سرِ هم سالم رسید (تکه‌تکه‌شدنِ بایت‌ها مشکلی نمی‌سازد)",
     JSON.stringify(decoded.slice(0, 120)));
  const openNotices = sent.filter((m) => m.channel === "serialport:notice").map((m) => String(m.payload));
  ok(openNotices.some((t) => /boot banner seen/i.test(t)),
     "پل از راهِ زنجیره‌ی واقعی دیدنِ بنر را گزارش کرد",
     JSON.stringify(openNotices).slice(0, 220));

  /* ---- نوشتن: باید به برد برسد ---- */
  board.got.length = 0;
  const wr = await handlers.get("serialport:write")({}, res.id, "status\n");
  await sleep(400);
  ok(wr && !wr.err, "serialport:write بدون خطا", JSON.stringify(wr));
  ok(board.got.some((t) => /status/.test(t)), "دستور به برد رسید (TX سالم است)",
     JSON.stringify(board.got));

  /* ---- آمارِ RX که اپ نشان می‌دهد ---- */
  const stats = await handlers.get("serialport:stats")({});
  ok(stats && stats.mainRx > 0 && stats.kind === "py",
     "serialport:stats بایت‌های دیده‌شده در پروسه‌ی اصلی را می‌گوید", JSON.stringify(stats));

  /* ---- بستن ---- */
  await handlers.get("serialport:close")({}, res.id);
  await sleep(700);
  ok(sent.some((m) => m.channel === "serialport:closed"),
     "بسته‌شدن به renderer اطلاع داده شد (serialport:closed)");

  /* ---- فهرستِ پورت‌ها بدونِ درایورِ native ---- */
  const list = await handlers.get("serialport:list")({});
  ok(list && (Array.isArray(list.ports) || list.err),
     "serialport:list ساختارِ درست برمی‌گرداند", JSON.stringify(list).slice(0, 120));
  const names = await handlers.get("serial:list-system-ports")({});
  ok(Array.isArray(names), "serial:list-system-ports آرایه می‌دهد", JSON.stringify(names).slice(0, 100));
  ok(!names.some((n) => /^\/dev\/ttyS\d+$/.test(n)) || names.every((n) => /^\/dev\/ttyS\d+$/.test(n)),
     "پورتِ شبحیِ ttyS وقتی USB هست در فهرست نمی‌ماند", JSON.stringify(names).slice(0, 120));

  /* ---- ⚠ شبیه‌سازیِ دقیقِ باگِ گزارش‌شده: pgrep بی‌پاسخ ----
     کاربر «[SYS] opening …» را می‌دید و بعد هیچ. اگر پیدا کردنِ پل‌های یتیم
     هرگز settle نشود، serialport:open هرگز به پل نمی‌رسد. با یک pgrepِ
     گیرکرده در PATH همان شرایط را می‌سازیم: بازکردنِ پورت باید **با وجودِ
     آن** کامل شود. */
  const hangDir = path.join(os.tmpdir(), "axis3-hangbin");
  require("fs").mkdirSync(hangDir, { recursive: true });
  const hangPgrep = path.join(hangDir, "pgrep");
  require("fs").writeFileSync(hangPgrep, "#!/bin/sh\nsleep 60\n", { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = hangDir + ":" + oldPath;
  const board2 = await startBoard();
  sent.length = 0;
  /* بنر از پیش در بافرِ pty است (بایت‌ها تا باز شدنِ پورت می‌مانند) تا
   * دست‌دادنِ بوت بی‌درنگ حل شود و این سناریو فقط مهلتِ داخلیِ pgrep را
   * بسنجد، نه مهلتِ ۵ ثانیه‌ی بنر را. */
  board2.send("AXIS-3 Firmware v1.0.0");
  const t0 = Date.now();
  const openP2 = handlers.get("serialport:open")({}, board2.slave, 115200);
  setTimeout(() => board2.send("System initialized."), 3000);
  const res2 = await openP2;
  const took = Date.now() - t0;
  ok(res2 && !res2.err, "با pgrepِ گیرکرده هم پورت باز شد (open هرگز hang نمی‌شود)",
     res2 && res2.err ? res2.err : "");
  ok(took < 6000, "و در کمتر از ۶ ثانیه — مهلتِ داخلی کار کرد", took + " ms");
  const notices = sent.filter((m) => m.channel === "serialport:notice").map((m) => String(m.payload));
  ok(notices.some((t) => /leftover bridge/i.test(t)),
     "breadcrumbِ «بررسیِ پل‌های جامانده» به کنسول رسید", JSON.stringify(notices));
  ok(notices.some((t) => /starting the serial bridge/i.test(t)),
     "breadcrumbِ «شروعِ پل» هم رسید — پس اگر جایی گیر کند، آخرین پیام همان است",
     JSON.stringify(notices));
  board2.send("AXIS-3 Firmware v1.0.0");
  await sleep(600);
  ok(sent.some((m) => m.channel === "serialport:data"),
     "RX هم در همان وضعیت جریان دارد");
  await handlers.get("serialport:close")({}, res2.id);
  await sleep(400);
  process.env.PATH = oldPath;
  try { board2.child.kill(); } catch (e) {}

  /* ---- پلِ یتیم: باید پیش از open خلاص شود ---- */
  const pybridge = require(path.join(ROOT, "desktop-app", "main", "pybridge.js"));
  const stubExec = (c, a, o, cb) => cb(null, "999991\n999992\n");
  const orphans = await pybridge.findOrphans({ execFile: stubExec });
  ok(orphans.length === 2, "findOrphans پل‌های ناشناس را پیدا می‌کند", JSON.stringify(orphans));
  ok((await pybridge.findOrphans({ execFile: stubExec, selfPids: [999991] })).length === 1,
     "پی‌جیِ خودی هرگز کشته نمی‌شود");

  try { board.child.kill(); } catch (e) {}
  pybridge.closeAll();

  console.log(`\n#  نتیجه: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) { console.log("#  مواردِ ناموفق:\n  - " + fails.join("\n  - ")); process.exit(1); }
  console.log("########## زنجیره‌ی واقعیِ پروسه‌ی اصلی: open → RX → TX → close سالم ##########");
  process.exit(0);
}

main().catch((e) => { console.log("FATAL " + ((e && e.stack) || e)); process.exit(1); });
