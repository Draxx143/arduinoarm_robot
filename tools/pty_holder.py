#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
# https://github.com/Draxx143/arduinoarm_robot
"""کمکیِ تست: یک جفت pty می‌سازد و نقشِ «برد» را بازی می‌کند.

چرا: پلِ سریال (desktop-app/bridge/serial_bridge.py) روی یک tty واقعی
termios و ioctl می‌زند، پس با لوله‌ی معمولی نمی‌شود تستش کرد. اینجا یک
pty می‌سازیم؛ سمتِ Node پل را روی slave باز می‌کند و این اسکریپت از سمتِ
master داده می‌فرستد/می‌گیرد.

پروتکل:
  stdout: خطِ اول = مسیرِ slave
          بعد: GOT:<متنِ رسیده از پل، با \\n فرار>
  stdin : SEND:<متن>  → همان متن + \\n به master نوشته می‌شود
          QUIT        → خروج
"""
import errno
import os
import pty
import select
import sys
import threading
import time
import tty


def main():
    mfd, sfd = pty.openpty()
    tty.setraw(mfd)          # مهم: بدون raw، رشته‌ی tty داده را دستکاری می‌کند
    try:
        tty.setraw(sfd)
    except Exception:
        pass
    slave = os.ttyname(sfd)
    os.close(sfd)            # slave را خودِ پل باز می‌کند
    sys.stdout.write(slave + "\n")
    sys.stdout.flush()

    stop = threading.Event()

    def pump():
        while not stop.is_set():
            try:
                r, _, _ = select.select([mfd], [], [], 0.2)
                if not r:
                    continue
                d = os.read(mfd, 4096)
                if not d:
                    break
                txt = d.decode("utf-8", "replace").replace("\r", "").replace("\n", "\\n")
                sys.stdout.write("GOT:" + txt + "\n")
                sys.stdout.flush()
            except OSError as e:
                # تا وقتی slave باز نشده، خواندنِ master یعنی EIO — عادی است
                if e.errno == errno.EIO:
                    time.sleep(0.03)
                    continue
                break

    threading.Thread(target=pump, daemon=True).start()

    for line in sys.stdin:
        line = line.rstrip("\n")
        if line == "QUIT":
            break
        if line.startswith("SEND:"):
            try:
                os.write(mfd, (line[5:] + "\n").encode("utf-8"))
            except OSError:
                pass
    stop.set()
    try:
        os.close(mfd)
    except OSError:
        pass


if __name__ == "__main__":
    main()
