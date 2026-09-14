#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
# https://github.com/Draxx143/arduinoarm_robot
"""AXIS-5 serial bridge: raw termios read/write over a tty, talking
base64 lines on stdin/stdout. Protocol (stdout): R: ready | D:<b64> data |
N:<b64> progress notice | E:<b64> error | X: exiting. stdin: W:<b64> write |
C: close.

Usage: serial_bridge.py PORT BAUD [READY_WAIT_S]

R: is sent only after the board's boot banner has been SEEN on the wire,
or after READY_WAIT_S seconds (default 5.0) with no banner — never right
after the reset pulse. That is what makes "Connected" deterministic: the
desktop app cannot send its first command into the bootloader window.
Readers that do not know N: lines must simply ignore them.
"""
import os, sys, termios, base64, threading, time

# Boot-handshake markers: substrings of the banner that setup() in
# firmware/RobotArm_Firmware/RobotArm_Firmware.ino always prints
# ("AXIS-5 Firmware v..." early, "System initialized." when setup is done).
# No new firmware protocol was invented — these lines already existed.
BANNER_MARKERS = (b"AXIS-5 Firmware", b"System initialized.")
READY_WAIT_S_DEFAULT = 5.0

def die(msg):
    sys.stdout.write("E:" + base64.b64encode(msg.encode()).decode() + "\n")
    sys.stdout.flush()
    sys.exit(1)

def main():
    if len(sys.argv) < 3:
        die("usage: serial_bridge.py PORT BAUD [READY_WAIT_S]")
    path, baud = sys.argv[1], int(sys.argv[2])
    try:
        ready_wait_s = float(sys.argv[3]) if len(sys.argv) > 3 else READY_WAIT_S_DEFAULT
    except ValueError:
        ready_wait_s = READY_WAIT_S_DEFAULT
    ready_wait_s = min(30.0, max(0.0, ready_wait_s))
    if not os.path.exists(path):
        die("port not found: " + path)

    def note(msg):
        # Progress notices. Safe at ANY time (even before R:): the Node side
        # forwards them to the app console and never fails the open on them.
        # Old readers ignore unknown line types, so this is backward compatible.
        sys.stdout.write("N:" + base64.b64encode(msg.encode()).decode() + "\n")
        sys.stdout.flush()

    def log(msg):
        # Terminal debugging. stderr BEFORE R: would fail the open on the Node
        # side, so this must only be called after R: was sent.
        print("[Bridge] " + msg, file=sys.stderr, flush=True)

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

    note("serial port opened on %s @ %d — resetting the board…" % (path, baud))

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
    t_reset_released = time.monotonic()
    note("reset released — waiting for the boot banner (up to %.1f s)…" % ready_wait_s)

    # ---- BOOT WAIT: R: means "board heard", not "port opened" ------------
    # The reset above reboots the board: bootloader (~1 s on a Mega 2560)
    # plus delay(500) plus the banner print in setup(). R: used to go out
    # 50 ms after the reset edge — about 2 s BEFORE the board could answer —
    # so the app's first `status` could land inside the bootloader window
    # (the bootloader eats it) and Connect worked only by luck.
    # Now the reader starts first (no byte is ever lost) and R: waits for the
    # real boot banner, with a hard deadline so a silent board can never hang
    # the open: worst case we continue after READY_WAIT_S anyway.
    banner_event = threading.Event()
    snoop_lock = threading.Lock()
    snoop = bytearray()

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
                # Passive snoop: every byte is still forwarded above; this only
                # watches for the banner so R: can go out at the right moment.
                # (extend(), not += : rebinding would make `snoop` a local and
                # kill this thread with UnboundLocalError.)
                with snoop_lock:
                    snoop.extend(d)
                    del snoop[:-4096]
                    if any(m in snoop for m in BANNER_MARKERS):
                        banner_event.set()
        sys.stdout.write("X:\n")
        sys.stdout.flush()
    t = threading.Thread(target=reader, daemon=True)
    t.start()

    banner_seen = banner_event.wait(ready_wait_s)
    boot_s = time.monotonic() - t_reset_released
    if banner_seen:
        note("boot banner seen after %.1f s — the board is up" % boot_s)
    else:
        note("no boot banner within %.1f s — continuing anyway "
             "(if it stays silent, press the board's RESET button)" % ready_wait_s)
    sys.stdout.write("R:\n")
    sys.stdout.flush()
    # Terminal recap (stderr is only safe to use AFTER R: — see log()).
    log("port %s @ %d opened, reset pulse done" % (path, baud))
    log("reset released, board %s (%.1f s)"
        % ("up — boot banner seen" if banner_seen else "silent after wait", boot_s))
    log("ready (R:) — commands are allowed from here on")

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
