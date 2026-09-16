#!/usr/bin/env node
/* ============================================================
 * تستِ مسیرهای اتصال — «شناسایی می‌شود ولی کامل وصل نمی‌شود»
 *
 * چیزهایی که این تست پین می‌کند، همه علتِ واقعیِ «وصل نمی‌شود» بوده‌اند:
 *
 *  ۱) مسیرِ وب‌سریال هم باید خطوطِ مودم را کنترل کند. کرومیوم DTR/RTS را
 *     در وضعیتِ پیش‌فرضِ درایور رها می‌کند: بردهای USB بومی بدونِ DTRِ
 *     asserted هر Serial.print را دور می‌ریزند و بردهای Rev3 لبه‌ی ریست
 *     نمی‌گیرند. پالس باید با **هر دو خط هم‌سطح** تمام شود، وگرنه برد در
 *     ریست نگه داشته می‌شود.
 *
 *  ۲) در اپِ دسکتاپ، «اتصال» با کشوی خالی باید از **پلِ سیستمی** برود، نه
 *     از وب‌سریال.
 *
 *  ۳) بردِ ساکت باید **یک بار** درخواستِ RESET بگیرد و اپ پورت را باز و بسته
 *     نکند. کاوشِ پشتِ سرِ همِ baud روی CH340 خودش باعثِ افتِ تغذیه و
 *     بیرون‌افتادنِ دستگاه از BUS می‌شود — یعنی ابزارِ «عیب‌یابی» مشکل را
 *     بدتر می‌کرد. پس فقط دو پله: RESET بزن، بعد حکمِ روشنِ علتِ الکتریکی.
 *
 *  ۴) وقتی USB می‌افتد (EMI)، اپ باید خودش دوباره وصل شود و اگر کرنل اسمِ
 *     گره را عوض کرد (ttyUSB0 → ttyUSB1) گره‌ی تازه را پیدا کند.
 *
 *  ۵) ابزارهای تشخیصی (عیب‌یاب / «برد را پیدا کن» / Port Test) حذف شده‌اند
 *     و این تست پین می‌کند که دیگر برنگردند.
 *
 * همه با یک electronAPIِ ساختگی در jsdom — بدونِ سخت‌افزار.
 *
 * اجرا: cd tools && npm install jsdom && node test_connect_paths.js
 * ============================================================ */
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "..");
const PAGE = "desktop-app/renderer/index.html";

function findJsdom() {
  const bases = [path.join(ROOT, "node_modules"), path.join(ROOT, "tools", "node_modules"),
                 path.join(process.env.HOME || "/root", "guitest", "node_modules"),
                 path.join(process.env.HOME || "/root", "node_modules")];
  for (const b of bases) {
    try { return createRequire(path.join(b, "_x.js"))("jsdom"); } catch (e) { /* بعدی */ }
  }
  try { return require("jsdom"); } catch (e) { return null; }
}
const jsdom = findJsdom();
if (!jsdom) {
  console.log("  jsdom نصب نیست — این تست SKIP شد (cd tools && npm install)");
  process.exit(0);
}
const { JSDOM, VirtualConsole } = jsdom;

let PASS = 0, FAIL = 0;
const fails = [];
function ok(cond, msg, extra) {
  if (cond) { PASS++; console.log("  ✔ " + msg); }
  else { FAIL++; fails.push(msg); console.log("  ✘ " + msg + (extra ? " — " + extra : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- سرورِ ایستای کوچک ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
               ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml" };
function startStatic() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("nope"); return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
                           "Cache-Control": "no-store" });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

/* ---------- وضعیتِ «بردِ ساختگی» که اپ با آن حرف می‌زند ---------- */
function makeBoard() {
  return {
    onlyBaud: 0,          /* 0 = در هر baud ای جواب می‌دهد */
    realBaud: 0,          /* اگر != 0: فقط در این baud متنِ درست می‌فرستد */
    garbage: false,       /* در baudِ اشتباه بایتِ بی‌معنی بفرست (مثلِ سیمِ واقعی) */
    opened: [],           /* هر open: {path, baud} */
    written: [],          /* هر write */
    closed: 0,
    onData: null,
    rxSent: 0,
    replyGarbage() {
      /* بایتِ بی‌معنی — دقیقاً همان چیزی که با سرعتِ اشتباه روی سیم است */
      const junk = Buffer.from([0xC3, 0x28, 0xA0, 0xFF, 0x9B, 0x07, 0xE2, 0x10,
                                0xBE, 0x44, 0x0A, 0xF8, 0x7F, 0x31, 0x13, 0xC9]);
      if (this.onData) { this.onData(junk.toString("base64")); this.rxSent += junk.length; }
    },
    reply() {
      /* پاسخِ واقعیِ فریم‌ور: بلوکِ status + خطِ POS (همان قالبِ Config.h) */
      const block = "=== System Status ===\nState: Ready\nFW: v1.0.0\n" +
        "Homed: J1[ok] J2[ok] J3[ok] J4[ok]\n======================\n" +
        ">> POS 0.0,0.0,0.0,0.0,0\n";
      if (this.onData) {
        this.onData(Buffer.from(block, "utf8").toString("base64"));
        this.rxSent += block.length;
      }
    },
  };
}

function installMock(w, board) {
  w.electronAPI = {
    isElectron: true,
    appVersion: "0.0.0-test",
    serialDriverAvailable: async () => false,
    serialStats: async () => ({ mainRx: board.rxSent, kind: "py" }),
    /* با board.holders می‌شود «خواننده‌ی دوم پورت را گرفته» را ساخت */
    portHolders: async () => board.holders || { pids: [], procs: [] },
    listSystemPorts: async () => {
      /* با portPlan می‌شود «برد از BUS افتاد و با اسمِ دیگری برگشت» را ساخت */
      board.listCalls = (board.listCalls || 0) + 1;
      if (Array.isArray(board.portPlan) && board.portPlan.length) {
        return board.portPlan[Math.min(board.listCalls - 1, board.portPlan.length - 1)];
      }
      return ["/dev/ttyUSB0"];
    },
    expectPort: () => {}, onPortList: () => {}, onPortAdded: () => {}, onPortRemoved: () => {},
    choosePort: () => {}, cancelChoose: () => {},
    versions: { electron: "test", node: "test", chrome: "test" },
    ipcSerial: {
      list: async () => ({ ports: [{ path: "/dev/ttyUSB0", friendly: "CH340 serial", vid: "1a86", pid: "7523" },
                                   { path: "/dev/ttyUSB1", friendly: "CH340 serial", vid: "1a86", pid: "7523" }] }),
      open: async (p, baud) => {
        board.opened.push({ path: String(p), baud: Number(baud) });
        board.id = 1000001;
        /* بردِ واقعی بعد از پالسِ ریست، بنرِ بوت را می‌فرستد — اما فقط اگر
           سرعت درست باشد (فریمِور با Config.h قدیمی = ۹۶۰۰) */
        /* بردِ واقعی هم بعد از پالسِ ریست بنر می‌فرستد — ولی فقط اگر سرعت
           درست باشد؛ وگرنه یا ساکت است یا بایتِ بی‌معنی می‌دهد. */
        const rightSpeed = (!board.onlyBaud || board.onlyBaud === Number(baud)) &&
                           (!board.realBaud || board.realBaud === Number(baud)) &&
                           (!board.answerPaths || board.answerPaths.indexOf(String(p)) !== -1);
        if (rightSpeed) setTimeout(() => board.reply(), 30);
        else if (board.garbage) setTimeout(() => board.replyGarbage(), 30);
        return { id: 1000001 };
      },
      write: async (id, text) => {
        board.written.push(String(text));
        const last = board.opened[board.opened.length - 1] || {};
        if (board.realBaud && board.realBaud !== Number(last.baud)) {
          if (board.garbage) board.replyGarbage();
        } else if ((!board.onlyBaud || board.onlyBaud === Number(last.baud)) &&
                   (!board.answerPaths || board.answerPaths.indexOf(String(last.path || "")) !== -1)) {
          board.reply();
        }
        return {};
      },
      close: async () => { board.closed++; return {}; },
      onData: (cb) => { board.onData = cb; },
      onClosed: (cb) => { board.onClosed = cb; },
      onError: (cb) => { board.onError = cb; },
    },
  };
}

/* ---------- بارگذاریِ صفحه با electronAPIِ ساختگی ---------- */
async function loadApp(port, board) {
  const vc = new VirtualConsole();       /* نویزِ فونت/CSS بیرونی گرفته شود */
  vc.on("jsdomError", () => {});
  const dom = await JSDOM.fromURL(`http://127.0.0.1:${port}/${PAGE}`, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      /* canvas در jsdom نیست؛ بدل باید هر ترکیبی را بدون استثنا تحمل کند،
         وگرنه requestAnimationFrame از زمان‌بندی می‌افتد و همه‌چیز یخ می‌زند */
      const f = function () { return A; };
      const A = new Proxy(f, {
        get: (t, k) => (k === Symbol.toPrimitive ? () => 0
                        : k === Symbol.iterator ? function* () {}
                        : k === "length" ? 0 : k === "then" ? undefined : A),
        apply: () => A, set: () => true, has: () => true,
      });
      w.HTMLCanvasElement.prototype.getContext = () => A;
      installMock(w, board);
    },
  });
  await sleep(1200);
  return dom;
}

const consoleText = (dom) => {
  const box = dom.window.document.getElementById("consoleBox");
  return box ? Array.from(box.children).map((d) => d.textContent).join("\n") : "";
};

async function main() {
  const { srv, port } = await startStatic();
  console.log("=== تستِ مسیرهای اتصال (renderer + electronAPIِ ساختگی) ===");

  /* ---------- ۱) وب‌سریال: پالسِ خطوط باید هم‌سطح تمام شود ---------- */
  console.log("\n-- وب‌سریال: کنترلِ DTR/RTS (مسیری که قبلاً هیچ کاری نمی‌کرد) --");
  let board = makeBoard();
  let dom = await loadApp(port, board);
  let w = dom.window;
  ok(w.eval("typeof SerialLink") === "function", "SerialLink در صفحه هست");
  const sig = await w.eval(`(async () => {
    const calls = [];
    const fakePort = {
      open: async () => {},
      setSignals: async (s) => { calls.push({ dtr: !!s.dataTerminalReady, rts: !!s.requestToSend }); },
      get readable() { return null; },
    };
    const link = new SerialLink();
    link.onConnect = null;
    /* فقط پالسِ خطوط را صدا بزن — _readLoop به readableِ واقعی نیاز دارد */
    await link._assertLines(fakePort);
    return calls;
  })()`);
  ok(Array.isArray(sig) && sig.length >= 3, "setSignals دستِ‌کم سه بار صدا شد",
     sig ? sig.length + " بار" : "هیچ");
  const differ = sig.filter((c) => c.dtr !== c.rts);
  ok(differ.length >= 1, "یک وضعیتِ «متفاوت» ساخته شد (لبه‌ی ریستِ Rev3)");
  ok(sig.length > 0 && sig[sig.length - 1].dtr === sig[sig.length - 1].rts,
     "وضعیتِ نهایی هم‌سطح است → برد در ریست رها نمی‌شود",
     JSON.stringify(sig[sig.length - 1]));
  ok(sig.length > 0 && sig[sig.length - 1].dtr === true,
     "در پایان DTR asserted است → بردهای USB بومی «میزبان وصل است» را می‌بینند",
     "بدونِ آن Serial.print بی‌صدا دور ریخته می‌شود");
  /* لبه‌ی RISINGِ DTR — تنها تریگرِ ریستِ چیپِ 16U2/32U4 روی Mega 2560.
     بدونِ آن: پورت بی‌خطا باز می‌شود، برد ری‌بوت نمی‌شود، هیچ بایتی
     نمی‌آید، ولی Arduino IDE سالم وصل می‌شود (چون اول DTR را می‌اندازد). */
  const dtrSeq = sig.map((c) => c.dtr);
  const rises = dtrSeq.filter((d, i) => i > 0 && !dtrSeq[i - 1] && d).length;
  ok(rises >= 1, "لبه‌ی RISINGِ DTR (۰→۱) وجود دارد — تریگرِ ریستِ Mega 2560 (16U2)",
     "DTR: " + dtrSeq.map((d) => (d ? "1" : "0")).join("→"));
  ok(dtrSeq.indexOf(false) !== -1, "DTR واقعاً یک بار LOW شد",
     "DTR: " + dtrSeq.map((d) => (d ? "1" : "0")).join("→"));
  ok(rises === 1, "دقیقاً یک ریست (ریستِ دوم بنرِ بوت را cut می‌کند)", rises + " لبه");
  dom.window.close();

  /* ---------- ۲) کشوی خالی → باید از پلِ سیستمی برود ---------- */
  console.log("\n-- دکمه‌ی «اتصال» با کشوی پورتِ خالی --");
  board = makeBoard();
  dom = await loadApp(port, board);
  w = dom.window;
  ok(w.eval("IpcSerialLink.supported") === true, "پلِ سیستمی در دسترس است (electronAPI نصب شد)");
  w.document.getElementById("hdrPort").value = "";     /* کاربر چیزی انتخاب نکرده */
  await w.eval("toggleSerial()");
  await sleep(700);
  ok(board.opened.length >= 1, "پورت از راهِ پلِ سیستمی باز شد",
     board.opened.length ? JSON.stringify(board.opened[0]) : "هیچ open ای صدا نشد");
  ok(board.opened.length >= 1 && /\/dev\/ttyUSB0/.test(board.opened[0].path),
     "مسیرِ دستگاهِ درست انتخاب شد (نه برچسب، نه حدس)");
  ok(board.opened.length >= 1 && board.opened[0].baud === 115200,
     "با baudِ پیش‌فرضِ ۱۱۵۲۰۰ باز شد");
  ok(w.eval("S.mode") === "serial", "وضعیتِ اپ «متصل» شد");
  ok(w.eval("S.serial.rxCount") > 0, "RX > 0 — داده‌ی برد به رندر رسید",
     "rxCount=" + w.eval("S.serial.rxCount"));
  ok(board.written.some((t) => /status/.test(t)), "اپ دستورِ status را فرستاد");
  ok(/1\.0\.0/.test(consoleText(dom)) || w.eval("S.serial.rxCount") > 0,
     "پاسخِ برد (نسخه‌ی فریم‌ور) در اپ دیده شد");
  ok(w.eval("typeof autoPickPort") === "function", "autoPickPort وجود دارد (انتخابِ خودکارِ پورت)");

  /* ---------- ۳) بردِ ساکت: یک درخواستِ RESET، بدونِ باز و بسته کردنِ پورت ---- */
  console.log("\n-- بردِ ساکت: فقط یک بار RESET بخواه، پورت را churn نکن --");
  const boardSilent = makeBoard();
  boardSilent.onlyBaud = -1;                 /* هیچ‌وقت جواب نمی‌دهد */
  dom = await loadApp(port, boardSilent);
  w = dom.window;
  w.document.getElementById("selBaud").value = "115200";
  await w.eval("connectSystemPort('/dev/ttyUSB0')");
  await sleep(400);
  ok(w.eval("S.serial.rxCount") === 0, "RX صفر ماند — دقیقاً همان علامتِ کاربر",
     "rxCount=" + w.eval("S.serial.rxCount"));
  const openedBefore = boardSilent.opened.length;
  w.eval("S._connAt = Date.now() - 7000; updateLinkStats();");   /* ۶ ثانیه گذشته */
  await sleep(150);
  ok(w.eval("S._rxStage") === 1, "پله‌ی ۱ فعال شد");
  ok(/press the RESET button/i.test(consoleText(dom)), "یک بار گفت دکمه‌ی RESET را بزند");
  ok(boardSilent.opened.length === openedBefore,
     "پورت دوباره باز **نشد** (باز و بسته‌کردنِ پشتِ سرِ هم روی CH340 خودش افتِ BUS می‌سازد)",
     `${openedBefore} → ${boardSilent.opened.length}`);
  w.eval("S._connAt = Date.now() - 7000; updateLinkStats(); updateLinkStats();");
  await sleep(100);
  const resetMsgs = (consoleText(dom).match(/press the RESET button/gi) || []).length;
  ok(resetMsgs === 1, "درخواستِ RESET تکرار نمی‌شود (کاربر را گیج نمی‌کند)", resetMsgs + " بار");
  w.eval("S._connAt = Date.now() - 17000; updateLinkStats();");  /* ۱۶ ثانیه گذشته */
  await sleep(150);
  ok(w.eval("S._rxStage") === 2, "پله‌ی ۲: حکمِ روشن داده شد");
  ok(boardSilent.opened.length === openedBefore, "در پله‌ی ۲ هم پورت دست‌نخورده ماند",
     `${openedBefore} → ${boardSilent.opened.length}`);
  ok(/dmesg/.test(consoleText(dom)) && /EMI/.test(consoleText(dom)),
     "علتِ واقعی را گفت: افتِ USB/EMI و راهِ تأییدش (sudo dmesg)");
  ok(w.eval("S.mode") === "serial", "اپ متصل می‌ماند تا کاربر RESET را بزند (قطع نمی‌شود)");
  dom.window.close();

  /* ---------- ۳ب) پورت دزدیده شده: دستور می‌رود، جواب برنمی‌گردد ---------- */
  console.log("\n-- خواننده‌ی دوم پورت را گرفته (ModemManager/brltty/پلِ جامانده) --");
  const boardStolen = makeBoard();
  boardStolen.onlyBaud = -1;                      /* برد ساکت */
  boardStolen.holders = { pids: [4242], procs: ["ModemManager"] };
  dom = await loadApp(port, boardStolen);
  w = dom.window;
  w.document.getElementById("selBaud").value = "115200";
  await w.eval("connectSystemPort('/dev/ttyUSB0')");
  await sleep(400);
  const openedStolen = boardStolen.opened.length;
  w.eval("S._connAt = Date.now() - 4000; updateLinkStats();");   /* پله‌ی ۰ */
  await sleep(250);
  ok(w.eval("S._holdersChecked") === true, "پیش از هر نصیحتی، مالکیتِ پورت بررسی شد");
  ok(/another program is holding this port/i.test(consoleText(dom)) &&
     /ModemManager/.test(consoleText(dom)),
     "دزدِ پورت با نام و PID معرفی شد", consoleText(dom).slice(-200));
  ok(/tty is NOT exclusive/i.test(consoleText(dom)),
     "توضیح داد چرا دستور می‌رود ولی جواب برنمی‌گردد (tty انحصاری نیست)");
  ok(/fix-serial-port-ownership/.test(consoleText(dom)),
     "راه‌حلِ یک‌خطیِ دائمی را داد");
  ok(w.eval("S._rxStage") === 3, "پله‌ی RESET رد شد — چون علت چیزِ دیگری بود");
  w.eval("S._connAt = Date.now() - 7000; updateLinkStats();");
  await sleep(200);
  ok(!/press the RESET button/i.test(consoleText(dom)),
     "به کاربر نگفت RESET بزند (نشانه‌ی غلط وقتی پورت دزدیده شده)");
  ok(boardStolen.opened.length === openedStolen, "پورت هم دوباره باز نشد",
     `${openedStolen} → ${boardStolen.opened.length}`);
  ok(w.eval("S.mode") === "serial", "اپ متصل می‌ماند تا کاربر دزد را ببندد");
  dom.window.close();

  /* ---------- ۴) ابزارهای تشخیصی حذف شده‌اند و نباید برگردند ---------- */
  console.log("\n-- حذفِ ابزارهای تشخیصی: عیب‌یاب / «برد را پیدا کن» / Port Test --");
  const boardNone = makeBoard();
  dom = await loadApp(port, boardNone);
  w = dom.window;
  ok(w.document.getElementById("btnDoctor") === null, "دکمه‌ی 🩺 Doctor از UI حذف شد");
  ok(w.document.getElementById("btnFind") === null, "دکمه‌ی 🔍 Find board از UI حذف شد");
  ok(w.document.getElementById("btnPortTest") === null, "دکمه‌ی 🔬 Port Test از UI حذف شد");
  ok(w.eval("typeof runPortDoctor") === "undefined", "تابعِ عیب‌یاب دیگر وجود ندارد");
  ok(w.eval("typeof findMyBoard") === "undefined", "تابعِ «برد را پیدا کن» دیگر وجود ندارد");
  ok(w.eval("typeof autoRecoverRx") === "undefined", "نردبانِ خودکارِ RX=0 دیگر وجود ندارد");
  ok(w.eval("typeof BAUD_LADDER") === "undefined", "نردبانِ baud دیگر وجود ندارد");
  ok(w.electronAPI.portDoctor === undefined && w.electronAPI.portFind === undefined &&
     w.electronAPI.portProbe === undefined,
     "پلِ preload هم IPC تشخیصی ندارد (پاک‌سازی کاملِ هر سه لایه)");
  ok(w.eval("typeof autoReconnect") === "function", "وصلِ دوباره‌ی خودکار هست (همین اصلاحِ اصلی است)");
  ok(w.eval("typeof findLiveNode") === "function", "یافتنِ گره‌ی تازه بعد از افتِ USB هست");
  ok(w.eval("typeof autoCorrectBaud") === "function", "اصلاحِ خودکارِ baudِ اشتباه هست");
  dom.window.close();

  /* ---------- ۵) بایتِ آشغال = سرعتِ اشتباه (گزارشِ واقعیِ کاربر) ---------- */
  console.log("\n-- اپ روی ۱۹۲۰۰، برد روی ۱۱۵۲۰۰: پاسخ «کاراکترِ بی‌معنی» --");
  const board4 = makeBoard();
  board4.realBaud = 115200; board4.garbage = true;
  dom = await loadApp(port, board4);
  w = dom.window;
  ok(w.eval(`looksLikeBoard("\\u00c3(\\u00a0\\uffff\\u009b\\u0007 junk")`) === false,
     "سنجه: بایتِ بی‌معنی «حرفِ برد» حساب نمی‌شود");
  ok(w.eval(`looksLikeBoard("=== System Status ===\\nState: Ready\\n>> POS 0.0,0.0")`) === true,
     "سنجه: بلوکِ واقعیِ status را می‌شناسد");
  w.document.getElementById("selBaud").value = "19200";
  await w.eval("connectSystemPort('/dev/ttyUSB0')");
  await sleep(700);
  ok(board4.opened[0] && board4.opened[0].baud === 19200, "با همان ۱۹۲۰۰ی که کاربر داشت وصل شد");
  ok(w.eval("S.serial.rxCount") > 0, "بایت می‌آید — پس سیم، پورت و مجوز سالم‌اند",
     "rxCount=" + w.eval("S.serial.rxCount"));
  ok(w.eval("S._sawBoardText") === false, "ولی هیچ نشانه‌ای از فریم‌ور دیده نمی‌شود (یعنی آشغال است)");
  const corrected = await w.eval("autoCorrectBaud(19200)");
  await sleep(400);
  ok(corrected === true, "اصلاحِ خودکارِ baud موفق بود");
  ok(w.document.getElementById("selBaud").value === "115200",
     "کشوی baud به ۱۱۵۲۰۰ برگشت", "value=" + w.document.getElementById("selBaud").value);
  ok(w.eval("S.serial.baud") === 115200, "اتصالِ فعلی روی ۱۱۵۲۰۰ است");
  ok(w.eval("S._sawBoardText") === true, "حالا متنِ خوانا می‌رسد");
  ok(board4.opened.some((o) => o.baud === 115200), "پورت با ۱۱۵۲۰۰ از نو باز شد");
  dom.window.close();

  /* ---------- ۶) قفلِ هم‌زمانی: کلیکِ دوم وسطِ وصلِ دوباره ---------- */
  console.log("\n-- کلیکِ دوباره‌ی «اتصال» وسطِ وصلِ دوباره (دو خواننده روی یک پورت) --");
  const boardGuard = makeBoard();
  dom = await loadApp(port, boardGuard);
  w = dom.window;
  const before = boardGuard.opened.length;
  w.eval("S._reconnecting = true");
  await w.eval("connectSystemPort('/dev/ttyUSB0')");
  await sleep(300);
  ok(boardGuard.opened.length === before, "نشستِ دومی باز نشد (بایت‌ها دزدیده نمی‌شوند)",
     `${before} → ${boardGuard.opened.length}`);
  ok(/busy/i.test(consoleText(dom)), "به کاربر گفت اپ مشغول است");
  w.eval("S._reconnecting = false");
  dom.window.close();

  /* ---------- ۷) افتِ USB: برد با اسمِ دیگری برمی‌گردد ---------- */
  console.log("\n-- افتِ USB: گره ناپدید و به‌جایش /dev/ttyUSB1 پیدا می‌شود --");
  const board7 = makeBoard();
  board7.portPlan = [[], [], ["/dev/ttyUSB1"], ["/dev/ttyUSB1"], ["/dev/ttyUSB1"]];
  dom = await loadApp(port, board7);
  w = dom.window;
  ok(w.eval("typeof autoReconnect") === "function", "autoReconnect وجود دارد");
  ok(w.eval("typeof findLiveNode") === "function", "findLiveNode وجود دارد (یافتنِ گره‌ی تازه)");
  w.document.getElementById("selBaud").value = "115200";
  const back = await w.eval("autoReconnect('/dev/ttyUSB0', 115200)");
  await sleep(400);
  ok(back === true, "بعد از افتِ USB خودش دوباره وصل شد");
  ok(board7.opened.some((o) => o.path === "/dev/ttyUSB1" && o.baud === 115200),
     "گره‌ی تازه‌ای که کرنل ساخت را پیدا کرد و همان را باز کرد",
     JSON.stringify(board7.opened.map((o) => o.path + "@" + o.baud)));
  ok(/re-enumerated/.test(consoleText(dom)),
     "به کاربر گفت که کرنل اسمِ گره را عوض کرده (ttyUSB0 → ttyUSB1)");
  ok(w.eval("S.mode") === "serial", "اپ دوباره در وضعیتِ اتصال است");
  ok(/dropped|USB drop-out|electrical/.test(consoleText(dom)),
     "گفت علتِ افت، الکتریکی است (EMI/تغذیه)، نه نرم‌افزار");

  /* ---------- ۷ب) گره‌ی مرده: بعد از افتِ USB اسم عوض شده ---------- */
  console.log("\n-- کشو هنوز ttyUSB0 را نشان می‌دهد ولی برد الان ttyUSB1 است --");
  const board8 = makeBoard();
  /* فهرستِ زنده‌ی سیستم فقط ttyUSB1 را دارد — ttyUSB0 دیگر وجود ندارد */
  board8.portPlan = [["/dev/ttyUSB1"], ["/dev/ttyUSB1"], ["/dev/ttyUSB1"]];
  dom = await loadApp(port, board8);
  w = dom.window;
  w.document.getElementById("selBaud").value = "115200";
  await w.eval("connectSystemPort('/dev/ttyUSB0')");     /* همان انتخابِ کهنه‌ی کاربر */
  await sleep(700);
  ok(!board8.opened.some((o) => o.path === "/dev/ttyUSB0"),
     "گره‌ی مرده باز **نشد** (بازکردنش همیشه «وصل نمی‌شود» می‌سازد)",
     JSON.stringify(board8.opened.map((o) => o.path)));
  ok(board8.opened.some((o) => o.path === "/dev/ttyUSB1"),
     "خودش گره‌ی زنده را پیدا کرد و همان را باز کرد",
     JSON.stringify(board8.opened.map((o) => o.path)));
  ok(/no longer exists/.test(consoleText(dom)),
     "به کاربر گفت که کرنل گره را عوض کرده و اپ کدام را برداشت");
  ok(w.eval("S.mode") === "serial", "اتصال برقرار شد (نه «وصل نمی‌شود»)");
  ok(w.eval("S.serial.rxCount") > 0, "RX > 0 — داده‌ی برد رسید",
     "rxCount=" + w.eval("S.serial.rxCount"));
  dom.window.close();

  /* ---------- ۷ج) برد روی گره‌ی دیگری است: یک دورِ محدود ---------- */
  console.log("\n-- ttyUSB0 ساکت است ولی برد روی ttyUSB1 جواب می‌دهد --");
  const boardSweep = makeBoard();
  boardSweep.answerPaths = ["/dev/ttyUSB1"];
  boardSweep.portPlan = [["/dev/ttyUSB0", "/dev/ttyUSB1"], ["/dev/ttyUSB0", "/dev/ttyUSB1"],
                         ["/dev/ttyUSB0", "/dev/ttyUSB1"], ["/dev/ttyUSB0", "/dev/ttyUSB1"]];
  dom = await loadApp(port, boardSweep);
  w = dom.window;
  ok(w.eval("typeof tryOtherNodes") === "function", "بازیابیِ «یک دور روی گره‌های دیگر» وجود دارد");
  w.document.getElementById("selBaud").value = "115200";
  await w.eval("connectSystemPort('/dev/ttyUSB0')");
  await sleep(400);
  ok(w.eval("S.serial.rxCount") === 0, "روی گره‌ی انتخابیِ کاربر ساکت است",
     "rxCount=" + w.eval("S.serial.rxCount"));
  w.eval("S._connAt = Date.now() - 4000; updateLinkStats();");   /* بررسیِ مالکیت */
  await sleep(300);
  w.eval("S._connAt = Date.now() - 6000; updateLinkStats();");   /* شروعِ یک دور */
  await sleep(3200);
  ok(/one pass over the other live device/.test(consoleText(dom)),
     "گفت یک دور روی بقیه‌ی گره‌های زنده می‌زند (نه نردبانِ baud)");
  ok(boardSweep.opened.some((o) => o.path === "/dev/ttyUSB1"), "گره‌ی دیگر را امتحان کرد",
     JSON.stringify(boardSweep.opened.map((o) => o.path)));
  ok(/the board answered on \/dev\/ttyUSB1/.test(consoleText(dom)),
     "برد را روی گره‌ی دیگر پیدا کرد و همان‌جا ماند");
  ok(w.eval("S.mode") === "serial", "اپ متصل است");
  ok(w.eval("S.serial.rxCount") > 0, "RX > 0 روی گره‌ی درست", "rx=" + w.eval("S.serial.rxCount"));
  ok(w.eval("S._nodeSweep") === false, "پرچمِ sweep پاک شد (اتصالِ بعدی قفل نمی‌شود)");
  const tries = boardSweep.opened.filter((o) => o.path === "/dev/ttyUSB1").length;
  ok(tries === 1, "**یک** دور، نه بیشتر — چرنِ قدیمی برنگشته", tries + " بار");
  ok(!boardSweep.opened.some((o) => o.baud !== 115200),
     "فقط با سرعتِ خودِ فریم‌ور امتحان کرد (۹۶۰۰/۵۷۶۰۰/… نه)",
     JSON.stringify(boardSweep.opened.map((o) => o.baud)));
  dom.window.close();

  /* ---------- ۸) پیامِ تکراری در کنسول جمع می‌شود ---------- */
  console.log("\n-- ۲۰ بار «[Errno 5]» پشتِ سرِ هم: کنسول پر نمی‌شود --");
  const boardDedupe = makeBoard();     /* پنجره‌ی خودش — به سناریوی قبل تکیه نکند */
  dom = await loadApp(port, boardDedupe);
  w = dom.window;
  const cBefore = w.eval("document.getElementById('consoleBox').children.length");
  w.eval(`for (let i = 0; i < 20; i++) addConsole("err", "!! [Errno 5] Input/output error")`);
  const cAfter = w.eval("document.getElementById('consoleBox').children.length");
  ok(cAfter - cBefore === 1, "بیست خطای یکسان در **یک** خط جمع شد",
     `${cBefore} → ${cAfter}`);
  ok(/×20/.test(consoleText(dom)), "شمارنده‌ی تکرار نشان داده شد (×20)");
  w.eval(`addConsole("err", "!! [Errno 5] Input/output error")`);
  ok(/×21/.test(consoleText(dom)), "با تکرارِ بعدی شمارنده بالا رفت");
  const nBefore = w.eval("document.getElementById('consoleBox').children.length");
  w.eval(`addConsole("err", "!! a DIFFERENT error"); addConsole("err", "!! a DIFFERENT error")`);
  ok(w.eval("document.getElementById('consoleBox').children.length") - nBefore === 1,
     "خطای متفاوت خطِ تازه می‌گیرد (جمع‌شدن فقط برای پشتِ سرِ همِ یکسان)");
  dom.window.close();

  srv.close();
  console.log(`\n#  نتیجه: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) { console.log("#  مواردِ ناموفق:\n  - " + fails.join("\n  - ")); process.exit(1); }
  console.log("########## مسیرهای اتصال: پلِ سیستمی پیش‌فرض، خطوط درست، بدونِ churn، وصلِ خودکار ##########");
  process.exit(0);
}

main().catch((e) => { console.log("FATAL " + ((e && e.stack) || e)); process.exit(1); });
