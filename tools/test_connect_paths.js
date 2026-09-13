#!/usr/bin/env node
/* ============================================================
 * تستِ مسیرهای اتصال — «شناسایی می‌شود ولی کامل وصل نمی‌شود»
 *
 * سه چیزی که این تست پین می‌کند، هر سه علتِ واقعیِ RX=0 بوده‌اند:
 *
 *  ۱) مسیرِ وب‌سریال هم باید خطوطِ مودم را کنترل کند. کرومیوم DTR/RTS را
 *     در وضعیتِ پیش‌فرضِ درایور رها می‌کند: بردهای USB بومی بدونِ DTRِ
 *     asserted هر Serial.print را دور می‌ریزند و بردهای Rev3 لبه‌ی ریست
 *     نمی‌گیرند. پالس باید با **هر دو خط هم‌سطح** تمام شود، وگرنه برد در
 *     ریست نگه داشته می‌شود.
 *
 *  ۲) در اپِ دسکتاپ، «اتصال» با کشوی خالی باید از **پلِ سیستمی** برود، نه
 *     از وب‌سریال. قبلاً کاربری که فقط دکمه‌ی اتصال را می‌زد واردِ مسیری
 *     می‌شد که نه پالسِ ریستِ درست داشت، نه عیب‌یاب، نه کاوشِ baud.
 *
 *  ۳) وقتی RX صفر ماند، اپ باید **خودش** نردبانِ baud را برود و اگر برد با
 *     سرعتِ دیگری حرف زد همان‌جا متصل بماند (و کشوی baud را به‌روز کند)؛
 *     و اگر هیچ سرعتی جواب نداد، صریح بگوید برد ساکت است.
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
      const block = "=== System Status ===\nState: Ready\nFW: v1.0.41\n" +
        "Homed: J1[ok] J2[ok] J3[ok] J4[ok] J5[ok]\n======================\n" +
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
    portHolders: async () => ({ pids: [], procs: [] }),
    portProbe: async () => ({ bytes: 0, sample: "" }),
    portDoctor: async () => ({ port: "/dev/ttyUSB0", baud: 115200,
      checks: [{ name: "rx", ok: false, detail: "0 byte(s)", fix: "check the board" }] }),
    /* اسکنر: برد روی ttyUSB1 است نه ttyUSB0 — همان چیزی که هیچ حدسی
       پیدایش نمی‌کند و فقط امتحانِ همه‌ی گره‌ها پیدایش می‌کند */
    portFind: async () => {
      board.findCalls = (board.findCalls || 0) + 1;
      return {
        ports: ["/dev/ttyUSB0", "/dev/ttyUSB1"],
        found: { port: "/dev/ttyUSB1", baud: 115200, firmware: "1.0.41",
                 sample: "AXIS-5 Firmware v1.0.41" },
        tried: [{ port: "/dev/ttyUSB0", baud: 115200, bytes: 0, known: false },
                { port: "/dev/ttyUSB1", baud: 115200, bytes: 120, known: true }],
        stopped: false,
      };
    },
    portFindStop: () => {},
    onFindLog: (cb) => { board.findLog = cb; },
    listSystemPorts: async () => ["/dev/ttyUSB0"],
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
                           (!board.realBaud || board.realBaud === Number(baud));
        if (rightSpeed) setTimeout(() => board.reply(), 30);
        else if (board.garbage) setTimeout(() => board.replyGarbage(), 30);
        return { id: 1000001 };
      },
      write: async (id, text) => {
        board.written.push(String(text));
        const last = board.opened[board.opened.length - 1] || {};
        if (board.realBaud && board.realBaud !== Number(last.baud)) {
          if (board.garbage) board.replyGarbage();
        } else if (!board.onlyBaud || board.onlyBaud === Number(last.baud)) {
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
  ok(/1\.0\.41/.test(consoleText(dom)) || w.eval("S.serial.rxCount") > 0,
     "پاسخِ برد (نسخه‌ی فریم‌ور) در اپ دیده شد");
  ok(w.eval("typeof autoPickPort") === "function", "autoPickPort وجود دارد (انتخابِ خودکارِ پورت)");

  /* ---------- ۳) برد فقط با ۹۶۰۰ حرف می‌زند → نردبانِ baud ---------- */
  console.log("\n-- RX=0 چون فریم‌ور روی ۹۶۰۰ است: بازیابیِ خودکار --");
  const board2 = makeBoard();
  board2.onlyBaud = 9600;
  dom = await loadApp(port, board2);
  w = dom.window;
  /* نردبان را کوتاه کن تا تست سریع بماند (آرایه const است، ولی محتوایش نه) */
  w.eval("BAUD_LADDER.splice(0, BAUD_LADDER.length, 9600)");
  w.document.getElementById("hdrPort").value = "/dev/ttyUSB0";
  w.document.getElementById("selBaud").value = "115200";
  await w.eval("connectSystemPort('/dev/ttyUSB0')");
  await sleep(600);
  ok(board2.opened[0] && board2.opened[0].baud === 115200, "اول با ۱۱۵۲۰۰ وصل شد");
  ok(w.eval("S.serial.rxCount") === 0, "RX صفر ماند — دقیقاً همان علامتِ کاربر",
     "rxCount=" + w.eval("S.serial.rxCount"));
  const fixed = await w.eval("autoRecoverRx()");
  await sleep(300);
  ok(fixed === true, "نردبانِ baud برد را پیدا کرد و متصل ماند");
  ok(board2.opened.some((o) => o.baud === 9600), "با ۹۶۰۰ هم امتحان کرد",
     JSON.stringify(board2.opened.map((o) => o.baud)));
  ok(w.eval("S.serial.rxCount") > 0, "بعد از بازیابی RX > 0 است");
  ok(w.document.getElementById("selBaud").value === "9600",
     "کشوی baud به ۹۶۰۰ به‌روز شد (کاربر دفعه‌ی بعد درست وصل می‌شود)",
     "value=" + w.document.getElementById("selBaud").value);
  ok(/answers at 9600|۹۶۰۰/.test(consoleText(dom)), "در کنسول گفته شد برد با ۹۶۰۰ جواب می‌دهد");
  dom.window.close();

  /* ---------- ۴) بردِ کاملاً ساکت ---------- */
  console.log("\n-- بردی که در هیچ baud ای حرف نمی‌زند --");
  const board3 = makeBoard();
  board3.onlyBaud = -1;                    /* هیچ‌وقت جواب نمی‌دهد */
  dom = await loadApp(port, board3);
  w = dom.window;
  w.eval("BAUD_LADDER.splice(0, BAUD_LADDER.length, 9600, 57600)");
  w.document.getElementById("selBaud").value = "115200";
  await w.eval("connectSystemPort('/dev/ttyUSB0')");
  await sleep(500);
  const fixed3 = await w.eval("autoRecoverRx()");
  await sleep(400);
  ok(fixed3 === false, "گزارش داد که بازیابی موفق نبود");
  ok(board3.opened.filter((o) => o.baud === 115200).length >= 2,
     "در پایان به baudِ اولیه برگشت (اتصالِ کاربر را خراب رها نمی‌کند)",
     JSON.stringify(board3.opened.map((o) => o.baud)));
  ok(/NOTHING at any baud|silent|ساکت/.test(consoleText(dom)),
     "صریحاً گفت برد در هیچ سرعتی چیزی نفرستاد (نه یک پیامِ مبهم)");
  ok(w.eval("S.mode") === "serial", "اپ هنوز در وضعیتِ اتصال است تا کاربر بتواند عیب‌یاب را ببیند");
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

  /* ---------- ۶) نردبان باید آشغال را نپذیرد ---------- */
  console.log("\n-- نردبانِ baud: آشغال را رد کند، سرعتِ درست را بپذیرد --");
  const board5 = makeBoard();
  board5.realBaud = 57600; board5.garbage = true;
  dom = await loadApp(port, board5);
  w = dom.window;
  w.eval("BAUD_LADDER.splice(0, BAUD_LADDER.length, 9600, 57600)");
  w.document.getElementById("selBaud").value = "115200";
  await w.eval("connectSystemPort('/dev/ttyUSB0')");
  await sleep(500);
  ok(w.eval("S.serial.rxCount") > 0 && w.eval("S._sawBoardText") === false,
     "در ۱۱۵۲۰۰ فقط آشغال می‌آید");
  const fixed5 = await w.eval("autoRecoverRx()");
  await sleep(300);
  ok(fixed5 === true, "نردبان سرعتِ درست را پیدا کرد و متصل ماند");
  ok(w.eval("S.serial.baud") === 57600, "روی ۵۷۶۰۰ ماند (نه ۹۶۰۰ که آشغال می‌داد)",
     "baud=" + w.eval("S.serial.baud"));
  ok(w.document.getElementById("selBaud").value === "57600", "کشوی baud به‌روز شد");
  ok(/UNREADABLE/.test(consoleText(dom)),
     "در کنسول صریح گفت که بایتِ ۹۶۰۰ خوانا نبود");
  ok(/Press the RESET button/.test(consoleText(dom)),
     "از کاربر خواست دکمه‌ی RESET را بزند (بردهای بدونِ ریستِ خودکار)");
  dom.window.close();

  /* ---------- ۷) 🔍 برد را پیدا کن: برد روی گره‌ی دیگری است ---------- */
  console.log("\n-- 🔍 Find board: برد روی /dev/ttyUSB1 است، نه ttyUSB0 --");
  const board6 = makeBoard();
  dom = await loadApp(port, board6);
  w = dom.window;
  ok(w.document.getElementById("btnFind") !== null, "دکمه‌ی «🔍 Find board» در هدر هست");
  ok(w.eval("typeof findMyBoard") === "function", "findMyBoard وجود دارد");
  w.document.getElementById("selBaud").value = "19200";
  await w.eval("findMyBoard()");
  await sleep(600);
  ok(board6.findCalls === 1, "اسکنر از راهِ IPC صدا شد");
  ok(/FIND\] ✓ the board is \/dev\/ttyUSB1 @ 115200/.test(consoleText(dom)),
     "در کنسول گفت برد کجاست و با چه سرعتی");
  ok(board6.opened.some((o) => o.path === "/dev/ttyUSB1" && o.baud === 115200),
     "بعدش روی همان گره و سرعت وصل شد", JSON.stringify(board6.opened));
  ok(w.eval("S.mode") === "serial", "اتصال برقرار شد");
  ok(w.document.getElementById("selBaud").value === "115200",
     "کشوی baud از ۱۹۲۰۰ به ۱۱۵۲۰۰ برگشت", w.document.getElementById("selBaud").value);
  ok(w.eval("S._finding") === false, "پرچمِ اسکن بعد از پایان پاک شد (دکمه دوباره کار می‌کند)");
  ok(w.document.getElementById("btnFind").textContent.indexOf("Find board") !== -1,
     "برچسبِ دکمه از «scanning…» به حالِ اول برگشت");

  /* ---------- ۸) قفلِ هم‌زمانی: کلیکِ دوم وسطِ بازیابی ---------- */
  console.log("\n-- کلیکِ دوباره‌ی «اتصال» وسطِ بازیابی (دو خواننده روی یک پورت) --");
  await w.eval("S.serial.disconnect()");      /* قفل باید وقتی هنوز متصل نیستیم دیده شود */
  await sleep(250);
  const before = board6.opened.length;
  w.eval("S._recovering = true");
  await w.eval("connectSystemPort('/dev/ttyUSB0')");
  await sleep(300);
  ok(board6.opened.length === before, "نشستِ دومی باز نشد (بایت‌ها دزدیده نمی‌شوند)",
     `${before} → ${board6.opened.length}`);
  ok(/busy/i.test(consoleText(dom)), "به کاربر گفت اپ مشغول است");
  w.eval("S._recovering = false");

  srv.close();
  console.log(`\n#  نتیجه: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) { console.log("#  مواردِ ناموفق:\n  - " + fails.join("\n  - ")); process.exit(1); }
  console.log("########## مسیرهای اتصال: پلِ سیستمی پیش‌فرض، خطوط درست، بازیابیِ baud ##########");
  process.exit(0);
}

main().catch((e) => { console.log("FATAL " + ((e && e.stack) || e)); process.exit(1); });
