#!/usr/bin/env python3
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
