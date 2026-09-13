/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
 * https://github.com/Draxx143/arduinoarm_robot
/* ============================================================
 * scan.js — «برد را پیدا کن»
 *
 * چرا: کاربرِ ما لاگی داد که در آن همه‌چیز سبز است (python3 ✓، dialout ✓،
 * گره‌ی دستگاه ✓، مجوز ✓، خواننده‌ی دوم ✗) ولی در **هیچ** سرعتی یک بایت
 * هم نمی‌آید. در این حالت حدس زدن فایده ندارد: باید همه‌ی گره‌های واقعیِ
 * سریال را یکی‌یکی باز کرد، دستور فرستاد و گوش داد. برد ممکن است روی
 * ttyUSB1 باشد نه ttyUSB0 (بعضی بردها دو رابطِ سریال می‌سازند)، یا روی
 * یک مبدلِ USB-سریال که به ماژولِ بلوتوث وصل است، یا اصلاً سرعتش با
 * چیزی که در کشو انتخاب شده یکی نباشد.
 *
 * این ماژول عمداً به electron وابسته نیست (مثلِ doctor.js) تا با Nodeِ
 * خالی روی بردِ جعلی قابلِ تست باشد: tools/test_scan.js
 * ============================================================ */
"use strict";

const { scoreText } = require("./doctor.js");

const nap = (ms) => new Promise((r) => setTimeout(r, ms));

/* گره‌های واقعی در برابر پورت‌های شبحی.
 * node-serialport در لینوکس همه‌ی /dev/ttyS0..ttyS31 را هم فهرست می‌کند —
 * پورت‌های مادربرد که اصلاً وجود خارجی ندارند. کاربرِ ما ۳۳ «دستگاه» می‌دید
 * درحالی‌که فقط یکی واقعی بود. اگر حتی یک گره‌ی USB/بلوتوث هست، ttyS* را
 * دور بریز؛ وگرنه (مثلاً رزبری‌پای با UARTِ روی هدر) نگهشان دار. */
function pickRealPorts(names, extra) {
  const all = [...new Set([...(names || []), ...(extra || [])]
    .map((x) => String(x || "").trim()).filter(Boolean))];
  /* محافظه‌کارانه: فقط ttyS* را دور بریز (و آن هم فقط وقتی یک گره‌ی USB/
     بلوتوثِ واقعی هست). هر چیزِ دیگری — cu.usbserial، ttyAMA0، rfcomm —
     نگه داشته می‌شود تا دستگاهِ واقعیِ کسی از فهرست نیفتد. */
  const hasUsb = all.some((p) => /tty(USB|ACM)\d|rfcomm\d|^COM\d+$/i.test(p));
  return (hasUsb ? all.filter((p) => !/^\/dev\/ttyS\d+$/.test(p)) : all).sort();
}

/**
 * همه‌ی (گره × سرعت)های محتمل را امتحان کن تا برد حرف بزند.
 * @param {object} o
 * @param {object} o.pybridge        ماژولِ پل (desktop-app/main/pybridge.js)
 * @param {string[]} o.ports         گره‌های نامزد (خروجیِ pickRealPorts)
 * @param {number[]} [o.bauds]
 * @param {number} [o.perTryMs]      چقدر بعد از «status» گوش بدهیم
 * @param {number} [o.settleMs]      مکث بعد از بستن، تا پورت واقعاً رها شود
 * @param {(line:string)=>void} [o.log]  گزارشِ زنده به کنسولِ اپ
 * @param {()=>boolean} [o.shouldStop]   لغو از طرفِ کاربر
 * @param {Function} [o.openBridge]  برای تست: بدلِ pybridge.openBridge
 * @returns {Promise<{found:object|null,tried:Array,stopped:boolean}>}
 */
async function findBoard(o) {
  const bauds = (Array.isArray(o.bauds) && o.bauds.length)
    ? o.bauds : [115200, 9600, 57600, 38400, 19200];
  const ports = (Array.isArray(o.ports) ? o.ports : []).filter(Boolean);
  const perTryMs = Number(o.perTryMs) || 1500;
  const settleMs = Number(o.settleMs) || 300;
  const log = typeof o.log === "function" ? o.log : () => {};
  const shouldStop = typeof o.shouldStop === "function" ? o.shouldStop : () => false;
  const bridge = o.pybridge || null;
  const tried = [];
  let found = null;
  let stopped = false;

  if (!ports.length) {
    log("no candidate serial device found — is the USB cable plugged in?");
    return { found: null, tried, stopped, note: "no candidate device" };
  }

  for (const p of ports) {
    for (const b of bauds) {
      if (shouldStop()) { stopped = true; log("scan stopped"); return { found, tried, stopped }; }
      const rx = [];
      let res;
      try {
        res = await bridge.openBridge({
          portPath: p, baud: b, timeoutMs: 4000,
          send: (ch, payload) => {
            if (ch === "serialport:data") {
              try { rx.push(Buffer.from(payload, "base64").toString("utf8")); } catch (e) {}
            }
          },
        });
      } catch (er) {
        tried.push({ port: p, baud: b, bytes: 0, err: String((er && er.message) || er) });
        log(`  ✗ ${p} @ ${b}: ${String((er && er.message) || er).slice(0, 90)}`);
        continue;
      }
      if (!res || res.err) {
        tried.push({ port: p, baud: b, bytes: 0, err: String((res && res.err) || "open failed") });
        log(`  ✗ ${p} @ ${b}: ${String((res && res.err) || "open failed").slice(0, 90)}`);
        continue;
      }
      /* بازکردنِ پورت پالسِ ریست هم می‌زند؛ کمی فرصت بده تا برد بالا بیاید
         (و تا کاربر بتواند دکمه‌ی RESET دستی را بزند) */
      await nap(Math.min(400, perTryMs / 3));
      try { bridge.writeTo(res.id, "status\n"); } catch (e) {}
      await nap(perTryMs);
      try { bridge.writeTo(res.id, "help\n"); } catch (e) {}
      await nap(Math.round(perTryMs * 0.4));
      const text = rx.join("");
      try { bridge.closeSession(res.id); } catch (e) {}
      await nap(settleMs);                 /* تا پورت واقعاً رها شود */

      const sc = scoreText(text);
      const m = text.match(/(?:FW: v|Firmware v)(\d+\.\d+\.\d+)/);
      tried.push({ port: p, baud: b, bytes: sc.bytes, ratio: Math.round(sc.ratio * 100) / 100,
                   known: sc.known, sample: text.slice(0, 140).replace(/\s+/g, " ").trim() });
      if (sc.known && sc.ratio >= 0.85) {
        found = { port: p, baud: b, firmware: m ? m[1] : "", sample: tried[tried.length - 1].sample };
        log(`  ✓ FOUND the board: ${p} @ ${b} baud` + (found.firmware ? ` (firmware v${found.firmware})` : ""));
        return { found, tried, stopped };
      }
      log(sc.bytes
        ? `  … ${p} @ ${b}: ${sc.bytes} byte(s) but unreadable (${Math.round(sc.ratio * 100)}% printable) → wrong speed`
        : `  … ${p} @ ${b}: nothing`);
    }
  }
  return { found: null, tried, stopped };
}

module.exports = { findBoard, pickRealPorts };
