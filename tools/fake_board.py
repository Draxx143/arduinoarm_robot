#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
# https://github.com/Draxx143/arduinoarm_robot
"""بردِ جعلی برای تست — روی یک pty، دقیقاً مثلِ فریم‌ورِ واقعی جواب می‌دهد.

    python3 tools/fake_board.py [VERSION] [--only-baud N]

`--only-baud N` بردِ ساکت را شبیه‌سازی می‌کند: تا وقتی پورت با سرعتِ دیگری
باز باشد هیچ نمی‌گوید (دقیقاً همان «RX=0» در دنیای واقعی). این اجازه
می‌دهد کاوشِ خودکارِ baud در عیب‌یاب واقعاً تست شود — سرعتِ slave روی
masterِ pty هم دیده می‌شود، پس بردِ جعلی می‌تواند بفهمد اپ با چه baud
بازش کرده است.

چرا لازم است: عیب‌یابِ اتصال (desktop-app/main/doctor.js) باید روی چیزی
آزمایش شود که واقعاً مثلِ برد رفتار کند — بنرِ بوت با نسخه، بلوکِ کاملِ
`status`، و خطِ `>> POS`. بدون بردِ واقعی، این اسکریپت همان نقش را بازی
می‌کند و می‌شود حتی نسخه‌ی «قدیمی» را هم با آن شبیه‌سازی کرد تا گیتِ نسخه
تست شود.

پروتکل: خطِ اولِ stdout = مسیرِ slave (pty). stdin: «QUIT» = خروج.
"""
import errno
import os
import pty
import select
import sys
import termios
import threading
import time
import tty

FW_VERSION = "1.0.41"
ONLY_BAUD = 0
_args = sys.argv[1:]
_i = 0
while _i < len(_args):
    if _args[_i] == "--only-baud":
        ONLY_BAUD = int(_args[_i + 1]); _i += 2
    else:
        FW_VERSION = _args[_i]; _i += 1

mfd, sfd = pty.openpty()
tty.setraw(mfd)
try:
    tty.setraw(sfd)
except Exception:
    pass
slave = os.ttyname(sfd)
os.close(sfd)                     # slave را خودِ پل باز می‌کند
sys.stdout.write(slave + "\n")
sys.stdout.flush()

stop = False
buf = ""
banner_sent = False


def host_baud():
    """سرعتی که میزبان (پل) روی این tty گذاشته است."""
    try:
        return termios.tcgetattr(mfd)[4]
    except Exception:
        return 0


BAUD_NAMES = {getattr(termios, n): int(n[1:])
              for n in dir(termios) if n.startswith("B") and n[1:].isdigit()}


def send(text):
    # بردِ «فقط-9600» با سرعتِ اشتباه هیچ نمی‌گوید — مثلِ بردِ واقعی
    if ONLY_BAUD and BAUD_NAMES.get(host_baud(), 0) != ONLY_BAUD:
        return True
    try:
        os.write(mfd, text.encode("utf-8"))
        return True
    except OSError:
        return False


def banner():
    global banner_sent
    if banner_sent:
        return
    if send("======================================\n"
            "5 DOF Robot Arm - TEST MODE (No ROS)\n"
            "AXIS-5 Firmware v" + FW_VERSION + "\n"
            "======================================\n"
            "System initialized.\n"):
        banner_sent = True


def handle(cmd):
    if not cmd:
        return
    banner()                      # اولین برخورد = برد تازه ریست شده
    if cmd == "status":
        send("=== System Status ===\nState: Ready\n")
        send("FW: v" + FW_VERSION + "\nProfile: NORMAL (100%)\n")
        send("Homing priority: J1 -> J2 -> J3 -> J4 -> J5\n")
        send("Homed: J1[ok] J2[ok] J3[ok] J4[ok] J5[ok]\n")
        for i in range(1, 6):
            send("Axis %d: 0 (0.0°), Homed=Y, En=Y, Mov=N, V=0/2000, ES=Open\n" % i)
        send("======================\n")
        send(">> POS 0.0,0.0,0.0,0.0,0.0\n")
    elif cmd == "pos":
        send(">> POS 0.0,0.0,0.0,0.0,0.0\n")
    elif cmd == "help":
        send("Commands: status, pos, home, move, deg, ik, fk ...\n")
    else:
        send("> " + cmd + "\nUnknown command - send 'help'\n")


def reader():
    global buf
    while not stop:
        try:
            r, _, _ = select.select([mfd], [], [], 0.2)
            if not r:
                continue
            d = os.read(mfd, 4096)
            if not d:
                break
            buf += d.decode("utf-8", "replace")
            while "\n" in buf:
                line, buf = buf.split("\n", 1)
                handle(line.strip())
        except OSError as e:
            if e.errno == errno.EIO:      # تا slave باز نشده، خواندن یعنی EIO
                time.sleep(0.03)
                continue
            break


threading.Thread(target=reader, daemon=True).start()

# بنر را یکی دو بار تلاش کن (اگر بردِ واقعی بود، بعد از پالسِ DTR می‌آمد)
for _ in range(6):
    if banner_sent or stop:
        break
    banner()
    time.sleep(0.25)

for line in sys.stdin:
    if line.strip() == "QUIT":
        break
stop = True
try:
    os.close(mfd)
except OSError:
    pass
