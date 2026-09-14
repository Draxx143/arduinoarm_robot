#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
# https://github.com/Draxx143/arduinoarm_robot
# ======================================================================
#  AXIS-5 — فلشِ کاملِ فریم‌ور روی Mega 2560 از ترمینالِ اوبونتو
#
#  یک‌خطی (بدون کلون کردن ریپو):
#     bash <(curl -fsSL https://raw.githubusercontent.com/Draxx143/arduinoarm_robot/arena/01a09f8f-arduinoarm-robot/tools/flash-linux.sh)
#
#  یا بعد از کلون:
#     bash tools/flash-linux.sh                  # پیدا کردن پورت + کامپایل + آپلود
#     bash tools/flash-linux.sh --port /dev/ttyACM0
#     bash tools/flash-linux.sh --compile-only   # فقط بساز، آپلود نکن
#     bash tools/flash-linux.sh --dry-run        # فقط نشان بده چه می‌کرد
#     bash tools/flash-linux.sh --keep-ros       # دست به ROS_Interface نزن
#
#  چه کار می‌کند:
#    ۱. arduino-cli را پیدا می‌کند؛ نبود در ~/.local/bin نصب می‌کند (بدون روت)
#    ۲. هسته‌ی arduino:avr را نصب می‌کند
#    ۳. وابستگیِ rosserial را حل می‌کند: اول کتابخانه، و اگر نبود
#       ROS_Interface.{h,cpp} را موقتاً کنار می‌گذارد (فریم‌ور TEST MODE است
#       و هیچ فایلِ دیگری به آن ارجاع نمی‌دهد) و بعد از ساخت برمی‌گرداند
#    ۴. با FQBN درست (arduino:avr:mega) کامپایل می‌کند
#    ۵. آپلود می‌کند و بعد بنرِ بوت را از خودِ برد می‌خواند تا نسخه تأیید شود
#
#  نکته: Arduino IDE هم همین کار را می‌کند؛ این اسکریپت فقط همان را بدونِ GUI
#  و بدونِ حدس‌زدنِ تنظیمات انجام می‌دهد.
# ======================================================================
set -uo pipefail

REPO_BRANCH="arena/01a09f8f-arduinoarm-robot"
FQBN="${AXIS5_FQBN:-arduino:avr:mega}"
BAUD="115200"
DRY=0
COMPILE_ONLY=0
KEEP_ROS=0
PORT="${AXIS5_PORT:-}"
CLI="${AXIS5_ARDUINO_CLI:-}"
BUILD_DIR="${AXIS5_BUILD:-$HOME/.cache/axis5-build}"

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run)      DRY=1 ;;
        --compile-only|--no-upload) COMPILE_ONLY=1 ;;
        --keep-ros)     KEEP_ROS=1 ;;
        --port)         shift; PORT="${1:-}" ;;
        --port=*)       PORT="${1#--port=}" ;;
        --fqbn)         shift; FQBN="${1:-$FQBN}" ;;
        --fqbn=*)       FQBN="${1#--fqbn=}" ;;
        -h|--help)      sed -n '2,30p' "$0"; exit 0 ;;
        *)              echo "گزینه‌ی ناشناخته: $1" >&2; exit 2 ;;
    esac
    shift
done

# ---------------------------------------------------------------- رنگ/لاگ
if [ -t 1 ]; then
    C_G=$'\033[32m'; C_R=$'\033[31m'; C_Y=$'\033[33m'; C_B=$'\033[1m'; C_0=$'\033[0m'
else
    C_G=""; C_R=""; C_Y=""; C_B=""; C_0=""
fi
step() { printf '\n%s── %s%s\n' "$C_B" "$1" "$C_0"; }
ok()   { printf '  %s✓%s %s\n' "$C_G" "$C_0" "$1"; }
bad()  { printf '  %s✗%s %s\n' "$C_R" "$C_0" "$1"; }
warn() { printf '  %s!%s %s\n' "$C_Y" "$C_0" "$1"; }
info() { printf '  · %s\n' "$1"; }
run()  {
    if [ "$DRY" = 1 ]; then printf '  %s[dry-run]%s %s\n' "$C_Y" "$C_0" "$*"
    else printf '  %s$%s %s\n' "$C_B" "$C_0" "$*"; eval "$@"; fi
}

# ------------------------------------------------------- پوشه‌ی اسکچ کجاست؟
find_sketch() {
    local here d
    here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
    for d in "$here/../firmware/RobotArm_Firmware" "./firmware/RobotArm_Firmware" \
             "$HOME/arduinoarm_robot/firmware/RobotArm_Firmware"; do
        if [ -f "$d/RobotArm_Firmware.ino" ]; then
            (cd "$d" && pwd); return 0
        fi
    done
    return 1
}

step "۰) پیش‌نیازها"
if [ "$(uname -s)" != "Linux" ]; then
    bad "این اسکریپت برای لینوکس است (برای ویندوز: Arduino IDE یا arduino-cli.exe)"
    exit 1
fi
info "سیستم: $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") · کاربر: $(id -un)"

SKETCH="$(find_sketch)" || {
    bad "پوشه‌ی اسکچ پیدا نشد. اول ریپو را کلون کن:"
    info "git clone https://github.com/Draxx143/arduinoarm_robot.git && cd arduinoarm_robot"
    info "یا یک‌خطی از خودِ ریپو اجرا کن (بالاتر، بخشِ یک‌خطی)."
    exit 1
}
ok "اسکچ: $SKETCH"
FW_VER="$(sed -n 's/^#define FIRMWARE_VERSION[[:space:]]*"\([^"]*\)".*/\1/p' "$SKETCH/Config.h" | head -1)"
info "نسخه‌ی فریم‌ورِ همین پوشه: ${FW_VER:-نامعلوم}"

# ------------------------------------------------------------- arduino-cli
step "۱) arduino-cli"
if [ -z "$CLI" ]; then
    for c in arduino-cli "$HOME/.local/bin/arduino-cli" /usr/local/bin/arduino-cli; do
        if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CLI="$c"; break; fi
    done
fi
if [ -n "$CLI" ]; then
    ok "$("$CLI" version 2>/dev/null | head -1)"
else
    warn "arduino-cli نصب نیست — در ~/.local/bin نصب می‌شود (روت لازم نیست)"
    run "mkdir -p \"\$HOME/.local/bin\" \"\$HOME/.cache/axis5-cli\""
    run "curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh -o \"\$HOME/.cache/axis5-cli/install.sh\""
    run "BINDIR=\"\$HOME/.local/bin\" sh \"\$HOME/.cache/axis5-cli/install.sh\""
    CLI="$HOME/.local/bin/arduino-cli"
    if [ "$DRY" = 0 ] && [ ! -x "$CLI" ]; then
        bad "نصبِ arduino-cli ناموفق بود. دستی: https://arduino.github.io/arduino-cli/latest/installation/"
        exit 1
    fi
fi
[ "$DRY" = 0 ] && export PATH="$HOME/.local/bin:$PATH"

step "۲) هسته‌ی AVR"
run "\"$CLI\" core update-index"
run "\"$CLI\" core install arduino:avr"

# -------------------------------------------------------------- rosserial
# ROS_Interface.h هدرهای ros.h و sensor_msgs/std_msgs را include می‌کند و IDE
# **همه‌ی** .cppهای پوشه‌ی اسکچ را کامپایل می‌کند — پس حتی در TEST MODE بدونِ
# آن کتابخانه ساخت شکست می‌خورد. هیچ فایلِ دیگری به ROS_Interface ارجاع
# نمی‌دهد (با grep تأیید شده)، پس کنار گذاشتنش بی‌خطر است.
STASH=""
restore_ros() {
    [ -n "$STASH" ] && [ -d "$STASH" ] || return 0
    mv "$STASH"/ROS_Interface.* "$SKETCH/" 2>/dev/null
    rmdir "$STASH" 2>/dev/null
    ok "ROS_Interface.{h,cpp} سرِ جایش برگشت"
}
trap restore_ros EXIT INT TERM

step "۳) وابستگیِ rosserial"
if [ "$KEEP_ROS" = 1 ]; then
    info "--keep-ros: دست به ROS_Interface نمی‌زنم (کتابخانه باید نصب باشد)"
elif [ "$DRY" = 0 ] && "$CLI" lib install "rosserial_arduino" >/dev/null 2>&1; then
    ok "کتابخانه‌ی rosserial_arduino نصب شد"
elif [ "$DRY" = 1 ]; then
    info "[dry-run] اول «arduino-cli lib install rosserial_arduino» امتحان می‌شود؛ نشد ROS_Interface موقتاً کنار گذاشته می‌شود"
else
    warn "کتابخانه‌ی rosserial_arduino در دسترس نیست — ROS_Interface.{h,cpp} موقتاً کنار گذاشته می‌شود"
    info "فریم‌ور TEST MODE (بدون ROS) است و هیچ فایلِ دیگری به آن ارجاع نمی‌دهد، پس ساخت سالم می‌ماند"
    STASH="$(mktemp -d)"
    mv "$SKETCH"/ROS_Interface.h "$SKETCH"/ROS_Interface.cpp "$STASH/" 2>/dev/null
    ok "کنار گذاشته شد در: $STASH (بعد از ساخت خودش برمی‌گردد)"
fi

# ------------------------------------------------------------------- پورت
step "۴) پورت"
if [ -z "$PORT" ]; then
    for p in /dev/axis5 /dev/ttyACM0 /dev/ttyACM1 /dev/ttyUSB0 /dev/ttyUSB1; do
        [ -e "$p" ] && { PORT="$p"; break; }
    done
fi
if [ -z "$PORT" ]; then
    bad "هیچ پورتِ سریالی پیدا نشد (/dev/axis5، /dev/ttyACM*، /dev/ttyUSB*)"
    info "کابل را بزن و این را ببین: sudo dmesg | tail -20"
    info "Mega 2560 اصلی معمولاً /dev/ttyACM0 می‌شود و کلون‌های CH340 /dev/ttyUSB0"
    [ "$COMPILE_ONLY" = 1 ] || [ "$DRY" = 1 ] || exit 1
else
    ok "پورت: $PORT"
    if [ ! -r "$PORT" ] || [ ! -w "$PORT" ]; then
        warn "مجوزِ خواندن/نوشتن نداری — این یک بار لازم است:"
        info "sudo usermod -aG dialout \$USER   # بعد یک بار logout/login"
        info "یا موقتاً: sudo chmod a+rw $PORT"
    fi
fi

# ------------------------------------------------------------- کامپایل/آپلود
step "۵) کامپایل"
run "\"$CLI\" compile --fqbn $FQBN --build-path \"$BUILD_DIR\" \"$SKETCH\""
RC=$?
if [ "$DRY" = 0 ] && [ "$RC" -ne 0 ]; then
    bad "کامپایل شکست خورد — متنِ خطا را کامل بفرست"
    exit 1
fi
[ "$DRY" = 0 ] && ok "ساخت موفق"

if [ "$COMPILE_ONLY" = 1 ]; then
    step "۶) آپلود"
    info "--compile-only: آپلود انجام نشد — خروجی (.hex/.elf) اینجاست: $BUILD_DIR"
    exit 0
fi

step "۶) آپلود روی برد"
if [ -n "$PORT" ]; then
    run "\"$CLI\" upload -p \"$PORT\" --fqbn $FQBN \"$SKETCH\""
fi

step "۷) راستی‌آزمایی"
info "اپ را ببند (پورت را ول کند)، بعد:"
info "  bash tools/diagnose-linux.sh $PORT"
info "باید بنرِ «AXIS-5 Firmware v${FW_VER:-?}» را ببینی. اگر «پورت دستِ برنامه‌ی دیگری است» گفت:"
info "  bash <(curl -fsSL https://raw.githubusercontent.com/Draxx143/arduinoarm_robot/${REPO_BRANCH}/tools/fix-serial-port-ownership.sh)"

if [ "$DRY" = 1 ]; then
    printf '\n%s[dry-run] هیچ چیزی اجرا/تغییر نکرد.%s\n' "$C_Y" "$C_0"
fi
