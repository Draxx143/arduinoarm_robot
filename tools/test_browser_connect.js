#!/usr/bin/env node
/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
 * https://github.com/Draxx143/arduinoarm_robot */
/* ============================================================
 * تستِ مسیرِ اتصالِ **GUI مرورگر** (gui/index.html + Web Serial)
 *
 * چرا جدا از test_connect_paths.js؟ آن فایل اپِ دسکتاپ را با یک
 * electronAPIِ ساختگی می‌سنجد؛ این فایل همان کاری را با خودِ مرورگر
 * می‌کند — جایی که Web Serial مستقیم استفاده می‌شود. گزارشِ کاربر
 * («آردوینو به نرم‌افزار وصل نمی‌شود») از همین‌جا می‌آمد: سه مسیرِ
 * اتصالِ پروژه (پلِ پایتون، وب‌سریالِ اپِ دسکتاپ، وب‌سریالِ مرورگر)
 * باید **یکسان** رفتار کنند وگرنه همان برد با یک GUI وصل می‌شود و با
 * دیگری نه.
 *
 * چیزی که این تست پین می‌کند:
 *  ۱) وب‌سریالِ مرورگر هم خطوطِ مودم را می‌زند: پالسِ DTR/RTS با پایانِ
 *     هم‌سطح. بدونِ آن، بردهای Rev3 لبه‌ی ریست نمی‌گیرند (بنرِ بوت و
 *     نسخه‌ی فریم‌ور هرگز نمی‌آید) و بردهای USB بومی هر Serial.print را
 *     بی‌صدا دور می‌ریزند → RX = 0.
 *  ۲) بردی که **فقط بعد از ریست** حرف می‌زند واقعاً دیده می‌شود: بنرِ بوت
 *     → نسخه‌ی فریم‌ور در GUI. و دو سلام فرستاده می‌شود (۶۰۰ms و ۳۰۰۰ms)
 *     چون سلامِ اول را خودِ بوت‌لودر می‌خورد.
 *  ۳) هندلرِ onConnect که استثنا می‌دهد نباید اتصال را کور کند: حلقه‌ی
 *     خواندن **پیش از** آن شروع می‌شود (وگرنه پورت باز می‌ماند، RX صفر،
 *     UI روی «متصل» — بی‌صدا برای همیشه).
 *  ۴) setAckUI دیگر بلوک‌های راه‌اندازیِ کنسول (جداکننده/پنجره‌ی آزاد) را
 *     در بدنه‌ی خودش نمی‌بلعد: آن‌ها یک بار در زمانِ بارگذاری اجرا می‌شوند
 *     و با هر اتصال listenerِ تکراری ثبت نمی‌شود.
 *  ۵) بردِ ساکت: **یک بار** عیب‌یابیِ روشن، بدونِ باز و بسته کردنِ پورت.
 *     بایتِ بی‌معنی = باودریتِ غلط، نه بردِ خراب.
 *
 * اجرا: cd tools && npm install jsdom && node test_browser_connect.js
 * ============================================================ */
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { createRequire } = require("module");
const { ReadableStream, WritableStream } = require("node:stream/web");

const ROOT = path.resolve(__dirname, "..");
const PAGE = "gui/index.html";

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

/* ---------- «بردِ ساختگی» روی Web Serial --------------------------------
   مثلِ Mega واقعی: تا پالسِ ریست نخورده ساکت است؛ بعد از آن بنرِ بوت را
   می‌فرستد و به status جواب می‌دهد. با silent=true هیچ‌وقت جواب نمی‌دهد
   (علامتِ «وصل نمی‌شود»)، با garbage=true بایتِ بی‌معنی می‌دهد (باودریتِ
   غلط). */
function makeBoard(opt) {
  const o = opt || {};
  const state = { signals: [], opened: [], written: [], closed: 0, resetSeen: false, rxSent: 0 };
  let push = null;
  const readable = new ReadableStream({
    start: (c) => {
      push = (s) => { c.enqueue(new TextEncoder().encode(s)); state.rxSent += s.length; };
    },
  });
  const banner = "======================================\n" +
                 "5 DOF Robot Arm - TEST MODE (No ROS)\n" +
                 "AXIS-5 Firmware v1.0.41\n" +
                 "======================================\n" +
                 "System initialized.\n" +
                 "======================================\n";
  const statusBlock = "=== System Status ===\nState: Ready\nFW: v1.0.41\n" +
                      "Homed: J1[ok] J2[ok] J3[ok] J4[ok] J5[ok]\n======================\n" +
                      ">> POS 0.0,0.0,0.0,0.0,0.0\n";
  /* بایتِ بی‌معنی: همان چیزی که با سرعتِ غلط روی سیم است. هیچ نشانه‌ی
     فریم‌وری ندارد — بردی که با baudِ غلط حرف می‌زند حتی بنرش خوانا نیست. */
  const garbageBytes = "\u00c3\ufffd\u00a0\u0007\u0013\u00c9\u00be\u0044\u00e2\u0010\u00f8\u007f";
  const board = {
    state,
    /* دقیقاً مثلِ بردِ واقعی: فقط بعد از لبه‌ی ریست حرف می‌زند */
    bootIfNeeded() {
      if (o.silent || state.resetSeen) return;
      state.resetSeen = true;
      setTimeout(() => push(o.garbage ? garbageBytes : banner), 30);
    },
    reply() {
      if (o.silent) return;
      if (o.garbage) { push(garbageBytes); return; }
      if (!state.resetSeen) return;         /* هنوز بالا نیامده */
      push(statusBlock);
    },
  };
  const port = {
    getInfo() { return { usbVendorId: 0x2341, usbProductId: 0x0042 }; },
    async open(opts) { state.opened.push({ baud: Number(opts && opts.baudRate) }); },
    async close() { state.closed++; },
    async setSignals(s) {
      state.signals.push({ dtr: !!s.dataTerminalReady, rts: !!s.requestToSend });
      /* لبه‌ی ریستِ Rev3: DTR و RTS در سطحِ متفاوت → RESET پایین */
      if (!!s.dataTerminalReady !== !!s.requestToSend) board.bootIfNeeded();
    },
    get readable() { return readable; },
    get writable() {
      return new WritableStream({ write(chunk) {
        const t = new TextDecoder().decode(chunk);
        state.written.push(t);
        (state.writtenAt = state.writtenAt || []).push(Date.now());
        if (/^\s*status\b/.test(t)) board.reply();
      } });
    },
  };
  return { port, board, push: (s) => push(s) };
}

/* ---------- بارگذاریِ GUI مرورگر با navigator.serialِ ساختگی ---------- */
async function loadGui(httpPort, opt) {
  const { port, board, push } = makeBoard(opt);
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});           /* نویزِ فونت/canvas بیرونی */
  const dom = await JSDOM.fromURL(`http://127.0.0.1:${httpPort}/${PAGE}`, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      const f = function () { return A; };
      const A = new Proxy(f, {
        get: (t, k) => (k === Symbol.toPrimitive ? () => 0
                        : k === Symbol.iterator ? function* () {}
                        : k === "length" ? 0 : k === "then" ? undefined : A),
        apply: () => A, set: () => true, has: () => true,
      });
      w.HTMLCanvasElement.prototype.getContext = () => A;
      Object.defineProperty(w.navigator, "serial", {
        configurable: true,
        value: { requestPort: async () => port, getPorts: async () => [port] },
      });
      /* شبیه‌سازِ خودکار خاموش بماند تا تست فقط مسیرِ سریال را بسنجد */
      try { w.localStorage.setItem("arm_prefer_hw", "1"); } catch (e) {}
      /* تعدادِ listenerِ جداکننده‌ی کنسول: تنها راهِ دیدنِ اینکه بلوکِ
         راه‌اندازی واقعاً در زمانِ بارگذاری اجرا شده یا نه */
      w.__split = {};
      const orig = w.Element.prototype.addEventListener;
      w.Element.prototype.addEventListener = function (type, cb, op) {
        if (this.id === "colSplit") w.__split[type] = (w.__split[type] || 0) + 1;
        return orig.call(this, type, cb, op);
      };
    },
  });
  await sleep(1200);
  return { dom, port, board, push };
}

/* پالسِ **واقعیِ** اپِ دسکتاپ: همان فایلِ serial.js روی یک پورتِ ساختگی */
async function loadDesktopPulse(httpPort) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  const dom = await JSDOM.fromURL(`http://127.0.0.1:${httpPort}/desktop-app/renderer/index.html`, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      const f = function () { return A; };
      const A = new Proxy(f, {
        get: (t, k) => (k === Symbol.toPrimitive ? () => 0
                        : k === Symbol.iterator ? function* () {}
                        : k === "length" ? 0 : k === "then" ? undefined : A),
        apply: () => A, set: () => true, has: () => true,
      });
      w.HTMLCanvasElement.prototype.getContext = () => A;
    },
  });
  await sleep(800);
  try {
    return await dom.window.eval(`(async () => {
      const calls = [];
      const fake = { setSignals: async (s) => { calls.push({ dtr: !!s.dataTerminalReady, rts: !!s.requestToSend }); } };
      const link = new SerialLink();
      await link._assertLines(fake);
      return calls;
    })()`);
  } catch (e) {
    return null;
  } finally {
    dom.window.close();
  }
}

const consoleText = (dom) => {
  const box = dom.window.document.getElementById("consoleBox");
  return box ? Array.from(box.children).map((d) => d.textContent).join("\n") : "";
};

async function main() {
  const { srv, port: httpPort } = await startStatic();
  console.log("=== تستِ اتصالِ GUI مرورگر (Web Serial واقعی در jsdom) ===");

  /* ---------- ۱) پالسِ خطوطِ مودم — همان قانونِ پلِ دسکتاپ ---------- */
  console.log("\n-- پالسِ DTR/RTS موقعِ بازکردنِ پورت (لبه‌ی ریستِ برد) --");
  let g = await loadGui(httpPort);
  let w = g.dom.window;
  ok(w.eval("typeof SerialLink") === "function", "SerialLink در صفحه هست");
  ok(w.eval("SerialLink.supported") === true, "Web Serial در دسترس است");
  ok(w.eval("typeof SerialLink.prototype._assertLines") === "function",
     "کنترلِ خطوطِ مودم پیاده‌سازی شده (_assertLines)");
  w.document.getElementById("selBaud").value = "115200";
  await w.eval("toggleSerial()");
  await sleep(600);
  const st = g.board.state;
  ok(st.opened.length === 1, "پورت یک بار باز شد", JSON.stringify(st.opened));
  ok(st.opened[0] && st.opened[0].baud === 115200, "با ۱۱۵۲۰۰ باز شد (سرعتِ خودِ فریم‌ور)");
  ok(st.signals.length >= 3, "setSignals دستِ‌کم سه بار صدا شد (پالسِ چندمرحله‌ای)",
     st.signals.length + " بار");
  const differ = st.signals.filter((c) => c.dtr !== c.rts);
  ok(differ.length >= 1, "یک وضعیتِ «متفاوت» ساخته شد → لبه‌ی ریستِ Rev3");
  const browserPulse = st.signals.slice();      /* برای مقایسه با اپِ دسکتاپ */
  const last = st.signals[st.signals.length - 1] || {};
  ok(last.dtr === last.rts, "وضعیتِ نهایی هم‌سطح است → برد در ریست رها نمی‌شود",
     JSON.stringify(last));
  ok(last.dtr === true, "در پایان DTR asserted است → بردهای USB بومی «میزبان وصل است» را می‌بینند",
     "بدونِ آن Serial.print بی‌صدا دور ریخته می‌شود");
  /* لبه‌ی RISINGِ DTR: تنها تریگرِ ریستِ چیپِ 16U2/32U4 روی Mega 2560.
     فریم‌ورِ CDCِ آن چیپ‌ها «if (!prevDTR && curDTR) ResetTimer=…» است، پس
     پالسی که DTR را پایین نبرد ((۱,۱)→(۱,۰)→(۱,۱)) هیچ لبه‌ی rising نمی‌سازد:
     برد ری‌بوت نمی‌شود، بنری نمی‌فرستد، و در حالی که IDE وصل می‌شود اپ
     ساکت می‌ماند — دقیقاً همان گزارشِ کاربر. */
  const dtrSeq = st.signals.map((c) => c.dtr);
  const rises = dtrSeq.filter((d, i) => i > 0 && !dtrSeq[i - 1] && d).length;
  ok(rises >= 1, "لبه‌ی RISINGِ DTR (۰→۱) وجود دارد — تریگرِ ریستِ Mega 2560 (16U2)",
     "DTR: " + dtrSeq.map((d) => (d ? "1" : "0")).join("→"));
  ok(dtrSeq.indexOf(false) !== -1, "DTR واقعاً یک بار LOW شد (مستقل از وضعیتِ اولیه‌ی کرنل)",
     "DTR: " + dtrSeq.map((d) => (d ? "1" : "0")).join("→"));
  ok(rises === 1, "دقیقاً یک ریست — ریستِ دوم وسطِ بنرِ بوت می‌افتد و متنش را cut می‌کند",
     rises + " لبه‌ی rising");
  ok(w.eval("S.mode") === "serial", "GUI در وضعیتِ اتصال است");
  g.dom.window.close();

  /* ---------- ۲) بردی که فقط بعد از ریست حرف می‌زند ---------- */
  console.log("\n-- بردِ واقعی: بعد از پالسِ ریست بنرِ بوت را می‌فرستد --");
  g = await loadGui(httpPort);
  w = g.dom.window;
  w.document.getElementById("selBaud").value = "115200";
  /* استعلامِ خودکار خاموش: تنها status‌هایی که می‌شماریم همان دو سلامِ
     بعد از اتصال‌اند (poll پیش‌فرض ۳ ثانیه است و با سلامِ دوم قاطی می‌شد) */
  w.document.getElementById("selPoll").value = "0";
  const tOpen = Date.now();
  await w.eval("toggleSerial()");
  await sleep(3800);
  ok(g.board.state.resetSeen === true, "برد لبه‌ی ریست را دید (وگرنه ساکت می‌ماند)");
  ok(w.eval("S.serial.rxCount") > 0, "RX > 0 — بایتِ برد به GUI رسید",
     "rxCount=" + w.eval("S.serial.rxCount"));
  ok(w.eval("S._sawBoardText") === true, "متن به‌عنوانِ حرفِ خودِ فریم‌ور شناخته شد");
  ok(w.eval("S.fwVersion") === w.eval("FW.EXPECTED_FW"),
     "نسخه‌ی فریم‌ور از بنرِ بوت خوانده شد → GUI و برد هم‌نسخه‌اند",
     "fwVersion=" + w.eval("S.fwVersion"));
  const statuses = g.board.state.written.filter((t) => /^\s*status/.test(t));
  ok(statuses.length >= 2, "دو سلام فرستاده شد (۶۰۰ms و ۳۰۰۰ms) — سلامِ اول را بوت‌لودر می‌خورد",
     statuses.length + " بار");
  ok(statuses.length >= 2 && g.board.state.writtenAt &&
     g.board.state.writtenAt[g.board.state.writtenAt.length - 1] - tOpen > 2500,
     "سلامِ دوم **بعد از پنجره‌ی بوت‌لودر** رفت (نه پشتِ سرِ هم با اولی)",
     "آخرین status در " + ((g.board.state.writtenAt || []).slice(-1)[0] - tOpen) + "ms");
  ok(/AXIS-5 Firmware v1\.0\.41/.test(consoleText(g.dom)), "بنرِ بوت در کنسول دیده شد");
  g.dom.window.close();

  /* ---------- ۳) هندلرِ خراب نباید اتصال را کور کند ---------- */
  console.log("\n-- onConnect که استثنا می‌دهد: RX نباید صفر بماند --");
  g = await loadGui(httpPort);
  w = g.dom.window;
  await w.eval(`(async () => {
    S.serial.onConnect = () => { throw new Error("boom in a UI handler"); };
    document.getElementById("selBaud").value = "115200";
    try { await S.serial.connect(115200); } catch (e) { /* هندلر خراب است */ }
  })()`);
  await sleep(300);
  g.push("AXIS-5 Firmware v1.0.41\n");
  await sleep(400);
  ok(w.eval("S.serial.rxCount") > 0,
     "حلقه‌ی خواندن پیش از onConnect شروع می‌شود → داده نمی‌سوزد",
     "rxCount=" + w.eval("S.serial.rxCount"));
  const deskSerial = fs.readFileSync(path.join(ROOT, "desktop-app/renderer/js/serial.js"), "utf8");
  const iLoop = deskSerial.indexOf("this._readLoop();");
  const iConn = deskSerial.indexOf("if (this.onConnect) this.onConnect(this.baud);");
  ok(iLoop !== -1 && iConn !== -1 && iLoop < iConn,
     "اپِ دسکتاپ هم همان ترتیب را دارد (خواندن پیش از خبرِ اتصال)");
  g.dom.window.close();

  /* ---------- ۴) setAckUI دیگر راه‌اندازیِ کنسول را نمی‌بلعد ---------- */
  console.log("\n-- بلوک‌های راه‌اندازیِ کنسول: یک بار، در زمانِ بارگذاری --");
  g = await loadGui(httpPort);
  w = g.dom.window;
  ok((w.__split.pointerdown || 0) === 1,
     "جداکننده‌ی کنسول در زمانِ بارگذاری راه افتاد",
     "pointerdown=" + (w.__split.pointerdown || 0));
  await w.eval("setAckUI(false); setAckUI(true); setAckUI(false);");
  ok((w.__split.pointerdown || 0) === 1,
     "با صداکردنِ setAckUI listenerِ تکراری ثبت نمی‌شود",
     "pointerdown=" + (w.__split.pointerdown || 0));
  ok(w.document.getElementById("btnAck").classList.contains("on") === false,
     "خودِ setAckUI هنوز کارِ خودش را می‌کند (دکمه‌ی ACK)");
  g.dom.window.close();

  /* ---------- ۵) بردِ ساکت: یک عیب‌یابیِ روشن، بدونِ churn ---------- */
  console.log("\n-- بردِ ساکت: RX = 0 و هیچ پاسخ --");
  g = await loadGui(httpPort, { silent: true });
  w = g.dom.window;
  w.document.getElementById("selBaud").value = "115200";
  await w.eval("toggleSerial()");
  await sleep(400);
  ok(w.eval("S.serial.rxCount") === 0, "RX صفر ماند — همان علامتِ کاربر");
  const openedBefore = g.board.state.opened.length;
  w.eval("S._connAt = Date.now() - 7000; updateLinkStats(); updateLinkStats(); updateLinkStats();");
  await sleep(150);
  const diag = (consoleText(g.dom).match(/RX = 0/g) || []).length;
  ok(diag === 1, "عیب‌یابی **یک بار** گفته شد (کنسول پر نمی‌شود)", diag + " بار");
  ok(g.board.state.opened.length === openedBefore,
     "پورت دوباره باز **نشد** (churn روی CH340 خودش افتِ BUS می‌سازد)",
     `${openedBefore} → ${g.board.state.opened.length}`);
  ok(/fuser/.test(consoleText(g.dom)), "خواننده‌ی دومِ پورت را به‌عنوان علتِ اول گفت (sudo fuser)");
  ok(/RESET/.test(consoleText(g.dom)), "زدنِ RESET را گفت (اپ وصل می‌ماند)");
  ok(new RegExp(String(w.eval("FW.BAUD"))).test(consoleText(g.dom)), "باودریتِ درستِ فریم‌ور را گفت");
  ok((w.document.getElementById("portHint").textContent || "").length > 20,
     "راهنما در کارتِ اتصال هم نشست (نه فقط کنسول)");
  ok(w.eval("S.mode") === "serial", "GUI وصل می‌ماند تا کاربر RESET را بزند");
  g.dom.window.close();

  /* ---------- ۶) بایتِ بی‌معنی = باودریتِ غلط، نه بردِ خراب ---------- */
  console.log("\n-- بایت می‌آید ولی بی‌معنی است (سرعتِ غلط) --");
  g = await loadGui(httpPort, { garbage: true });
  w = g.dom.window;
  w.document.getElementById("selBaud").value = "115200";
  await w.eval("toggleSerial()");
  await sleep(500);
  w.eval("S._connAt = Date.now() - 7000; updateLinkStats(); updateLinkStats();");
  await sleep(150);
  ok(w.eval("S.serial.rxCount") > 0, "بایت رسید");
  ok(w.eval("S._sawBoardText") !== true, "هیچ نشانه‌ای از فریم‌ور در آن نبود");
  const baudMsg = (consoleText(g.dom).match(/باودریت غلط/g) || []).length;
  ok(baudMsg === 1, "یک بار گفت باودریت غلط است (نه «برد خراب است»)", baudMsg + " بار");
  g.dom.window.close();

  /* ---------- ۷) دو GUI باید **یکسان** پالس بزنند ----------
     ریشه‌ی گزارشِ کاربر: «ناهماهنگیِ آردوینو و GUI». اگر اپِ دسکتاپ و GUI
     مرورگر پالسِ متفاوتی بزنند، همان برد با یکی وصل می‌شود و با دیگری نه.
     (پلِ پایتون را tools/test_reset_lines.py روی pty واقعی با همان سه
     وضعیت پین می‌کند.) */
  console.log("\n-- یکسان بودنِ پالس در هر دو GUI --");
  g = await loadGui(httpPort, { silent: true });          /* GUI مرورگر */
  const deskPulse = await loadDesktopPulse(httpPort);     /* اپِ دسکتاپ */
  ok(deskPulse !== null, "پالسِ اپِ دسکتاپ گرفته شد");
  ok(JSON.stringify(deskPulse) === JSON.stringify(browserPulse),
     "دنباله‌ی DTR/RTS در مرورگر و اپِ دسکتاپ **یکی** است",
     "مرورگر=" + JSON.stringify(browserPulse) + " دسکتاپ=" + JSON.stringify(deskPulse));
  g.dom.window.close();

  srv.close();
  console.log("\n#  نتیجه: " + PASS + " PASS / " + FAIL + " FAIL");
  if (FAIL) {
    console.log("########## خطاها ##########");
    fails.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
  console.log("########## GUI مرورگر: پالسِ ریست، بنرِ بوت، بدونِ اتصالِ کور ##########");
}

main().catch((e) => { console.error(e); process.exit(1); });
