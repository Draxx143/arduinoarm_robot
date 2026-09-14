#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
# https://github.com/Draxx143/arduinoarm_robot
# ======================================================================
# عیب‌یابیِ اتصالِ برد به اپ (لینوکس)
#
#   bash tools/diagnose-linux.sh              # خودش پورت را پیدا می‌کند
#   bash tools/diagnose-linux.sh /dev/ttyUSB0 # پورتِ مشخص
#
# هر چیزی که برای فهمیدنِ علتِ «شناسایی می‌شود ولی کامل وصل نمی‌شود» لازم
# است را چاپ می‌کند: مجوزها، گروه dialout، اینکه چه کسی پورت را گرفته،
# dmesg، و در آخر یک **دست‌دادنِ واقعی** با برد (دقیقاً با همان روشی که
# اپ استفاده می‌کند: termios خام + پالسِ DTR) تا ببینیم برد اصلاً جواب
# می‌دهد یا نه و فریم‌ورش کدام نسخه است.
#
# خروجی را کامل کپی کن و بفرست — از رویش دقیق می‌شود گفت مشکل کجاست.
# ======================================================================
set -u

PORT="${1:-}"
BAUD="${2:-115200}"
hr() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
info() { printf '  · %s\n' "$1"; }

echo "════════════════════════════════════════════════════════════"
echo "  AXIS-5 — عیب‌یابیِ اتصالِ برد        $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════════"

# ---------------------------------------------------------------- ۱ سیستم
hr "۱) سیستم"
info "OS     : $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
info "Kernel : $(uname -srmo)"
info "User   : $(id -un) (uid $(id -u))"

# ---------------------------------------------------------------- ۲ اپ
hr "۲) اپِ نصب‌شده"
if command -v axis5-robot-control >/dev/null 2>&1; then
    ok "axis5-robot-control پیدا شد: $(command -v axis5-robot-control)"
    dpkg -l 2>/dev/null | awk '/axis5-robot-control/{print "  · نسخه‌ی deb: "$3}'
else
    warn "در PATH نیست (شاید AppImage اجرا می‌کنی)"
fi
command -v python3 >/dev/null 2>&1 \
    && ok "python3 $(python3 -V 2>&1 | awk '{print $2}') — پلِ سریالِ اپ به آن نیاز دارد" \
    || bad "python3 نصب نیست! پلِ سریالِ لینوکس بدون آن کار نمی‌کند → sudo apt install python3"

# ---------------------------------------------------------------- ۳ گروه
hr "۳) مجوزِ دسترسی به پورتِ سریال"
if id -nG | tr ' ' '\n' | grep -qx dialout; then
    ok "کاربر در گروه dialout است"
elif id -nG | tr ' ' '\n' | grep -qx uucp; then
    ok "کاربر در گروه uucp است (معادلِ dialout در بعضی توزیع‌ها)"
else
    bad "کاربر در گروه dialout نیست → sudo usermod -aG dialout \$USER"
    bad "بعدش حتماً یک بار logout/login (یا ری‌بوت) لازم است؛ بدون آن اثر نمی‌کند"
fi

# ---------------------------------------------------------------- ۴ دستگاه‌ها
hr "۴) دستگاه‌های سریالِ دیده‌شده"
FOUND=$(ls -1 /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true)
if [ -z "$FOUND" ]; then
    bad "هیچ /dev/ttyUSB* یا /dev/ttyACM* وجود ندارد — یعنی کرنل اصلاً برد را ندیده"
    info "کابل را بکش و دوباره بزن، بعد همین‌جا را نگاه کن؛ اگر نیامد:"
    printf '      - کابلِ USB **دیتا** باشد (کابل‌های فقط-شارژ بسیار رایج‌اند)\n'
    printf '      - پورت یا هابِ دیگر را امتحان کن\n'
    printf '      - sudo dmesg | tail -30 را بعد از وصل‌کردن نگاه کن\n'
else
    for p in $FOUND; do
        printf '  %s\n' "$(ls -l "$p")"
        if command -v udevadm >/dev/null 2>&1; then
            udevadm info -q property -n "$p" 2>/dev/null \
              | grep -E 'ID_VENDOR=|ID_MODEL=|ID_VENDOR_ID|ID_MODEL_ID|ID_SERIAL=' \
              | sed 's/^/      /'
        fi
    done
    [ -d /dev/serial/by-id ] && { info "نام‌های پایدار (بهتر است از این‌ها استفاده کنی):"; ls -l /dev/serial/by-id 2>/dev/null | tail -n +2 | sed 's/^/      /'; }
fi

# انتخابِ پورت
if [ -z "$PORT" ]; then
    PORT=$(ls -1 /dev/ttyACM* /dev/ttyUSB* 2>/dev/null | head -1 || true)
fi
if [ -z "$PORT" ]; then
    echo
    bad "پورتی برای آزمایش نیست — بقیه‌ی تست‌ها رد می‌شوند."
    exit 1
fi
hr "۵) پورتِ انتخاب‌شده: $PORT @ $BAUD"

# ---------------------------------------------------------------- ۶ اشغال
hr "۶) چه کسی پورت را گرفته؟"
HELD=""
if command -v fuser >/dev/null 2>&1; then
    HELD=$(fuser "$PORT" 2>/dev/null || true)
elif command -v lsof >/dev/null 2>&1; then
    HELD=$(lsof -t "$PORT" 2>/dev/null || true)
else
    warn "نه fuser هست نه lsof — نمی‌شود مطمئن بررسی کرد (sudo apt install psmisc)"
fi
if [ -n "$HELD" ]; then
    bad "پورت در اختیارِ این فرایندهاست: $HELD"
    ps -o pid=,comm= -p $(echo "$HELD" | tr -s ' ' ',' | sed 's/^,//') 2>/dev/null | sed 's/^/      /'
    bad "دو خواننده بایت‌ها را می‌دزدند → Arduino IDE / Serial Monitor / نسخه‌ی دومِ اپ را ببند"
else
    ok "کسِ دیگری پورت را نگرفته"
fi

# در لینوکس tty انحصاری نیست: یک خواننده‌ی دوم همه‌ی بایت‌های برد را می‌بلعد
# درحالی‌که دستورهای اپ هنوز به برد می‌رسند. علامتش دقیقاً همین است:
# «موتورها سفت می‌شوند / تکان می‌خورند ولی اپ هیچ پاسخی نمی‌بیند».
OWNERSHIP_BAD=0
hr "۶ب) دیمون‌هایی که پورتِ سریال را می‌قاپند (ModemManager / brltty)"
if pgrep -x ModemManager >/dev/null 2>&1; then
    bad "ModemManager در حالِ اجراست — هر tty تازه را با دستورِ AT کاوش می‌کند و DTR را تکان می‌دهد (→ ریستِ برد + بلعیدنِ بایت‌ها)"
    OWNERSHIP_BAD=1
else
    ok "ModemManager اجرا نمی‌شود"
fi
BRL=""
for f in /lib/udev/rules.d/85-brltty.rules /usr/lib/udev/rules.d/85-brltty.rules; do
    [ -f "$f" ] && grep -qi '1a86' "$f" && BRL="$f"
done
if [ -n "$BRL" ] && [ ! -f /etc/udev/rules.d/85-brltty.rules ]; then
    bad "brltty چیپِ CH340 (1a86:7523) را «نمایشگرِ بریل» می‌پندارد و دستگاه را busy می‌کند: $BRL"
    OWNERSHIP_BAD=1
elif [ -n "$BRL" ]; then
    ok "ادعای brltty روی CH340 خنثی شده (/etc/udev/rules.d/85-brltty.rules)"
else
    ok "brltty ادعایی روی CH340 ندارد"
fi
ORPH=""
command -v pgrep >/dev/null 2>&1 && ORPH=$(pgrep -f serial_bridge.py 2>/dev/null | tr '\n' ' ')
if [ -n "$ORPH" ]; then
    warn "پل(های) سریالِ زنده: $ORPH"
    ps -o pid=,etime=,args= -p $(echo "$ORPH" | tr -s ' ' ',' | sed 's/^,//') 2>/dev/null | sed 's/^/      /'
    info "اگر اپ باز نیست، این‌ها جامانده‌ی نشستِ قبلی‌اند و بایت‌ها را می‌بلعند → پیداکشان کن"
else
    ok "پلِ سریالِ جامانده‌ای نیست"
fi
if [ -f /etc/udev/rules.d/99-axis5-serial.rules ]; then
    ok "قاعده‌ی udev پروژه نصب است (ModemManager چشم می‌پوشد + نامِ ثابت)"
else
    bad "قاعده‌ی udev پروژه نصب نیست: /etc/udev/rules.d/99-axis5-serial.rules"
    OWNERSHIP_BAD=1
fi
if [ -e /dev/axis5 ]; then
    ok "/dev/axis5 → $(readlink -f /dev/axis5 2>/dev/null) (نامِ ثابت؛ با افتِ USB عوض نمی‌شود)"
else
    info "/dev/axis5 وجود ندارد — بعد از نصبِ قاعده یک بار کابل را بکش و دوباره بزن"
fi
if [ "$OWNERSHIP_BAD" = 1 ]; then
    echo
    bad "ریشه‌ی «دستور می‌رود ولی جواب برنمی‌گردد» همین‌جاست. یک دستور درستش می‌کند:"
    echo "      bash <(curl -fsSL https://raw.githubusercontent.com/Draxx143/arduinoarm_robot/arena/01a09f8f-arduinoarm-robot/tools/fix-serial-port-ownership.sh)"
    echo "    بعد کابلِ USB را یک بار بکش و دوباره بزن."
fi

# ---------------------------------------------------------------- ۷ dmesg
hr "۷) dmesg (اتصالِ USB)"
if DMESG=$(dmesg 2>/dev/null | grep -iE 'usb|tty|ch340|ch341|cp210|ftdi|arduino' | tail -14); then
    [ -n "$DMESG" ] && echo "$DMESG" | sed 's/^/  /' || warn "چیزی پیدا نشد"
else
    warn "dmesg بدون sudo خوانده نشد — امتحان کن: sudo dmesg | grep -iE 'usb|tty|ch34' | tail -20"
fi

# ---------------------------------------------------------------- ۸ خواندنِ خام
hr "۸) خواندنِ خامِ ۳ ثانیه‌ای (بدونِ فرستادنِ چیزی)"
if command -v timeout >/dev/null 2>&1; then
    RAW=$(timeout 3 cat "$PORT" 2>&1 | head -c 300 || true)
    if [ -n "$RAW" ]; then
        ok "برد خودش داده می‌فرستد:"; printf '%s\n' "$RAW" | head -8 | sed 's/^/      /'
    else
        warn "در ۳ ثانیه هیچ بایتی نیامد (طبیعی است اگر برد وسطِ کار ریست نشود)"
    fi
else
    warn "timeout نصب نیست (coreutils)"
fi

# ---------------------------------------------------------------- ۹ دست‌دادن
hr "۹) دست‌دادنِ واقعی با برد (همان روشِ اپ: termios خام + پالسِ DTR)"
python3 - "$PORT" "$BAUD" <<'PY'
import fcntl, os, sys, termios, time

port, baud = sys.argv[1], int(sys.argv[2])
print(f"  باز کردنِ {port} @ {baud} …")
try:
    fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
except OSError as e:
    print(f"  \033[31m✗ باز نشد:\033[0m {e}")
    if e.errno == 13:
        print("    → مجوز: sudo usermod -aG dialout $USER و بعد logout/login")
    elif e.errno == 16:
        print("    → پورت مشغول: Arduino IDE / Serial Monitor / اپِ دوم را ببند")
    sys.exit(0)

try:
    a = termios.tcgetattr(fd)
    sp = getattr(termios, "B%d" % baud)
    a[0] &= ~(termios.IGNBRK | termios.BRKINT | termios.PARMRK | termios.ISTRIP |
              termios.INLCR | termios.IGNCR | termios.ICRNL | termios.IXON)
    a[1] &= ~termios.OPOST
    a[2] &= ~(termios.CSIZE | termios.PARENB)
    a[2] |= termios.CS8 | termios.CLOCAL | termios.CREAD
    a[3] &= ~(termios.ICANON | termios.ECHO | termios.ECHOE | termios.ECHOK |
              termios.ECHONL | termios.ISIG | termios.IEXTEN)
    a[4] = sp; a[5] = sp
    a[6][termios.VMIN] = 0; a[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, a)
    print("  \033[32m✓\033[0m termios روی حالتِ خام تنظیم شد")
except termios.error as e:
    print(f"  \033[31m✗ termios:\033[0m {e}  (یعنی {port} یک tty واقعی نیست)")
    sys.exit(0)

# پالسِ DTR = ریستِ خودکارِ آردوینو (مثلِ IDE و خودِ اپ)
try:
    TIOCMGET, TIOCMSET = 0x5415, 0x5418
    DTR, RTS = 0x002, 0x004
    def lines(dtr, rts):
        b = fcntl.ioctl(fd, TIOCMGET, 0)
        b = (b | DTR) if dtr else (b & ~DTR)
        b = (b | RTS) if rts else (b & ~RTS)
        fcntl.ioctl(fd, TIOCMSET, b)
    # همان پالسی که خودِ اپ می‌زند — باید هر دو مکانیزمِ ریست را بزند:
    #  · Rev3: تا وقتی DTR و RTS متفاوت‌اند AVR در ریست می‌ماند، پس پایانِ
    #    پالس باید هم‌سطح باشد (وگرنه پورت باز می‌شود ولی RX=0 می‌ماند)؛
    #  · چیپِ 16U2/32U4 روی Mega 2560 / Leonardo / Micro: AVR را **فقط** با
    #    لبه‌ی RISINGِ DTR (۰→۱) ریست می‌کند. پالسِ (۱,۱)→(۱,۰)→(۱,۱) هرگز DTR
    #    را پایین نمی‌برد، پس لبه‌ی rising ندارد و برد ری‌بوت نمی‌شود — دقیقاً
    #    همان «IDE وصل می‌شود، اپ ساکت است».
    lines(0, 0); time.sleep(0.05)     # DTR پایین → لبه‌ی falling
    lines(0, 1); time.sleep(0.12)     # متفاوت → RESET پایین (Rev3)
    lines(1, 1); time.sleep(0.05)     # لبه‌ی RISINGِ DTR → ریستِ 16U2/32U4
    print("  \033[32m✓\033[0m پالسِ ریست زده شد (لبه‌ی risingِ DTR + پایانِ هم‌سطح)"
          " — برد باید ریست شود و بنرِ بوت را بفرستد")
except Exception as e:
    print(f"  \033[33m!\033[0m کنترلِ خطوطِ مودم ممکن نشد: {e}")

def drain(sec):
    end, out = time.time() + sec, b""
    while time.time() < end:
        try:
            d = os.read(fd, 4096)
            if d:
                out += d
        except BlockingIOError:
            time.sleep(0.01)
        except OSError as e:
            print(f"  \033[31m✗ خواندن:\033[0m {e}")
            break
    return out

boot = drain(3.0)
print(f"\n  ── بنرِ بوت ({len(boot)} بایت) ──")
print("   " + (boot.decode("utf-8", "replace").strip().replace("\n", "\n   ")[:700] or "(هیچ — برد چیزی نفرستاد)"))

os.write(fd, b"status\n")
rep = drain(2.0)
print(f"\n  ── پاسخِ «status» ({len(rep)} بایت) ──")
print("   " + (rep.decode("utf-8", "replace").strip().replace("\n", "\n   ")[:900] or "(هیچ)"))

os.write(fd, b"pos\n")
p = drain(1.2)
print(f"\n  ── پاسخِ «pos» ({len(p)} بایت) ──")
print("   " + (p.decode("utf-8", "replace").strip().replace("\n", "\n   ")[:200] or "(هیچ)"))

txt = (boot + rep + p).decode("utf-8", "replace")
print("\n  ── جمع‌بندی ──")
if "AXIS-5 Firmware v" in txt or "FW: v" in txt:
    import re
    m = re.search(r"v?(\d+\.\d+\.\d+)", txt)
    print(f"  \033[32m✓ برد جواب می‌دهد و فریم‌ور را گزارش کرد: {m.group(0) if m else '?'}\033[0m")
    print("    → پس پورت، مجوز و فریم‌ور سالم‌اند؛ مشکل در خودِ اپ است.")
    print("      اپ را از ترمینال اجرا کن تا خطاهایش دیده شود:  axis5-robot-control")
elif "System Status" in txt or ">> POS" in txt:
    print("  \033[32m✓ برد جواب می‌دهد\033[0m ولی نسخه را چاپ نکرد → فریم‌ورِ روی برد قدیمی است؛")
    print("    firmware/RobotArm_Firmware/ را دوباره فلش کن (باید v1.0.41 باشد).")
elif len(txt.strip()) == 0:
    print("  \033[31m✗ پورت باز شد ولی برد هیچ چیزی نفرستاد.\033[0m")
    print("    به این ترتیب چک کن:")
    print("     ۱. LED چشمک‌زنِ فریم‌ور (STATUS_LED) روشن/خاموش می‌شود؟ نه → اسکچ اجرا نمی‌شود")
    print("     ۲. نرخِ سریال: این تست را با ۹۶۰۰ هم بزن →  bash tools/diagnose-linux.sh %s 9600" % port)
    print("        اگر با ۹۶۰۰ متنِ خوانا آمد، فریم‌ور با baud دیگری کامپایل شده")
    print("     ۳. اگر متنِ **به‌هم‌ریخته** دیدی → baud اشتباه است")
    print("     ۴. برد با منبعِ تغذیه‌ی خارجی روشن است؟ بعضی درایورهای موتور وقتی")
    print("        از USB تغذیه می‌شوند باعث brown-out و ریستِ پی‌در‌پیِ Mega می‌شوند")
else:
    print("  \033[33m!\033[0m داده آمد ولی قابلِ تشخیص نیست — احتمالِ زیاد baud اشتباه:")
    print("    bash tools/diagnose-linux.sh %s 9600" % port)
try:
    os.close(fd)
except OSError:
    pass
PY

hr "۱۰) قدمِ بعدی"
echo "  · اگر بخشِ ۹ «✓ برد جواب می‌دهد» گفت → اپ را از ترمینال اجرا کن و خروجی را بفرست:"
echo "        axis5-robot-control        (یا:  AppImage را از ترمینال اجرا کن)"
echo "  · اگر ✗ گفت → همان بخش را کامل برایم بفرست تا بگویم مشکل کجاست."
echo "  · کلِ خروجیِ همین اسکریپت را کپی کن؛ از رویش دقیق می‌شود تشخیص داد."
echo
