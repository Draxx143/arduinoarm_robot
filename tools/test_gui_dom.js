#!/usr/bin/env node
/* ============================================================
 * تست DOM واقعیِ GUI — با jsdom صفحه‌ی واقعی بارگذاری می‌شود و
 * شبیه‌سازِ خودِ GUI کار می‌کند. سه چیزی را بررسی می‌کند که با
 * تست‌های متنی نمی‌شود دید:
 *
 *  ۱) چیدمانِ ردیفِ اسلایدر: دقیقاً ۴ فرزند (نام | اسلایدر | کادر
 *     عدد | دکمه‌ها) و **هیچ گره‌ی متنیِ ولگرد**. یک کامنتِ JS که
 *     اشتباهی داخلِ رشته‌ی HTML جا بیفتد، در گرید یک ستونِ ضمنی
 *     می‌سازد و اسلایدر را له می‌کند — همین‌جا گیر می‌افتد.
 *  ۲) کنسولِ سریال: پاسخِ پرسش‌های خودکار (status + pos) چاپ نشود،
 *     ولی همان دستور که **کاربر خودش** تایپ کند یک بار کامل چاپ شود.
 *  ۳) اسلایدرها موقعیتِ گزارش‌شده‌ی برد را دنبال کنند (کانال POS).
 *
 * هر دو GUI بررسی می‌شوند: وب (gui/) و اپ دسکتاپ (desktop-app/).
 *
 * اجرا:   node tools/test_gui_dom.js
 * نیاز:   jsdom   →  npm install jsdom   (اگر نباشد تست SKIP می‌شود)
 * ============================================================ */
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "..");

/* ---------- jsdom را از هر جایی که نصب است پیدا کن ---------- */
function findJsdom() {
  const candidates = [
    path.join(ROOT, "node_modules"),
    path.join(ROOT, "tools", "node_modules"),
    path.join(process.env.HOME || "/root", "guitest", "node_modules"),
    path.join(process.env.HOME || "/root", "node_modules"),
  ];
  for (const base of candidates) {
    try {
      const req = createRequire(path.join(base, "_x.js"));
      return req("jsdom");
    } catch (e) { /* بعدی */ }
  }
  try { return require("jsdom"); } catch (e) { return null; }
}

const jsdom = findJsdom();
if (!jsdom) {
  console.log("  jsdom نصب نیست — این تست SKIP شد (npm install jsdom)");
  console.log("  ⚠ نکته: بدون jsdom، چیدمان و رفتار کنسول فقط چشمی بررسی می‌شود.");
  process.exit(0);
}
const { JSDOM, VirtualConsole } = jsdom;

/* ---------- سرور ایستای کوچک (تا تست به سرورِ پیش‌نمایش نیاز نداشته باشد) ---------- */
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

/* ---------- شمارنده‌ی تست ---------- */
let PASS = 0, FAIL = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { PASS++; console.log("  ✔ " + msg); }
  else { FAIL++; fails.push(msg); console.log("  ✘ " + msg); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- بارگذاری یک GUI ---------- */
async function loadGui(port, page) {
  const vc = new VirtualConsole();          /* نویزِ فونتِ CDN و css بیرونی گرفته شود */
  const dom = await JSDOM.fromURL(`http://127.0.0.1:${port}/${page}`, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      /* canvas در jsdom پیاده نشده. بدل باید **هر** ترکیبی را بدون استثنا
         تحمل کند (گرادیان، measureText، زنجیره‌ها) — وگرنه viz.frame()
         استثنا می‌دهد، requestAnimationFrame دیگر زمان‌بندی نمی‌شود و
         sim.tick() می‌ایستد (یعنی کل شبیه‌ساز یخ می‌زند). */
      const f = function () { return A; };
      const A = new Proxy(f, {
        get: (t, k) => (k === Symbol.toPrimitive ? () => 0
                        : k === Symbol.iterator ? function* () {}
                        : k === "length" ? 0
                        : k === "then" ? undefined
                        : A),
        apply: () => A,
        set: () => true,
        has: () => true,
      });
      w.HTMLCanvasElement.prototype.getContext = () => A;
    },
  });
  await sleep(1000);
  return dom;
}

/* متنِ کنسول **با جداکننده‌ی خط** — textContentِ ظرف، خط‌ها را به هم می‌چسباند
   و آن‌وقت /^Axis …/m هرگز جور نمی‌شود. */
function consoleText(dom) {
  return consoleLines(dom).join("\n");
}
function consoleLines(dom) {
  const box = dom.window.document.getElementById("consoleBox");
  return box ? Array.from(box.children).map((d) => d.textContent) : [];
}
const count = (txt, re) => (txt.match(re) || []).length;

/* تایپِ دستور در کنسول، دقیقاً مثلِ کاربر */
function typeCmd(dom, text) {
  const w = dom.window;
  w.document.getElementById("cmdInput").value = text;
  /* تابع‌های سطحِ بالا روی window هستند، ولی «S» با const تعریف شده و
     فقط از scope جهانیِ خودِ صفحه دیده می‌شود → eval. */
  w.eval("sendFromInput()");
}

async function testOneGui(label, port, page, lang) {
  console.log(`\n── ${label} (${page}) ──`);
  const dom = await loadGui(port, page);
  const w = dom.window, doc = w.document;
  const T = lang === "fa"
    ? { stray: "ردیفِ اسلایدر گره‌ی متنیِ ولگرد ندارد (کامنتِ جاافتاده → ستونِ ضمنیِ گرید)",
        four: "هر ردیف دقیقاً ۴ فرزند دارد: نام | اسلایدر | کادر عدد | دکمه‌ها",
        nojval: "عددِ آبیِ jval دیگر در ردیف نیست",
        j5: "ردیفِ J5 آفستِ صفرِ ۹۰+ درجه را نشان می‌دهد",
        quiet: "پاسخِ poll (status و pos) در کنسول چاپ نمی‌شود",
        manualStatus: "«status» دستی یک بار کامل چاپ می‌شود",
        noPosInStatus: "خط POS انتهای بلوکِ status چاپ نمی‌شود",
        manualPos: "«pos» دستی دقیقاً یک خط POS نشان می‌دهد",
        track: "اسلایدر موقعیتِ گزارش‌شده‌ی برد را دنبال می‌کند" }
    : { stray: "slider row has no stray text node (a misplaced comment becomes an implicit grid column)",
        four: "every row has exactly 4 children: name | slider | number box | buttons",
        nojval: "the blue jval number is gone from the row",
        j5: "the J5 row shows the +90° zero offset",
        quiet: "poll replies (status and pos) are never printed to the console",
        manualStatus: "a manual 'status' is printed once, in full",
        noPosInStatus: "the POS line at the end of a status block is not printed",
        manualPos: "a manual 'pos' prints exactly one POS line",
        track: "the slider follows the position the board reports" };

  /* ---- ۱) چیدمان ---- */
  const rows = Array.from(doc.querySelectorAll(".joint-row"));
  ok(rows.length === 5, `${label}: ۵ ردیفِ اسلایدر ساخته شد`);
  let stray = false, wrongCount = [], jval = false;
  rows.forEach((r, i) => {
    if (r.querySelector(".jval")) jval = true;
    if (r.children.length !== 4) wrongCount.push(`row${i + 1}=${r.children.length}`);
    r.childNodes.forEach((n) => { if (n.nodeType === 3 && n.textContent.trim()) stray = true; });
  });
  ok(!stray, T.stray);
  ok(wrongCount.length === 0, `${T.four}${wrongCount.length ? " → " + wrongCount.join(", ") : ""}`);
  ok(!jval, T.nojval);
  ok(/\+\s?90|90°/.test(rows[4].textContent), T.j5);

  /* ---- شبیه‌ساز را روشن کن ---- */
  if (w.eval("S.mode") !== "sim") { w.eval("startSim()"); await sleep(400); }
  ok(w.eval("S.mode") === "sim", `${label}: شبیه‌ساز روشن است`);
  doc.getElementById("selPoll").value = "1500";   /* سریع‌ترین نرخِ poll */
  w.eval("restartPoll()");

  /* ---- ۲) سکوتِ کنسول زیرِ poll ---- */
  await sleep(3600);                              /* ≥۲ بلوکِ status و ~۱۰ خط POS */
  let txt = consoleText(dom);
  const pollEchoes = count(txt, />\s*(status|pos)\s*$/gm);
  ok(count(txt, />>\s*POS/g) === 0 && count(txt, /System Status/g) === 0 &&
     count(txt, /Axis \d:/g) === 0 && pollEchoes === 0,
     `${T.quiet}  (اکوی poll: ${pollEchoes})`);
  /* ولی پردازش شده باشد: وضعیت از داده‌ی poll پر شده */
  ok(w.eval("S.axes.every((a) => typeof a.deg === 'number')"),
     `${label}: poll پردازش می‌شود (موقعیت محورها خوانده شد)`);

  /* ---- ۳) status دستی ---- */
  typeCmd(dom, "status");
  await sleep(900);
  txt = consoleText(dom);
  ok(count(txt, /System Status/g) === 1 && count(txt, /Axis \d:/g) >= 5 &&
     count(txt, />\s*status\s*$/gm) === 1, T.manualStatus);
  ok(count(txt, />>\s*POS/g) === 0, T.noPosInStatus);

  /* ---- ۴) pos دستی ---- */
  typeCmd(dom, "pos");
  await sleep(900);
  txt = consoleText(dom);
  ok(count(txt, />>\s*POS/g) === 1, T.manualPos);

  /* ---- ۵) هومِ تک‌محور → اسلایدر باید صفر شود (خواسته‌ی ۴) ---- */
  typeCmd(dom, "home 1");
  const t0 = Date.now();
  while (Date.now() - t0 < 25000 && w.eval("S.axes[0].homed") !== true) await sleep(250);
  ok(w.eval("S.axes[0].homed") === true, `${label}: محور ۱ در شبیه‌ساز هوم شد`);
  await sleep(1200);                    /* یک poll بعد از هوم */
  const sliderAfterHome = parseFloat(doc.getElementById("jSlider0").value);
  const wantAfterHome = w.eval("S.degMode ? S.axes[0].deg : Kin.degToSteps(0, S.axes[0].deg)");
  ok(Math.abs(wantAfterHome) < 0.05 && Math.abs(sliderAfterHome) < 1.0,
     `${label}: بعد از هوم، اسلایدرِ همان محور روی صفر نشست (${sliderAfterHome})`);

  /* ---- ۶) اسلایدر موقعیتِ برد را دنبال کند (خواسته‌ی ۵) ---- */
  typeCmd(dom, "move 1 400");
  await sleep(3500);                    /* حرکت + یک poll بعد از مکثِ ۹۰۰ms */
  const deg = w.eval("S.axes[0].deg");
  const want = w.eval("S.degMode ? S.axes[0].deg : Kin.degToSteps(0, S.axes[0].deg)");
  const got = parseFloat(doc.getElementById("jSlider0").value);
  ok(Math.abs(deg) > 0.5 && Math.abs(got - want) < 1.0,
     `${T.track}  (برد: ${deg.toFixed(1)}° → اسلایدر: ${got})`);

  /* یک بررسیِ اضافی: کنسول با دستوراتِ دستی پر شده، نه با poll */
  const lines = consoleLines(dom);
  ok(lines.length > 8 && lines.length < 120,
     `${label}: کنسول خوانا ماند (${lines.length} خط بعد از ~۹ ثانیه اتصال)`);

  dom.window.close();
}

(async () => {
  console.log("=== تست DOMِ GUI (jsdom) — چیدمانِ اسلایدر + سکوتِ کنسول + دنبال‌کردنِ موقعیت ===");
  const { srv, port } = await startStatic();
  try {
    await testOneGui("GUI وب", port, "gui/index.html", "fa");
    await testOneGui("اپ دسکتاپ", port, "desktop-app/renderer/index.html", "en");
  } catch (e) {
    FAIL++; fails.push("خطای اجرا: " + e.message);
    console.log("  ✘ خطای اجرا: " + (e.stack || e.message));
  } finally {
    srv.close();
  }
  console.log(`\n#  نتیجه: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) { console.log("#  مواردِ ناموفق:\n  - " + fails.join("\n  - ")); process.exit(1); }
  console.log("########## هر دو GUI: چیدمان درست، کنسول بی‌شلوغی، اسلایدرها همگام ##########");
  process.exit(0);
})();
