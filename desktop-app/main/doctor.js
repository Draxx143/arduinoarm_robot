/* ============================================================
 * doctor.js — 🩺 عیب‌یابِ اتصال
 *
 * به‌جای حدس زدن، همه‌ی چیزهایی را که می‌توانند مانعِ اتصالِ برد شوند
 * یک‌جا بررسی می‌کند و برای هر مورد **راه‌حلِ دقیق** می‌دهد:
 *
 *   python3      پلِ لینوکس/مک به آن نیاز دارد
 *   group        عضویت در dialout/uucp (بدون آن + logout/login پورت باز نمی‌شود)
 *   device       وجودِ گره‌ی دستگاه (/dev/ttyUSB0 …)
 *   permission   خواندن/نوشتنِ همان گره توسط همین کاربر
 *   free         اینکه چه فرایندِ دیگری پورت را گرفته (دو خواننده = بایتِ دزدیده)
 *   dmesg        آخرین رویدادهای USB
 *   handshake    بازکردنِ واقعیِ پورت با همان پلی که اپ استفاده می‌کند،
 *                پالسِ DTR، فرستادنِ status/pos و شمارشِ بایت‌های برگشتی
 *   rx           آیا برد اصلاً چیزی فرستاد؟
 *   bauds        اگر ساکت بود: کاوشِ خودکارِ ۹۶۰۰/۵۷۶۰۰/۳۸۴۰۰
 *   firmware     کدام نسخه روی برد است (باید v1.0.41 باشد)
 *
 * این ماژول عمداً به electron وابسته نیست تا با Nodeِ خالی قابلِ تست باشد
 * (tools/test_doctor.js آن را روی یک «بردِ جعلی» روی pty آزمایش می‌کند).
 * ============================================================ */
"use strict";

const fs = require("fs");
const { execFile } = require("child_process");

/* اجرای یک دستور و برگرداندنِ {err,out,errOut} */
function defaultSh(cmd, args, ms = 4000) {
  return new Promise((res) => {
    execFile(cmd, args, { timeout: ms, maxBuffer: 512 * 1024 },
      (err, stdout, stderr) => res({
        err: err ? String((err && err.message) || err) : "",
        out: String(stdout || ""),
        errOut: String(stderr || ""),
      }));
  });
}
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

/* baudِ خودِ فریم‌ور (Config.h: SERIAL_BAUD) — مرجعِ «سرعتِ درست». */
const FW_BAUD = 115200;

/* آیا این متن واقعاً حرفِ برد است یا بایتِ به‌هم‌ریخته‌ی baudِ اشتباه؟
 * با سرعتِ غلط، برد همچنان بایت می‌فرستد — پس «تعدادِ بایت» به‌تنهایی
 * هیچ چیز را ثابت نمی‌کند. */
function scoreText(text) {
  const s = String(text || "");
  if (!s.length) return { bytes: 0, ratio: 0, known: false };
  let printable = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) printable++;
  }
  return {
    bytes: s.length,
    ratio: printable / s.length,
    known: /AXIS-5 Firmware|System Status|>>\s*POS|State:|Homed:|Unknown command|System initialized/i.test(s),
  };
}

/**
 * @param {object} o
 * @param {string} o.portPath
 * @param {number} o.baud
 * @param {object} o.pybridge          ماژولِ پل (desktop-app/main/pybridge.js)
 * @param {boolean} [o.busy]           اپ الان متصل است؟ (دست‌دادن رد می‌شود)
 * @param {string} [o.platform]
 * @param {string} [o.expectedFw]      نسخه‌ی فریم‌وری که اپ انتظار دارد
 * @param {Function} [o.sh]            برای تست: بدلِ execFile
 * @param {number} [o.handshakeMs]     برای تست: کوتاه‌تر کردنِ زمانِ انتظار
 * @returns {Promise<{port:string,baud:number,checks:Array}>}
 */
async function runDoctor(o) {
  const p = String(o.portPath || "");
  const b = Number(o.baud) || 115200;
  const platform = o.platform || process.platform;
  const expectedFw = String(o.expectedFw || "1.0.41");
  const sh = typeof o.sh === "function" ? o.sh : defaultSh;
  const H = Number(o.handshakeMs) || 0;      /* 0 = زمان‌های واقعی */
  const checks = [];
  const add = (name, ok, detail, fix, skip) =>
    checks.push({ name, ok: skip ? null : !!ok,
                  detail: String(detail == null ? "" : detail),
                  fix: String(fix || ""), skip: !!skip });

  /* ---- ۱) پیش‌نیازهای سیستم ---- */
  if (platform === "win32") {
    add("driver", true, "Windows: the node-serialport driver in the main process is used (python3 not needed)");
  } else {
    const py = await sh("python3", ["-V"]);
    add("python3", !py.err, py.err ? "not runnable: " + py.err : (py.out.trim() || py.errOut.trim()),
        py.err ? "sudo apt install python3   (the Linux/macOS serial bridge runs on it)" : "");
    const g = await sh("id", ["-nG"]);
    const has = /(^|\s)(dialout|uucp)(\s|$)/.test(String(g.out || "").trim());
    add("group", has, has ? "user is in dialout/uucp" : "user is NOT in dialout — groups: " + String(g.out || "").trim(),
        has ? "" : "sudo usermod -aG dialout $USER   then log out and back in (a reboot counts)");
  }

  /* ---- ۲) گره‌ی دستگاه ---- */
  let st = null;
  try { st = p ? fs.statSync(p) : null; } catch (er) { st = null; }
  add("device", !!st,
      p ? (st ? `${p} exists (mode ${(st.mode & 0o777).toString(8)})` : `${p} does not exist`)
        : "no port selected",
      st ? "" : "replug the USB cable, press ↻ rescan, and pick the /dev/… path that appears");
  if (st) {
    let rw = true, why = "";
    try { fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK); }
    catch (er) { rw = false; why = String((er && er.message) || er); }
    add("permission", rw, rw ? "this user may read/write the device" : "read/write denied: " + why,
        rw ? "" : "sudo usermod -aG dialout $USER, then log out & back in");

    const h = await sh("fuser", [p], 3000);
    /* فرایندهای خودمان (اپ + پلِ پایتونی که اپ بالا آورده) خواننده‌ی دوم
     * نیستند؛ وگرنه عیب‌یاب دقیقاً همان چیزی را می‌گفت که کاربرِ ما دید:
     * «ALSO held by PID 24396» درحالی‌که ۲۴۳۹۶ خودِ پلِ اپ بود. */
    const ours = new Set([process.pid, ...(Array.isArray(o.selfPids) ? o.selfPids : [])]);
    const pids = String(h.out || "").trim().split(/\s+/).filter(Boolean).map(Number)
      .filter((n) => n && !ours.has(n));
    add("free", pids.length === 0,
        pids.length
          ? "ALSO held by PID(s) " + pids.join(", ") + " — two readers steal each other's bytes"
          : "no other process is holding the port",
        pids.length ? "close Arduino IDE / Serial Monitor / a second copy of this app" : "");
  }

  /* ---- ۳) dmesg ---- */
  const dm = await sh("sh", ["-c", "dmesg 2>/dev/null | grep -iE 'usb|tty|ch34|cp210|ftdi' | tail -6"], 4000);
  add("dmesg", true, String(dm.out || "").trim() ||
      "(dmesg is not readable without sudo — try: sudo dmesg | tail -30)");

  /* ---- ۴) دست‌دادنِ زنده با برد ---- */
  if (!p || !st) {
    add("handshake", false, "cannot handshake: no device at that path");
    return { port: p, baud: b, checks };
  }
  if (o.busy || (o.pybridge && o.pybridge.stats && o.pybridge.stats().count)) {
    add("handshake", null,
        "skipped — the app is already connected; press Disconnect first, then run the doctor", "", true);
    return { port: p, baud: b, checks };
  }

  /* یک دست‌دادنِ کامل با یک baud مشخص. هر بار پورت را از نو باز می‌کند،
     پس پالسِ ریست هم زده می‌شود (بعضی بردها فقط بعدِ ریست حرف می‌زنند). */
  const probe = async (baud, quick) => {
    const rx = [];
    const res = await o.pybridge.openBridge({
      portPath: p, baud, timeoutMs: 8000,
      send: (ch, payload) => {
        if (ch === "serialport:data") {
          try { rx.push(Buffer.from(payload, "base64").toString("utf8")); } catch (e) {}
        }
      },
    });
    if (res.err) return { err: res.err, text: "" };
    /* بنرِ بوت بعد از پالسِ ریست. ۵ ثانیه برایِ بردی که ریستِ خودکار ندارد
       (بسیاری از کلون‌های CH340) — تا کاربر فرصت داشته باشد دکمه‌ی RESET را
       بزند؛ رندر پیش از صداکردنِ عیب‌یاب همین را در کنسول می‌گوید. */
    await nap(H || (quick ? 1200 : 5000));
    o.pybridge.writeTo(res.id, "status\n");
    await nap(H || (quick ? 900 : 1600));
    o.pybridge.writeTo(res.id, "pos\n");
    await nap(H || (quick ? 400 : 900));
    const text = rx.join("");
    o.pybridge.closeSession(res.id);
    await nap(H ? 50 : 250);
    return { text };
  };

  const first = await probe(b, false);
  if (first.err) {
    add("handshake", false, "the bridge could not open the port: " + first.err, "");
    return { port: p, baud: b, checks };
  }
  let text = first.text;

  /* ---- برد ساکت است؟ خودمان baud های محتمل را امتحان می‌کنیم ----
     رایج‌ترین علتِ «RX=0» بعد از ریستِ برد، سرعتِ اشتباه است: فریم‌وری که
     با Config.h قدیمی (۹۶۰۰) فلش شده، یا بردی که بوت‌لودرش ۹۶۰۰ است.
     به‌جای اینکه فقط بگوییم «۹۶۰۰ را امتحان کن»، خودمان امتحان می‌کنیم. */
  const ALTS = [9600, 57600, 38400].filter((x) => x !== b);
  let altHit = null;
  if (!text.length) {
    for (const alt of ALTS) {
      const r = await probe(alt, true);
      if (r.err) continue;
      if (r.text.length) { altHit = { baud: alt, text: r.text }; break; }
    }
    if (altHit) text = altHit.text;      /* بگذار بررسی‌های بعدی همان را ببینند */
  }

  /* بایت آمد ولی خوانا نبود؟ این یعنی baud اشتباه — نه بردِ خراب. */
  const sc = scoreText(text);
  add("rx", text.length > 0, `${text.length} byte(s) came back from the board` +
      (text.length && !sc.known ? ` — but only ${Math.round(sc.ratio * 100)}% printable ASCII (unreadable)` : ""),
      text.length ? "" :
        "the board is silent at every baud we tried: press the board's RESET button while the " +
        "doctor waits (many CH340 clones have no auto-reset circuit), check that the firmware's " +
        "heartbeat LED blinks, and make sure the USB cable carries data (charge-only cables are common)");
  if (text.length && !sc.known) {
    add("baudmatch", false,
        `the board sends data but it is unreadable at ${b} baud → the baud rate is WRONG ` +
        `(the firmware in this repo uses ${FW_BAUD})`,
        `set the app's baud rate to ${FW_BAUD} (the selector next to the port) and reconnect — ` +
        "garbage characters are never a board fault, always a speed mismatch");
  }

  /* نتیجه‌ی کاوشِ baud — هم وقتی پیدا شد، هم وقتی نشد */
  if (!first.text.length) {
    /* در هر دو حالت یک «مشکلِ عملی» است: یا baud اشتباه است و باید عوض
       شود، یا برد اصلاً فریم‌ور را اجرا نمی‌کند. پس ✗ — ولی با دو پیامِ
       کاملاً متفاوت، چون راه‌حلشان زمین تا آسمان فرق دارد. */
    add("bauds", false,
        altHit
          ? `FOUND IT — the board is silent at ${b} but answers at ${altHit.baud} baud`
          : `no reply at ${b}, ${ALTS.join(", ")} baud (the port opens fine, so the board itself is silent)`,
        altHit
          ? `set the app's baud rate to ${altHit.baud} and reconnect — or reflash the firmware ` +
            `whose Config.h uses SERIAL_BAUD ${b}`
          : "the board is not running the firmware: check the heartbeat LED, the data cable, " +
            "and reflash firmware/RobotArm_Firmware/ with the Arduino IDE");
  }

  const ver = (text.match(/(?:FW: v|Firmware v)(\d+\.\d+\.\d+)/) || [])[1] || "";
  if (ver) {
    add("firmware", ver === expectedFw,
        `board reports firmware v${ver} (this app expects v${expectedFw})`,
        ver === expectedFw ? "" : `flash firmware/RobotArm_Firmware/ (v${expectedFw}) to the Mega, then reconnect`);
  } else {
    const answered = /System Status|>> POS/.test(text);
    add("firmware", answered,
        answered
          ? `the board answers but reports no version → firmware older than v${expectedFw}: reflash it`
          : "no recognisable firmware reply (garbage usually means the wrong baud rate)");
  }
  add("sample", true, text.slice(0, 260).replace(/\s+/g, " ").trim() || "(empty)");

  return { port: p, baud: b, checks };
}

module.exports = { runDoctor, scoreText, FW_BAUD };
