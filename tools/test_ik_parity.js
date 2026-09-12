#!/usr/bin/env node
/* =====================================================================
 * برابری IK: پیش‌بینی GUI در برابر خروجی واقعی فریم‌ور.
 *
 * بخش «برو به مختصات» در GUI زوایا را با Kin.ik حل می‌کند و بعد همان
 * مختصات را با «ik x y z» به برد می‌فرستد. اگر این دو مدل حتی کمی فرق
 * داشته باشند، کاربر عددی را می‌بیند که برد انجام نمی‌دهد (دقیقاً همان
 * باگی که قبلاً بود: GUI ساعد مؤثر را L2+L3 می‌گرفت و فریم‌ور L2، و برای
 * هدف‌های دور «nan» تولید می‌شد).
 *
 * این تست همان نقطه‌ها را به باینری کامپایل‌شده‌ی فریم‌ور می‌دهد، خط
 * «>> IK solution: ...» را می‌خواند و با Kin.ik هر دو GUI مقایسه می‌کند.
 *
 *   node tools/test_ik_parity.js [path/to/firmware-binary]
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.dirname(__dirname);
const BIN = process.argv[2] || path.join(ROOT, "tools/hosttest/build/firmware");

const PTS = [
  [230, 0, 60], [245, 20, 10], [250, 0, 0], [210, 0, 30],
  [150, 0, 80], [60, 0, 20], [260, 0, 0], [240, -30, 40], [225, 15, 90],
];

function loadKin(file) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  /* eslint-disable-next-line no-new-func */
  return new Function(src + "\nreturn { Kin: Kin, FW: FW };")();
}

const GUIS = [
  { tag: "gui وب  ", file: "gui/js/firmware.js" },
  { tag: "desktop", file: "desktop-app/renderer/js/core.js" },
];

if (!fs.existsSync(BIN)) {
  console.error("!! باینری فریم‌ور پیدا نشد: " + BIN);
  console.error("   اول tools/hosttest/run_tests.sh را اجرا کن.");
  process.exit(2);
}

// ---- ۱) همان نقطه‌ها به فریم‌ور واقعی ----
const cmds = PTS.map((p) => `ik ${p[0]} ${p[1]} ${p[2]}`).join("\n") + "\n";
const tmp = path.join(ROOT, "tools/hosttest/build/ik_parity.txt");
fs.writeFileSync(tmp, cmds);
let out;
try {
  out = execFileSync(BIN, [tmp], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
} catch (e) {
  out = (e.stdout || "") + (e.stderr || "");
}

const fw = {};
/* خروجی را به بلوکِ هر دستور تقسیم کن: هر بلوک با «> ik ...» شروع می‌شود
   (اکوی تک‌`>` — خط‌های «>>» جواب‌اند و مرز بلوک نیستند). اگر یک‌جا همه‌ی
   خروجی را با یک regex چندخطی بگیریم، جوابِ دستور بعدی به حسابِ دستور
   قبلی که پاسخی نگرفته نوشته می‌شود. */
for (const block of out.split(/^> /m).slice(1)) {
  const head = block.split("\n")[0].trim();
  const mm = /^ik (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/.exec(head);
  if (!mm) continue;
  const key = `${mm[1]},${mm[2]},${mm[3]}`;
  const sol = /^>> IK solution: (.*)$/m.exec(block);
  if (sol) {
    fw[key] = sol[1].split(",").map((t) => parseFloat(t.replace("°", "").trim()));
  } else if (/^!! Position out of reach/m.test(block)) {
    fw[key] = null;                      /* فریم‌ور هم خارج از دسترس دانست */
  } else {
    fw[key] = undefined;                 /* هیچ پاسخی نگرفتیم */
  }
}

let fail = 0;
console.log("برابری IK — GUI در برابر فریم‌ورِ کامپایل‌شده");
console.log("نقطه (mm)        فریم‌ور                         " + GUIS.map((g) => g.tag).join("  "));
console.log("-".repeat(96));

for (const gui of GUIS) {
  const { Kin, FW } = loadKin(gui.file);
  for (const p of PTS) {
    const key = `${p[0]},${p[1]},${p[2]}`;
    const got = fw[key];
    const mine = Kin.ik(p[0], p[1], p[2]);
    const pad = `(${p[0]},${p[1]},${p[2]})`.padEnd(16);
    if (got === undefined) {
      console.log(`${gui.tag} ${pad} !! فریم‌ور اصلاً پاسخ نداد`);
      fail++; continue;
    }
    if (got === null && mine === null) {
      console.log(`${gui.tag} ${pad} هر دو: خارج از دسترس ✔`);
      continue;
    }
    if ((got === null) !== (mine === null)) {
      console.log(`${gui.tag} ${pad} ✖ اختلاف: فریم‌ور ${got ? "حل کرد" : "رد کرد"} / GUI ${mine ? "حل کرد" : "رد کرد"}`);
      fail++; continue;
    }
    if (got.some((v) => !isFinite(v)) || mine.some((v) => !isFinite(v))) {
      console.log(`${gui.tag} ${pad} ✖ nan/Infinity  فریم‌ور=[${got}]  GUI=[${mine.map((x) => x.toFixed(1))}]`);
      fail++; continue;
    }
    let maxErr = 0;
    for (let i = 0; i < 5; i++) maxErr = Math.max(maxErr, Math.abs(got[i] - mine[i]));
    const ok = maxErr <= 0.11;      /* فریم‌ور یک رقم اعشار چاپ می‌کند */
    if (!ok) fail++;
    console.log(`${gui.tag} ${pad} ${ok ? "✔" : "✖"} بیشترین اختلاف = ${maxErr.toFixed(3)}°   ` +
      `fr=[${got.map((x) => x.toFixed(1))}]  gui=[${mine.map((x) => x.toFixed(1))}]`);
  }
}

console.log("-".repeat(96));
if (fail) {
  console.log(`✖ ${fail} مورد اختلاف بین GUI و فریم‌ور`);
  process.exit(1);
}
console.log("✔ همه‌ی نقطه‌ها: پیش‌محاسبه‌ی GUI = خروجی فریم‌ور (بدون nan)");
