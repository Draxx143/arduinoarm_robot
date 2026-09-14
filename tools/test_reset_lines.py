#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
# https://github.com/Draxx143/arduinoarm_robot
"""تستِ پالسِ ریستِ برد — چرا «شناسایی می‌شود ولی RX صفر می‌ماند».

در بردهای Rev3 (Uno/Mega) خطِ RESET با یک جفت ترانزیستور از DTR و RTS
هدایت می‌شود: تا وقتی این دو در **سطحِ متفاوت** باشند، AVR در ریست
نگه داشته می‌شود. آن‌وقت پورت بدون هیچ خطایی باز می‌شود، بایت‌های
TX را کرنل می‌پذیرد، و RX برای همیشه صفر می‌ماند — دقیقاً همان
شکایتِ «بورد شناسایی می‌شود ولی کامل وصل نمی‌شود».

این تست **همان فایلِ واقعیِ پل** (desktop-app/bridge/serial_bridge.py)
را روی یک pty اجرا می‌کند و با یک fcntlِ شبیه‌سازی‌شده، هر ioctlِ
کنترلِ خطوط را ثبت می‌کند. چون pty این ioctl ها را ندارد (ENOTTY)،
بدونِ این شبیه‌سازی هیچ‌وقت نمی‌شد این منطق را تست کرد.

بررسی‌ها:
  ۱. پل آماده می‌شود («R:» می‌فرستد) — ولی **نه بی‌درنگ**: اول منتظرِ بنرِ
     بوت می‌ماند و اگر برد ساکت بود، بعد از مهلت ادامه می‌دهد (hang نه)
  ۲. پالسِ ریست واقعاً زده می‌شود (حداقل یک وضعیتِ «متفاوت» دیده شود)
  ۳. **وضعیتِ نهایی: DTR و RTS یکسان و هر دو asserted** — یعنی برد از
     ریست آزاد شده و اجرا می‌شود
  ۴. هرگز در وضعیتِ متفاوت رها نشود (اگر ioctl وسطِ کار استثنا بدهد)
  ۵. اسکریپتِ تشخیصِ ترمینال هم همان قانون را دارد (آخرین خطوط(۱,۱))

    python3 tools/test_reset_lines.py
"""
import ast
import io
import os
import pty
import re
import runpy
import sys
import time
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRIDGE = os.path.join(ROOT, "desktop-app", "bridge", "serial_bridge.py")
DIAGNOSE = os.path.join(ROOT, "tools", "diagnose-linux.sh")

TIOCMGET, TIOCMSET = 0x5415, 0x5418
TIOCM_DTR, TIOCM_RTS = 0x002, 0x004

PASS = FAIL = 0


def check(ok, name, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  \033[32m✔\033[0m {name}" + (f" — {detail}" if detail else ""))
    else:
        FAIL += 1
        print(f"  \033[31m✘\033[0m {name}" + (f" — {detail}" if detail else ""))


def same_level(bits):
    return bool(bits & TIOCM_DTR) == bool(bits & TIOCM_RTS)


def run_bridge_on_pty(fail_at=None, ready_wait="0.3"):
    """پلِ واقعی را روی pty اجرا کن و تاریخچه‌ی خطوطِ مودم را برگردان.

    fail_at: شماره‌ی چندمین TIOCMSET باید استثنا بدهد (شبیه‌سازیِ مبدلِ
             ناقص) — برای اینکه مطمئن شویم حتی در آن حالت هم برد در ریست
             رها نمی‌شود.
    ready_wait: مهلتِ انتظارِ بنرِ بوت (ثانیه) — کوتاه، تا تست معطلِ
             ۵ ثانیه‌ی واقعی نماند. خروجی: (stdout, تاریخچه, ثانیه‌ی سپری‌شده)
    """
    mfd, sfd = pty.openpty()
    slave = os.ttyname(sfd)
    os.close(sfd)                      # خودِ پل بازمی‌کندش

    history = []                       # هر وضعیتِ خطوط بعد از هر TIOCMSET
    state = {"bits": TIOCM_DTR | TIOCM_RTS}   # بعدِ open، درایور هر دو را asserted می‌کند
    calls = {"set": 0}
    real_fcntl = __import__("fcntl")

    fake = types.ModuleType("fcntl")
    for attr in dir(real_fcntl):
        if not attr.startswith("_"):
            setattr(fake, attr, getattr(real_fcntl, attr))

    def ioctl(fd, req, arg=0, mutate_flag=True):
        if req == TIOCMGET:
            return state["bits"]
        if req == TIOCMSET:
            calls["set"] += 1
            if fail_at is not None and calls["set"] == fail_at:
                raise OSError(25, "Inappropriate ioctl for device")
            state["bits"] = int(arg) & 0xFFFF
            history.append(state["bits"])
            return 0
        return real_fcntl.ioctl(fd, req, arg, mutate_flag)

    fake.ioctl = ioctl

    saved = {
        "fcntl": sys.modules.get("fcntl"),
        "argv": sys.argv,
        "stdin": sys.stdin,
        "stdout": sys.stdout,
    }
    out = io.StringIO()
    sys.modules["fcntl"] = fake
    sys.argv = ["serial_bridge.py", slave, "115200", ready_wait]
    sys.stdin = io.StringIO("")        # EOF فوری: حلقه‌ی stdin تمام می‌شود
    sys.stdout = out
    t0 = time.monotonic()
    try:
        runpy.run_path(BRIDGE, run_name="__main__")
    except SystemExit:
        pass
    except BaseException as e:         # پل نباید با استثنا بمیرد
        history.append(("EXC", repr(e)))
    finally:
        for k, v in saved.items():
            if k == "fcntl":
                if v is None:
                    sys.modules.pop("fcntl", None)
                else:
                    sys.modules[k] = v
            else:
                setattr(sys, k, v)
        try:
            os.close(mfd)
        except OSError:
            pass
    return out.getvalue(), [h for h in history if not isinstance(h, tuple)], time.monotonic() - t0


print("=" * 72)
print("تستِ پالسِ ریستِ برد (DTR/RTS) — علتِ «RX=0 با پورتِ سالم»")
print("=" * 72)

print("\n-- پلِ واقعیِ اپ روی pty، با fcntlِ شبیه‌سازی‌شده --")
out, hist, elapsed = run_bridge_on_pty()
lines = out.splitlines()
check("R:" in lines, "پل آماده شد (R: را فرستاد)", f"stdout: {lines[:3]!r}…")
check(any(x.startswith("N:") for x in lines),
      "پل علتِ انتظار را گزارش کرد (خطِ N: …)",
      "پیش از R: باید بگوید منتظرِ بنرِ بوت است")
check(elapsed >= 0.25,
      "R: بی‌درنگ نیامد — پل واقعاً منتظرِ بنرِ بوت ماند",
      f"%0.2fs سپری شد (مهلتِ تست 0.3s)" % elapsed)
check(elapsed < 5.0,
      "مهلت کار کرد — بردِ ساکت اتصال را hang نکرد",
      f"%0.2fs با مهلتِ 0.3s" % elapsed)
check(len(hist) >= 3, "پالسِ ریست چند مرحله‌ای است", f"{len(hist)} بار TIOCMSET")
check(any(not same_level(b) for b in hist),
      "یک وضعیتِ «متفاوت» دیده شد (یعنی RESET واقعاً پایین کشیده شد)",
      " ".join(f"DTR{'1' if b & TIOCM_DTR else '0'}/RTS{'1' if b & TIOCM_RTS else '0'}" for b in hist))
check(hist and same_level(hist[-1]),
      "وضعیتِ نهایی: DTR و RTS هم‌سطح → برد از ریست آزاد است",
      f"آخرین = DTR{'1' if hist and hist[-1] & TIOCM_DTR else '0'}/RTS{'1' if hist and hist[-1] & TIOCM_RTS else '0'}")
check(bool(hist and hist[-1] & TIOCM_DTR),
      "در پایان DTR asserted است (بردهای USB بومی «میزبان وصل است» را می‌بینند)",
      "بدونِ آن، Serial.print در 32u4/ESP32 بی‌صدا دور ریخته می‌شود")
check(not (hist and not same_level(hist[-1])),
      "هرگز در وضعیتِ متفاوت رها نمی‌شود",
      "رها شدن در تفاوت = نگه‌داشتنِ AVR در ریست برای کلِ نشست")

# ---- لبه‌ی RISINGِ DTR: تنها تریگرِ ریستِ چیپ‌های 16U2/32U4 -------------
# روی Mega 2560 / Leonardo / Micro فریم‌ورِ CDCِ چیپِ USB می‌گوید
#   if (!prevDTR && curDTR) ResetTimer = ...
# یعنی AVR فقط با لبه‌ی ۰→۱ِ DTR ریست می‌شود. پالسی که DTR را
# هرگز پایین نبرد ((۱,۱)→(۱,۰)→(۱,۱)) هیچ لبه‌ی rising نمی‌سازد: برد
# ری‌بوت نمی‌شود، بنری نمی‌فرستد، و در حالی که Arduino IDE سالم وصل
# می‌شود اپ ساکت می‌ماند. این دقیقاً همان شکایتِ کاربر بود.
dtr_seq = [bool(b & TIOCM_DTR) for b in hist]
rising = [(i, a, c) for i, (a, c) in enumerate(zip(dtr_seq, dtr_seq[1:])) if not a and c]
check(len(rising) >= 1,
      "لبه‌ی RISINGِ DTR (۰→۱) وجود دارد — تریگرِ ریستِ 16U2/32U4 (Mega 2560)",
      "DTR: " + "→".join("1" if d else "0" for d in dtr_seq))
check(any(not d for d in dtr_seq),
      "DTR واقعاً یک بار LOW شد (پالس به وضعیتِ اولیه‌ی کرنل وابسته نیست)",
      "DTR: " + "→".join("1" if d else "0" for d in dtr_seq))
check(len(rising) == 1,
      "دقیقاً یک ریست، نه دوتا (ریستِ دوم وسطِ بنرِ بوت می‌افتد و متن را cut می‌کند)",
      f"{len(rising)} لبه‌ی rising")

print("\n-- همان پل وقتی مبدل، ioctlِ دوم را پس می‌زند (مبدلِ ناقص) --")
out2, hist2, _ = run_bridge_on_pty(fail_at=2)
check("R:" in out2.splitlines(), "پل هنوز آماده می‌شود (اتصال نباید بشکند)",
      f"{len(hist2)} بار خطوط ست شد")
check(not hist2 or same_level(hist2[-1]),
      "حتی با ioctlِ ناقص، وضعیتِ نهایی هم‌سطح است",
      "پل در یک tryِ جداگانه خطوط را آزاد می‌کند")

print("\n-- اسکریپتِ تشخیصِ ترمینال (tools/diagnose-linux.sh) --")
src = open(DIAGNOSE, encoding="utf-8").read()
blocks = re.findall(r"<<'PY'\n(.*?)\nPY\n", src, re.S)
check(len(blocks) >= 1, "بلوکِ پایتونِ دست‌دادن پیدا شد", f"{len(blocks)} بلوک")
py = blocks[0] if blocks else ""
try:
    ast.parse(py)
    check(True, "بلوکِ پایتون syntax درست دارد")
except SyntaxError as e:
    check(False, "بلوکِ پایتون syntax درست دارد", str(e))
seq = re.findall(r"lines\(\s*(\d)\s*,\s*(\d)\s*\)", py)
check(len(seq) >= 3, "همان سه‌مرحله‌ی پالس در اسکریپت هست", f"{len(seq)} فراخوانی: {seq}")
check(bool(seq) and seq[-1][0] == seq[-1][1] == "1",
      "آخرین فراخوانی lines(1, 1) است → برد در ریست رها نمی‌شود",
      f"آخرین = {seq[-1] if seq else None}")
check(any(a != b for a, b in seq),
      "اسکریپت هم یک وضعیتِ «متفاوت» می‌سازد (ریستِ واقعی)",
      f"{seq}")
sdtr = [a for a, _ in seq]
srise = [i for i in range(1, len(sdtr)) if sdtr[i - 1] == "0" and sdtr[i] == "1"]
check(len(srise) >= 1,
      "اسکریپت هم لبه‌ی risingِ DTR دارد (وگرنه عیب‌یاب خودش برد را ریست نمی‌کند و گزارشِ غلط می‌دهد)",
      f"DTR: {'→'.join(sdtr)}")

print(f"\n#  نتیجه: {PASS} PASS / {FAIL} FAIL")
if FAIL:
    print("########## پالسِ ریست هنوز برد را در ریست نگه می‌دارد ##########")
    sys.exit(1)
print("########## پالسِ ریست: برد آزاد می‌شود و باید حرف بزند ##########")
