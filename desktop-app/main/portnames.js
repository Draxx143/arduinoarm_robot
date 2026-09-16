/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Draxx143 — AXIS-3 Robot Arm
 * https://github.com/Draxx143/arm-3-axis */
/* ============================================================
 * portnames.js — کدام گره را به کاربر نشان بدهیم و کدام را باز کنیم
 *
 * دو مشکلِ واقعیِ «اتصال برقرار نمی‌شود» اینجا حل می‌شود، هر دو بدونِ
 * وابستگی به electron (پس با Nodeِ خالی تست می‌شوند):
 *
 *  ۱) پورت‌های شبحی: node-serialport در لینوکس /dev/ttyS0..ttyS31 را هم
 *     فهرست می‌کند. کاربر «۳۳ دستگاه» می‌دید درحالی‌که یکی واقعی بود و
 *     انتخابِ هر ttyS یعنی «وصل نشد».
 *
 *  ۲) نامِ بی‌ثبات: بعد از هر افتِ USB (EMI) کرنل دستگاه را دوباره
 *     enumerate می‌کند و ممکن است نامش از ttyUSB0 به ttyUSB1 عوض شود.
 *     قاعده‌ی udev پروژه (build/99-axis3-serial.rules) یک symlinkِ ثابت
 *     به نامِ /dev/axis3 می‌سازد؛ اگر وجود داشته باشد، اپ **همان** را باز
 *     می‌کند، پس افتِ USB دیگر اتصال را گم نمی‌کند.
 * ============================================================ */
"use strict";

const fs = require("fs");

/* نامِ ثابتی که قاعده‌ی udev می‌سازد */
const STABLE_NODE = "/dev/axis3";

/**
 * گره‌های واقعی را از شبحی‌ها جدا کن.
 * محافظه‌کارانه: فقط /dev/ttyS* را دور می‌ریزیم، و آن هم فقط وقتی یک گره‌ی
 * USB/بلوتوثِ واقعی هست. هر چیزِ دیگری (cu.usbserial، ttyAMA0، rfcomm،
 * COM3، /dev/axis3) نگه داشته می‌شود تا دستگاهِ واقعیِ کسی از فهرست نیفتد.
 * @param {string[]} names   فهرستِ سطحِ سیستم (ls /dev/…)
 * @param {string[]} [extra] فهرستِ node-serialport
 * @returns {string[]} مرتب و بدونِ تکرار
 */
function pickRealPorts(names, extra) {
  const all = [...new Set([...(names || []), ...(extra || [])]
    .map((x) => String(x || "").trim()).filter(Boolean))];
  const hasUsb = all.some((p) => /tty(USB|ACM)\d|rfcomm\d|^COM\d+$/i.test(p));
  return (hasUsb ? all.filter((p) => !/^\/dev\/ttyS\d+$/.test(p)) : all).sort();
}

/**
 * هدفِ واقعیِ symlinkِ ثابت را بده (یا null اگر وجود ندارد).
 * @param {{existsSync:Function,realpathSync:Function}} [fso] برای تست
 * @param {string} [stable]
 */
function stableTarget(fso, stable) {
  const f = fso || fs;
  const s = stable || STABLE_NODE;
  try {
    if (f.existsSync(s)) return f.realpathSync(s);
  } catch (e) { /* بدو نِ symlink — همان فهرستِ قبلی */ }
  return null;
}

/**
 * در فهرستِ نام‌ها، گره‌ی هدف را با نامِ ثابت جایگزین کن.
 * اگر هدف در فهرست نیست ولی symlink وجود دارد، نامِ ثابت را اول می‌گذاریم
 * (دستگاه ممکن است یک لحظه بینِ افت و برگشت ناپدید شود).
 * @param {string[]} names
 * @param {string|null} target  خروجیِ stableTarget()
 * @param {string} [stable]
 */
function preferStableNode(names, target, stable) {
  const s = stable || STABLE_NODE;
  const list = (names || []).map(String).filter(Boolean);
  if (!target) return list;
  const i = list.indexOf(target);
  if (i !== -1) { const out = list.slice(); out[i] = s; return out; }
  return list.indexOf(s) === -1 ? [s, ...list] : list;
}

/**
 * همان کار برای فهرستِ ساخت‌یافته‌ی پورت‌ها: مدخلِ گره‌ی هدف نامش را به
 * نامِ ثابت عوض می‌کند تا اپ و کاربر هر دو یک چیز را ببینند.
 * @param {Array<{path:string,friendly?:string}>} ports
 * @param {string|null} target
 * @param {string} [stable]
 */
function applyStableName(ports, target, stable) {
  const s = stable || STABLE_NODE;
  const list = Array.isArray(ports) ? ports : [];
  if (!target || target === s) return list;
  let hit = false;
  const out = [];
  for (const p of list) {
    if (!p || !p.path) continue;
    if (p.path === s) { hit = true; out.push(p); continue; }
    if (p.path === target) {
      hit = true;
      out.push({ ...p, path: s, stable: true,
                 friendly: (p.friendly ? p.friendly + " · " : "") + "stable name (survives USB drop-outs)" });
      continue;
    }
    out.push(p);
  }
  if (!hit) out.unshift({ path: s, friendly: "AXIS-3 board (stable name)", stable: true });
  return out;
}

/** آیا این نام یک گره‌ی سریالِ واقعی است؟ (برای reconnect و انتخابِ خودکار) */
function isRealSerialNode(name) {
  return /tty(USB|ACM)\d|rfcomm\d|^COM\d+$|^\/dev\/axis3$/i.test(String(name || "").trim());
}

module.exports = { STABLE_NODE, pickRealPorts, stableTarget, preferStableNode, applyStableName, isRealSerialNode };
