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
    const pids = String(h.out || "").trim().split(/\s+/).filter(Boolean).map(Number)
      .filter((n) => n && n !== process.pid);
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

  const rx = [];
  const res = await o.pybridge.openBridge({
    portPath: p, baud: b, timeoutMs: 8000,
    send: (ch, payload) => {
      if (ch === "serialport:data") {
        try { rx.push(Buffer.from(payload, "base64").toString("utf8")); } catch (e) {}
      }
    },
  });
  if (res.err) {
    add("handshake", false, "the bridge could not open the port: " + res.err, "");
    return { port: p, baud: b, checks };
  }

  await nap(H || 2600);                                   /* بنرِ بوت بعد از پالسِ ریست */
  o.pybridge.writeTo(res.id, "status\n");
  await nap(H || 1600);
  o.pybridge.writeTo(res.id, "pos\n");
  await nap(H || 900);
  const text = rx.join("");
  o.pybridge.closeSession(res.id);
  await nap(H ? 50 : 250);

  add("rx", text.length > 0, `${text.length} byte(s) came back from the board`,
      text.length ? "" :
        "the board is silent: is the firmware's heartbeat LED blinking? try another baud (9600), " +
        "and make sure the USB cable carries data (charge-only cables are very common)");

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

module.exports = { runDoctor };
