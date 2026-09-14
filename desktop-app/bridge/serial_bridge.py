#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
# https://github.com/Draxx143/arduinoarm_robot
"""AXIS-5 serial bridge: raw termios read/write over a tty, talking
base64 lines on stdin/stdout. Protocol (stdout): R: ready | D:<b64> data |
E:<b64> error | X: exiting. stdin: W:<b64> write | C: close."""
import os, sys, termios, base64, threading, time

def die(msg):
    sys.stdout.write("E:" + base64.b64encode(msg.encode()).decode() + "\n")
    sys.stdout.flush()
    sys.exit(1)

def main():
    if len(sys.argv) < 3:
        die("usage: serial_bridge.py PORT BAUD")
    path, baud = sys.argv[1], int(sys.argv[2])
    if not os.path.exists(path):
        die("port not found: " + path)
    try:
        fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    except OSError as e:
        die("open failed: " + str(e))
    try:
        attrs = termios.tcgetattr(fd)
        speed_name = "B" + str(baud)
        if not hasattr(termios, speed_name):
            die("unsupported baud: " + str(baud))
        speed = getattr(termios, speed_name)
        # raw mode
        attrs[0] &= ~(termios.IGNBRK | termios.BRKINT | termios.PARMRK | termios.ISTRIP |
                      termios.INLCR | termios.IGNCR | termios.ICRNL | termios.IXON)
        attrs[1] &= ~(termios.OPOST)
        attrs[2] &= ~(termios.CSIZE | termios.PARENB)
        attrs[2] |= (termios.CS8 | termios.CLOCAL | termios.CREAD)
        attrs[3] &= ~(termios.ICANON | termios.ECHO | termios.ECHOE | termios.ECHOK |
                      termios.ECHONL | termios.ISIG | termios.IEXTEN)
        attrs[4] = speed
        attrs[5] = speed
        attrs[6][termios.VMIN] = 0
        attrs[6][termios.VTIME] = 0
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
    except termios.error as e:
        die("termios failed: " + str(e))
    # ---- Arduino auto-reset (avrdude's classic DTR/RTS sequence) -------------
    # On Rev3 Uno/Mega the reset line is driven by a transistor PAIR: RESET is
    # pulled low whenever DTR and RTS sit at DIFFERENT levels. So the pulse must
    # END with both lines at the SAME level. Ending with DTR=1/RTS=0 (what this
    # bridge used to do) keeps the AVR held in reset for the whole session: the
    # port opens without any error, TX bytes are accepted by the kernel, and RX
    # stays 0 forever — "the board is detected but never answers".
    # Final level DTR=RTS=1 is also what the IDE/pyserial leave behind, and it
    # is what native-USB boards (32u4 / ESP32) need to treat the host as
    # "connected" — otherwise every Serial.print() is silently dropped.
    # Boards with only the 100 nF cap reset on the edge and ignore the level.
    def set_lines(dtr, rts):
        import fcntl
        TIOCMGET, TIOCMSET = 0x5415, 0x5418
        TIOCM_DTR, TIOCM_RTS = 0x002, 0x004
        bits = fcntl.ioctl(fd, TIOCMGET, 0)
        bits = (bits | TIOCM_DTR) if dtr else (bits & ~TIOCM_DTR)
        bits = (bits | TIOCM_RTS) if rts else (bits & ~TIOCM_RTS)
        fcntl.ioctl(fd, TIOCMSET, bits)

    # ---- THE PULSE -------------------------------------------------------
    # Two different reset mechanisms live on these boards, and one pulse has
    # to trigger BOTH:
    #
    #  * Rev3 boards (Uno/Mega) pull RESET low while DTR and RTS sit at
    #    DIFFERENT levels (the transistor pair), so the pulse must also end
    #    with both lines at the SAME level or the AVR is held in reset for
    #    the whole session.
    #  * The 16U2 / 32U4 USB chips on the Mega 2560 / Leonardo / Micro reset
    #    the AVR ONLY on the DTR RISING edge (0 -> 1): their CDC firmware does
    #    `if (!prevDTR && curDTR) ResetTimer = ...`. A pulse that never drives
    #    DTR low produces no rising edge, so the board is never re-booted: the
    #    port opens cleanly, nothing is ever received, and the Arduino IDE
    #    (which drops DTR then raises it, like avrdude) still works fine.
    #    That is the "IDE works, the app is silent" failure.
    #
    # (0,0) -> (0,1) -> (1,1) is deterministic: it contains the DTR falling
    # edge (resets cap-coupled boards), exactly ONE DTR rising edge (resets
    # 16U2/32U4 boards) regardless of the DTR level the kernel left behind on
    # open, and it ends with both lines asserted so native-USB boards see the
    # host as connected instead of silently dropping every Serial.print().
    #
    # Starting from (1,1) is wrong twice over: it has no falling edge, and if
    # the kernel left DTR low that first step is itself a rising edge, so the
    # second reset can land mid-banner and truncate the boot text.
    try:
        set_lines(False, False)   # DTR low: falling edge for cap-coupled boards
        time.sleep(0.05)
        set_lines(False, True)    # levels differ -> RESET pulled low on Rev3
        time.sleep(0.12)          # hold reset (bootloaders want >= 50 ms)
    except Exception:
        pass                      # ptys/ports without modem-control ioctls
    try:
        set_lines(True, True)     # DTR RISING edge -> 16U2/32U4 reset; both
    except Exception:             # asserted -> Rev3 released, host "connected"
        pass
    time.sleep(0.05)
    sys.stdout.write("R:\n")
    sys.stdout.flush()

    stop = threading.Event()
    def reader():
        while not stop.is_set():
            try:
                d = os.read(fd, 4096)
            except BlockingIOError:
                time.sleep(0.004)
                continue
            except OSError:
                break
            if d:
                sys.stdout.write("D:" + base64.b64encode(d).decode() + "\n")
                sys.stdout.flush()
        sys.stdout.write("X:\n")
        sys.stdout.flush()
    t = threading.Thread(target=reader, daemon=True)
    t.start()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        if line.startswith("W:"):
            try:
                os.write(fd, base64.b64decode(line[2:]))
            except OSError as e:
                sys.stdout.write("E:" + base64.b64encode(str(e).encode()).decode() + "\n")
                sys.stdout.flush()
        elif line.startswith("C:"):
            break
    stop.set()
    time.sleep(0.05)
    try:
        os.close(fd)
    except OSError:
        pass

main()
