#!/usr/bin/env node
/* =====================================================================
 * تولید همه‌ی دستوراتی که GUIها می‌توانند بفرستند.
 *
 * هر دو GUI جدول `Cmd` دارند که رشته‌ی دستور را می‌سازد. این اسکریپت
 * تک‌تک آن‌ها را با آرگومان‌های نمونه صدا می‌زند و خروجی را خط‌به‌خط
 * چاپ می‌کند تا harness فریم‌ور (tools/hosttest) همان رشته‌ها را واقعاً
 * به کد فریم‌ور بدهد.
 *
 * هدف: هیچ دکمه‌ای در GUI دستوری نسازد که فریم‌ور «Unknown command» بدهد.
 *
 *   node tools/gui_cmds.js > build/gui_cmds.txt
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);

const GUIS = [
  { tag: "desktop", file: "desktop-app/renderer/js/core.js" },
  { tag: "web",     file: "gui/js/firmware.js" },
];

/* آرگومان‌های نمونه برای هر سازنده‌ی دستور.
   عددها عمداً داخل محدوده‌ی مجاز انتخاب شده‌اند تا «!!» نگیریم. */
const SAMPLES = {
  homeAxis:    [3],
  enableAxis:  [2],
  disableAxis: [2],
  moveAll:     [[10, 20, 10, 0, 0]],
  deg:         [1, 45],
  move:        [1, 500],
  savePos:     [0],
  loadPos:     [0],
  clearPos:    [0],
  timer:       [5000, 1, 30],
  profile:     ["fast"],
  ik:          [100, 50, 50],
  fk:          [[10, 20, 30, 0, 0]],
  autoSleep:   [true],
};

function loadCmd(file) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  /* eslint-disable-next-line no-new-func */
  return new Function(src + "\nreturn Cmd;")();
}

let count = 0;
const problems = [];

for (const gui of GUIS) {
  let Cmd;
  try {
    Cmd = loadCmd(gui.file);
  } catch (e) {
    problems.push(`${gui.tag}: cannot load ${gui.file} -> ${e.message}`);
    continue;
  }
  process.stderr.write(`# ${gui.tag}: ${Object.keys(Cmd).length} command builder(s)\n`);

  for (const [name, fn] of Object.entries(Cmd)) {
    if (typeof fn !== "function") continue;
    const args = SAMPLES[name] || [];
    if (args.length < fn.length) {
      problems.push(`${gui.tag}: Cmd.${name} needs ${fn.length} arg(s) but the sample has ${args.length}`);
      continue;
    }
    let text;
    try {
      text = fn(...args);
    } catch (e) {
      problems.push(`${gui.tag}: Cmd.${name} threw ${e.message}`);
      continue;
    }
    if (typeof text !== "string" || !text.trim()) {
      problems.push(`${gui.tag}: Cmd.${name} produced an empty command`);
      continue;
    }
    if (/\s$/.test(text)) problems.push(`${gui.tag}: Cmd.${name} produced a trailing space: "${text}"`);
    if (/\bundefined\b|\bNaN\b|\bnull\b/.test(text)) {
      problems.push(`${gui.tag}: Cmd.${name} produced "${text}" (undefined/NaN/null inside)`);
    }
    process.stdout.write(text.trim() + "\n");
    count++;
  }
}

process.stderr.write(`# ${count} command(s) generated, ${problems.length} problem(s)\n`);
for (const p of problems) process.stderr.write("!! " + p + "\n");
process.exit(problems.length ? 1 : 0);
